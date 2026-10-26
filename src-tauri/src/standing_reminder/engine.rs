//! Single monotonic-clock state machine; input contains aggregate times only.
use super::activity::{ResumeSample, INPUT_GAP_MS, RESUME_CONFIRM_MS};
use super::activity_log::{AllocatedSpan, LogMode, LogObservation, LogReason};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub work_seconds: u64,
    pub rest_seconds: u64,
    pub idle_seconds: u64,
    pub sound: bool,
    pub auto_lock: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            work_seconds: 2700,
            rest_seconds: 180,
            idle_seconds: 60,
            sound: true,
            auto_lock: false,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=86400).contains(&self.work_seconds)
            || !(1..=7200).contains(&self.rest_seconds)
            || !(1..=3600).contains(&self.idle_seconds)
        {
            return Err("工作需为 1–86400 秒，休息 1–7200 秒，无操作确认 1–3600 秒".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub enabled: Option<bool>,
    pub work_seconds: Option<u64>,
    pub rest_seconds: Option<u64>,
    pub idle_seconds: Option<u64>,
    pub sound: Option<bool>,
    pub auto_lock: Option<bool>,
}
impl SettingsPatch {
    pub fn merge(self, current: &Settings) -> Settings {
        Settings {
            enabled: self.enabled.unwrap_or(current.enabled),
            work_seconds: self.work_seconds.unwrap_or(current.work_seconds),
            rest_seconds: self.rest_seconds.unwrap_or(current.rest_seconds),
            idle_seconds: self.idle_seconds.unwrap_or(current.idle_seconds),
            sound: self.sound.unwrap_or(current.sound),
            auto_lock: self.auto_lock.unwrap_or(current.auto_lock),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Durations {
    pub work_seconds: u64,
    pub rest_seconds: u64,
    pub idle_seconds: u64,
}
impl From<&Settings> for Durations {
    fn from(s: &Settings) -> Self {
        Self {
            work_seconds: s.work_seconds,
            rest_seconds: s.rest_seconds,
            idle_seconds: s.idle_seconds,
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Off,
    Working,
    Resting,
    SystemRest,
    Paused,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    StartRest,
    Snooze,
    Dismiss,
    Collapse,
    Skip,
    CancelLock,
    Pause,
    Resume,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionKind {
    Locked,
    Sleeping,
    Disconnected,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Effect {
    ShowPrompt,
    HidePrompt,
    Sound,
    Lock,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub settings: Settings,
    pub active: Durations,
    pub work_ms: u64,
    pub round_id: u64,
    pub paused: bool,
    pub snooze_used: bool,
    #[serde(default)]
    pub snooze_remaining_ms: Option<u64>,
    pub lock_attempted: bool,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InputSourceStatus {
    Inactive,
    Starting,
    Filtered,
    Unavailable,
    Test,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub settings: Settings,
    pub active_durations: Durations,
    pub pending_durations: bool,
    pub mode: Mode,
    pub work_ms: u64,
    pub work_remaining_ms: u64,
    pub rest_ms: u64,
    pub rest_remaining_ms: u64,
    pub idle_confirmation_remaining_ms: u64,
    pub due: bool,
    pub round_id: u64,
    pub prompt_token: u64,
    pub prompt_visible: bool,
    pub prompt_presented: bool,
    pub reminder_count: u8,
    pub snooze_used: bool,
    pub snooze_remaining_ms: Option<u64>,
    pub lock_remaining_ms: Option<u64>,
    pub lock_attempted: bool,
    pub error: Option<String>,
    pub test_mode: bool,
    pub system_monitor_available: bool,
    pub simulated_lock_requests: u64,
    pub input_source_status: InputSourceStatus,
    pub resume_confirmation_remaining_ms: Option<u64>,
}
#[derive(Clone, Debug)]
pub struct Engine {
    pub settings: Settings,
    active: Durations,
    pub mode: Mode,
    work_ms: u64,
    rest_ms: u64,
    pub last_ms: u64,
    last_input: Option<u64>,
    idle_ms: u64,
    rest_input_after_ms: u64,
    resume_candidate_ms: Option<u64>,
    resume_latest_ms: u64,
    locked: bool,
    sleeping: bool,
    disconnected: bool,
    system_rest_start_ms: u64,
    round_id: u64,
    due: bool,
    prompt_token: u64,
    prompt_visible: bool,
    prompt_presented: bool,
    reminder_count: u8,
    repeat_ms: Option<u64>,
    snooze_ms: Option<u64>,
    snooze_used: bool,
    lock_ms: Option<u64>,
    lock_started_ms: u64,
    lock_attempted: bool,
    lock_cancelled: bool,
    rest_completed: bool,
    pub error: Option<String>,
    activity_reason: LogReason,
    activity_observations: Vec<LogObservation>,
}
impl Engine {
    pub fn new(now: u64) -> Self {
        let settings = Settings::default();
        Self {
            active: Durations::from(&settings),
            settings,
            mode: Mode::Off,
            work_ms: 0,
            rest_ms: 0,
            last_ms: now,
            last_input: None,
            idle_ms: 0,
            rest_input_after_ms: now,
            resume_candidate_ms: None,
            resume_latest_ms: now,
            locked: false,
            sleeping: false,
            disconnected: false,
            system_rest_start_ms: now,
            round_id: 1,
            due: false,
            prompt_token: 0,
            prompt_visible: false,
            prompt_presented: false,
            reminder_count: 0,
            repeat_ms: None,
            snooze_ms: None,
            snooze_used: false,
            lock_ms: None,
            lock_started_ms: now,
            lock_attempted: false,
            lock_cancelled: false,
            rest_completed: false,
            error: None,
            activity_reason: LogReason::Control,
            activity_observations: Vec::new(),
        }
    }
    pub fn restore(c: Checkpoint, now: u64) -> Self {
        let mut r = Self::new(now);
        if c.settings.validate().is_err()
            || !(1..=86400).contains(&c.active.work_seconds)
            || !(1..=7200).contains(&c.active.rest_seconds)
            || !(1..=3600).contains(&c.active.idle_seconds)
        {
            return r;
        }
        r.activity_reason = LogReason::Restart;
        r.settings = c.settings;
        r.active = c.active;
        r.work_ms = c.work_ms;
        r.round_id = c.round_id;
        r.snooze_used = c.snooze_used;
        r.lock_attempted = c.lock_attempted;
        r.mode = if !r.settings.enabled {
            Mode::Off
        } else if c.paused {
            Mode::Paused
        } else {
            Mode::Working
        };
        r.due = r.work_ms >= r.active.work_seconds * 1000;
        // A stopped process cannot establish rest, elapsed input, or prompt presentation.
        if r.due {
            r.reminder_count = 3;
            r.lock_cancelled = true;
            // Persist remaining working time; never count time while the app was stopped.
            r.snooze_ms = c.snooze_remaining_ms.map(|ms| ms.clamp(1, 300_000));
        }
        r
    }
    pub fn checkpoint(&self) -> Checkpoint {
        Checkpoint {
            settings: self.settings.clone(),
            active: self.active.clone(),
            work_ms: self.work_ms,
            round_id: self.round_id,
            paused: self.mode == Mode::Paused,
            snooze_used: self.snooze_used,
            snooze_remaining_ms: self.snooze_ms,
            lock_attempted: self.lock_attempted,
        }
    }
    pub fn snapshot(&self, test_mode: bool, available: bool) -> Snapshot {
        Snapshot {
            settings: self.settings.clone(),
            active_durations: self.active.clone(),
            pending_durations: self.active != Durations::from(&self.settings),
            mode: self.mode,
            work_ms: self.work_ms,
            work_remaining_ms: (self.active.work_seconds * 1000).saturating_sub(self.work_ms),
            rest_ms: self.rest_ms,
            rest_remaining_ms: if self.rest_completed {
                0
            } else {
                (self.active.rest_seconds * 1000).saturating_sub(self.rest_ms)
            },
            idle_confirmation_remaining_ms: (self.active.idle_seconds * 1000)
                .saturating_sub(self.idle_ms),
            due: self.due,
            round_id: self.round_id,
            prompt_token: self.prompt_token,
            prompt_visible: self.prompt_visible,
            prompt_presented: self.prompt_presented,
            reminder_count: self.reminder_count,
            snooze_used: self.snooze_used,
            snooze_remaining_ms: self.snooze_ms,
            lock_remaining_ms: self.lock_ms,
            lock_attempted: self.lock_attempted,
            error: self.error.clone(),
            test_mode,
            system_monitor_available: available,
            simulated_lock_requests: 0,
            input_source_status: if test_mode {
                InputSourceStatus::Test
            } else {
                InputSourceStatus::Inactive
            },
            resume_confirmation_remaining_ms: self.resume_candidate_ms.map(|start| {
                RESUME_CONFIRM_MS.saturating_sub(self.resume_latest_ms.saturating_sub(start))
            }),
        }
    }
    fn clear_resume_confirmation(&mut self, now: u64) {
        self.rest_input_after_ms = now;
        self.resume_candidate_ms = None;
        self.resume_latest_ms = now;
    }
    /// Only a fresh sequence of unflagged events can confirm return; no idle timestamp fallback.
    fn confirmed_return(&mut self, now: u64, sample: ResumeSample) -> Option<u64> {
        if !sample.available {
            self.clear_resume_confirmation(now);
            return None;
        }
        let Some(window) = sample.window else {
            self.resume_candidate_ms = None;
            return None;
        };
        if window.first_ms > window.latest_ms
            || window.latest_ms > now
            || window.latest_ms <= self.rest_input_after_ms
            || now.saturating_sub(window.latest_ms) > INPUT_GAP_MS
        {
            self.resume_candidate_ms = None;
            return None;
        }
        let start = match self.resume_candidate_ms {
            Some(start)
                if window.first_ms <= start && window.latest_ms >= self.resume_latest_ms =>
            {
                start
            }
            _ => {
                if window.first_ms > self.rest_input_after_ms {
                    window.first_ms
                } else {
                    window.latest_ms
                }
            }
        };
        self.resume_candidate_ms = Some(start);
        self.resume_latest_ms = window.latest_ms;
        if window.latest_ms.saturating_sub(start) >= RESUME_CONFIRM_MS {
            Some(start.saturating_add(RESUME_CONFIRM_MS))
        } else {
            None
        }
    }
    pub fn drain_activity(&mut self) -> Vec<LogObservation> {
        std::mem::take(&mut self.activity_observations)
    }
    pub fn blocked(&self) -> bool {
        self.away()
    }
    fn log_span(&mut self, start: u64, end: u64, mode: LogMode, reason: LogReason) {
        if end > start {
            self.activity_observations
                .push(LogObservation::Span(AllocatedSpan {
                    start_mono_ms: start,
                    end_mono_ms: end,
                    mode,
                    reason,
                }));
        }
    }
    fn log_close(&mut self, incomplete: bool) {
        self.activity_observations
            .push(LogObservation::Close { incomplete });
    }
    fn log_rest(&mut self, start: u64, end: u64) {
        let mode = if self.mode == Mode::SystemRest {
            LogMode::SystemRest
        } else {
            LogMode::Resting
        };
        self.log_span(start, end, mode, self.activity_reason);
    }
    fn away(&self) -> bool {
        self.locked || self.sleeping || self.disconnected
    }
    fn cancel_lock(&mut self) {
        self.lock_ms = None;
        self.lock_cancelled = true;
    }
    fn hide(&mut self, effects: &mut Vec<Effect>) {
        if self.prompt_visible {
            effects.push(Effect::HidePrompt);
        }
        self.prompt_visible = false;
        self.prompt_presented = false;
    }
    fn prompt(&mut self, effects: &mut Vec<Effect>) {
        if self.reminder_count >= 3 {
            return;
        }
        self.deferred_prompt(effects);
    }
    fn deferred_prompt(&mut self, effects: &mut Vec<Effect>) {
        if self.prompt_visible {
            return;
        }
        self.prompt_token = self.prompt_token.wrapping_add(1);
        self.prompt_visible = true;
        self.prompt_presented = false;
        self.reminder_count = self.reminder_count.saturating_add(1);
        effects.push(Effect::ShowPrompt);
    }
    fn snooze(&mut self, effects: &mut Vec<Effect>) {
        self.snooze_used = true;
        self.snooze_ms = Some(300_000);
        self.repeat_ms = None;
        self.cancel_lock();
        self.hide(effects);
    }
    fn reset_round(&mut self, effects: &mut Vec<Effect>) {
        self.work_ms = 0;
        self.rest_completed = true;
        self.active = Durations::from(&self.settings);
        self.round_id = self.round_id.wrapping_add(1);
        self.due = false;
        self.reminder_count = 0;
        self.repeat_ms = None;
        self.snooze_ms = None;
        self.snooze_used = false;
        self.lock_ms = None;
        self.lock_attempted = false;
        self.lock_cancelled = false;
        self.hide(effects);
    }
    fn settle_rest(&mut self, delta: u64, effects: &mut Vec<Effect>) {
        self.rest_ms = self.rest_ms.saturating_add(delta);
        if !self.rest_completed && self.rest_ms >= self.active.rest_seconds * 1000 {
            self.reset_round(effects);
        }
    }
    pub fn configure(&mut self, settings: Settings, now: u64) -> Result<Vec<Effect>, String> {
        settings.validate()?;
        let mut effects = vec![];
        let changed_enabled = settings.enabled != self.settings.enabled;
        let disabled_lock = self.settings.auto_lock && !settings.auto_lock;
        let enabled_lock = !self.settings.auto_lock && settings.auto_lock;
        if changed_enabled {
            self.log_close(false);
            self.activity_reason = if self.away() {
                LogReason::System
            } else {
                LogReason::Control
            };
        }
        self.settings = settings;
        if self.work_ms == 0 && self.rest_ms == 0 {
            self.active = Durations::from(&self.settings);
        }
        if disabled_lock {
            self.cancel_lock();
        }
        if !self.settings.enabled {
            self.clear_resume_confirmation(now);
            self.mode = Mode::Off;
            self.rest_ms = 0;
            self.rest_completed = false;
            self.cancel_lock();
            self.repeat_ms = None;
            self.hide(&mut effects);
        } else if changed_enabled {
            self.system_rest_start_ms = now;
            self.clear_resume_confirmation(now);
            self.mode = if self.away() {
                Mode::SystemRest
            } else {
                Mode::Working
            };
            self.rest_ms = 0;
            self.rest_completed = false;
            self.last_input = None;
            if self.work_ms == 0 {
                self.lock_cancelled = false;
            }
        }
        if enabled_lock
            && self.prompt_visible
            && self.prompt_presented
            && !self.lock_attempted
            && !self.lock_cancelled
            && self.mode == Mode::Working
        {
            self.lock_ms = Some(15_000);
            self.lock_started_ms = now;
        }
        self.last_ms = now;
        Ok(effects)
    }

    /// None is an unavailable sample and never establishes rest.
    pub fn tick(
        &mut self,
        now: u64,
        input: Option<(u64, u64)>,
        resume: ResumeSample,
    ) -> Vec<Effect> {
        let mut effects = vec![];
        let Some(delta) = now.checked_sub(self.last_ms) else {
            self.log_close(true);
            self.last_ms = now;
            self.clear_resume_confirmation(now);
            self.rest_ms = 0;
            self.rest_completed = false;
            self.cancel_lock();
            self.error = Some("系统计时出现倒退，本次间隔未计入".into());
            return effects;
        };
        let previous = self.last_ms;
        self.last_ms = now;
        if self.mode == Mode::Off || self.mode == Mode::Paused {
            if delta > 5000 {
                self.log_close(true);
            } else {
                self.log_span(
                    previous,
                    now,
                    if self.mode == Mode::Off {
                        LogMode::Off
                    } else {
                        LogMode::Paused
                    },
                    self.activity_reason,
                );
            }
            return effects;
        }
        if self.away() {
            self.mode = Mode::SystemRest;
            // Account continuously, but commit/reset only at a trusted resume timestamp.
            // A queued early unlock must be able to remove a late poll's overhang.
            self.log_span(previous, now, LogMode::SystemRest, LogReason::System);
            self.rest_ms = self.rest_ms.saturating_add(delta);
            return effects;
        }
        // An unexplained process/clock gap is neither confirmed rest nor confirmed work.
        if delta > 5000 {
            self.log_close(true);
            self.clear_resume_confirmation(now);
            self.rest_ms = 0;
            self.rest_completed = false;
            // A clock gap cannot substitute for filtered user-return confirmation.
            if self.mode != Mode::Resting {
                self.mode = Mode::Working;
            }
            self.cancel_lock();
            self.repeat_ms = None;
            self.hide(&mut effects);
            self.error = Some("检测到未确认的计时间隔，已保留工作累计并取消自动锁屏".into());
            if let Some((stamp, age)) = input {
                self.last_input = Some(stamp);
                self.idle_ms = age;
            }
            return effects;
        }
        if self.mode == Mode::Resting {
            if let Some((stamp, age)) =
                input.filter(|(stamp, age)| *stamp <= now && *age <= 7 * 86_400_000)
            {
                self.last_input = Some(stamp);
                self.idle_ms = age;
            }
            // The confirmation interval remains continuous rest. Poll-delivery latency after
            // the fifth second is work only after a sequence actually spans that boundary.
            let confirmed = self.confirmed_return(now, resume);
            let return_time = confirmed
                .map(|stamp| stamp.clamp(previous, now))
                .unwrap_or(now);
            self.log_rest(previous, return_time);
            self.settle_rest(return_time - previous, &mut effects);
            if confirmed.is_some() {
                self.log_close(false);
                self.activity_reason = LogReason::Control;
                self.log_span(return_time, now, LogMode::Working, self.activity_reason);
                self.mode = Mode::Working;
                self.rest_ms = 0;
                self.rest_completed = false;
                self.clear_resume_confirmation(now);
                self.work_ms = self.work_ms.saturating_add(now - return_time);
                if self.due && self.reminder_count < 3 {
                    self.repeat_ms = Some(60_000);
                } else if !self.due && self.work_ms >= self.active.work_seconds * 1000 {
                    self.due = true;
                    self.prompt(&mut effects);
                }
            }
            return effects;
        }
        let Some((stamp, idle_ms)) = input else {
            self.log_close(true);
            self.cancel_lock();
            self.rest_ms = 0;
            self.rest_completed = false;
            if self.mode == Mode::Resting {
                self.mode = Mode::Working;
            }
            self.error = Some("无法读取系统无操作状态，本次间隔未计入".into());
            return effects;
        };
        if stamp > now
            || idle_ms > 7 * 86_400_000
            || self.last_input.map(|old| stamp < old).unwrap_or(false)
        {
            self.log_close(true);
            self.cancel_lock();
            self.rest_ms = 0;
            self.rest_completed = false;
            self.mode = Mode::Working;
            self.last_input = Some(stamp.min(now));
            self.error = Some("系统最后活动时间异常，本次间隔未计入；已取消本轮自动锁屏".into());
            return effects;
        }
        let activity = self.last_input.map(|old| old != stamp).unwrap_or(false);
        self.last_input = Some(stamp);
        self.idle_ms = idle_ms;
        let idle_limit = self.active.idle_seconds * 1000;
        if !activity && idle_ms >= idle_limit {
            // Confirmation is observed now; never backdate rest to an inferred idle timestamp.
            self.log_span(previous, now, LogMode::Working, self.activity_reason);
            self.log_close(false);
            self.activity_reason = LogReason::Idle;
            self.work_ms = self.work_ms.saturating_add(delta);
            if self.work_ms >= self.active.work_seconds * 1000 {
                self.due = true;
            }
            self.mode = Mode::Resting;
            self.clear_resume_confirmation(now);
            self.rest_ms = 0;
            self.rest_completed = false;
            self.cancel_lock();
            self.hide(&mut effects);
            return effects;
        }
        self.log_span(previous, now, LogMode::Working, self.activity_reason);
        self.work_ms = self.work_ms.saturating_add(delta);
        if self.work_ms >= self.active.work_seconds * 1000 && !self.due {
            self.due = true;
            self.prompt(&mut effects);
        }
        if let Some(remaining) = self.snooze_ms {
            let next = remaining.saturating_sub(delta);
            self.snooze_ms = if next == 0 { None } else { Some(next) };
            if next == 0 {
                // A user-requested delay is repeatable even beyond the text reminder cap.
                self.deferred_prompt(&mut effects);
            }
        }
        if let Some(remaining) = self.repeat_ms {
            let next = remaining.saturating_sub(delta);
            self.repeat_ms = if next == 0 { None } else { Some(next) };
            if next == 0 && self.snooze_ms.is_none() {
                self.prompt(&mut effects);
            }
        }
        if let Some(remaining) = self.lock_ms {
            let warning_delta = now.saturating_sub(previous.max(self.lock_started_ms));
            let next = remaining.saturating_sub(warning_delta);
            self.lock_ms = if next == 0 { None } else { Some(next) };
            if next == 0
                && self.settings.auto_lock
                && self.due
                && self.prompt_presented
                && !self.lock_attempted
                && !self.lock_cancelled
            {
                self.lock_attempted = true;
                effects.push(Effect::Lock);
            }
        }
        effects
    }

    pub fn session(&mut self, kind: SessionKind, active: bool, now: u64) -> Vec<Effect> {
        let mut effects = vec![];
        let was_away = self.away();
        // Only confirmed system rest may retract a delayed recovery, within its own start.
        let now = if was_away && self.settings.enabled && self.mode == Mode::SystemRest {
            now.max(self.system_rest_start_ms)
        } else {
            now.max(self.last_ms)
        };
        self.clear_resume_confirmation(now);
        // Continuous observed lock/suspend has a trusted start; settle before resume/input.
        if was_away && self.settings.enabled && self.mode != Mode::Paused {
            if let Some(delta) = now.checked_sub(self.last_ms) {
                self.log_span(self.last_ms, now, LogMode::SystemRest, LogReason::System);
                self.rest_ms = self.rest_ms.saturating_add(delta);
            } else {
                self.activity_observations
                    .push(LogObservation::TruncateSystemRest { at_mono_ms: now });
                self.rest_ms = self.rest_ms.saturating_sub(self.last_ms - now);
            }
        }
        self.last_ms = now;
        match kind {
            SessionKind::Locked => self.locked = active,
            SessionKind::Sleeping => self.sleeping = active,
            SessionKind::Disconnected => self.disconnected = active,
        }
        if !self.settings.enabled || self.mode == Mode::Paused {
            return effects;
        }
        if !was_away && self.away() {
            self.system_rest_start_ms = now;
            self.log_close(false);
            self.activity_reason = LogReason::System;
            self.mode = Mode::SystemRest;
            self.rest_ms = 0;
            self.rest_completed = false;
            self.cancel_lock();
            self.hide(&mut effects);
        } else if was_away && !self.away() {
            self.log_close(false);
            self.activity_reason = LogReason::Control;
            self.settle_rest(0, &mut effects);
            self.mode = Mode::Working;
            self.rest_ms = 0;
            self.rest_completed = false;
            self.last_input = None;
            self.cancel_lock();
            if self.due && self.reminder_count < 3 {
                self.repeat_ms = Some(60_000);
            }
        }
        effects
    }

    pub fn action(
        &mut self,
        action: Action,
        now: u64,
        latest_input: Option<u64>,
    ) -> Result<Vec<Effect>, String> {
        if !self.settings.enabled {
            return Err("久坐提醒尚未启用".into());
        }
        let mut effects = vec![];
        // A button can be the first input at the exact rest threshold.
        if matches!(self.mode, Mode::Resting | Mode::SystemRest) {
            if let Some(delta) = now.checked_sub(self.last_ms) {
                self.log_rest(self.last_ms, now);
                self.settle_rest(delta, &mut effects);
            }
        }
        self.last_ms = now;
        match action {
            Action::StartRest => {
                self.clear_resume_confirmation(now);
                if !matches!(self.mode, Mode::Resting | Mode::SystemRest) {
                    self.log_close(false);
                    self.activity_reason = if self.away() {
                        LogReason::System
                    } else {
                        LogReason::Manual
                    };
                    self.mode = if self.away() {
                        Mode::SystemRest
                    } else {
                        Mode::Resting
                    };
                    self.rest_ms = 0;
                    self.rest_completed = false;
                }
                self.last_input = latest_input;
                self.repeat_ms = None;
                self.cancel_lock();
                self.hide(&mut effects);
            }
            Action::Snooze => {
                if !self.due || self.snooze_used {
                    return Err("每轮只能稍后一次".into());
                }
                self.snooze(&mut effects);
            }
            Action::Dismiss => {
                if self.prompt_visible && self.due {
                    self.snooze(&mut effects);
                }
            }
            Action::Collapse => {
                if !self.prompt_visible {
                    return Ok(effects);
                }
                self.hide(&mut effects);
                // Acknowledgement remains valid after collapse; an issued warning continues.
                self.prompt_presented = self.lock_ms.is_some();
                if self.reminder_count < 3 {
                    self.repeat_ms = Some(60_000);
                }
            }
            Action::Skip => {
                if !self.due {
                    return Err("当前没有待处理的久坐提醒".into());
                }
                self.reset_round(&mut effects);
                // Explicit skip starts a new work cycle; it is not credited as a rest.
                self.rest_completed = false;
                self.rest_ms = 0;
                self.activity_reason = LogReason::Control;
            }
            Action::CancelLock => self.cancel_lock(),
            Action::Pause => {
                self.log_close(false);
                self.activity_reason = LogReason::Control;
                self.clear_resume_confirmation(now);
                self.mode = Mode::Paused;
                self.rest_ms = 0;
                self.rest_completed = false;
                self.cancel_lock();
                self.hide(&mut effects);
            }
            Action::Resume => {
                if self.mode == Mode::Paused {
                    self.system_rest_start_ms = now;
                    self.log_close(false);
                    self.activity_reason = if self.away() {
                        LogReason::System
                    } else {
                        LogReason::Control
                    };
                    self.clear_resume_confirmation(now);
                    self.mode = if self.away() {
                        Mode::SystemRest
                    } else {
                        Mode::Working
                    };
                    self.rest_ms = 0;
                    self.rest_completed = false;
                    self.last_input = latest_input;
                }
            }
        }
        Ok(effects)
    }
    pub fn presented(&mut self, token: u64, now: u64) -> Vec<Effect> {
        if token != self.prompt_token || !self.prompt_visible || self.prompt_presented {
            return vec![];
        }
        self.prompt_presented = true;
        if self.settings.auto_lock
            && !self.lock_attempted
            && !self.lock_cancelled
            && self.mode == Mode::Working
        {
            self.lock_ms = Some(15_000);
            self.lock_started_ms = now;
        }
        if self.settings.sound && self.reminder_count == 1 {
            vec![Effect::Sound]
        } else {
            vec![]
        }
    }
    pub fn prompt_failed(&mut self, error: String) {
        self.prompt_visible = false;
        self.prompt_presented = false;
        self.cancel_lock();
        self.repeat_ms = None;
        self.error = Some(error);
    }
    pub fn can_issue_lock(&self) -> bool {
        self.settings.enabled
            && self.settings.auto_lock
            && self.due
            && self.prompt_presented
            && self.lock_attempted
            && !self.lock_cancelled
            && self.mode == Mode::Working
    }
    pub fn lock_result(&mut self, result: Result<(), String>) {
        if let Err(error) = result {
            self.error = Some(error);
        }
    }
    pub fn storage_failed(&mut self, error: String) {
        self.cancel_lock();
        self.error = Some(error);
    }
}
