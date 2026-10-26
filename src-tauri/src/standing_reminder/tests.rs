use super::activity::{sample_then_clock, ActivityTimeline, ResumeSample};
use super::engine::*;
struct Clock {
    engine: Engine,
    now: u64,
    stamp: u64,
    idle: u64,
    activity: ActivityTimeline,
}
impl Clock {
    fn new(work: u64, rest: u64, idle: u64, auto_lock: bool) -> Self {
        let mut engine = Engine::new(0);
        engine
            .configure(
                Settings {
                    enabled: true,
                    work_seconds: work,
                    rest_seconds: rest,
                    idle_seconds: idle,
                    auto_lock,
                    sound: false,
                },
                0,
            )
            .unwrap();
        Self {
            engine,
            now: 0,
            stamp: 0,
            idle: 0,
            activity: ActivityTimeline::default(),
        }
    }
    fn step(&mut self, ms: u64, activity: bool) -> Vec<Effect> {
        self.now += ms;
        if activity {
            self.stamp = self.now;
            self.idle = 0;
            self.activity.record(self.now, false);
        } else {
            self.idle += ms;
        }
        let resume = self.resume_sample();
        self.engine
            .tick(self.now, Some((self.stamp, self.idle)), resume)
    }
    fn resume_sample(&self) -> ResumeSample {
        ResumeSample {
            available: true,
            window: self.activity.window(),
        }
    }
    fn advance(&mut self, mut ms: u64, activity: bool) -> Vec<Effect> {
        let mut result = vec![];
        while ms > 0 {
            let step = ms.min(500);
            result.extend(self.step(step, activity));
            ms -= step;
        }
        result
    }
    fn action(&mut self, action: Action) -> Vec<Effect> {
        self.engine
            .action(action, self.now, Some(self.stamp))
            .unwrap()
    }
    fn state(&self) -> Snapshot {
        self.engine.snapshot(true, true)
    }
    fn ack(&mut self) -> Vec<Effect> {
        self.engine.presented(self.state().prompt_token, self.now)
    }
    fn session(&mut self, kind: SessionKind, active: bool) -> Vec<Effect> {
        self.engine.session(kind, active, self.now)
    }
}
#[test]
fn defaults_are_opt_in_and_45_3_60() {
    let mut e = Engine::new(0);
    assert_eq!(e.settings, Settings::default());
    assert!(e.tick(1_000_000, None, ResumeSample::default()).is_empty());
    let s = e.snapshot(true, true);
    assert_eq!(s.mode, Mode::Off);
    assert_eq!(s.work_ms, 0);
    assert!(s.error.is_none());
}
#[test]
fn exact_45_minutes_shows_one_prompt_without_early_lock() {
    let mut c = Clock::new(2700, 180, 60, true);
    assert!(c.advance(2_699_999, true).is_empty());
    assert_eq!(c.advance(1, true), vec![Effect::ShowPrompt]);
    assert!(c.state().lock_remaining_ms.is_none());
    assert!(c.advance(5000, true).is_empty());
    assert_eq!(c.state().reminder_count, 1);
}
#[test]
fn idle_confirmation_is_work_then_full_rest_requires_four_minutes() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10_000, true);
    c.advance(59_999, false);
    assert_eq!(c.state().work_ms, 69_999);
    assert_eq!(c.state().mode, Mode::Working);
    c.advance(1, false);
    assert_eq!(c.state().mode, Mode::Resting);
    assert_eq!(c.state().work_ms, 70_000);
    c.advance(179_999, false);
    assert_eq!(c.state().work_ms, 70_000);
    c.advance(1, false);
    assert_eq!(c.state().work_ms, 0);
    assert_eq!(c.state().round_id, 2);
}
#[test]
fn short_rest_preserves_work_and_fragments_do_not_accumulate() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.advance(120000, false);
    c.step(1, true);
    c.advance(5000, true);
    let saved = c.state().work_ms;
    assert_eq!(saved, 10000);
    c.action(Action::StartRest);
    c.advance(120000, false);
    c.step(1, true);
    c.advance(5000, true);
    assert_eq!(c.state().work_ms, saved);
    assert_eq!(c.state().round_id, 1);
}
#[test]
fn exact_rest_boundary_is_settled_before_return_input() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.advance(179999, false);
    c.step(1, true);
    assert_eq!(c.state().mode, Mode::Resting);
    c.advance(5000, true);
    assert_eq!(c.state().work_ms, 0);
    assert_eq!(c.state().mode, Mode::Working);
    assert_eq!(c.state().round_id, 2);
}
#[test]
fn resume_input_mouse_and_keyboard_share_one_aggregate_confirmation() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.advance(10000, false);
    c.step(500, true);
    c.advance(4999, true);
    assert_eq!(c.state().mode, Mode::Resting);
    assert_eq!(c.state().resume_confirmation_remaining_ms, Some(1));
    c.step(1, true);
    assert_eq!(c.state().mode, Mode::Working);
    assert_eq!(c.state().work_ms, 10000);
}
#[test]
fn repeated_start_rest_does_not_reset_continuous_rest_or_count_its_click() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.step(500, false);
    assert_eq!(c.state().mode, Mode::Resting);
    c.advance(10000, false);
    c.action(Action::StartRest);
    assert_eq!(c.state().rest_ms, 10500);
}
#[test]
fn manual_pause_freezes_work_rest_and_snooze() {
    let mut c = Clock::new(1, 180, 60, false);
    c.advance(1000, true);
    c.action(Action::Snooze);
    c.advance(10000, true);
    c.action(Action::Pause);
    let before = c.state();
    c.advance(600000, true);
    let after = c.state();
    assert_eq!(after.work_ms, before.work_ms);
    assert_eq!(after.snooze_remaining_ms, before.snooze_remaining_ms);
    c.action(Action::Resume);
    c.advance(1000, true);
    assert_eq!(c.state().snooze_remaining_ms, Some(289000));
}
#[test]
fn paused_lock_and_sleep_do_not_prove_rest() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::Pause);
    c.session(SessionKind::Sleeping, true);
    c.advance(600000, false);
    c.session(SessionKind::Sleeping, false);
    c.action(Action::Resume);
    assert_eq!(c.state().work_ms, 10000);
    assert_eq!(c.state().round_id, 1);
}
#[test]
fn short_lock_restores_accumulation_full_lock_clears_it() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.session(SessionKind::Locked, true);
    c.advance(179999, false);
    c.session(SessionKind::Locked, false);
    assert_eq!(c.state().work_ms, 10000);
    c.advance(1000, true);
    c.session(SessionKind::Locked, true);
    c.advance(180000, false);
    c.session(SessionKind::Locked, false);
    assert_eq!(c.state().work_ms, 0);
    assert_eq!(c.state().round_id, 2);
    assert!(!c.state().prompt_visible);
}
#[test]
fn suspended_interval_is_credited_on_resume_without_intermediate_ticks() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.session(SessionKind::Sleeping, true);
    c.now += 180000;
    c.session(SessionKind::Sleeping, false);
    assert_eq!(c.state().work_ms, 0);
    assert_eq!(c.state().round_id, 2);
}
#[test]
fn overlapping_sleep_and_lock_form_one_continuous_rest() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.session(SessionKind::Locked, true);
    c.advance(90000, false);
    c.session(SessionKind::Sleeping, true);
    c.advance(90000, false);
    c.session(SessionKind::Sleeping, false);
    assert_eq!(c.state().mode, Mode::SystemRest);
    assert_eq!(c.state().round_id, 1);
    c.session(SessionKind::Locked, false);
    assert_eq!(c.state().mode, Mode::Working);
    assert_eq!(c.state().round_id, 2);
}
#[test]
fn normal_wall_clock_restart_never_proves_rest_or_backfills_prompt() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.ack();
    let restored = Engine::restore(c.engine.checkpoint(), 86_400_000);
    let s = restored.snapshot(true, true);
    assert_eq!(s.work_ms, 1000);
    assert!(!s.prompt_visible);
    assert!(s.lock_remaining_ms.is_none());
}
#[test]
fn unexplained_gap_or_clock_reversal_preserves_work_and_cancels_lock() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.ack();
    let work = c.state().work_ms;
    c.step(6000, false);
    assert_eq!(c.state().work_ms, work);
    assert!(c.state().lock_remaining_ms.is_none());
    c.engine.tick(0, Some((0, 0)), ResumeSample::default());
    assert_eq!(c.state().work_ms, work);
}
#[test]
fn durations_change_next_round_and_switches_change_immediately() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    let mut settings = c.engine.settings.clone();
    settings.work_seconds = 600;
    settings.rest_seconds = 10;
    c.engine.configure(settings, c.now).unwrap();
    assert_eq!(c.state().active_durations.work_seconds, 2700);
    assert!(c.state().pending_durations);
    c.action(Action::StartRest);
    c.advance(180000, false);
    assert_eq!(c.state().active_durations.work_seconds, 600);
    assert!(!c.state().pending_durations);
    c.advance(20000, false);
    assert_eq!(c.state().round_id, 2);
}
#[test]
fn snooze_is_once_per_round_and_five_working_minutes() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.ack();
    c.action(Action::Snooze);
    assert!(c.state().lock_remaining_ms.is_none());
    assert!(c
        .engine
        .action(Action::Snooze, c.now, Some(c.stamp))
        .is_err());
    assert!(!c.advance(299999, true).contains(&Effect::ShowPrompt));
    assert!(c.advance(1, true).contains(&Effect::ShowPrompt));
}
#[test]
fn collapse_adds_at_most_two_text_reminders() {
    let mut c = Clock::new(1, 180, 60, false);
    c.advance(1000, true);
    for expected in [2, 3] {
        c.action(Action::Collapse);
        assert!(!c.advance(59999, true).contains(&Effect::ShowPrompt));
        assert!(c.advance(1, true).contains(&Effect::ShowPrompt));
        assert_eq!(c.state().reminder_count, expected);
    }
    c.action(Action::Collapse);
    assert!(!c.advance(120000, true).contains(&Effect::ShowPrompt));
}
#[test]
fn close_repeats_five_working_minutes_after_more_than_three_prompts() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    for expected in 2..=6 {
        c.ack();
        let before = c.state();
        assert_eq!(c.action(Action::Dismiss), vec![Effect::HidePrompt]);
        assert_eq!(c.state().work_ms, before.work_ms);
        assert_eq!(c.state().round_id, before.round_id);
        assert_eq!(c.state().mode, Mode::Working);
        assert_eq!(c.state().snooze_remaining_ms, Some(300_000));
        assert!(c.state().lock_remaining_ms.is_none());
        assert!(c.action(Action::Dismiss).is_empty());
        assert!(!c.advance(299_999, true).contains(&Effect::ShowPrompt));
        assert!(c.advance(1, true).contains(&Effect::ShowPrompt));
        assert_eq!(c.state().reminder_count, expected);
        assert!(!c.state().lock_attempted);
    }
}
#[test]
fn closed_snooze_freezes_in_pause_and_short_rest_until_real_resume() {
    let mut c = Clock::new(1, 180, 60, false);
    c.advance(1000, true);
    c.action(Action::Dismiss);
    c.action(Action::Pause);
    c.advance(600_000, true);
    assert_eq!(c.state().snooze_remaining_ms, Some(300_000));
    c.action(Action::Resume);
    c.action(Action::StartRest);
    c.advance(10_000, false);
    c.step(500, true);
    c.advance(4999, true);
    assert_eq!(c.state().mode, Mode::Resting);
    assert_eq!(c.state().snooze_remaining_ms, Some(300_000));
    c.step(1, true);
    assert_eq!(c.state().mode, Mode::Working);
    c.advance(1000, true);
    assert_eq!(c.state().snooze_remaining_ms, Some(299_000));
}
#[test]
fn full_rest_cancels_closed_snooze_without_a_stale_prompt() {
    let mut c = Clock::new(1, 180, 60, false);
    c.advance(1000, true);
    c.action(Action::Dismiss);
    c.action(Action::StartRest);
    assert!(!c.advance(180_000, false).contains(&Effect::ShowPrompt));
    assert_eq!(c.state().work_ms, 0);
    assert_eq!(c.state().round_id, 2);
    assert_eq!(c.state().snooze_remaining_ms, None);
    assert!(!c.state().due);
    assert!(!c.advance(300_000, false).contains(&Effect::ShowPrompt));
}
#[test]
fn closed_snooze_survives_sqlite_restart_without_counting_offline_time() {
    let mut c = Clock::new(1, 180, 60, false);
    c.advance(1000, true);
    c.action(Action::Dismiss);
    c.advance(30_000, true);
    let dir = tempfile::tempdir().unwrap();
    let store = super::persistence::Store::open(dir.path()).unwrap();
    store.save(&c.engine.checkpoint()).unwrap();
    c.now = 86_400_000;
    c.engine = Engine::restore(store.load().unwrap().unwrap(), c.now);
    assert_eq!(c.state().work_ms, 31_000);
    assert_eq!(c.state().snooze_remaining_ms, Some(270_000));
    assert!(!c.state().prompt_visible);
    assert!(!c.advance(269_999, true).contains(&Effect::ShowPrompt));
    assert!(c.advance(1, true).contains(&Effect::ShowPrompt));
}
#[test]
fn legacy_checkpoint_without_snooze_field_keeps_prior_restore_behavior() {
    let mut c = Clock::new(1, 180, 60, false);
    c.advance(1000, true);
    let mut json = serde_json::to_value(c.engine.checkpoint()).unwrap();
    json.as_object_mut().unwrap().remove("snoozeRemainingMs");
    let restored = Engine::restore(serde_json::from_value(json).unwrap(), 86_400_000);
    let s = restored.snapshot(true, true);
    assert_eq!(s.work_ms, 1000);
    assert!(s.due);
    assert_eq!(s.snooze_remaining_ms, None);
    assert!(!s.prompt_visible);
}
#[test]
fn real_presentation_ack_is_required_and_stale_ack_is_rejected() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    assert!(c.engine.presented(99, c.now).is_empty());
    assert!(c.state().lock_remaining_ms.is_none());
    c.ack();
    assert_eq!(c.state().lock_remaining_ms, Some(15000));
    c.ack();
    assert_eq!(c.state().lock_remaining_ms, Some(15000));
}
#[test]
fn fifteen_second_warning_is_cancellable() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.ack();
    assert!(!c.advance(14999, true).contains(&Effect::Lock));
    c.action(Action::CancelLock);
    assert!(!c.advance(120000, true).contains(&Effect::Lock));
    assert!(!c.state().lock_attempted);
}
#[test]
fn collapsed_prompt_keeps_warning_and_requests_lock_only_once() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.ack();
    c.action(Action::Collapse);
    assert!(!c.state().prompt_visible);
    let effects = c.advance(15000, true);
    assert_eq!(effects.iter().filter(|e| **e == Effect::Lock).count(), 1);
    assert!(c.engine.can_issue_lock());
    c.engine.lock_result(Err("injected failure".into()));
    assert!(!c.advance(120000, true).contains(&Effect::Lock));
    assert!(c.state().error.is_some());
}
#[test]
fn failed_prompt_never_locks_or_automatically_retries() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.engine.prompt_failed("window failed".into());
    c.ack();
    assert!(c.state().lock_remaining_ms.is_none());
    assert!(!c.advance(60000, true).contains(&Effect::Lock));
    assert!(!c.state().prompt_visible);
}
#[test]
fn rest_pause_snooze_and_disable_cancel_unissued_lock() {
    for action in [Action::StartRest, Action::Pause, Action::Snooze] {
        let mut c = Clock::new(1, 180, 60, true);
        c.advance(1000, true);
        c.ack();
        c.action(action);
        assert!(c.state().lock_remaining_ms.is_none());
        assert!(!c.advance(15000, true).contains(&Effect::Lock));
    }
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.ack();
    let mut settings = c.engine.settings.clone();
    settings.enabled = false;
    c.engine.configure(settings, c.now).unwrap();
    assert_eq!(c.state().mode, Mode::Off);
    assert!(!c.advance(15000, true).contains(&Effect::Lock));
}
#[test]
fn automatic_lock_off_and_storage_failure_cancel_queued_lock_permission() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.ack();
    c.advance(15000, true);
    assert!(c.engine.can_issue_lock());
    c.engine.storage_failed("disk".into());
    assert!(!c.engine.can_issue_lock());
}
#[test]
fn settings_bounds_and_unavailable_input_are_conservative() {
    let mut c = Clock::new(1, 180, 60, true);
    let mut settings = c.engine.settings.clone();
    settings.rest_seconds = 0;
    assert!(c.engine.configure(settings, c.now).is_err());
    c.advance(1000, true);
    c.ack();
    c.engine.tick(2000, None, ResumeSample::default());
    assert!(c.state().lock_remaining_ms.is_none());
    assert_eq!(c.state().work_ms, 1000);
}
#[test]
fn second_round_rest_completion_does_not_repeatedly_reset_round() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.advance(720000, false);
    assert_eq!(c.state().round_id, 2);
    assert_eq!(c.state().work_ms, 0);
}

#[test]
fn resume_input_single_touch_before_rest_boundary_does_not_interrupt_completion() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.advance(179500, false);
    c.step(300, true);
    c.step(200, false);
    assert_eq!(c.state().round_id, 2);
    assert_eq!(c.state().work_ms, 0);
    assert_eq!(c.state().mode, Mode::Resting);
}
#[test]
fn first_confirming_poll_never_backdates_rest() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.advance(59500, false);
    c.step(750, false);
    assert_eq!(c.state().work_ms, 70250);
    assert_eq!(c.state().rest_ms, 0);
    assert_eq!(c.state().mode, Mode::Resting);
}
#[test]
fn resume_input_immediately_after_start_rest_requires_full_five_seconds() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.step(100, true);
    c.advance(4999, true);
    assert_eq!(c.state().mode, Mode::Resting);
    assert_eq!(c.state().rest_ms, 5099);
    assert_eq!(c.state().work_ms, 10000);
    c.step(1, true);
    assert_eq!(c.state().mode, Mode::Working);
    assert_eq!(c.state().work_ms, 10000);
}
#[test]
fn nonincremental_or_future_input_timestamps_fail_closed() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.ack();
    c.engine
        .tick(1500, Some((999, 501)), ResumeSample::default());
    assert_eq!(c.state().work_ms, 1000);
    assert!(c.state().lock_remaining_ms.is_none());
    c.engine
        .tick(2000, Some((2100, 0)), ResumeSample::default());
    assert_eq!(c.state().work_ms, 1000);
    c.engine
        .tick(2500, Some((0, 8 * 86400000)), ResumeSample::default());
    assert_eq!(c.state().work_ms, 1000);
    assert_ne!(c.state().mode, Mode::Resting);
}

#[test]
fn partial_settings_merge_does_not_reenable_a_stale_windows_lock_flag() {
    let current = Settings {
        auto_lock: false,
        enabled: true,
        ..Settings::default()
    };
    let patch = SettingsPatch {
        sound: Some(false),
        ..SettingsPatch::default()
    };
    let merged = patch.merge(&current);
    assert!(!merged.auto_lock);
    assert!(!merged.sound);
    assert!(merged.enabled);
}
#[test]
fn warning_has_full_fifteen_seconds_from_ack_not_prior_poll() {
    let mut c = Clock::new(1, 180, 60, true);
    c.advance(1000, true);
    c.engine.presented(c.state().prompt_token, 1250);
    assert!(!c.advance(15000, true).contains(&Effect::Lock));
    assert!(c.advance(250, true).contains(&Effect::Lock));
}
#[test]
fn repeated_text_reminders_are_silent_even_when_initial_sound_enabled() {
    let mut c = Clock::new(1, 180, 60, false);
    c.engine.settings.sound = true;
    c.advance(1000, true);
    assert_eq!(c.ack(), vec![Effect::Sound]);
    c.action(Action::Collapse);
    c.advance(60000, true);
    assert!(c.ack().is_empty());
}

#[test]
fn queued_early_unlock_does_not_clear_after_a_late_poll() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.session(SessionKind::Locked, true);
    c.advance(180000, false);
    assert_eq!(c.state().round_id, 1);
    assert_eq!(c.state().rest_remaining_ms, 0);
    c.engine.session(SessionKind::Locked, false, c.now - 5000);
    assert_eq!(c.state().round_id, 1);
    assert_eq!(c.state().work_ms, 10000);
}
#[test]
fn exact_verified_unlock_threshold_settles_before_any_return_input() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.session(SessionKind::Locked, true);
    c.now += 180000;
    c.session(SessionKind::Locked, false);
    assert_eq!(c.state().round_id, 2);
    assert_eq!(c.state().work_ms, 0);
    c.step(500, true);
    assert_eq!(c.state().work_ms, 500);
    assert!(!c.state().prompt_visible);
}

#[test]
fn resume_input_single_and_intermittent_events_never_resume_work() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    for _ in 0..10 {
        c.step(500, true);
        c.advance(1001, false);
    }
    assert_eq!(c.state().mode, Mode::Resting);
    assert_eq!(c.state().work_ms, 10000);
    assert_eq!(c.state().resume_confirmation_remaining_ms, None);
    c.step(500, true);
    c.advance(5000, true);
    assert_eq!(c.state().mode, Mode::Working);
}
#[test]
fn resume_input_injected_activity_cannot_resume_or_extend_confirmation() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.step(500, true);
    for _ in 0..12 {
        c.now += 500;
        c.stamp = c.now;
        c.idle = 0;
        c.activity.record(c.now, true);
        let resume = c.resume_sample();
        c.engine.tick(c.now, Some((c.stamp, c.idle)), resume);
    }
    assert_eq!(c.state().mode, Mode::Resting);
    assert_eq!(c.state().work_ms, 10000);
    assert_eq!(c.state().resume_confirmation_remaining_ms, None);
}
#[test]
fn resume_input_rest_goal_during_confirmation_resets_once_before_work_resumes() {
    let mut c = Clock::new(2700, 10, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.advance(8000, false);
    c.step(500, true);
    c.advance(1500, true);
    assert_eq!(c.state().round_id, 2);
    assert_eq!(c.state().work_ms, 0);
    assert_eq!(c.state().mode, Mode::Resting);
    c.advance(3500, true);
    assert_eq!(c.state().round_id, 2);
    assert_eq!(c.state().mode, Mode::Working);
    assert_eq!(c.state().work_ms, 0);
}
#[test]
fn resume_input_unavailable_monitor_clears_candidate_and_retains_rest() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.step(500, true);
    c.advance(4000, true);
    c.now += 500;
    c.engine.tick(c.now, None, ResumeSample::default());
    assert_eq!(c.state().mode, Mode::Resting);
    assert_eq!(c.state().rest_ms, 5000);
    assert_eq!(c.state().resume_confirmation_remaining_ms, None);
    c.step(500, true);
    c.advance(4999, true);
    assert_eq!(c.state().mode, Mode::Resting);
    c.step(1, true);
    assert_eq!(c.state().mode, Mode::Working);
}
#[test]
fn resume_input_confirmation_delivery_keeps_rest_through_fifth_second() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.step(500, true);
    c.advance(4500, true);
    c.activity.record(c.now + 500, false);
    c.now += 750;
    c.stamp = c.now - 250;
    c.idle = 250;
    let resume = c.resume_sample();
    c.engine.tick(c.now, Some((c.stamp, c.idle)), resume);
    assert_eq!(c.state().mode, Mode::Working);
    assert_eq!(c.state().work_ms, 10250);
}
#[test]
fn resume_input_samples_taken_before_tick_clock_do_not_discard_legitimate_input() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(1000, true);
    let adapter_clock = std::cell::Cell::new(1500);
    let (now, sample) = sample_then_clock(
        || {
            // New input arrives after the old clock value but during adapter sampling.
            adapter_clock.set(1501);
            Some((adapter_clock.get(), 0))
        },
        || adapter_clock.get(),
    );
    c.engine.tick(now, sample, ResumeSample::default());
    assert_eq!(c.state().work_ms, 1501);
    assert!(c.state().error.is_none());
}

#[test]
fn resume_input_pause_and_system_rest_discard_pending_confirmation() {
    for action in [Action::Pause, Action::StartRest] {
        let mut c = Clock::new(2700, 180, 60, false);
        c.advance(10000, true);
        c.action(Action::StartRest);
        c.step(500, true);
        c.advance(4500, true);
        c.action(action);
        assert_eq!(c.state().resume_confirmation_remaining_ms, None);
        if action == Action::Pause {
            c.action(Action::Resume);
            assert_eq!(c.state().mode, Mode::Working);
        } else {
            c.step(500, true);
            assert_eq!(c.state().mode, Mode::Resting);
        }
    }
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.step(500, true);
    c.advance(4500, true);
    c.session(SessionKind::Locked, true);
    c.advance(1000, false);
    c.session(SessionKind::Locked, false);
    assert_eq!(c.state().resume_confirmation_remaining_ms, None);
    assert_eq!(c.state().mode, Mode::Working);
    assert_eq!(c.state().work_ms, 10000);
}

#[test]
fn resume_input_unexplained_gap_never_substitutes_for_return_confirmation() {
    let mut c = Clock::new(2700, 180, 60, false);
    c.advance(10000, true);
    c.action(Action::StartRest);
    c.step(500, true);
    c.advance(4000, true);
    c.step(6000, false);
    assert_eq!(c.state().mode, Mode::Resting);
    assert_eq!(c.state().work_ms, 10000);
    assert_eq!(c.state().rest_ms, 0);
    assert_eq!(c.state().resume_confirmation_remaining_ms, None);
    c.step(500, true);
    c.advance(4999, true);
    assert_eq!(c.state().mode, Mode::Resting);
    c.step(1, true);
    assert_eq!(c.state().mode, Mode::Working);
}

#[cfg(windows)]
#[test]
fn resume_input_failed_disable_save_still_stops_and_joins_monitor() {
    use super::activity::Worker;
    use super::{
        configure_runtime, input_monitor::InputMonitor, persistence::Store, snapshot, Runtime,
    };
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let stop = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_finished = finished.clone();
    let handle = std::thread::spawn(move || {
        while !thread_stop.load(Ordering::SeqCst) {
            std::thread::park_timeout(std::time::Duration::from_millis(1));
        }
        thread_finished.store(true, Ordering::SeqCst);
    });
    let mut clock = Clock::new(2700, 180, 60, false);
    clock.advance(10000, true);
    let log_dir = tempfile::tempdir().unwrap();
    let mut runtime = Runtime {
        attention: super::attention::Coordinator::default(),
        attention_rendered_revision: u64::MAX,
        attention_rendered_state: None,
        attention_ready: std::collections::HashSet::new(),
        attention_loading_since: None,
        engine: clock.engine,
        fitness: super::fitness::FitnessEngine::default(),
        fitness_last_save: 10000,
        fitness_writable: true,
        log_last_save: 10000,
        log: super::activity_recorder::Recorder::new(log_dir.path(), 10000),
        store: Store::unavailable("injected disable-save failure".into()),
        test_mode: false,
        monitor_available: true,
        last_save: 10000,
        test_input: 0,
        test_idle: 0,
        simulated_locks: 0,
        fail_next_lock: false,
        input_monitor: Some(InputMonitor::from_test_worker(Worker::new(
            stop.clone(),
            handle,
        ))),
        test_activity: ActivityTimeline::default(),
    };
    assert!(matches!(
        snapshot(&runtime).input_source_status,
        InputSourceStatus::Filtered
    ));
    let error = configure_runtime(
        &mut runtime,
        SettingsPatch {
            enabled: Some(false),
            ..SettingsPatch::default()
        },
        10000,
    )
    .unwrap_err();
    assert!(error.contains("injected disable-save failure"));
    assert!(!runtime.engine.settings.enabled);
    assert_eq!(runtime.engine.mode, Mode::Off);
    assert_eq!(snapshot(&runtime).work_ms, 10000);
    assert!(runtime.input_monitor.is_none());
    assert!(stop.load(Ordering::SeqCst));
    assert!(finished.load(Ordering::SeqCst));
    assert!(matches!(
        snapshot(&runtime).input_source_status,
        InputSourceStatus::Inactive
    ));
    assert_eq!(runtime.last_save, 10000);
}

fn fitness_daily_runtime_fixture() -> (super::Runtime, tempfile::TempDir) {
    let directory = tempfile::tempdir().unwrap();
    let mut checkpoint = super::fitness::Checkpoint::default();
    checkpoint.settings.enabled = true;
    checkpoint.pool[0].selected = true;
    checkpoint.active_ms = 60_000;
    checkpoint.total_active_ms = 90_000;
    checkpoint.daily_active_ms = 65_000;
    checkpoint.daily_active_day = Some("1900-01-01".into());
    checkpoint.next_id = 3;
    checkpoint.pending = Some(super::fitness::Reminder {
        started: false,
        id: 1,
        exercise: checkpoint.pool[0].clone(),
        issued_at_ms: 0,
        snooze_active_remaining_ms: 2000,
    });
    checkpoint.history.push(super::fitness::HistoryEntry {
        id: 2,
        reminder_id: 1,
        exercise_name: checkpoint.pool[0].name.clone(),
        outcome: super::fitness::Outcome::Later,
        at_ms: 0,
        cycle_active_ms: 60_000,
    });
    let runtime = super::Runtime {
        attention: super::attention::Coordinator::default(),
        attention_rendered_revision: u64::MAX,
        attention_rendered_state: None,
        attention_ready: std::collections::HashSet::new(),
        attention_loading_since: None,
        engine: Engine::new(10000),
        fitness: super::fitness::FitnessEngine::restore(checkpoint).unwrap(),
        fitness_last_save: 10000,
        fitness_writable: true,
        log: super::activity_recorder::Recorder::new(directory.path(), 10000),
        log_last_save: 10000,
        store: super::persistence::Store::unavailable("injected daily save failure".into()),
        test_mode: true,
        monitor_available: true,
        last_save: 10000,
        test_input: 0,
        test_idle: 0,
        simulated_locks: 0,
        fail_next_lock: false,
        input_monitor: None,
        test_activity: ActivityTimeline::default(),
    };
    (runtime, directory)
}
#[test]
fn fitness_daily_runtime_save_failure_exposes_today_zero_and_preserves_cycle() {
    let (mut runtime, _directory) = fitness_daily_runtime_fixture();
    let mut expected = runtime.fitness.checkpoint();
    let error = super::fitness_normalize_runtime(&mut runtime).unwrap_err();
    assert!(error.contains("injected daily save failure"));
    assert!(!runtime.fitness_writable);
    assert!(!runtime.fitness.enabled());
    assert!(!runtime.fitness.snapshot().prompt_visible);
    assert!(runtime.fitness.snapshot().error.is_some());
    let actual = runtime.fitness.checkpoint();
    assert_ne!(actual.daily_active_day.as_deref(), Some("1900-01-01"));
    assert!(actual.daily_active_day.is_some());
    expected.daily_active_day = actual.daily_active_day.clone();
    expected.daily_active_ms = 0;
    expected.settings.enabled = false;
    assert_eq!(actual, expected);
}
#[test]
fn fitness_daily_runtime_unwritable_normalization_never_attempts_checkpoint_write() {
    let (mut runtime, _directory) = fitness_daily_runtime_fixture();
    runtime.fitness_writable = false;
    let mut expected = runtime.fitness.checkpoint();
    // An attempted write would fail with the injected unavailable store.
    assert!(super::fitness_normalize_runtime(&mut runtime).is_ok());
    assert!(!runtime.fitness_writable);
    let actual = runtime.fitness.checkpoint();
    assert_ne!(actual.daily_active_day.as_deref(), Some("1900-01-01"));
    expected.daily_active_day = actual.daily_active_day.clone();
    expected.daily_active_ms = 0;
    assert_eq!(actual, expected);
}
