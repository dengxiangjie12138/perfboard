//! Warehouse-independent activity estimate and uniformly sampled, opt-in exercise pool.
//! Only aggregate monotonic input times enter this engine; never keys or coordinates.
use super::activity_log::{Calendar, ClockPair, WindowsLocalCalendar};
use serde::{Deserialize, Serialize};
const MAX_GAP_MS: u64 = 5_000;
const MAX_HISTORY: usize = 200;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Exercise {
    pub id: String,
    pub name: String,
    pub instructions: String,
    pub selected: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub interval_ms: u64,
    pub idle_ms: u64,
    pub snooze_ms: u64,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_ms: 600_000,
            idle_ms: 30_000,
            snooze_ms: 120_000,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reminder {
    pub id: u64,
    pub exercise: Exercise,
    pub issued_at_ms: u64,
    pub snooze_active_remaining_ms: u64,
    #[serde(default)]
    pub started: bool,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Complete,
    Later,
    Skip,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryEntry {
    pub id: u64,
    pub reminder_id: u64,
    pub exercise_name: String,
    pub outcome: Outcome,
    pub at_ms: u64,
    pub cycle_active_ms: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkpoint {
    pub version: u8,
    pub settings: Settings,
    pub pool: Vec<Exercise>,
    pub active_ms: u64,
    pub total_active_ms: u64,
    #[serde(default)]
    pub daily_active_ms: u64,
    #[serde(default)]
    pub daily_active_day: Option<String>,
    pub pending: Option<Reminder>,
    pub history: Vec<HistoryEntry>,
    pub next_id: u64,
}
impl Default for Checkpoint {
    fn default() -> Self {
        Self {
            version: 1,
            settings: Settings::default(),
            pool: [
                ("push-ups", "俯卧撑"),
                ("squats", "深蹲"),
                ("horse-stance", "马步"),
            ]
            .into_iter()
            .map(|(id, name)| Exercise {
                id: id.into(),
                name: name.into(),
                instructions: String::new(),
                selected: false,
            })
            .collect(),
            active_ms: 0,
            total_active_ms: 0,
            daily_active_ms: 0,
            daily_active_day: None,
            pending: None,
            history: Vec::new(),
            next_id: 1,
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configure {
    pub settings: Settings,
    pub pool: Vec<Exercise>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Start {
        #[serde(rename = "reminderId")]
        reminder_id: u64,
    },
    Respond {
        #[serde(rename = "reminderId")]
        reminder_id: u64,
        outcome: Outcome,
    },
    Reset,
    Show,
    Collapse,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    pub state: Checkpoint,
    pub source_available: bool,
    pub blocked: bool,
    pub system_monitor_available: bool,
    pub prompt_visible: bool,
    pub idle: bool,
    pub error: Option<String>,
}
#[derive(Clone, Copy, Debug)]
pub struct Sample {
    pub now_ms: u64,
    pub latest_input_ms: Option<u64>,
    pub available: bool,
    pub blocked: bool,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Effect {
    ShowPrompt,
    HidePrompt,
}
#[derive(Clone, Debug)]
pub struct FitnessEngine {
    checkpoint: Checkpoint,
    previous: Option<Sample>,
    daily_clock: Option<ClockPair>,
    input_floor: u64,
    collapsed: bool,
    source_available: bool,
    blocked: bool,
    system_available: bool,
    error: Option<String>,
}

fn valid_daily_day(day: &str) -> bool {
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .is_ok_and(|date| date.format("%Y-%m-%d").to_string() == day)
}
/// Accepted half-open intervals are clipped separately; idle holes stay idle.
fn credit_in_day(
    intervals: &[(u64, u64)],
    clock: ClockPair,
    today: &str,
    calendar: &impl Calendar,
) -> Result<u64, String> {
    let mut total = 0u64;
    for &(start, end) in intervals {
        let mut cursor = clock.utc_at(start)?;
        let finish = clock.utc_at(end)?;
        if finish < cursor {
            return Err("Fitness activity interval reversed".into());
        }
        while cursor < finish {
            let boundary = calendar.next_midnight(cursor)?;
            if boundary <= cursor {
                return Err("Fitness midnight did not advance".into());
            }
            let stop = finish.min(boundary);
            if calendar.local_day(cursor)? == today {
                total = total.saturating_add(
                    u64::try_from(stop - cursor).map_err(|_| "Invalid fitness daily duration")?,
                );
            }
            cursor = stop;
        }
    }
    Ok(total)
}

fn validate_pool(pool: &[Exercise]) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    if pool.len() > 50
        || pool.iter().any(|x| {
            x.id.is_empty()
                || x.id.len() > 128
                || !ids.insert(&x.id)
                || x.name.trim().is_empty()
                || x.name.chars().count() > 80
                || x.instructions.chars().count() > 240
        })
    {
        return Err("动作池无效：动作最多50项，名称不能为空，ID不能重复。".into());
    }
    Ok(())
}
impl Checkpoint {
    pub fn validate(&self) -> Result<(), String> {
        let s = &self.settings;
        if self.version != 1
            || !(60_000..=86_400_000).contains(&s.interval_ms)
            || !(1_000..=3_600_000).contains(&s.idle_ms)
            || !(60_000..=3_600_000).contains(&s.snooze_ms)
            || self.history.len() > MAX_HISTORY
            || self.next_id == 0
            || self.next_id > MAX_SAFE - 1
            || self.active_ms > 86_400_000
            || self.total_active_ms > MAX_SAFE
            || self.daily_active_ms > self.total_active_ms
            || self
                .daily_active_day
                .as_deref()
                .is_some_and(|day| !valid_daily_day(day))
            || (self.daily_active_day.is_none() && self.daily_active_ms != 0)
        {
            return Err("工作与健身配置版本或数值无效。".into());
        }
        validate_pool(&self.pool)?;
        if s.enabled && !self.pool.iter().any(|x| x.selected) {
            return Err("请先勾选至少一个随机动作，再启用提醒。".into());
        }
        if let Some(p) = &self.pending {
            validate_pool(std::slice::from_ref(&p.exercise))?;
            if p.id == 0
                || p.id >= self.next_id
                || p.snooze_active_remaining_ms > 3_600_000
                || p.issued_at_ms > MAX_SAFE
            {
                return Err("提醒状态无效。".into());
            }
        }
        if self.history.iter().any(|h| {
            h.id == 0
                || h.id >= self.next_id
                || h.reminder_id == 0
                || h.reminder_id >= h.id
                || h.at_ms > MAX_SAFE
                || h.cycle_active_ms > 86_400_000
                || h.exercise_name.is_empty()
                || h.exercise_name.chars().count() > 80
        }) {
            return Err("动作记录无效。".into());
        }
        Ok(())
    }
}
impl Default for FitnessEngine {
    fn default() -> Self {
        Self::restore(Checkpoint::default()).expect("default fitness checkpoint")
    }
}
impl FitnessEngine {
    pub fn restore(checkpoint: Checkpoint) -> Result<Self, String> {
        checkpoint.validate()?;
        // A due reminder can be left by an older close action or process exit.
        // Re-arm it without changing saved activity, the exercise, or history.
        // visible() still waits for enabled, healthy, unblocked native sources.
        let collapsed = checkpoint
            .pending
            .as_ref()
            .is_none_or(|pending| pending.snooze_active_remaining_ms > 0);
        Ok(Self {
            checkpoint,
            previous: None,
            daily_clock: None,
            input_floor: 0,
            collapsed,
            source_available: false,
            blocked: true,
            system_available: false,
            error: None,
        })
    }
    pub fn checkpoint(&self) -> Checkpoint {
        self.checkpoint.clone()
    }
    pub fn enabled(&self) -> bool {
        self.checkpoint.settings.enabled
    }
    pub fn reset_observation(&mut self) {
        self.previous = None;
        self.daily_clock = None;
    }

    pub fn daily_day(&self) -> Option<&str> {
        self.checkpoint.daily_active_day.as_deref()
    }
    /// A status read changes the date bucket, never the input/clock baseline.
    pub fn normalize_daily(
        &mut self,
        wall_ms: u64,
        calendar: &impl Calendar,
    ) -> Result<bool, String> {
        let utc_ms = i64::try_from(wall_ms).map_err(|_| "Invalid fitness wall timestamp")?;
        let day = calendar.local_day(utc_ms)?;
        if !valid_daily_day(&day) {
            return Err("Invalid fitness local day".into());
        }
        if self.daily_day() == Some(day.as_str()) {
            return Ok(false);
        }
        self.checkpoint.daily_active_day = Some(day);
        self.checkpoint.daily_active_ms = 0;
        Ok(true)
    }
    pub fn report_error(&mut self, error: String) {
        self.error = Some(error);
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            state: self.checkpoint(),
            source_available: self.source_available,
            blocked: self.blocked,
            system_monitor_available: self.system_available,
            prompt_visible: self.visible(),
            idle: self.previous.is_none_or(|sample| {
                sample.latest_input_ms.is_none_or(|t| {
                    t < self.input_floor
                        || sample.now_ms.saturating_sub(t) >= self.checkpoint.settings.idle_ms
                })
            }),
            error: self.error.clone(),
        }
    }
    pub fn display_failed(&mut self, error: String) {
        self.error = Some(error);
        self.collapsed = true;
    }
    pub fn storage_failed(&mut self, error: String) {
        self.error = Some(error);
        self.checkpoint.settings.enabled = false;
        self.collapsed = true;
        self.reset_observation();
    }
    fn visible(&self) -> bool {
        self.enabled()
            && self.source_available
            && self.system_available
            && !self.blocked
            && !self.collapsed
            && self
                .checkpoint
                .pending
                .as_ref()
                .is_some_and(|p| p.snooze_active_remaining_ms == 0)
    }
    fn effects(&self, before: bool) -> Vec<Effect> {
        match (before, self.visible()) {
            (false, true) => vec![Effect::ShowPrompt],
            (true, false) => vec![Effect::HidePrompt],
            _ => vec![],
        }
    }
    pub fn configure(&mut self, request: Configure) -> Result<Vec<Effect>, String> {
        let before = self.visible();
        let mut candidate = self.checkpoint();
        candidate.settings = request.settings;
        candidate.pool = request.pool;
        candidate.validate()?;
        if candidate.settings.enabled != self.enabled()
            || candidate.settings.idle_ms != self.checkpoint.settings.idle_ms
        {
            self.reset_observation();
        }
        if !candidate.settings.enabled {
            self.collapsed = true;
        }
        self.checkpoint = candidate;
        self.error = None;
        Ok(self.effects(before))
    }
    /// Caller persists a cloned candidate before replacing the live engine or running effects.
    pub fn action(&mut self, action: Action, wall_ms: u64) -> Result<Vec<Effect>, String> {
        let before = self.visible();
        match action {
            Action::Start { reminder_id } => {
                let pending = self.checkpoint.pending.as_mut().ok_or("此提醒已处理。")?;
                if pending.id != reminder_id || pending.snooze_active_remaining_ms > 0 {
                    return Err("提醒已变化或正在稍后计时。".into());
                }
                pending.started = true;
                self.collapsed = false;
            }
            Action::Collapse => {
                // Closing is the same persisted response as Later, never a completion.
                // Duplicate close events must not restart a running snooze or add history.
                if before {
                    let reminder_id = self.checkpoint.pending.as_ref().unwrap().id;
                    return self.action(
                        Action::Respond {
                            reminder_id,
                            outcome: Outcome::Later,
                        },
                        wall_ms,
                    );
                }
            }
            Action::Show => self.collapsed = false,
            Action::Reset => {
                if self.checkpoint.pending.is_some() {
                    return Err("请先处理当前提醒，再重置累计。".into());
                }
                self.checkpoint.active_ms = 0;
                self.reset_observation();
            }
            Action::Respond {
                reminder_id,
                outcome,
            } => {
                let pending = self.checkpoint.pending.as_ref().ok_or("此提醒已处理。")?;
                if pending.id != reminder_id || pending.snooze_active_remaining_ms > 0 {
                    return Err("提醒已变化或正在稍后计时，请使用当前提醒。".into());
                }
                let entry = HistoryEntry {
                    id: self.checkpoint.next_id,
                    reminder_id,
                    exercise_name: pending.exercise.name.clone(),
                    outcome,
                    at_ms: wall_ms,
                    cycle_active_ms: self.checkpoint.active_ms,
                };
                self.checkpoint.next_id = self
                    .checkpoint
                    .next_id
                    .checked_add(1)
                    .ok_or("记录编号已耗尽。")?;
                self.checkpoint.history.insert(0, entry);
                self.checkpoint.history.truncate(MAX_HISTORY);
                if outcome == Outcome::Later {
                    self.checkpoint.pending.as_mut().unwrap().started = false;
                    self.checkpoint
                        .pending
                        .as_mut()
                        .unwrap()
                        .snooze_active_remaining_ms = self.checkpoint.settings.snooze_ms;
                } else {
                    self.checkpoint.pending = None;
                    self.checkpoint.active_ms = 0;
                }
                self.collapsed = false;
                self.reset_observation();
            }
        }
        Ok(self.effects(before))
    }
    pub fn tick(
        &mut self,
        sample: Sample,
        wall_ms: u64,
        system_available: bool,
        random_u32: impl FnMut() -> u32,
    ) -> Vec<Effect> {
        self.tick_with_calendar(
            sample,
            wall_ms,
            system_available,
            random_u32,
            &WindowsLocalCalendar,
        )
    }
    pub fn tick_with_calendar(
        &mut self,
        sample: Sample,
        wall_ms: u64,
        system_available: bool,
        mut random_u32: impl FnMut() -> u32,
        calendar: &impl Calendar,
    ) -> Vec<Effect> {
        let before = self.visible();
        // Normalize even when disabled, idle, locked or without a source.
        let daily_valid = match self.normalize_daily(wall_ms, calendar) {
            Ok(_) => true,
            Err(error) => {
                self.error = Some(error);
                false
            }
        };
        let clock = i64::try_from(wall_ms).ok().map(|utc_ms| ClockPair {
            mono_ms: sample.now_ms,
            utc_ms,
        });
        let coherent = self
            .daily_clock
            .zip(clock)
            .is_some_and(|(previous, current)| {
                current.mono_ms >= previous.mono_ms
                    && previous.utc_at(current.mono_ms).is_ok_and(|expected| {
                        (i128::from(expected) - i128::from(current.utc_ms)).abs() <= 2000
                    })
            });
        self.daily_clock = clock;
        self.source_available = sample.available;
        self.blocked = sample.blocked;
        self.system_available = system_available;
        let intervals = self.credit(Sample {
            available: sample.available && system_available,
            ..sample
        });
        let credited: u64 = intervals.iter().map(|(start, end)| end - start).sum();
        let daily_credited = if daily_valid && coherent {
            match credit_in_day(
                &intervals,
                clock.expect("coherent fitness clock"),
                self.daily_day().expect("normalized fitness day"),
                calendar,
            ) {
                Ok(value) => value,
                Err(error) => {
                    self.error = Some(error);
                    0
                }
            }
        } else {
            0
        };
        if self.enabled() && system_available {
            self.checkpoint.daily_active_ms = self
                .checkpoint
                .daily_active_ms
                .saturating_add(daily_credited)
                .min(MAX_SAFE);
            self.checkpoint.total_active_ms = self
                .checkpoint
                .total_active_ms
                .saturating_add(credited)
                .min(MAX_SAFE);
            if let Some(pending) = self.checkpoint.pending.as_mut() {
                if pending.snooze_active_remaining_ms > 0 {
                    let old = pending.snooze_active_remaining_ms;
                    pending.snooze_active_remaining_ms = old.saturating_sub(credited);
                    if old > 0 && pending.snooze_active_remaining_ms == 0 {
                        self.collapsed = false;
                    }
                }
            } else {
                self.checkpoint.active_ms = self
                    .checkpoint
                    .active_ms
                    .saturating_add(credited)
                    .min(self.checkpoint.settings.interval_ms);
                if credited > 0 && self.checkpoint.active_ms >= self.checkpoint.settings.interval_ms
                {
                    let selected: Vec<&Exercise> =
                        self.checkpoint.pool.iter().filter(|x| x.selected).collect();
                    if let Some(index) = uniform_index(selected.len(), &mut random_u32) {
                        if self.checkpoint.next_id < MAX_SAFE - 1 {
                            self.checkpoint.pending = Some(Reminder {
                                started: false,
                                id: self.checkpoint.next_id,
                                exercise: selected[index].clone(),
                                issued_at_ms: wall_ms,
                                snooze_active_remaining_ms: 0,
                            });
                            self.checkpoint.next_id += 1;
                            self.collapsed = false;
                        } else {
                            self.storage_failed("记录编号已耗尽，提醒已停用。".into());
                        }
                    }
                }
            }
        }
        self.effects(before)
    }
    fn credit(&mut self, sample: Sample) -> Vec<(u64, u64)> {
        let Some(previous) = self.previous.replace(sample) else {
            self.input_floor = sample.now_ms;
            return Vec::new();
        };
        let gap = sample.now_ms.checked_sub(previous.now_ms);
        let invalid = gap.is_none_or(|x| x == 0 || x > MAX_GAP_MS)
            || !sample.available
            || !previous.available
            || sample.blocked
            || previous.blocked
            || sample.latest_input_ms.is_some_and(|t| t > sample.now_ms)
            || (sample
                .latest_input_ms
                .zip(previous.latest_input_ms)
                .is_some_and(|(a, b)| a < b));
        if invalid {
            self.input_floor = sample.now_ms;
            return Vec::new();
        }
        let start = previous.now_ms;
        let end = sample.now_ms;
        let idle = self.checkpoint.settings.idle_ms;
        let previous_end = previous
            .latest_input_ms
            .filter(|t| *t >= self.input_floor)
            .map(|t| end.min(t.saturating_add(idle)))
            .unwrap_or(start)
            .max(start);
        let current_start = sample
            .latest_input_ms
            .filter(|t| *t >= self.input_floor)
            .map(|t| start.max(t))
            .unwrap_or(end);
        let current_end = sample
            .latest_input_ms
            .filter(|t| *t >= self.input_floor)
            .map(|t| end.min(t.saturating_add(idle)))
            .unwrap_or(end);
        let mut intervals = Vec::with_capacity(2);
        if previous_end > start {
            intervals.push((start, previous_end));
        }
        let current_start = current_start.max(previous_end);
        if current_end > current_start {
            intervals.push((current_start, current_end));
        }
        intervals
    }
}
/// Equal-size buckets over the entire u32 space. Rejected tail values remove modulo bias.
pub fn uniform_index(length: usize, random: &mut impl FnMut() -> u32) -> Option<usize> {
    if length == 0 || length > 50 {
        return None;
    }
    let bucket = (1u64 << 32) / length as u64;
    let limit = bucket * length as u64;
    for _ in 0..128 {
        let value = random() as u64;
        if value < limit {
            return Some((value / bucket) as usize);
        }
    }
    None
}
#[cfg(test)]
mod tests {
    use super::*;
    fn engine() -> FitnessEngine {
        let mut e = FitnessEngine::default();
        let mut c = e.checkpoint();
        c.settings.enabled = true;
        c.settings.interval_ms = 60_000;
        c.pool[0].selected = true;
        e.configure(Configure {
            settings: c.settings,
            pool: c.pool,
        })
        .unwrap();
        e
    }
    fn sample(now: u64, input: Option<u64>, blocked: bool) -> Sample {
        Sample {
            now_ms: now,
            latest_input_ms: input,
            available: true,
            blocked,
        }
    }
    #[test]
    fn defaults_are_off_and_nothing_is_opted_in() {
        let e = FitnessEngine::default();
        assert!(!e.enabled());
        assert_eq!(e.checkpoint.settings.interval_ms, 600_000);
        assert_eq!(e.checkpoint.settings.idle_ms, 30_000);
        assert!(e.checkpoint.pool.iter().all(|x| !x.selected));
    }
    #[test]
    fn combined_activity_is_never_double_counted_and_idle_is_clipped() {
        let mut e = engine();
        e.tick(sample(0, Some(0), false), 0, true, || 0);
        for t in (500..=31_000).step_by(500) {
            e.tick(sample(t, Some(0), false), t, true, || 0);
        }
        assert_eq!(e.checkpoint.active_ms, 30_000);
        e.tick(sample(31_500, Some(31_300), false), 31_500, true, || 0);
        assert_eq!(e.checkpoint.active_ms, 30_200);
    }
    #[test]
    fn lock_sleep_source_loss_and_large_gaps_never_backfill() {
        let mut e = engine();
        for s in [
            sample(0, Some(0), false),
            sample(500, Some(500), false),
            sample(1000, Some(1000), true),
            sample(20_000, Some(20_000), false),
            sample(20_500, Some(20_500), false),
        ] {
            e.tick(s, s.now_ms, true, || 0);
        }
        assert_eq!(e.checkpoint.active_ms, 1000);
        let mut s = sample(21_000, Some(21_000), false);
        s.available = false;
        e.tick(s, 21_000, true, || 0);
        e.tick(sample(21_500, Some(21_500), false), 21_500, true, || 0);
        assert_eq!(e.checkpoint.active_ms, 1000);
    }
    #[test]
    fn only_selected_actions_are_random_and_the_tail_is_rejected() {
        assert_eq!(uniform_index(0, &mut || 0), None);
        let mut values = [u32::MAX, 2_863_311_530].into_iter();
        assert_eq!(uniform_index(3, &mut || values.next().unwrap()), Some(2));
        let mut e = engine();
        for t in (0..=60_000).step_by(500) {
            e.tick(sample(t, Some(t), false), t, true, || u32::MAX);
        }
        assert_eq!(
            e.checkpoint.pending.as_ref().unwrap().exercise.id,
            "push-ups"
        );
    }
    #[test]
    fn each_outcome_is_recorded_and_later_keeps_the_same_exercise() {
        let mut e = engine();
        for t in (0..=60_000).step_by(500) {
            e.tick(sample(t, Some(t), false), t, true, || 0);
        }
        let id = e.checkpoint.pending.as_ref().unwrap().id;
        e.action(
            Action::Respond {
                reminder_id: id,
                outcome: Outcome::Later,
            },
            60_001,
        )
        .unwrap();
        assert_eq!(e.checkpoint.history[0].outcome, Outcome::Later);
        assert_eq!(e.checkpoint.pending.as_ref().unwrap().id, id);
        assert!(e
            .action(
                Action::Respond {
                    reminder_id: id,
                    outcome: Outcome::Skip
                },
                60_002
            )
            .is_err());
        for t in (60_500..=180_500).step_by(500) {
            e.tick(sample(t, Some(t), false), t, true, || 0);
        }
        e.action(
            Action::Respond {
                reminder_id: id,
                outcome: Outcome::Complete,
            },
            180_501,
        )
        .unwrap();
        assert_eq!(e.checkpoint.active_ms, 0);
        assert_eq!(e.checkpoint.history[0].outcome, Outcome::Complete);
        for t in (181_000..=241_000).step_by(500) {
            e.tick(sample(t, Some(t), false), t, true, || 0);
        }
        let id = e.checkpoint.pending.as_ref().unwrap().id;
        e.action(
            Action::Respond {
                reminder_id: id,
                outcome: Outcome::Skip,
            },
            241_001,
        )
        .unwrap();
        assert_eq!(e.checkpoint.history[0].outcome, Outcome::Skip);
    }
    #[test]
    fn close_uses_configured_snooze_preserves_counts_and_repeats_same_exercise() {
        let mut e = engine();
        e.checkpoint.settings.snooze_ms = 60_000;
        for t in (0..=60_000).step_by(500) {
            e.tick(sample(t, Some(t), false), t, true, || 0);
        }
        let initial = e.checkpoint();
        let id = initial.pending.as_ref().unwrap().id;
        for attempt in 0..4 {
            let now = 60_000 + attempt * 60_500;
            assert_eq!(
                e.action(Action::Collapse, now).unwrap(),
                vec![Effect::HidePrompt]
            );
            assert!(!e.snapshot().prompt_visible);
            assert_eq!(e.checkpoint.active_ms, initial.active_ms);
            assert_eq!(e.checkpoint.pending.as_ref().unwrap().id, id);
            assert_eq!(
                e.checkpoint.pending.as_ref().unwrap().exercise,
                initial.pending.as_ref().unwrap().exercise
            );
            assert_eq!(
                e.checkpoint
                    .pending
                    .as_ref()
                    .unwrap()
                    .snooze_active_remaining_ms,
                60_000
            );
            assert_eq!(e.checkpoint.history.len(), attempt as usize + 1);
            assert!(e
                .checkpoint
                .history
                .iter()
                .all(|h| h.outcome == Outcome::Later));
            let closed = e.checkpoint();
            assert!(e.action(Action::Collapse, now + 1).unwrap().is_empty());
            assert_eq!(e.checkpoint(), closed);
            for delta in (500..=60_000).step_by(500) {
                assert!(!e
                    .tick(
                        sample(now + delta, Some(now + delta), false),
                        now + delta,
                        true,
                        || 0
                    )
                    .contains(&Effect::ShowPrompt));
            }
            assert_eq!(
                e.tick(
                    sample(now + 60_500, Some(now + 60_500), false),
                    now + 60_500,
                    true,
                    || 0
                ),
                vec![Effect::ShowPrompt]
            );
        }
        assert!(e.checkpoint.total_active_ms >= initial.total_active_ms);
    }
    #[test]
    fn closed_fitness_snooze_survives_restore_and_does_not_count_idle_or_blocked_time() {
        let mut e = engine();
        for t in (0..=60_000).step_by(500) {
            e.tick(sample(t, Some(t), false), t, true, || 0);
        }
        e.action(Action::Collapse, 60_001).unwrap();
        let saved = e.checkpoint();
        let mut r = FitnessEngine::restore(saved.clone()).unwrap();
        for t in (1_000_000..=1_005_000).step_by(500) {
            r.tick(sample(t, Some(60_000), false), t, true, || 0);
        }
        for t in (1_005_500..=1_010_000).step_by(500) {
            r.tick(sample(t, Some(t), true), t, true, || 0);
        }
        assert_eq!(r.checkpoint.pending, saved.pending);
        assert_eq!(r.checkpoint.active_ms, saved.active_ms);
        assert_eq!(r.checkpoint.total_active_ms, saved.total_active_ms);
        assert!(!r.snapshot().prompt_visible);
        for t in (1_010_500..=1_131_000).step_by(500) {
            r.tick(sample(t, Some(t), false), t, true, || 0);
        }
        assert!(r.snapshot().prompt_visible);
        assert_eq!(
            r.checkpoint.pending.as_ref().unwrap().id,
            saved.pending.unwrap().id
        );
    }
    #[test]
    fn restore_rearms_due_pending_only_after_healthy_unblocked_sources() {
        let mut e = engine();
        for t in (0..=60_000).step_by(500) {
            e.tick(sample(t, Some(t), false), t, true, || 0);
        }
        let saved = e.checkpoint();
        assert_eq!(
            saved.pending.as_ref().unwrap().snooze_active_remaining_ms,
            0
        );
        let mut restored = FitnessEngine::restore(saved.clone()).unwrap();
        assert!(!restored.snapshot().prompt_visible);

        let mut unavailable = sample(1_000_000, Some(1_000_000), false);
        unavailable.available = false;
        assert!(restored.tick(unavailable, 1_000_000, true, || 0).is_empty());
        assert!(restored
            .tick(
                sample(1_000_500, Some(1_000_500), false),
                1_000_500,
                false,
                || 0
            )
            .is_empty());
        assert!(restored
            .tick(
                sample(1_001_000, Some(1_001_000), true),
                1_001_000,
                true,
                || 0
            )
            .is_empty());
        assert!(!restored.snapshot().prompt_visible);
        assert_eq!(
            restored.tick(
                sample(1_001_500, Some(1_001_500), false),
                1_001_500,
                true,
                || 0
            ),
            vec![Effect::ShowPrompt]
        );
        assert!(restored.snapshot().prompt_visible);
        assert_eq!(restored.checkpoint.pending, saved.pending);
        assert_eq!(restored.checkpoint.active_ms, saved.active_ms);
        assert_eq!(restored.checkpoint.total_active_ms, saved.total_active_ms);
        assert_eq!(restored.checkpoint.history, saved.history);
        assert_eq!(restored.checkpoint.next_id, saved.next_id);
        assert!(restored
            .tick(
                sample(1_002_000, Some(1_002_000), false),
                1_002_000,
                true,
                || 0
            )
            .is_empty());

        assert_eq!(
            restored.action(Action::Collapse, 1_002_001).unwrap(),
            vec![Effect::HidePrompt]
        );
        assert_eq!(
            restored.checkpoint.pending.as_ref().unwrap().id,
            saved.pending.as_ref().unwrap().id
        );
        assert_eq!(
            restored
                .checkpoint
                .pending
                .as_ref()
                .unwrap()
                .snooze_active_remaining_ms,
            saved.settings.snooze_ms
        );
        assert_eq!(restored.checkpoint.active_ms, saved.active_ms);
        assert_eq!(restored.checkpoint.history.len(), saved.history.len() + 1);
        assert_eq!(restored.checkpoint.history[0].outcome, Outcome::Later);
    }

    #[test]
    fn restore_without_pending_requires_new_input_and_preserves_active_time() {
        let mut e = engine();
        for t in (0..=10_000).step_by(500) {
            e.tick(sample(t, Some(t), false), t, true, || 0);
        }
        let mut r = FitnessEngine::restore(e.checkpoint()).unwrap();
        r.tick(sample(100_000, Some(10_000), false), 100_000, true, || 0);
        r.tick(sample(100_500, Some(10_000), false), 100_500, true, || 0);
        assert_eq!(r.checkpoint.active_ms, 10_000);
        assert!(!r.snapshot().prompt_visible);
    }
    #[test]
    fn system_monitor_recovery_and_response_start_a_new_observation() {
        let mut e = engine();
        e.tick(sample(0, Some(0), false), 0, true, || 0);
        e.tick(sample(500, Some(500), false), 500, false, || 0);
        e.tick(sample(1000, Some(1000), false), 1000, true, || 0);
        assert_eq!(e.checkpoint.active_ms, 0);
        e.tick(sample(1500, Some(1500), false), 1500, true, || 0);
        assert_eq!(e.checkpoint.active_ms, 500);
        for t in (2000..=61_000).step_by(500) {
            e.tick(sample(t, Some(t), false), t, true, || 0);
        }
        let id = e.checkpoint.pending.as_ref().unwrap().id;
        e.action(
            Action::Respond {
                reminder_id: id,
                outcome: Outcome::Complete,
            },
            61_100,
        )
        .unwrap();
        e.tick(sample(61_500, Some(61_500), false), 61_500, true, || 0);
        assert_eq!(e.checkpoint.active_ms, 0);
        e.tick(sample(62_000, Some(62_000), false), 62_000, true, || 0);
        assert_eq!(e.checkpoint.active_ms, 500);
    }
    #[test]
    fn invalid_selection_and_unsafe_checkpoint_do_not_replace_live_state() {
        let mut e = engine();
        let before = e.checkpoint();
        let mut request = Configure {
            settings: before.settings.clone(),
            pool: before.pool.clone(),
        };
        request
            .pool
            .iter_mut()
            .for_each(|item| item.selected = false);
        assert!(e.configure(request).is_err());
        assert_eq!(e.checkpoint(), before);
        let mut invalid = before;
        invalid.total_active_ms = MAX_SAFE + 1;
        assert!(FitnessEngine::restore(invalid).is_err());
    }
}

#[cfg(test)]
mod daily_tests {
    use super::*;
    use crate::standing_reminder::activity_log::FixedCalendar;
    fn calendar() -> FixedCalendar {
        FixedCalendar(chrono::FixedOffset::east_opt(8 * 3600).unwrap())
    }
    fn wall(value: &str) -> u64 {
        chrono::DateTime::parse_from_rfc3339(value)
            .unwrap()
            .timestamp_millis()
            .try_into()
            .unwrap()
    }
    fn sample(now: u64, input: Option<u64>, blocked: bool) -> Sample {
        Sample {
            now_ms: now,
            latest_input_ms: input,
            available: true,
            blocked,
        }
    }
    fn enabled() -> FitnessEngine {
        let mut checkpoint = Checkpoint::default();
        checkpoint.settings.enabled = true;
        checkpoint.settings.interval_ms = 60_000;
        checkpoint.settings.idle_ms = 1_000;
        checkpoint.pool[0].selected = true;
        FitnessEngine::restore(checkpoint).unwrap()
    }
    fn at_poll_start(wall_ms: u64, old_input: u64) -> FitnessEngine {
        let mut engine = enabled();
        engine.normalize_daily(wall_ms, &calendar()).unwrap();
        engine.previous = Some(sample(1000, Some(old_input), false));
        engine.input_floor = 0;
        engine.daily_clock = Some(ClockPair {
            mono_ms: 1000,
            utc_ms: wall_ms as i64,
        });
        engine
    }
    #[test]
    fn continuous_midnight_and_exact_midnight_use_half_open_intervals() {
        let before = wall("2026-10-08T23:59:59.750+08:00");
        let mut engine = at_poll_start(before, 1000);
        engine.tick_with_calendar(
            sample(1500, Some(1500), false),
            before + 500,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(engine.checkpoint.total_active_ms, 500);
        assert_eq!(engine.checkpoint.active_ms, 500);
        assert_eq!(engine.checkpoint.daily_active_ms, 250);
        assert_eq!(engine.daily_day(), Some("2026-10-09"));
        let exact = wall("2026-10-08T23:59:59.500+08:00");
        let mut engine = at_poll_start(exact, 1000);
        engine.tick_with_calendar(
            sample(1500, Some(1500), false),
            exact + 500,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(engine.checkpoint.total_active_ms, 500);
        assert_eq!(engine.checkpoint.active_ms, 500);
        assert_eq!(engine.checkpoint.daily_active_ms, 0);
        assert_eq!(engine.daily_day(), Some("2026-10-09"));
    }
    #[test]
    fn midnight_disjoint_credit_and_old_day_idle_tail_are_clipped_exactly() {
        let before = wall("2026-10-08T23:59:59.750+08:00");
        let mut engine = at_poll_start(before, 250);
        engine.tick_with_calendar(
            sample(1500, Some(1350), false),
            before + 500,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(engine.checkpoint.total_active_ms, 400);
        assert_eq!(engine.checkpoint.active_ms, 400);
        assert_eq!(engine.checkpoint.daily_active_ms, 150);
        let mut tail = at_poll_start(before, 200);
        tail.tick_with_calendar(
            sample(1500, Some(200), false),
            before + 500,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(tail.checkpoint.total_active_ms, 200);
        assert_eq!(tail.checkpoint.active_ms, 200);
        assert_eq!(tail.checkpoint.daily_active_ms, 0);
    }
    #[test]
    fn midnight_status_normalization_does_not_advance_activity_baseline() {
        let before = wall("2026-10-08T23:59:59.750+08:00");
        let mut engine = at_poll_start(before, 1000);
        assert!(engine.normalize_daily(before + 350, &calendar()).unwrap());
        assert_eq!(engine.checkpoint.daily_active_ms, 0);
        assert_eq!(engine.previous.unwrap().now_ms, 1000);
        assert_eq!(engine.daily_clock.unwrap().mono_ms, 1000);
        engine.tick_with_calendar(
            sample(1500, Some(1500), false),
            before + 500,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(engine.checkpoint.daily_active_ms, 250);
        assert_eq!(engine.checkpoint.total_active_ms, 500);
    }
    #[test]
    fn rollover_preserves_cycle_pending_snooze_history_and_settings() {
        let before = wall("2026-10-08T23:59:59.750+08:00");
        let mut engine = at_poll_start(before, 1000);
        engine.checkpoint.active_ms = 60_000;
        engine.checkpoint.total_active_ms = 60_000;
        engine.checkpoint.daily_active_ms = 50_000;
        engine.checkpoint.next_id = 3;
        engine.checkpoint.pending = Some(Reminder {
            started: false,
            id: 1,
            exercise: engine.checkpoint.pool[0].clone(),
            issued_at_ms: before - 1000,
            snooze_active_remaining_ms: 2000,
        });
        engine.checkpoint.history.push(HistoryEntry {
            id: 2,
            reminder_id: 1,
            exercise_name: engine.checkpoint.pool[0].name.clone(),
            outcome: Outcome::Later,
            at_ms: before - 500,
            cycle_active_ms: 60_000,
        });
        let mut expected = engine.checkpoint();
        expected.daily_active_day = Some("2026-10-09".into());
        expected.daily_active_ms = 0;
        engine.normalize_daily(before + 350, &calendar()).unwrap();
        assert_eq!(engine.checkpoint(), expected);
        engine.tick_with_calendar(
            sample(1500, Some(1500), false),
            before + 500,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(engine.checkpoint.active_ms, 60_000);
        assert_eq!(engine.checkpoint.pending.as_ref().unwrap().id, 1);
        assert_eq!(
            engine
                .checkpoint
                .pending
                .as_ref()
                .unwrap()
                .snooze_active_remaining_ms,
            1500
        );
        assert_eq!(engine.checkpoint.history, expected.history);
        assert_eq!(engine.checkpoint.settings, expected.settings);
        assert_eq!(engine.checkpoint.pool, expected.pool);
        assert_eq!(engine.checkpoint.next_id, expected.next_id);
        assert_eq!(engine.checkpoint.daily_active_ms, 250);
    }
    #[test]
    fn midnight_normalizes_while_disabled_blocked_or_source_unavailable() {
        let before = wall("2026-10-08T23:59:59.750+08:00");
        for variant in 0..3 {
            let mut engine = at_poll_start(before, 1000);
            engine.checkpoint.total_active_ms = 5000;
            engine.checkpoint.daily_active_ms = 5000;
            let mut current = sample(1500, Some(1500), false);
            if variant == 0 {
                engine.checkpoint.settings.enabled = false;
            }
            if variant == 1 {
                current.blocked = true;
            }
            if variant == 2 {
                current.available = false;
            }
            engine.tick_with_calendar(current, before + 500, true, || 0, &calendar());
            assert_eq!(engine.daily_day(), Some("2026-10-09"));
            assert_eq!(engine.checkpoint.daily_active_ms, 0);
            assert_eq!(engine.checkpoint.total_active_ms, 5000);
            assert_eq!(engine.checkpoint.active_ms, 0);
        }
    }
    #[test]
    fn same_day_restart_keeps_daily_next_day_restart_clears_only_daily() {
        let now = wall("2026-10-08T12:00:00+08:00");
        let mut original = enabled().checkpoint();
        original.active_ms = 1000;
        original.total_active_ms = 20_000;
        original.daily_active_ms = 4000;
        original.daily_active_day = Some("2026-10-08".into());
        let mut same = FitnessEngine::restore(original.clone()).unwrap();
        assert!(!same.normalize_daily(now, &calendar()).unwrap());
        same.tick_with_calendar(
            sample(100_000, Some(1000), false),
            now,
            true,
            || 0,
            &calendar(),
        );
        same.tick_with_calendar(
            sample(100_500, Some(1000), false),
            now + 500,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(same.checkpoint(), original);
        let mut next = FitnessEngine::restore(original.clone()).unwrap();
        assert!(next.normalize_daily(now + 86_400_000, &calendar()).unwrap());
        original.daily_active_day = Some("2026-10-09".into());
        original.daily_active_ms = 0;
        assert_eq!(next.checkpoint(), original);
    }
    #[test]
    fn sleep_or_large_gap_over_midnight_never_backfills_activity() {
        let before = wall("2026-10-08T23:59:59.750+08:00");
        for reset in [false, true] {
            let mut engine = at_poll_start(before, 1000);
            engine.checkpoint.active_ms = 1000;
            engine.checkpoint.total_active_ms = 5000;
            engine.checkpoint.daily_active_ms = 5000;
            if reset {
                engine.reset_observation();
            }
            let next_day = wall("2026-10-09T12:00:00+08:00");
            engine.tick_with_calendar(
                sample(100_000, Some(1000), false),
                next_day,
                true,
                || 0,
                &calendar(),
            );
            engine.tick_with_calendar(
                sample(100_500, Some(1000), false),
                next_day + 500,
                true,
                || 0,
                &calendar(),
            );
            assert_eq!(engine.daily_day(), Some("2026-10-09"));
            assert_eq!(engine.checkpoint.daily_active_ms, 0);
            assert_eq!(engine.checkpoint.total_active_ms, 5000);
            assert_eq!(engine.checkpoint.active_ms, 1000);
            engine.tick_with_calendar(
                sample(101_000, Some(101_000), false),
                next_day + 1000,
                true,
                || 0,
                &calendar(),
            );
            engine.tick_with_calendar(
                sample(101_500, Some(101_000), false),
                next_day + 1500,
                true,
                || 0,
                &calendar(),
            );
            assert_eq!(engine.checkpoint.daily_active_ms, 500);
            assert_eq!(engine.checkpoint.total_active_ms, 5500);
            assert_eq!(engine.checkpoint.active_ms, 1500);
        }
    }
    #[test]
    fn legacy_json_migrates_without_reinterpreting_lifetime_as_today() {
        let mut original = enabled().checkpoint();
        original.active_ms = 333;
        original.total_active_ms = 900_000;
        let mut json = serde_json::to_value(&original).unwrap();
        json.as_object_mut().unwrap().remove("dailyActiveMs");
        json.as_object_mut().unwrap().remove("dailyActiveDay");
        let legacy: Checkpoint = serde_json::from_value(json).unwrap();
        let mut engine = FitnessEngine::restore(legacy).unwrap();
        let now = wall("2026-10-09T12:00:00+08:00");
        assert!(engine.normalize_daily(now, &calendar()).unwrap());
        original.daily_active_day = Some("2026-10-09".into());
        assert_eq!(engine.checkpoint(), original);
        assert_eq!(engine.checkpoint.daily_active_ms, 0);
        let again: Checkpoint =
            serde_json::from_str(&serde_json::to_string(&engine.checkpoint()).unwrap()).unwrap();
        assert_eq!(again, original);
    }
    #[test]
    fn clock_jump_drops_uncertain_daily_slice_but_preserves_monotonic_cycle() {
        let before = wall("2026-10-08T23:59:59.750+08:00");
        let mut engine = at_poll_start(before, 1000);
        engine.tick_with_calendar(
            sample(1500, Some(1500), false),
            before + 3_600_500,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(engine.checkpoint.total_active_ms, 500);
        assert_eq!(engine.checkpoint.active_ms, 500);
        assert_eq!(engine.checkpoint.daily_active_ms, 0);
        engine.tick_with_calendar(
            sample(2000, Some(2000), false),
            before + 3_601_000,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(engine.checkpoint.daily_active_ms, 500);
        engine.tick_with_calendar(
            sample(2500, Some(2500), false),
            before - 3_600_000,
            true,
            || 0,
            &calendar(),
        );
        assert_eq!(engine.daily_day(), Some("2026-10-08"));
        assert_eq!(engine.checkpoint.daily_active_ms, 0);
        assert_eq!(engine.checkpoint.total_active_ms, 1500);
        assert_eq!(engine.checkpoint.active_ms, 1500);
    }
    struct VariableDay {
        boundary: i64,
    }
    impl Calendar for VariableDay {
        fn local_day(&self, utc: i64) -> Result<String, String> {
            Ok(if utc < self.boundary {
                "2026-10-25"
            } else {
                "2026-10-26"
            }
            .into())
        }
        fn next_midnight(&self, utc: i64) -> Result<i64, String> {
            Ok(if utc < self.boundary {
                self.boundary
            } else {
                self.boundary + 86_400_000
            })
        }
        fn offset_minutes(&self, utc: i64) -> Result<i32, String> {
            Ok(if utc < 3_600_000 { 120 } else { 60 })
        }
    }
    #[test]
    fn calendar_uses_23_or_25_hour_boundaries_and_allows_long_day_count() {
        for boundary in [82_800_000i64, 90_000_000] {
            let calendar = VariableDay { boundary };
            let mut engine = enabled();
            engine.checkpoint.total_active_ms = 89_000_000;
            engine.checkpoint.daily_active_ms = 89_000_000;
            engine.checkpoint.daily_active_day = Some("2026-10-25".into());
            assert!(engine.checkpoint.validate().is_ok());
            let before = (boundary - 250) as u64;
            engine.previous = Some(sample(1000, Some(1000), false));
            engine.daily_clock = Some(ClockPair {
                mono_ms: 1000,
                utc_ms: before as i64,
            });
            engine.tick_with_calendar(
                sample(1500, Some(1500), false),
                before + 500,
                true,
                || 0,
                &calendar,
            );
            assert_eq!(engine.daily_day(), Some("2026-10-26"));
            assert_eq!(engine.checkpoint.daily_active_ms, 250);
            assert_eq!(engine.checkpoint.total_active_ms, 89_000_500);
        }
    }
    #[test]
    fn invalid_daily_date_or_count_is_rejected_without_replacing_state() {
        let mut checkpoint = enabled().checkpoint();
        checkpoint.daily_active_day = Some("2026-02-30".into());
        assert!(checkpoint.validate().is_err());
        checkpoint.daily_active_day = Some("2026-10-09".into());
        checkpoint.daily_active_ms = 1;
        assert!(checkpoint.validate().is_err());
        checkpoint.total_active_ms = 1;
        assert!(checkpoint.validate().is_ok());
    }
}
