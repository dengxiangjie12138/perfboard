//! Login startup is changed only by an explicit main-window command.
//! Tests use a memory adapter; they never enable or disable Windows registration.
use crate::repository::AppResult;
use serde::Serialize;
use std::ffi::OsStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStartupStatus {
    pub supported: bool,
    pub enabled: bool,
}

trait StartupRegistration {
    fn is_enabled(&self) -> AppResult<bool>;
    fn set_enabled(&self, enabled: bool) -> AppResult<()>;
}

fn read_status(adapter: &impl StartupRegistration) -> AppResult<LoginStartupStatus> {
    Ok(LoginStartupStatus {
        supported: true,
        enabled: adapter.is_enabled()?,
    })
}

fn set_status(adapter: &impl StartupRegistration, enabled: bool) -> AppResult<LoginStartupStatus> {
    if adapter.is_enabled()? != enabled {
        adapter.set_enabled(enabled)?;
    }
    let actual = read_status(adapter)?;
    if actual.enabled != enabled {
        return Err("Windows login startup did not match the requested setting".into());
    }
    Ok(actual)
}

/// Match only the argument registered with the official autostart plugin.
pub fn is_autostart_args<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    args.into_iter()
        .any(|argument| argument.as_ref() == OsStr::new("--autostart"))
}

/// A failed tray must leave an accessible main window.
pub fn should_show_main<I, S>(args: I, tray_ready: bool) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    !is_autostart_args(args) || !tray_ready
}

#[cfg(target_os = "windows")]
struct WindowsRegistration<'a>(&'a tauri::AppHandle);

#[cfg(target_os = "windows")]
impl StartupRegistration for WindowsRegistration<'_> {
    fn is_enabled(&self) -> AppResult<bool> {
        use tauri_plugin_autostart::ManagerExt;
        self.0
            .autolaunch()
            .is_enabled()
            .map_err(|error| format!("Could not read Windows login startup: {error}"))
    }

    fn set_enabled(&self, enabled: bool) -> AppResult<()> {
        use tauri_plugin_autostart::ManagerExt;
        let manager = self.0.autolaunch();
        let result = if enabled {
            manager.enable()
        } else {
            manager.disable()
        };
        result.map_err(|error| format!("Could not change Windows login startup: {error}"))
    }
}

#[tauri::command]
pub fn login_startup_status(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> AppResult<LoginStartupStatus> {
    crate::tool_windows::require_main(&window)?;
    #[cfg(target_os = "windows")]
    {
        read_status(&WindowsRegistration(&app))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(LoginStartupStatus {
            supported: false,
            enabled: false,
        })
    }
}

#[tauri::command]
pub fn login_startup_set(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    enabled: bool,
) -> AppResult<LoginStartupStatus> {
    crate::tool_windows::require_main(&window)?;
    #[cfg(target_os = "windows")]
    {
        set_status(&WindowsRegistration(&app), enabled)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, enabled);
        Err("Login startup is only supported on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[derive(Default)]
    struct MemoryRegistration {
        enabled: Cell<bool>,
        writes: Cell<usize>,
        fail_read: Cell<bool>,
        fail_write: Cell<bool>,
        ignore_write: Cell<bool>,
    }

    impl StartupRegistration for MemoryRegistration {
        fn is_enabled(&self) -> AppResult<bool> {
            if self.fail_read.get() {
                return Err("Injected read failure".into());
            }
            Ok(self.enabled.get())
        }

        fn set_enabled(&self, enabled: bool) -> AppResult<()> {
            self.writes.set(self.writes.get() + 1);
            if self.fail_write.get() {
                return Err("Injected write failure".into());
            }
            if !self.ignore_write.get() {
                self.enabled.set(enabled);
            }
            Ok(())
        }
    }

    #[test]
    fn default_read_is_disabled_and_does_not_write() {
        let adapter = MemoryRegistration::default();
        assert_eq!(
            read_status(&adapter).unwrap(),
            LoginStartupStatus {
                supported: true,
                enabled: false
            }
        );
        assert_eq!(adapter.writes.get(), 0);
    }

    #[test]
    fn explicit_changes_return_verified_actual_state() {
        let adapter = MemoryRegistration::default();
        assert!(set_status(&adapter, true).unwrap().enabled);
        assert!(!set_status(&adapter, false).unwrap().enabled);
        assert_eq!(adapter.writes.get(), 2);
    }

    #[test]
    fn unchanged_state_does_not_write_registration() {
        let adapter = MemoryRegistration::default();
        assert!(!set_status(&adapter, false).unwrap().enabled);
        assert_eq!(adapter.writes.get(), 0);
    }

    #[test]
    fn failed_read_never_attempts_a_write() {
        let adapter = MemoryRegistration::default();
        adapter.fail_read.set(true);
        assert!(set_status(&adapter, true).is_err());
        assert_eq!(adapter.writes.get(), 0);
    }

    #[test]
    fn failed_or_ignored_write_never_reports_success() {
        let adapter = MemoryRegistration::default();
        adapter.fail_write.set(true);
        assert!(set_status(&adapter, true).is_err());
        assert!(!adapter.enabled.get());
        adapter.fail_write.set(false);
        adapter.ignore_write.set(true);
        assert!(set_status(&adapter, true).is_err());
        assert!(!adapter.enabled.get());
    }

    #[test]
    fn only_registered_flag_hides_main_when_tray_is_available() {
        assert!(is_autostart_args(["--autostart"]));
        for args in [
            vec![],
            vec!["--AUTOSTART"],
            vec!["--autostart=true"],
            vec!["--initialize-repository", "C:\\isolated"],
        ] {
            assert!(!is_autostart_args(args.clone()));
            assert!(should_show_main(args, true));
        }
        assert!(!should_show_main(["--autostart"], true));
        assert!(should_show_main(["--autostart"], false));
        assert!(should_show_main(Vec::<String>::new(), false));
    }
}
