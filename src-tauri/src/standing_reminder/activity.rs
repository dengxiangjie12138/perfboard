//! Bounded aggregate input times only; never stores keys, text or mouse coordinates.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::JoinHandle;

/// Read the clock after adapters that can observe newer input while sampling.
pub fn sample_then_clock<T>(sample: impl FnOnce() -> T, clock: impl FnOnce() -> u64) -> (u64, T) {
    let input = sample();
    (clock(), input)
}

pub const RESUME_CONFIRM_MS: u64 = 5_000;
pub const INPUT_GAP_MS: u64 = 1_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InputWindow {
    pub first_ms: u64,
    pub latest_ms: u64,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct ResumeSample {
    /// Installed hooks and a running message pump, not authenticated human identity.
    pub available: bool,
    pub window: Option<InputWindow>,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct ActivityTimeline {
    window: Option<InputWindow>,
}
impl ActivityTimeline {
    pub fn record(&mut self, now: u64, injected: bool) {
        if injected {
            return;
        }
        let first_ms = match self.window {
            Some(old) if now >= old.latest_ms && now - old.latest_ms <= INPUT_GAP_MS => {
                old.first_ms
            }
            _ => now,
        };
        self.window = Some(InputWindow {
            first_ms,
            latest_ms: now,
        });
    }
    pub fn window(&self) -> Option<InputWindow> {
        self.window
    }
}
pub fn keyboard_injected(flags: u32) -> bool {
    flags & (0x10 | 0x02) != 0
}
pub fn mouse_injected(flags: u32) -> bool {
    flags & (0x01 | 0x02) != 0
}

/// Joined shutdown is shared with pure lifecycle tests; no OS input is generated.
pub struct Worker {
    pub stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}
impl Worker {
    pub fn new(stop: Arc<AtomicBool>, handle: JoinHandle<()>) -> Self {
        Self {
            stop,
            handle: Some(handle),
        }
    }
    pub fn finished(&self) -> bool {
        self.handle
            .as_ref()
            .map(JoinHandle::is_finished)
            .unwrap_or(true)
    }
    /// A Tauri UI-effect worker may be waiting on the thread requesting exit.
    /// Stop it without joining from that thread; the input-only worker still joins.
    pub fn stop_without_join(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.handle.take();
    }
    pub fn shutdown(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            if handle.thread().id() != std::thread::current().id() {
                let _ = handle.join();
            }
        }
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resume_input_aggregation_ignores_both_injected_flags_and_resets_gaps() {
        assert!(keyboard_injected(0x10));
        assert!(keyboard_injected(0x02));
        assert!(mouse_injected(0x01));
        assert!(mouse_injected(0x02));
        assert!(!keyboard_injected(0x80));
        assert!(!mouse_injected(0));
        let mut a = ActivityTimeline::default();
        a.record(100, false);
        a.record(600, true);
        a.record(1_100, false);
        assert_eq!(a.window().unwrap().first_ms, 100);
        a.record(2_101, false);
        assert_eq!(a.window().unwrap().first_ms, 2_101);
        a.record(2_000, false);
        assert_eq!(a.window().unwrap().first_ms, 2_000);
    }
    #[test]
    fn resume_input_shutdown_joins_worker_and_is_idempotent() {
        let stop = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let thread_finished = finished.clone();
        let handle = std::thread::spawn(move || {
            while !thread_stop.load(Ordering::SeqCst) {
                std::thread::yield_now();
            }
            thread_finished.store(true, Ordering::SeqCst);
        });
        let mut worker = Worker::new(stop, handle);
        worker.shutdown();
        worker.shutdown();
        assert!(finished.load(Ordering::SeqCst));
        assert!(worker.handle.is_none());
    }
    #[test]
    fn resume_input_drop_also_joins_worker() {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let finished = Arc::new(AtomicBool::new(false));
        let thread_finished = finished.clone();
        let handle = std::thread::spawn(move || {
            while !thread_stop.load(Ordering::SeqCst) {
                std::thread::yield_now();
            }
            thread_finished.store(true, Ordering::SeqCst);
        });
        drop(Worker::new(stop, handle));
        assert!(finished.load(Ordering::SeqCst));
    }
    #[test]
    fn resume_input_host_shutdown_does_not_join_a_worker_waiting_on_host() {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let (release, waiting) = std::sync::mpsc::channel();
        let (completed, finished) = std::sync::mpsc::channel();
        let handle = std::thread::spawn(move || {
            waiting.recv().unwrap();
            completed.send(thread_stop.load(Ordering::SeqCst)).unwrap();
        });
        Worker::new(stop.clone(), handle).stop_without_join();
        assert!(stop.load(Ordering::SeqCst));
        release.send(()).unwrap();
        assert!(finished
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap());
    }
}
