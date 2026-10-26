//! Windows event-only session/power monitor plus aggregate idle timestamp.
//! Input-origin filtering lives in input_monitor; this adapter reads no input content.
use super::engine::SessionKind;

#[derive(Clone, Copy, Debug)]
pub struct SessionEvent {
    pub kind: SessionKind,
    pub active: bool,
    pub now: u64,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::{
        ffi::c_void,
        sync::{Mutex, OnceLock},
    };
    type Hwnd = *mut c_void;
    type Handle = *mut c_void;
    #[repr(C)]
    struct LastInput {
        size: u32,
        tick: u32,
    }
    #[repr(C)]
    struct WndClass {
        style: u32,
        procedure: Option<unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize>,
        class_extra: i32,
        window_extra: i32,
        instance: Handle,
        icon: Handle,
        cursor: Handle,
        background: Handle,
        menu: *const u16,
        name: *const u16,
    }
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[repr(C)]
    struct Message {
        window: Hwnd,
        message: u32,
        wparam: usize,
        lparam: isize,
        time: u32,
        point: Point,
        private: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount64() -> u64;
        fn GetModuleHandleW(name: *const u16) -> Handle;
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(info: *mut LastInput) -> i32;
        fn LockWorkStation() -> i32;
        fn MessageBeep(kind: u32) -> i32;
        fn ShowWindow(window: Hwnd, command: i32) -> i32;
        fn IsWindowVisible(window: Hwnd) -> i32;
        fn GetMessageTime() -> i32;
        fn RegisterClassW(class: *const WndClass) -> u16;
        fn UnregisterClassW(name: *const u16, instance: Handle) -> i32;
        fn CreateWindowExW(
            ex_style: u32,
            class: *const u16,
            title: *const u16,
            style: u32,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            parent: Hwnd,
            menu: Handle,
            instance: Handle,
            parameter: *mut c_void,
        ) -> Hwnd;
        fn DestroyWindow(window: Hwnd) -> i32;
        fn DefWindowProcW(window: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
        fn PeekMessageW(
            message: *mut Message,
            window: Hwnd,
            min: u32,
            max: u32,
            remove: u32,
        ) -> i32;
        fn TranslateMessage(message: *const Message) -> i32;
        fn DispatchMessageW(message: *const Message) -> isize;
    }
    #[link(name = "wtsapi32")]
    extern "system" {
        fn WTSRegisterSessionNotification(window: Hwnd, flags: u32) -> i32;
        fn WTSUnRegisterSessionNotification(window: Hwnd) -> i32;
    }
    static EVENTS: OnceLock<Mutex<Vec<SessionEvent>>> = OnceLock::new();
    unsafe extern "system" fn procedure(window: Hwnd, message: u32, wp: usize, lp: isize) -> isize {
        let event = match (message, wp) {
            (0x02B1, 7) => Some((SessionKind::Locked, true)),
            (0x02B1, 8) => Some((SessionKind::Locked, false)),
            (0x02B1, 2 | 4) => Some((SessionKind::Disconnected, true)),
            (0x02B1, 1 | 3) => Some((SessionKind::Disconnected, false)),
            (0x0218, 4) => Some((SessionKind::Sleeping, true)),
            (0x0218, 7 | 18) => Some((SessionKind::Sleeping, false)),
            _ => None,
        };
        if let Some((kind, active)) = event {
            if let Ok(mut events) = EVENTS.get_or_init(|| Mutex::new(vec![])).lock() {
                let observed = monotonic_ms();
                // Starts are observed (conservative). A queued unlock may have preceded polling;
                // never extend verified rest to the later delivery time.
                let stamp = if message == 0x02B1 && !active {
                    observed.saturating_sub(
                        (observed as u32).wrapping_sub(GetMessageTime() as u32) as u64
                    )
                } else {
                    observed
                };
                events.push(SessionEvent {
                    kind,
                    active,
                    now: stamp,
                });
            }
        }
        if message == 0x0218 {
            1
        } else {
            DefWindowProcW(window, message, wp, lp)
        }
    }
    pub fn monotonic_ms() -> u64 {
        unsafe { GetTickCount64() }
    }
    pub fn input() -> Option<(u64, u64)> {
        let mut info = LastInput {
            size: std::mem::size_of::<LastInput>() as u32,
            tick: 0,
        };
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return None;
        }
        let now = monotonic_ms();
        let age = (now as u32).wrapping_sub(info.tick) as u64;
        if age > 7 * 86_400_000 {
            return None;
        }
        Some((now.saturating_sub(age), age))
    }
    pub fn show_without_activation(window: &tauri::WebviewWindow) -> Result<(), String> {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as Hwnd;
        unsafe {
            ShowWindow(hwnd, 4);
        }
        if unsafe { IsWindowVisible(hwnd) } == 0 {
            Err("提醒窗口未实际呈现，已取消锁屏".into())
        } else {
            Ok(())
        }
    }
    pub fn hide_without_activation(window: &tauri::WebviewWindow) -> Result<(), String> {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as Hwnd;
        // Display uses SW_SHOWNOACTIVATE directly; symmetric hide must bypass
        // the framework's original visible(false) cache as well.
        unsafe {
            ShowWindow(hwnd, 0);
        }
        if unsafe { IsWindowVisible(hwnd) } != 0 {
            Err("Reminder window did not hide".into())
        } else {
            Ok(())
        }
    }
    pub fn lock() -> Result<(), String> {
        if unsafe { LockWorkStation() } == 0 {
            Err("Windows 未接受锁屏请求，本轮不会重试".into())
        } else {
            Ok(())
        }
    }
    pub fn sound() {
        unsafe {
            MessageBeep(0x40);
        }
    }
    /// Owned by its worker thread. A hidden top-level window receives power broadcasts.
    pub struct Monitor {
        window: Hwnd,
        class: Vec<u16>,
        instance: Handle,
        available: bool,
    }
    impl Monitor {
        pub fn new() -> Self {
            let class: Vec<u16> = "PerfboardStandingReminderMonitor"
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let instance = unsafe { GetModuleHandleW(std::ptr::null()) };
            let wc = WndClass {
                style: 0,
                procedure: Some(procedure),
                class_extra: 0,
                window_extra: 0,
                instance,
                icon: std::ptr::null_mut(),
                cursor: std::ptr::null_mut(),
                background: std::ptr::null_mut(),
                menu: std::ptr::null(),
                name: class.as_ptr(),
            };
            let registered = unsafe { RegisterClassW(&wc) } != 0;
            let window = if registered {
                unsafe {
                    CreateWindowExW(
                        0,
                        class.as_ptr(),
                        class.as_ptr(),
                        0,
                        0,
                        0,
                        0,
                        0,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        instance,
                        std::ptr::null_mut(),
                    )
                }
            } else {
                std::ptr::null_mut()
            };
            let available =
                !window.is_null() && unsafe { WTSRegisterSessionNotification(window, 0) } != 0;
            Self {
                window,
                class,
                instance,
                available,
            }
        }
        pub fn available(&self) -> bool {
            self.available
        }
        pub fn drain(&self) -> Vec<SessionEvent> {
            unsafe {
                let mut msg: Message = std::mem::zeroed();
                while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, 1) != 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            EVENTS
                .get_or_init(|| Mutex::new(vec![]))
                .lock()
                .map(|mut events| std::mem::take(&mut *events))
                .unwrap_or_default()
        }
    }
    impl Drop for Monitor {
        fn drop(&mut self) {
            unsafe {
                if !self.window.is_null() {
                    WTSUnRegisterSessionNotification(self.window);
                    DestroyWindow(self.window);
                }
                UnregisterClassW(self.class.as_ptr(), self.instance);
            }
        }
    }
}
#[cfg(not(windows))]
mod imp {
    use super::*;
    use std::sync::OnceLock;
    pub fn monotonic_ms() -> u64 {
        static START: OnceLock<std::time::Instant> = OnceLock::new();
        START
            .get_or_init(std::time::Instant::now)
            .elapsed()
            .as_millis() as u64
    }
    pub fn input() -> Option<(u64, u64)> {
        None
    }
    pub fn show_without_activation(window: &tauri::WebviewWindow) -> Result<(), String> {
        window.show().map_err(|e| e.to_string())
    }
    pub fn hide_without_activation(window: &tauri::WebviewWindow) -> Result<(), String> {
        window.hide().map_err(|e| e.to_string())
    }
    pub fn lock() -> Result<(), String> {
        Err("自动锁屏仅支持 Windows".into())
    }
    pub fn sound() {}
    pub struct Monitor;
    impl Monitor {
        pub fn new() -> Self {
            Self
        }
        pub fn available(&self) -> bool {
            false
        }
        pub fn drain(&self) -> Vec<SessionEvent> {
            vec![]
        }
    }
}
pub use imp::*;
