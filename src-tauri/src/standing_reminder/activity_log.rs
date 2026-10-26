//! Proposal: consumes Engine-allocated monotonic slices, never input contents or thresholds.
//! Open exactly once at startup. Queries share this Store; opening it recovers unfinished rows.
use chrono::{FixedOffset, Local, NaiveDate, TimeZone};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogMode {
    Off,
    Working,
    Resting,
    SystemRest,
    Paused,
}
impl LogMode {
    fn key(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Working => "working",
            Self::Resting => "resting",
            Self::SystemRest => "systemRest",
            Self::Paused => "paused",
        }
    }
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "off" => Ok(Self::Off),
            "working" => Ok(Self::Working),
            "resting" => Ok(Self::Resting),
            "systemRest" => Ok(Self::SystemRest),
            "paused" => Ok(Self::Paused),
            _ => Err("Invalid stored activity mode".into()),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogReason {
    Idle,
    Manual,
    System,
    Control,
    Restart,
}
impl LogReason {
    fn key(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Manual => "manual",
            Self::System => "system",
            Self::Control => "control",
            Self::Restart => "restart",
        }
    }
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "idle" => Ok(Self::Idle),
            "manual" => Ok(Self::Manual),
            "system" => Ok(Self::System),
            "control" => Ok(Self::Control),
            "restart" => Ok(Self::Restart),
            _ => Err("Invalid stored activity reason".into()),
        }
    }
}
#[derive(Clone, Debug)]
pub struct AllocatedSpan {
    pub start_mono_ms: u64,
    pub end_mono_ms: u64,
    pub mode: LogMode,
    pub reason: LogReason,
}
#[derive(Clone, Copy, Debug)]
pub struct ClockPair {
    pub mono_ms: u64,
    pub utc_ms: i64,
}
impl ClockPair {
    pub fn utc_at(self, mono: u64) -> Result<i64, String> {
        let delta = i128::from(mono) - i128::from(self.mono_ms);
        i64::try_from(i128::from(self.utc_ms) + delta)
            .map_err(|_| "Activity timestamp overflow".into())
    }
}
/// These are accounting outputs, not a second idle/resume state machine.
#[derive(Clone, Debug)]
pub enum LogObservation {
    Span(AllocatedSpan),
    /// Close at the last allocated endpoint. Unknown gaps are deliberately not appended.
    Close {
        incomplete: bool,
    },
    /// Existing Engine::session may retract late-poll system-rest overhang on a queued unlock.
    TruncateSystemRest {
        at_mono_ms: u64,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogSegment {
    pub id: String,
    pub mode: LogMode,
    pub reason: LogReason,
    pub start_utc_ms: i64,
    pub end_utc_ms: i64,
    pub duration_ms: u64,
    pub incomplete: bool,
    pub ongoing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_offset_minutes: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_offset_minutes: Option<i32>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogSummary {
    pub working_ms: u64,
    pub resting_ms: u64,
    pub system_rest_ms: u64,
    pub paused_ms: u64,
    pub off_ms: u64,
}
impl ActivityLogSummary {
    fn add(&mut self, s: &ActivityLogSegment) {
        let target = match s.mode {
            LogMode::Working => &mut self.working_ms,
            LogMode::Resting => &mut self.resting_ms,
            LogMode::SystemRest => &mut self.system_rest_ms,
            LogMode::Paused => &mut self.paused_ms,
            LogMode::Off => &mut self.off_ms,
        };
        *target = target.saturating_add(s.duration_ms);
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogDay {
    pub day: String,
    pub segments: Vec<ActivityLogSegment>,
    pub summary: ActivityLogSummary,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogDaySummary {
    pub day: String,
    pub summary: ActivityLogSummary,
    pub segment_count: usize,
    pub incomplete: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct ActivityLogDays {
    pub days: Vec<ActivityLogDaySummary>,
}
#[derive(Clone, Debug, Serialize)]
pub struct ActivityLogStatus {
    pub error: Option<String>,
}

/// Store each local day at insertion; never regroup old rows using a later timezone.
pub trait Calendar {
    fn local_day(&self, utc_ms: i64) -> Result<String, String>;
    fn next_midnight(&self, utc_ms: i64) -> Result<i64, String>;
    fn offset_minutes(&self, utc_ms: i64) -> Result<i32, String>;
}
pub struct WindowsLocalCalendar;
impl Calendar for WindowsLocalCalendar {
    fn local_day(&self, t: i64) -> Result<String, String> {
        Ok(Local
            .timestamp_millis_opt(t)
            .single()
            .ok_or("Invalid local timestamp")?
            .format("%Y-%m-%d")
            .to_string())
    }
    fn next_midnight(&self, t: i64) -> Result<i64, String> {
        let current = Local
            .timestamp_millis_opt(t)
            .single()
            .ok_or("Invalid local timestamp")?;
        let next = current
            .date_naive()
            .succ_opt()
            .ok_or("Local date overflow")?
            .and_hms_opt(0, 0, 0)
            .ok_or("Invalid midnight")?;
        let boundary = if let Some(value) = Local.from_local_datetime(&next).earliest() {
            value.timestamp_millis()
        } else {
            let day = self.local_day(t)?;
            let mut low = t;
            let mut high = t.checked_add(3 * 86_400_000).ok_or("Local date overflow")?;
            if self.local_day(high)? == day {
                return Err("Local day did not advance".into());
            }
            while high - low > 1 {
                let mid = low + (high - low) / 2;
                if self.local_day(mid)? == day {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            high
        };
        if boundary <= t {
            return Err("Local midnight did not advance".into());
        }
        Ok(boundary)
    }
    fn offset_minutes(&self, t: i64) -> Result<i32, String> {
        Ok(Local
            .timestamp_millis_opt(t)
            .single()
            .ok_or("Invalid local timestamp")?
            .offset()
            .local_minus_utc()
            / 60)
    }
}
/// Deterministic fixture adapter, also useful for explicit-offset export checks.
pub struct FixedCalendar(pub FixedOffset);
impl Calendar for FixedCalendar {
    fn local_day(&self, t: i64) -> Result<String, String> {
        Ok(self
            .0
            .timestamp_millis_opt(t)
            .single()
            .ok_or("Invalid fixture timestamp")?
            .format("%Y-%m-%d")
            .to_string())
    }
    fn next_midnight(&self, t: i64) -> Result<i64, String> {
        let next = self
            .0
            .timestamp_millis_opt(t)
            .single()
            .ok_or("Invalid fixture timestamp")?
            .date_naive()
            .succ_opt()
            .ok_or("Date overflow")?
            .and_hms_opt(0, 0, 0)
            .ok_or("Invalid midnight")?;
        self.0
            .from_local_datetime(&next)
            .single()
            .map(|v| v.timestamp_millis())
            .ok_or("Invalid fixture midnight".into())
    }
    fn offset_minutes(&self, _: i64) -> Result<i32, String> {
        Ok(self.0.local_minus_utc() / 60)
    }
}
fn valid_day(day: &str) -> Result<(), String> {
    let value = NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| "Invalid activity day")?;
    if value.format("%Y-%m-%d").to_string() != day {
        return Err("Activity day must be YYYY-MM-DD".into());
    }
    Ok(())
}
fn sql_mono(v: u64) -> Result<i64, String> {
    i64::try_from(v).map_err(|_| "Activity monotonic timestamp overflow".into())
}

pub struct ActivityLogStore {
    connection: Connection,
    write_error: Option<String>,
}
impl ActivityLogStore {
    pub fn open(directory: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        let path = directory.join("activity-log.sqlite");
        if path.is_symlink() {
            return Err("Activity log database cannot be a symlink".into());
        }
        let mut connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_millis(1000))
            .map_err(|e| e.to_string())?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 1 {
            return Err("Unsupported activity log schema version".into());
        }
        connection.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS activity_segments(
            id TEXT PRIMARY KEY,session_id TEXT NOT NULL,day TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('off','working','resting','systemRest','paused')),
            reason TEXT NOT NULL CHECK(reason IN ('idle','manual','system','control','restart')),
            start_mono_ms INTEGER NOT NULL CHECK(start_mono_ms>=0),end_mono_ms INTEGER NOT NULL CHECK(end_mono_ms>=start_mono_ms),
            start_utc_ms INTEGER NOT NULL,end_utc_ms INTEGER NOT NULL CHECK(end_utc_ms>=start_utc_ms),
            start_offset_minutes INTEGER,end_offset_minutes INTEGER,
            incomplete INTEGER NOT NULL CHECK(incomplete IN (0,1)),ongoing INTEGER NOT NULL CHECK(ongoing IN (0,1)));
          CREATE INDEX IF NOT EXISTS activity_segments_day ON activity_segments(day,start_utc_ms);
          CREATE INDEX IF NOT EXISTS activity_segments_session ON activity_segments(session_id,end_mono_ms);
          PRAGMA user_version=1;").map_err(|e|e.to_string())?;
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        // No restart timestamp is used: preserve the last durably confirmed endpoint.
        tx.execute(
            "UPDATE activity_segments SET ongoing=0,incomplete=1 WHERE ongoing=1",
            [],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Self {
            connection,
            write_error: None,
        })
    }
    pub fn status(&self) -> ActivityLogStatus {
        ActivityLogStatus {
            error: self.write_error.clone(),
        }
    }
    fn readable(&self) -> Result<(), String> {
        self.write_error.clone().map_or(Ok(()), Err)
    }
    /// Keep the failed input batch in the host; a successful retry clears the visible failure.
    pub fn apply(
        &mut self,
        session_id: &str,
        events: &[LogObservation],
        clock: ClockPair,
        calendar: &impl Calendar,
    ) -> Result<Vec<String>, String> {
        let result = (|| {
            if session_id.is_empty() {
                return Err("Missing activity session ID".into());
            }
            let tx = self.connection.transaction().map_err(|e| e.to_string())?;
            let mut changed = std::collections::BTreeSet::new();
            for event in events {
                match event {
                    LogObservation::Span(span) => {
                        append_span(&tx, session_id, span, clock, calendar, &mut changed)?
                    }
                    LogObservation::Close { incomplete } => {
                        close_open(&tx, session_id, *incomplete, &mut changed)?
                    }
                    LogObservation::TruncateSystemRest { at_mono_ms } => {
                        truncate_system_rest(&tx, session_id, *at_mono_ms, &mut changed)?
                    }
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(changed.into_iter().collect())
        })();
        match &result {
            Ok(_) => self.write_error = None,
            Err(e) => self.write_error = Some(format!("Activity log write failed: {e}")),
        }
        result
    }
    pub fn day(&self, day: &str) -> Result<ActivityLogDay, String> {
        self.readable()?;
        valid_day(day)?;
        let mut statement=self.connection.prepare("SELECT id,mode,reason,start_utc_ms,end_utc_ms,end_mono_ms-start_mono_ms,incomplete,ongoing,start_offset_minutes,end_offset_minutes FROM activity_segments WHERE day=?1 ORDER BY start_utc_ms,rowid").map_err(|e|e.to_string())?;
        let raw = statement
            .query_map([day], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, bool>(6)?,
                    r.get::<_, bool>(7)?,
                    r.get::<_, Option<i32>>(8)?,
                    r.get::<_, Option<i32>>(9)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut segments = Vec::new();
        let mut summary = ActivityLogSummary::default();
        for item in raw {
            let (
                id,
                mode,
                reason,
                start,
                end,
                duration,
                incomplete,
                ongoing,
                start_offset,
                end_offset,
            ) = item.map_err(|e| e.to_string())?;
            let segment = ActivityLogSegment {
                id,
                mode: LogMode::parse(&mode)?,
                reason: LogReason::parse(&reason)?,
                start_utc_ms: start,
                end_utc_ms: end,
                duration_ms: u64::try_from(duration)
                    .map_err(|_| "Invalid stored activity duration")?,
                incomplete,
                ongoing,
                start_offset_minutes: start_offset,
                end_offset_minutes: end_offset,
            };
            summary.add(&segment);
            segments.push(segment);
        }
        Ok(ActivityLogDay {
            day: day.into(),
            segments,
            summary,
        })
    }
    pub fn days(
        &self,
        limit: Option<u32>,
        before_day: Option<&str>,
    ) -> Result<ActivityLogDays, String> {
        self.readable()?;
        let limit = limit.unwrap_or(31);
        if !(1..=366).contains(&limit) {
            return Err("Activity day limit must be 1-366".into());
        }
        if let Some(day) = before_day {
            valid_day(day)?;
        }
        let keys = {
            let mut statement=self.connection.prepare("SELECT DISTINCT day FROM activity_segments WHERE (?1 IS NULL OR day<?1) ORDER BY day DESC LIMIT ?2").map_err(|e|e.to_string())?;
            let rows = statement
                .query_map(params![before_day, limit], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let mut days = Vec::new();
        for key in keys {
            let data = self.day(&key)?;
            days.push(ActivityLogDaySummary {
                day: key,
                summary: data.summary,
                segment_count: data.segments.len(),
                incomplete: data.segments.iter().any(|s| s.incomplete),
            });
        }
        Ok(ActivityLogDays { days })
    }
}
fn close_open(
    tx: &Transaction<'_>,
    session: &str,
    incomplete: bool,
    changed: &mut std::collections::BTreeSet<String>,
) -> Result<(), String> {
    let mut q = tx
        .prepare("SELECT DISTINCT day FROM activity_segments WHERE session_id=?1 AND ongoing=1")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([session], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for day in rows {
        changed.insert(day.map_err(|e| e.to_string())?);
    }
    tx.execute("UPDATE activity_segments SET ongoing=0,incomplete=MAX(incomplete,?2) WHERE session_id=?1 AND ongoing=1",params![session,incomplete]).map_err(|e|e.to_string())?;
    Ok(())
}
fn append_span(
    tx: &Transaction<'_>,
    session: &str,
    span: &AllocatedSpan,
    clock: ClockPair,
    calendar: &impl Calendar,
    changed: &mut std::collections::BTreeSet<String>,
) -> Result<(), String> {
    if span.end_mono_ms < span.start_mono_ms {
        return Err("Activity slice end precedes start".into());
    }
    if span.start_mono_ms == span.end_mono_ms {
        return Ok(());
    }
    let latest:Option<(i64,i64)>=tx.query_row("SELECT end_mono_ms,end_utc_ms FROM activity_segments WHERE session_id=?1 ORDER BY end_mono_ms DESC,rowid DESC LIMIT 1",[session],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
    if let Some((last_mono, last_utc)) = latest {
        if last_mono > sql_mono(span.start_mono_ms)? {
            return Err("Activity slices overlap or were replayed".into());
        }
        let new_start = clock.utc_at(span.start_mono_ms)?;
        if i128::from(new_start) - i128::from(span.start_mono_ms)
            != i128::from(last_utc) - i128::from(last_mono)
        {
            return Err("Activity clock mapping changed; start a new session".into());
        }
    }
    let mut start = clock.utc_at(span.start_mono_ms)?;
    let end = clock.utc_at(span.end_mono_ms)?;
    let mut mono = span.start_mono_ms;
    while start < end {
        let day = calendar.local_day(start)?;
        valid_day(&day)?;
        let boundary = calendar.next_midnight(start)?;
        if boundary <= start {
            return Err("Local day boundary did not advance".into());
        }
        let finish = end.min(boundary);
        let part =
            u64::try_from(finish - start).map_err(|_| "Invalid allocated activity length")?;
        let end_mono = mono.checked_add(part).ok_or("Activity duration overflow")?;
        let offset_start = calendar.offset_minutes(start)?;
        let offset_end = calendar.offset_minutes(finish)?;
        let previous:Option<(String,String,String,String,i64,i64,bool)>=tx.query_row("SELECT id,day,mode,reason,end_mono_ms,end_utc_ms,incomplete FROM activity_segments WHERE session_id=?1 AND ongoing=1 ORDER BY rowid DESC LIMIT 1",[session],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional().map_err(|e|e.to_string())?;
        if let Some((id, old_day, mode, reason, old_mono, old_utc, false)) = previous.filter(|p| {
            p.1 == day
                && p.2 == span.mode.key()
                && p.3 == span.reason.key()
                && p.4 == sql_mono(mono).unwrap_or(-1)
                && p.5 == start
                && !p.6
        }) {
            let _ = (old_day, mode, reason, old_mono, old_utc);
            tx.execute("UPDATE activity_segments SET end_mono_ms=?2,end_utc_ms=?3,end_offset_minutes=?4 WHERE id=?1",params![id,sql_mono(end_mono)?,finish,offset_end]).map_err(|e|e.to_string())?;
        } else {
            close_open(tx, session, false, changed)?;
            tx.execute("INSERT INTO activity_segments(id,session_id,day,mode,reason,start_mono_ms,end_mono_ms,start_utc_ms,end_utc_ms,start_offset_minutes,end_offset_minutes,incomplete,ongoing) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,1)",params![Uuid::new_v4().to_string(),session,day,span.mode.key(),span.reason.key(),sql_mono(mono)?,sql_mono(end_mono)?,start,finish,offset_start,offset_end]).map_err(|e|e.to_string())?;
        }
        changed.insert(day);
        mono = end_mono;
        start = finish;
        if finish == boundary {
            close_open(tx, session, false, changed)?;
        }
    }
    Ok(())
}
fn truncate_system_rest(
    tx: &Transaction<'_>,
    session: &str,
    at: u64,
    changed: &mut std::collections::BTreeSet<String>,
) -> Result<(), String> {
    let at = sql_mono(at)?;
    let mut statement=tx.prepare("SELECT id,day,mode,start_mono_ms,end_mono_ms,start_utc_ms FROM activity_segments WHERE session_id=?1 AND end_mono_ms>?2").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map(params![session, at], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if rows.iter().any(|row| row.2 != "systemRest") {
        return Err("Queued system event cannot retract non-system activity".into());
    }
    for (id, day, _, start, _, utc_start) in rows {
        changed.insert(day);
        if start >= at {
            tx.execute("DELETE FROM activity_segments WHERE id=?1", [id])
                .map_err(|e| e.to_string())?;
        } else {
            tx.execute("UPDATE activity_segments SET end_mono_ms=?2,end_utc_ms=?3,end_offset_minutes=NULL,ongoing=0 WHERE id=?1",params![id,at,utc_start.checked_add(at-start).ok_or("Activity timestamp overflow")?]).map_err(|e|e.to_string())?;
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;
    fn calendar() -> FixedCalendar {
        FixedCalendar(FixedOffset::east_opt(8 * 3600).unwrap())
    }
    fn stamp(mono: u64, utc: i64) -> ClockPair {
        ClockPair {
            mono_ms: mono,
            utc_ms: utc,
        }
    }
    fn utc(text: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(text)
            .unwrap()
            .timestamp_millis()
    }
    fn span(start: u64, end: u64, mode: LogMode, reason: LogReason) -> LogObservation {
        LogObservation::Span(AllocatedSpan {
            start_mono_ms: start,
            end_mono_ms: end,
            mode,
            reason,
        })
    }
    fn directory() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }
    #[test]
    fn exact_fifth_second_split_uses_allocated_slices() {
        let dir = directory();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        let base = utc("2026-10-08T09:00:00+08:00");
        db.apply(
            "s",
            &[
                span(0, 10_000, LogMode::Working, LogReason::Control),
                LogObservation::Close { incomplete: false },
                span(10_000, 15_500, LogMode::Resting, LogReason::Manual),
                LogObservation::Close { incomplete: false },
                span(15_500, 15_750, LogMode::Working, LogReason::Control),
            ],
            stamp(15_750, base + 15_750),
            &calendar(),
        )
        .unwrap();
        let day = db.day("2026-10-08").unwrap();
        assert_eq!(day.segments.len(), 3);
        assert_eq!(day.summary.working_ms, 10_250);
        assert_eq!(day.summary.resting_ms, 5_500);
        assert_eq!(day.segments[1].end_utc_ms, base + 15_500);
        assert!(!day.segments[1].ongoing);
        assert!(day.segments[2].ongoing);
    }
    #[test]
    fn local_midnight_is_split_and_offsets_are_stored() {
        let dir = directory();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        let start = utc("2026-10-08T23:59:59.500+08:00");
        let changed = db
            .apply(
                "s",
                &[span(0, 2000, LogMode::Working, LogReason::Control)],
                stamp(2000, start + 2000),
                &calendar(),
            )
            .unwrap();
        assert_eq!(changed, vec!["2026-10-08", "2026-10-09"]);
        let first = db.day("2026-10-08").unwrap();
        let second = db.day("2026-10-09").unwrap();
        assert_eq!(first.summary.working_ms, 500);
        assert_eq!(second.summary.working_ms, 1500);
        assert!(!first.segments[0].ongoing);
        assert!(second.segments[0].ongoing);
        assert_eq!(first.segments[0].start_offset_minutes, Some(480));
    }
    #[test]
    fn adjacent_polls_merge_and_transition_closes_only_once() {
        let dir = directory();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        let base = utc("2026-10-08T12:00:00+08:00");
        for n in 1..=4 {
            db.apply(
                "s",
                &[span(
                    (n - 1) * 500,
                    n * 500,
                    LogMode::Working,
                    LogReason::Control,
                )],
                stamp(n * 500, base + (n * 500) as i64),
                &calendar(),
            )
            .unwrap();
        }
        db.apply(
            "s",
            &[
                LogObservation::Close { incomplete: false },
                LogObservation::Close { incomplete: false },
            ],
            stamp(2000, base + 2000),
            &calendar(),
        )
        .unwrap();
        let day = db.day("2026-10-08").unwrap();
        assert_eq!(day.segments.len(), 1);
        assert_eq!(day.summary.working_ms, 2000);
        assert!(!day.segments[0].ongoing);
        assert!(!day.segments[0].incomplete);
    }
    #[test]
    fn restart_marks_only_tail_incomplete_and_never_bridges_shutdown() {
        let dir = directory();
        let base = utc("2026-10-08T12:00:00+08:00");
        {
            let mut db = ActivityLogStore::open(dir.path()).unwrap();
            db.apply(
                "old",
                &[span(0, 1000, LogMode::Working, LogReason::Control)],
                stamp(1000, base + 1000),
                &calendar(),
            )
            .unwrap();
        }
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        db.apply(
            "new",
            &[span(50_000, 50_500, LogMode::Working, LogReason::Restart)],
            stamp(50_500, base + 3_600_500),
            &calendar(),
        )
        .unwrap();
        let day = db.day("2026-10-08").unwrap();
        assert_eq!(day.summary.working_ms, 1500);
        assert_eq!(day.segments[0].end_utc_ms, base + 1000);
        assert!(day.segments[0].incomplete);
        assert!(!day.segments[0].ongoing);
        assert!(day.segments[1].ongoing);
    }
    #[test]
    fn normal_exit_preserves_complete_rows_on_restart() {
        let dir = directory();
        let base = utc("2026-10-08T12:00:00+08:00");
        {
            let mut db = ActivityLogStore::open(dir.path()).unwrap();
            db.apply(
                "old",
                &[
                    span(0, 1000, LogMode::Resting, LogReason::Idle),
                    LogObservation::Close { incomplete: false },
                ],
                stamp(1000, base + 1000),
                &calendar(),
            )
            .unwrap();
        }
        let db = ActivityLogStore::open(dir.path()).unwrap();
        let day = db.day("2026-10-08").unwrap();
        assert!(!day.segments[0].incomplete);
        assert!(!day.segments[0].ongoing);
    }
    #[test]
    fn unexplained_gap_is_not_filled() {
        let dir = directory();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        let base = utc("2026-10-08T12:00:00+08:00");
        db.apply(
            "s",
            &[
                span(0, 1000, LogMode::Working, LogReason::Control),
                LogObservation::Close { incomplete: true },
                span(10_000, 10_500, LogMode::Working, LogReason::Control),
            ],
            stamp(10_500, base + 10_500),
            &calendar(),
        )
        .unwrap();
        let day = db.day("2026-10-08").unwrap();
        assert_eq!(day.summary.working_ms, 1500);
        assert!(day.segments[0].incomplete);
        assert_eq!(
            day.segments[1].start_utc_ms - day.segments[0].end_utc_ms,
            9000
        );
    }
    #[test]
    fn queued_unlock_retracts_midnight_continuation() {
        let dir = directory();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        let start = utc("2026-10-08T23:59:58+08:00");
        db.apply(
            "s",
            &[span(0, 5000, LogMode::SystemRest, LogReason::System)],
            stamp(5000, start + 5000),
            &calendar(),
        )
        .unwrap();
        db.apply(
            "s",
            &[
                LogObservation::TruncateSystemRest { at_mono_ms: 1500 },
                LogObservation::Close { incomplete: false },
                span(1500, 5500, LogMode::Working, LogReason::Control),
            ],
            stamp(5500, start + 5500),
            &calendar(),
        )
        .unwrap();
        let a = db.day("2026-10-08").unwrap();
        let b = db.day("2026-10-09").unwrap();
        assert_eq!(a.summary.system_rest_ms, 1500);
        assert_eq!(b.summary.system_rest_ms, 0);
        assert_eq!(a.summary.working_ms + b.summary.working_ms, 4000);
        assert_eq!(a.segments[0].end_utc_ms, start + 1500);
    }
    #[test]
    fn failed_batch_rolls_back_is_visible_and_retry_clears_error() {
        let dir = directory();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        let base = utc("2026-10-08T12:00:00+08:00");
        let bad = [
            span(0, 1000, LogMode::Working, LogReason::Control),
            span(999, 1500, LogMode::Working, LogReason::Control),
        ];
        assert!(db
            .apply("s", &bad, stamp(1500, base + 1500), &calendar())
            .is_err());
        assert!(db.status().error.is_some());
        assert!(db.day("2026-10-08").is_err());
        db.apply(
            "s",
            &[span(0, 1000, LogMode::Working, LogReason::Control)],
            stamp(1000, base + 1000),
            &calendar(),
        )
        .unwrap();
        assert!(db.status().error.is_none());
        assert_eq!(db.day("2026-10-08").unwrap().summary.working_ms, 1000);
    }
    #[test]
    fn changed_timezone_never_regroups_stored_day() {
        let dir = directory();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        let base = utc("2026-10-09T00:30:00+08:00");
        db.apply(
            "s",
            &[
                span(0, 1000, LogMode::Working, LogReason::Control),
                LogObservation::Close { incomplete: false },
            ],
            stamp(1000, base + 1000),
            &calendar(),
        )
        .unwrap();
        let west = FixedCalendar(FixedOffset::west_opt(7 * 3600).unwrap());
        db.apply(
            "new",
            &[span(0, 500, LogMode::Working, LogReason::Control)],
            stamp(500, base + 2000),
            &west,
        )
        .unwrap();
        assert_eq!(db.day("2026-10-09").unwrap().summary.working_ms, 1000);
        assert_eq!(db.day("2026-10-08").unwrap().summary.working_ms, 500);
        assert_eq!(
            db.day("2026-10-09").unwrap().segments[0].start_offset_minutes,
            Some(480)
        );
    }
    #[test]
    fn strict_query_pagination_and_json_contract() {
        let dir = directory();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        let base = utc("2026-10-08T23:59:59.500+08:00");
        db.apply(
            "s",
            &[span(0, 2000, LogMode::Paused, LogReason::Control)],
            stamp(2000, base + 2000),
            &calendar(),
        )
        .unwrap();
        assert!(db.day("2026-1-8").is_err());
        assert!(db.days(Some(0), None).is_err());
        assert!(db.days(Some(367), None).is_err());
        let days = db.days(Some(1), Some("2026-10-09")).unwrap();
        assert_eq!(days.days[0].day, "2026-10-08");
        let json = serde_json::to_value(db.day("2026-10-09").unwrap()).unwrap();
        assert_eq!(json["segments"][0]["mode"], "paused");
        assert!(json["segments"][0].get("state").is_none());
        assert_eq!(json["summary"]["pausedMs"], 1500);
    }
    struct LongDay;
    impl Calendar for LongDay {
        fn local_day(&self, t: i64) -> Result<String, String> {
            Ok(if t < 90_000_000 {
                "2026-10-25"
            } else {
                "2026-10-26"
            }
            .into())
        }
        fn next_midnight(&self, t: i64) -> Result<i64, String> {
            Ok(if t < 90_000_000 {
                90_000_000
            } else {
                176_400_000
            })
        }
        fn offset_minutes(&self, t: i64) -> Result<i32, String> {
            Ok(if t < 3_600_000 { 120 } else { 60 })
        }
    }
    #[test]
    fn calendar_boundary_supports_a_25_hour_day_without_fixed_86400_assumption() {
        let dir = directory();
        let mut db = ActivityLogStore::open(dir.path()).unwrap();
        db.apply(
            "s",
            &[span(0, 90_000_500, LogMode::SystemRest, LogReason::System)],
            stamp(90_000_500, 90_000_500),
            &LongDay,
        )
        .unwrap();
        assert_eq!(
            db.day("2026-10-25").unwrap().summary.system_rest_ms,
            90_000_000
        );
        assert_eq!(db.day("2026-10-26").unwrap().summary.system_rest_ms, 500);
    }
}
