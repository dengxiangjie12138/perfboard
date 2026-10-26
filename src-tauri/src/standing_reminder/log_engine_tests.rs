use super::{
    activity::{ActivityTimeline, ResumeSample},
    activity_log::*,
    engine::*,
};
use chrono::FixedOffset;
fn base() -> i64 {
    chrono::DateTime::parse_from_rfc3339("2026-10-08T00:00:00Z")
        .unwrap()
        .timestamp_millis()
}
fn engine() -> Engine {
    let mut e = Engine::new(0);
    e.configure(
        Settings {
            enabled: true,
            work_seconds: 2700,
            rest_seconds: 60,
            idle_seconds: 1,
            sound: false,
            auto_lock: false,
        },
        0,
    )
    .unwrap();
    e.drain_activity();
    e
}
fn apply(db: &mut ActivityLogStore, e: &mut Engine) {
    db.apply(
        "session",
        &e.drain_activity(),
        ClockPair {
            mono_ms: 0,
            utc_ms: base(),
        },
        &FixedCalendar(FixedOffset::east_opt(0).unwrap()),
    )
    .unwrap();
}
fn day(db: &ActivityLogStore) -> ActivityLogDay {
    db.day("2026-10-08").unwrap()
}
#[test]
fn late_lock_entry_clips_to_confirmed_endpoint_and_never_blocks_log() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = ActivityLogStore::open(dir.path()).unwrap();
    let mut e = engine();
    e.tick(1500, Some((1500, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    e.session(SessionKind::Locked, true, 1499);
    apply(&mut db, &mut e);
    e.tick(2000, None, ResumeSample::default());
    apply(&mut db, &mut e);
    let d = day(&db);
    assert_eq!(d.summary.working_ms, 1500);
    assert_eq!(d.summary.system_rest_ms, 500);
    assert_eq!(d.segments[0].end_utc_ms, d.segments[1].start_utc_ms);
}
#[test]
fn idle_and_five_second_confirmed_return_use_exact_engine_slices() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = ActivityLogStore::open(dir.path()).unwrap();
    let mut e = engine();
    e.tick(500, Some((0, 500)), ResumeSample::default());
    apply(&mut db, &mut e);
    e.tick(1000, Some((0, 1000)), ResumeSample::default());
    apply(&mut db, &mut e);
    assert_eq!(e.mode, Mode::Resting);
    let mut activity = ActivityTimeline::default();
    activity.record(1200, false);
    e.tick(
        1500,
        Some((1200, 300)),
        ResumeSample {
            available: true,
            window: activity.window(),
        },
    );
    apply(&mut db, &mut e);
    assert_eq!(e.mode, Mode::Resting);
    for t in (3000..=7500).step_by(500) {
        activity.record(t, false);
        e.tick(
            t,
            Some((t, 0)),
            ResumeSample {
                available: true,
                window: activity.window(),
            },
        );
        apply(&mut db, &mut e);
    }
    activity.record(8000, false);
    e.tick(
        8250,
        Some((8000, 250)),
        ResumeSample {
            available: true,
            window: activity.window(),
        },
    );
    apply(&mut db, &mut e);
    let d = day(&db);
    assert_eq!(e.mode, Mode::Working);
    assert_eq!(d.summary.working_ms, 1250);
    assert_eq!(d.summary.resting_ms, 7000);
    assert_eq!(d.segments[1].reason, LogReason::Idle);
    assert_eq!(d.segments[1].duration_ms, 7000);
}
#[test]
fn manual_pause_and_unknown_gap_are_distinct_and_do_not_fill_unknown_time() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = ActivityLogStore::open(dir.path()).unwrap();
    let mut e = engine();
    e.tick(500, Some((500, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    e.action(Action::StartRest, 500, Some(500)).unwrap();
    apply(&mut db, &mut e);
    e.tick(1000, Some((500, 500)), ResumeSample::default());
    apply(&mut db, &mut e);
    e.action(Action::Pause, 1000, None).unwrap();
    apply(&mut db, &mut e);
    e.tick(1500, None, ResumeSample::default());
    apply(&mut db, &mut e);
    e.action(Action::Resume, 1500, Some(1500)).unwrap();
    apply(&mut db, &mut e);
    e.tick(10000, Some((10000, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    e.tick(10500, Some((10500, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    let d = day(&db);
    assert_eq!(d.summary.working_ms, 1000);
    assert_eq!(d.summary.resting_ms, 500);
    assert_eq!(d.summary.paused_ms, 500);
    assert_eq!(d.segments[1].reason, LogReason::Manual);
    assert_eq!(d.segments.iter().map(|s| s.duration_ms).sum::<u64>(), 2000);
}
#[test]
fn late_unlock_retracts_only_system_tail_then_continues_work() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = ActivityLogStore::open(dir.path()).unwrap();
    let mut e = engine();
    e.tick(500, Some((500, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    e.session(SessionKind::Locked, true, 500);
    apply(&mut db, &mut e);
    e.tick(1500, None, ResumeSample::default());
    apply(&mut db, &mut e);
    e.session(SessionKind::Locked, false, 1000);
    apply(&mut db, &mut e);
    e.tick(2000, Some((2000, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    let d = day(&db);
    assert_eq!(d.summary.working_ms, 1500);
    assert_eq!(d.summary.system_rest_ms, 500);
    assert_eq!(d.segments.iter().map(|s| s.duration_ms).sum::<u64>(), 2000);
}
#[test]
fn recovery_cannot_retract_work_before_the_confirmed_system_start() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = ActivityLogStore::open(dir.path()).unwrap();
    let mut e = engine();
    e.tick(9700, Some((9700, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    e.session(SessionKind::Locked, true, 10000);
    apply(&mut db, &mut e);
    e.session(SessionKind::Locked, false, 9500);
    apply(&mut db, &mut e);
    e.tick(10500, Some((10500, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    assert_eq!(e.last_ms, 10500);
    assert_eq!(day(&db).summary.system_rest_ms, 0);
}
#[test]
fn delayed_session_in_off_and_paused_never_overlaps_confirmed_slices() {
    for mode in [Mode::Off, Mode::Paused] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        let mut e = engine();
        if mode == Mode::Off {
            e.configure(Settings::default(), 0).unwrap();
        } else {
            e.action(Action::Pause, 0, None).unwrap();
        }
        apply(&mut db, &mut e);
        e.tick(500, None, ResumeSample::default());
        apply(&mut db, &mut e);
        e.session(SessionKind::Locked, true, 499);
        apply(&mut db, &mut e);
        e.session(SessionKind::Locked, false, 450);
        apply(&mut db, &mut e);
        e.tick(1000, None, ResumeSample::default());
        apply(&mut db, &mut e);
        let d = day(&db);
        assert_eq!(
            if mode == Mode::Off {
                d.summary.off_ms
            } else {
                d.summary.paused_ms
            },
            1000
        );
    }
}
#[test]
fn a_fixed_clock_anchor_merges_polls_but_changed_mapping_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = ActivityLogStore::open(dir.path()).unwrap();
    let mut e = engine();
    e.tick(500, Some((500, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    e.tick(1000, Some((1000, 0)), ResumeSample::default());
    apply(&mut db, &mut e);
    assert_eq!(day(&db).segments.len(), 1);
    e.tick(1500, Some((1500, 0)), ResumeSample::default());
    assert!(db
        .apply(
            "session",
            &e.drain_activity(),
            ClockPair {
                mono_ms: 0,
                utc_ms: base() + 1
            },
            &FixedCalendar(FixedOffset::east_opt(0).unwrap())
        )
        .is_err());
}
