//! One escalation clock for both reminders. It observes the existing worker; no timer/input hook.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub delay_seconds: u64,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            delay_seconds: 300,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !(60..=3600).contains(&self.delay_seconds) {
            return Err("升级等待时间需为 1–60 分钟。".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default)]
struct Waiting {
    key: Option<u64>,
    elapsed: u64,
}
impl Waiting {
    fn observe(&mut self, key: Option<u64>, delta: u64) {
        if self.key != key {
            self.key = key;
            self.elapsed = 0;
        } else if key.is_some() {
            self.elapsed = self.elapsed.saturating_add(delta);
        }
    }
}
#[derive(Clone, Debug)]
pub struct Coordinator {
    pub settings: Settings,
    pub error: Option<String>,
    standing: Waiting,
    fitness: Waiting,
    last_ms: Option<u64>,
    active: bool,
    pub revision: u64,
}
impl Default for Coordinator {
    fn default() -> Self {
        Self {
            settings: Settings::default(),
            error: None,
            standing: Waiting::default(),
            fitness: Waiting::default(),
            last_ms: None,
            active: false,
            revision: 0,
        }
    }
}
impl Coordinator {
    pub fn active(&self) -> bool {
        self.active
    }
    pub fn standing(&self) -> bool {
        self.active && self.standing.key.is_some()
    }
    pub fn fitness(&self) -> bool {
        self.active && self.fitness.key.is_some()
    }
    pub fn observe(
        &mut self,
        now: u64,
        blocked: bool,
        standing: Option<u64>,
        fitness: Option<u64>,
    ) -> bool {
        let before = (self.active, self.standing.key, self.fitness.key);
        let gap = self.last_ms.and_then(|last| now.checked_sub(last));
        self.last_ms = Some(now);
        // Sleep/lock, discontinuity, and an unavailable session monitor never backfill alerts.
        if blocked
            || !self.settings.enabled
            || gap.is_some_and(|delta| delta > 5_000)
            || gap.is_none()
        {
            self.standing = Waiting::default();
            self.fitness = Waiting::default();
            self.active = false;
            if !blocked && self.settings.enabled {
                self.standing.observe(standing, 0);
                self.fitness.observe(fitness, 0);
            }
        } else {
            let delta = gap.unwrap_or(0);
            self.standing.observe(standing, delta);
            self.fitness.observe(fitness, delta);
            let any = standing.is_some() || fitness.is_some();
            let threshold = self.settings.delay_seconds * 1000;
            self.active = any
                && (self.active
                    || self.standing.elapsed >= threshold
                    || self.fitness.elapsed >= threshold);
        }
        let changed = before != (self.active, self.standing.key, self.fitness.key);
        if changed {
            self.revision = self.revision.wrapping_add(1);
        }
        changed
    }
    pub fn release(&mut self, now: u64) {
        self.active = false;
        self.standing.elapsed = 0;
        self.fitness.elapsed = 0;
        self.last_ms = Some(now);
        self.revision = self.revision.wrapping_add(1);
    }
    pub fn configure(&mut self, settings: Settings, now: u64) -> Result<(), String> {
        settings.validate()?;
        self.settings = settings;
        self.error = None;
        self.release(now);
        Ok(())
    }
    pub fn display_failed(&mut self, error: String, now: u64) {
        self.release(now);
        self.settings.enabled = false;
        self.error = Some(error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn advance(c: &mut Coordinator, end: u64, standing: Option<u64>, fitness: Option<u64>) {
        let mut now = c.last_ms.unwrap_or(0);
        while now < end {
            now += 500;
            c.observe(now, false, standing, fitness);
        }
    }
    #[test]
    fn first_small_then_exactly_one_shared_escalation() {
        let mut c = Coordinator::default();
        c.observe(0, false, Some(1), Some(9));
        advance(&mut c, 299_500, Some(1), Some(9));
        assert!(!c.active());
        advance(&mut c, 300_000, Some(1), Some(9));
        assert!(c.active() && c.standing() && c.fitness());
        let revision = c.revision;
        advance(&mut c, 320_000, Some(1), Some(9));
        assert_eq!(revision, c.revision);
        c.observe(320_500, false, None, Some(9));
        assert!(c.active() && !c.standing() && c.fitness());
        c.observe(321_000, false, None, None);
        assert!(!c.active());
    }
    #[test]
    fn snooze_skip_completion_and_new_tokens_get_a_fresh_wait() {
        let mut c = Coordinator::default();
        c.observe(0, false, Some(1), None);
        advance(&mut c, 300_000, Some(1), None);
        assert!(c.active());
        c.observe(300_500, false, None, None);
        c.observe(301_000, false, Some(2), None);
        advance(&mut c, 600_500, Some(2), None);
        assert!(!c.active());
        advance(&mut c, 601_000, Some(2), None);
        assert!(c.active());
    }
    #[test]
    fn lock_sleep_discontinuity_and_restart_do_not_backfill() {
        let mut c = Coordinator::default();
        c.observe(0, false, Some(1), Some(9));
        advance(&mut c, 300_000, Some(1), Some(9));
        c.observe(300_500, true, Some(1), Some(9));
        assert!(!c.active());
        c.observe(9_000_000, false, Some(1), Some(9));
        advance(&mut c, 9_299_500, Some(1), Some(9));
        assert!(!c.active());
        c.observe(100, false, Some(1), Some(9)); // clock went backwards
        assert!(!c.active());
        let mut restored = Coordinator::default();
        restored.observe(99_999_999, false, Some(1), None);
        assert!(!restored.active());
    }
    #[test]
    fn escape_and_disabled_or_failed_display_always_release() {
        let mut c = Coordinator::default();
        c.observe(0, false, Some(1), None);
        advance(&mut c, 300_000, Some(1), None);
        c.release(300_000);
        c.observe(300_500, false, Some(1), None);
        assert!(!c.active());
        c.display_failed("display unavailable".into(), 300_500);
        advance(&mut c, 1_000_000, Some(1), None);
        assert!(!c.active());
        assert!(c.error.is_some());
        assert!(Settings {
            enabled: true,
            delay_seconds: 0
        }
        .validate()
        .is_err());
    }
}
