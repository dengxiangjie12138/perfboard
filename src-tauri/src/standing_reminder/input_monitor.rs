//! Input-origin filtering on a dedicated message-pump thread.
//! Unflagged input is not proof of a human: virtual HID/driver input cannot be classified here.
use super::activity::ResumeSample;

#[cfg(windows)]
mod imp {
    use super::super::activity::{
        keyboard_injected, mouse_injected, ActivityTimeline, InputWindow, Worker,
    };
    use super::*;
    use std::{
        cell::RefCell,
        ffi::c_void,
        sync::{
            atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
            Arc,
        },
    };
    type Handle = *mut c_void;
    type HookProc = unsafe extern "system" fn(i32, usize, isize) -> isize;
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[repr(C)]
    struct Message {
        window: Handle,
        message: u32,
        wp: usize,
        lp: isize,
        time: u32,
        point: Point,
        private: u32,
    }
    #[repr(C)]
    struct KeyboardEvent {
        key: u32,
        scan: u32,
        flags: u32,
        time: u32,
        extra: usize,
    }
    #[repr(C)]
    struct MouseEvent {
        point: Point,
        data: u32,
        flags: u32,
        time: u32,
        extra: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount64() -> u64;
        fn GetModuleHandleW(name: *const u16) -> Handle;
    }
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowsHookExW(
            kind: i32,
            callback: Option<HookProc>,
            module: Handle,
            thread: u32,
        ) -> Handle;
        fn UnhookWindowsHookEx(hook: Handle) -> i32;
        fn CallNextHookEx(hook: Handle, code: i32, wp: usize, lp: isize) -> isize;
        fn PeekMessageW(
            message: *mut Message,
            window: Handle,
            min: u32,
            max: u32,
            remove: u32,
        ) -> i32;
        fn TranslateMessage(message: *const Message) -> i32;
        fn DispatchMessageW(message: *const Message) -> isize;
        fn MsgWaitForMultipleObjectsEx(
            count: u32,
            handles: *const Handle,
            timeout: u32,
            wake: u32,
            flags: u32,
        ) -> u32;
    }
    // One writer (the hook thread). SeqCst versioning gives a coherent bounded snapshot.
    #[derive(Default)]
    struct Shared {
        version: AtomicU64,
        first: AtomicU64,
        latest: AtomicU64,
        has_input: AtomicBool,
        state: AtomicU8,
    }
    struct Local {
        timeline: ActivityTimeline,
        shared: Arc<Shared>,
    }
    thread_local! { static LOCAL: RefCell<Option<Local>> = const { RefCell::new(None) }; }
    fn record(injected: bool) {
        if injected {
            return;
        }
        LOCAL.with(|local| {
            if let Ok(mut local) = local.try_borrow_mut() {
                if let Some(local) = local.as_mut() {
                    local.timeline.record(unsafe { GetTickCount64() }, false);
                    if let Some(window) = local.timeline.window() {
                        let shared = &local.shared;
                        shared.version.fetch_add(1, Ordering::SeqCst);
                        shared.first.store(window.first_ms, Ordering::SeqCst);
                        shared.latest.store(window.latest_ms, Ordering::SeqCst);
                        shared.has_input.store(true, Ordering::SeqCst);
                        shared.version.fetch_add(1, Ordering::SeqCst);
                    }
                }
            }
        });
    }
    unsafe extern "system" fn keyboard(code: i32, wp: usize, lp: isize) -> isize {
        if code == 0 && lp != 0 {
            record(keyboard_injected((*(lp as *const KeyboardEvent)).flags));
        }
        CallNextHookEx(std::ptr::null_mut(), code, wp, lp)
    }
    unsafe extern "system" fn mouse(code: i32, wp: usize, lp: isize) -> isize {
        if code == 0 && lp != 0 {
            record(mouse_injected((*(lp as *const MouseEvent)).flags));
        }
        CallNextHookEx(std::ptr::null_mut(), code, wp, lp)
    }
    struct Hooks {
        keyboard: Handle,
        mouse: Handle,
    }
    impl Drop for Hooks {
        fn drop(&mut self) {
            unsafe {
                if !self.keyboard.is_null() {
                    UnhookWindowsHookEx(self.keyboard);
                }
                if !self.mouse.is_null() {
                    UnhookWindowsHookEx(self.mouse);
                }
            }
        }
    }
    pub struct InputMonitor {
        shared: Arc<Shared>,
        worker: Option<Worker>,
    }
    impl InputMonitor {
        pub fn new() -> Self {
            let shared = Arc::new(Shared::default());
            let stop = Arc::new(AtomicBool::new(false));
            let thread_shared = shared.clone();
            let thread_stop = stop.clone();
            let handle = std::thread::Builder::new()
                .name("perfboard-reminder-input".into())
                .spawn(move || {
                    // Do not delay hooks behind the reminder worker's 500 ms poll or storage work.
                    LOCAL.with(|local| {
                        *local.borrow_mut() = Some(Local {
                            timeline: ActivityTimeline::default(),
                            shared: thread_shared.clone(),
                        })
                    });
                    let module = unsafe { GetModuleHandleW(std::ptr::null()) };
                    let hooks = Hooks {
                        keyboard: unsafe { SetWindowsHookExW(13, Some(keyboard), module, 0) },
                        mouse: unsafe { SetWindowsHookExW(14, Some(mouse), module, 0) },
                    };
                    if hooks.keyboard.is_null() || hooks.mouse.is_null() {
                        thread_shared.state.store(2, Ordering::SeqCst);
                        return;
                    }
                    thread_shared.state.store(1, Ordering::SeqCst);
                    while !thread_stop.load(Ordering::SeqCst) {
                        let mut msg: Message = unsafe { std::mem::zeroed() };
                        while !thread_stop.load(Ordering::SeqCst)
                            && unsafe { PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, 1) } != 0
                        {
                            if msg.message == 0x0012 {
                                thread_stop.store(true, Ordering::SeqCst);
                                break;
                            }
                            unsafe {
                                TranslateMessage(&msg);
                                DispatchMessageW(&msg);
                            }
                        }
                        if thread_stop.load(Ordering::SeqCst) {
                            break;
                        }
                        // A finite wait makes shutdown independent of posting a message successfully.
                        if unsafe {
                            MsgWaitForMultipleObjectsEx(0, std::ptr::null(), 50, 0x04ff, 0x0004)
                        } == u32::MAX
                        {
                            break;
                        }
                    }
                    thread_shared.state.store(2, Ordering::SeqCst);
                    drop(hooks);
                    LOCAL.with(|local| *local.borrow_mut() = None);
                });
            let worker = match handle {
                Ok(handle) => Some(Worker::new(stop, handle)),
                Err(_) => {
                    shared.state.store(2, Ordering::SeqCst);
                    None
                }
            };
            Self { shared, worker }
        }
        /// Tests own a real stoppable worker without installing hooks or touching the desktop.
        #[cfg(test)]
        pub fn from_test_worker(worker: Worker) -> Self {
            let shared = Arc::new(Shared::default());
            shared.state.store(1, Ordering::SeqCst);
            Self {
                shared,
                worker: Some(worker),
            }
        }
        pub fn starting(&self) -> bool {
            !self.worker.as_ref().map(Worker::finished).unwrap_or(true)
                && self.shared.state.load(Ordering::SeqCst) == 0
        }
        pub fn sample(&self) -> ResumeSample {
            if self.worker.as_ref().map(Worker::finished).unwrap_or(true)
                || self.shared.state.load(Ordering::SeqCst) != 1
            {
                return ResumeSample::default();
            }
            for _ in 0..3 {
                let version = self.shared.version.load(Ordering::SeqCst);
                if version & 1 != 0 {
                    continue;
                }
                let window = if self.shared.has_input.load(Ordering::SeqCst) {
                    Some(InputWindow {
                        first_ms: self.shared.first.load(Ordering::SeqCst),
                        latest_ms: self.shared.latest.load(Ordering::SeqCst),
                    })
                } else {
                    None
                };
                if version == self.shared.version.load(Ordering::SeqCst) {
                    return ResumeSample {
                        available: true,
                        window,
                    };
                }
            }
            ResumeSample::default()
        }
        pub fn shutdown(&mut self) {
            self.shared.state.store(2, Ordering::SeqCst);
            if let Some(mut worker) = self.worker.take() {
                worker.shutdown();
            }
        }
    }
    impl Drop for InputMonitor {
        fn drop(&mut self) {
            self.shutdown();
        }
    }
}
#[cfg(not(windows))]
mod imp {
    use super::*;
    pub struct InputMonitor;
    impl InputMonitor {
        pub fn new() -> Self {
            Self
        }
        pub fn starting(&self) -> bool {
            false
        }
        pub fn sample(&self) -> ResumeSample {
            ResumeSample::default()
        }
        pub fn shutdown(&mut self) {}
    }
}
pub use imp::InputMonitor;
