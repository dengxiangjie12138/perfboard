use super::activity_log::{ActivityLogStore, ClockPair, LogObservation, WindowsLocalCalendar};
use super::engine::Engine;
use std::{collections::VecDeque, path::Path};
pub struct Batch {
    session: String,
    clock: ClockPair,
    events: Vec<LogObservation>,
}
pub struct Recorder {
    pub store: Option<ActivityLogStore>,
    pub error: Option<String>,
    clock: ClockPair,
    session: String,
    last_mono: u64,
    era_start: u64,
    pending: VecDeque<Batch>,
    flush_requested: bool,
}
pub struct FlushJob {
    store: Option<ActivityLogStore>,
    error: Option<String>,
    pending: VecDeque<Batch>,
}
impl FlushJob {
    pub fn run(&mut self) -> Result<Vec<String>, String> {
        let Some(store) = self.store.as_mut() else {
            return Err(self
                .error
                .clone()
                .unwrap_or_else(|| "活动日志存储不可用".into()));
        };
        let mut changed = std::collections::BTreeSet::new();
        while let Some(batch) = self.pending.front() {
            match store.apply(
                &batch.session,
                &batch.events,
                batch.clock,
                &WindowsLocalCalendar,
            ) {
                Ok(days) => {
                    changed.extend(days);
                    self.pending.pop_front();
                }
                Err(error) => {
                    self.error = Some(error.clone());
                    return Err(error);
                }
            }
        }
        self.error = None;
        Ok(changed.into_iter().collect())
    }
    pub fn day(&self, day: &str) -> Result<super::activity_log::ActivityLogDay, String> {
        self.store.as_ref().ok_or("活动日志存储不可用")?.day(day)
    }
    pub fn days(
        &self,
        limit: Option<u32>,
        before: Option<&str>,
    ) -> Result<super::activity_log::ActivityLogDays, String> {
        self.store
            .as_ref()
            .ok_or("活动日志存储不可用")?
            .days(limit, before)
    }
}
fn wall_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
impl Recorder {
    pub fn new(directory: &Path, mono: u64) -> Self {
        let (store, error) = match ActivityLogStore::open(directory) {
            Ok(s) => (Some(s), None),
            Err(e) => (None, Some(e)),
        };
        Self {
            store,
            error,
            clock: ClockPair {
                mono_ms: mono,
                utc_ms: wall_ms(),
            },
            session: uuid::Uuid::new_v4().to_string(),
            last_mono: mono,
            era_start: mono,
            pending: VecDeque::new(),
            flush_requested: false,
        }
    }
    pub fn observe_clock(&mut self, mono: u64, engine: &mut Engine) {
        self.observe_clock_at(mono, wall_ms(), engine);
    }
    fn observe_clock_at(&mut self, mono: u64, utc: i64, engine: &mut Engine) {
        let discontinuous = mono < self.last_mono
            || self
                .clock
                .utc_at(mono)
                .map(|v| (i128::from(v) - i128::from(utc)).abs() > 2000)
                .unwrap_or(true);
        if discontinuous {
            self.collect(engine);
            self.push(vec![LogObservation::Close { incomplete: true }]);
            self.clock = ClockPair {
                mono_ms: mono,
                utc_ms: utc,
            };
            self.session = uuid::Uuid::new_v4().to_string();
            self.era_start = mono;
        }
        self.last_mono = mono;
    }
    fn push(&mut self, events: Vec<LogObservation>) {
        if events.is_empty() {
            return;
        }
        if let Some(batch) = self
            .pending
            .back_mut()
            .filter(|b| b.session == self.session)
        {
            for event in events {
                if let LogObservation::Span(next) = &event {
                    if let Some(LogObservation::Span(previous)) = batch.events.last_mut() {
                        if previous.end_mono_ms == next.start_mono_ms
                            && previous.mode == next.mode
                            && previous.reason == next.reason
                        {
                            previous.end_mono_ms = next.end_mono_ms;
                            continue;
                        }
                    }
                }
                if let (
                    Some(LogObservation::Close { incomplete: a }),
                    LogObservation::Close { incomplete: b },
                ) = (batch.events.last_mut(), &event)
                {
                    *a |= *b;
                    continue;
                }
                batch.events.push(event);
            }
        } else {
            self.pending.push_back(Batch {
                session: self.session.clone(),
                clock: self.clock,
                events,
            });
        }
    }
    pub fn collect(&mut self, engine: &mut Engine) {
        let mut events = engine.drain_activity();
        events.retain_mut(|event| {
            if let LogObservation::Span(span) = event {
                span.start_mono_ms = span.start_mono_ms.max(self.era_start);
                return span.end_mono_ms > span.start_mono_ms;
            }
            true
        });
        self.push(events);
    }
    pub fn close(&mut self, engine: &mut Engine) {
        self.collect(engine);
        self.push(vec![LogObservation::Close { incomplete: false }]);
        self.flush_requested = true;
    }
    pub fn needs_flush(&self) -> bool {
        self.pending.iter().any(|b| {
            b.events
                .iter()
                .any(|e| !matches!(e, LogObservation::Span(_)))
        })
    }
    pub fn flush(&mut self) -> Result<Vec<String>, String> {
        let mut job = self.take_flush();
        let result = job.run();
        self.finish_flush(job);
        result
    }
    /// Detach storage and queued observations while Runtime remains responsive.
    pub fn take_flush(&mut self) -> FlushJob {
        self.flush_requested = false;
        FlushJob {
            store: self.store.take(),
            error: self.error.clone(),
            pending: std::mem::take(&mut self.pending),
        }
    }
    pub fn request_flush(&mut self) {
        self.flush_requested = true;
    }
    pub fn flush_requested(&self) -> bool {
        self.flush_requested
    }
    pub fn finish_flush(&mut self, mut job: FlushJob) {
        self.store = job.store;
        self.error = job.error;
        self.flush_requested |= self.error.is_some();
        job.pending.append(&mut self.pending);
        self.pending = job.pending;
    }
    pub fn readable(&self) -> Result<&ActivityLogStore, String> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        self.store
            .as_ref()
            .ok_or_else(|| "活动日志存储不可用".into())
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        activity::ResumeSample,
        engine::{SessionKind, Settings},
    };
    use super::*;
    #[test]
    fn queued_recovery_retracts_old_era_before_wall_clock_rotation() {
        let dir = tempfile::tempdir().unwrap();
        let mut recorder = Recorder::new(dir.path(), 0);
        let base = chrono::DateTime::parse_from_rfc3339("2026-10-08T12:00:00Z")
            .unwrap()
            .timestamp_millis();
        recorder.clock = ClockPair {
            mono_ms: 0,
            utc_ms: base,
        };
        let mut engine = Engine::new(0);
        engine
            .configure(
                Settings {
                    enabled: true,
                    ..Settings::default()
                },
                0,
            )
            .unwrap();
        engine.drain_activity();
        engine.session(SessionKind::Locked, true, 0);
        recorder.collect(&mut engine);
        engine.tick(10000, None, ResumeSample::default());
        recorder.collect(&mut engine);
        recorder.flush().unwrap();
        engine.session(SessionKind::Locked, false, 9500);
        recorder.collect(&mut engine);
        recorder.observe_clock_at(10500, base + 10500 + 3_600_000, &mut engine);
        engine.tick(11000, Some((11000, 0)), ResumeSample::default());
        recorder.collect(&mut engine);
        recorder.flush().unwrap();
        let db = recorder.readable().unwrap();
        let days = db.days(Some(31), None).unwrap();
        let total = days
            .days
            .iter()
            .map(|d| d.summary.working_ms + d.summary.system_rest_ms)
            .sum::<u64>();
        assert_eq!(total, 10000);
        let system = days
            .days
            .iter()
            .map(|d| d.summary.system_rest_ms)
            .sum::<u64>();
        assert_eq!(system, 9500);
    }
    #[test]
    fn observations_collected_while_storage_is_detached_are_not_lost() {
        let dir = tempfile::tempdir().unwrap();
        let mut recorder = Recorder::new(dir.path(), 0);
        let mut engine = Engine::new(0);
        engine
            .configure(
                Settings {
                    enabled: true,
                    ..Settings::default()
                },
                0,
            )
            .unwrap();
        engine.tick(1000, Some((1000, 0)), ResumeSample::default());
        recorder.collect(&mut engine);
        let mut flushing = recorder.take_flush();
        engine.tick(2000, Some((2000, 0)), ResumeSample::default());
        recorder.collect(&mut engine);
        flushing.run().unwrap();
        recorder.finish_flush(flushing);
        recorder.flush().unwrap();
        let days = recorder.readable().unwrap().days(Some(31), None).unwrap();
        assert_eq!(
            days.days.iter().map(|d| d.summary.working_ms).sum::<u64>(),
            2000
        );
    }
}
