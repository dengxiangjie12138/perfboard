//! One application-wide updater. Cached release details are display-only.
use crate::repository::AppResult;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const EVENT: &str = "perfboard:update-state";
const INTERVAL_SECONDS: i64 = 6 * 60 * 60;
const ENDPOINT: &str =
    "https://github.com/dengxiangjie12138/perfboard/releases/latest/download/latest.json";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    current_version: String,
    auto_check_enabled: bool,
    last_checked_at: Option<String>,
    available: Option<ReleaseInfo>,
    phase: &'static str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    error: Option<String>,
    installation: &'static str,
    installer_path: Option<String>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preferences {
    #[serde(default)]
    auto_check_enabled: bool,
    last_checked_at: Option<String>,
    available: Option<ReleaseInfo>,
}
struct Runtime {
    status: UpdateStatus,
    preferences: Preferences,
    load_error: Option<String>,
    next_check: i64,
    update: Option<Update>,
    package: Option<Vec<u8>>,
    installer: Option<PathBuf>,
    download_directory: Option<tempfile::TempDir>,
}
pub struct UpdateService {
    runtime: Mutex<Runtime>,
    directory: PathBuf,
}

fn newer(version: &str, current: &str) -> bool {
    match (
        semver::Version::parse(version.trim_start_matches('v')),
        semver::Version::parse(current),
    ) {
        (Ok(latest), Ok(current)) => latest > current && latest.pre.is_empty(),
        _ => false,
    }
}
fn save_preferences(directory: &Path, preferences: &Preferences) -> AppResult<()> {
    fs::create_dir_all(directory).map_err(|e| format!("无法建立更新设置目录：{e}"))?;
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut file, preferences).map_err(|e| e.to_string())?;
    file.flush()
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    file.persist(directory.join("updater-settings.json"))
        .map_err(|e| format!("更新设置未保存：{e}"))?;
    Ok(())
}
impl UpdateService {
    fn load(directory: PathBuf, version: String, installed: bool) -> Self {
        let loaded = match fs::read(directory.join("updater-settings.json")) {
            Ok(bytes) => serde_json::from_slice::<Preferences>(&bytes).map_err(|e| e.to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
            Err(e) => Err(e.to_string()),
        };
        let load_error = loaded
            .as_ref()
            .err()
            .map(|e| format!("无法读取更新设置，原文件已保留：{e}"));
        let mut preferences = loaded.unwrap_or_default();
        preferences.available = preferences
            .available
            .filter(|info| newer(&info.version, &version));
        let status = UpdateStatus {
            current_version: version,
            auto_check_enabled: preferences.auto_check_enabled,
            last_checked_at: preferences.last_checked_at.clone(),
            available: preferences.available.clone(),
            phase: "idle",
            downloaded_bytes: 0,
            total_bytes: None,
            error: load_error.clone(),
            installation: if installed { "installed" } else { "portable" },
            installer_path: None,
        };
        Self {
            directory,
            runtime: Mutex::new(Runtime {
                status,
                preferences,
                load_error,
                next_check: 0,
                update: None,
                package: None,
                installer: None,
                download_directory: None,
            }),
        }
    }
    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Runtime>> {
        self.runtime.lock().map_err(|_| "更新状态不可用".into())
    }
    fn publish(&self, app: &tauri::AppHandle) -> AppResult<UpdateStatus> {
        let runtime = self.lock()?;
        let status = runtime.status.clone();
        let _ = app.emit(EVENT, &status);
        Ok(status)
    }
    fn begin(&self, phase: &'static str) -> AppResult<bool> {
        let mut runtime = self.lock()?;
        if matches!(
            runtime.status.phase,
            "checking" | "downloading" | "installing"
        ) {
            return Ok(false);
        }
        runtime.status.phase = phase;
        runtime.status.error = None;
        Ok(true)
    }
    fn due(&self, now: i64) -> bool {
        self.lock()
            .map(|runtime| {
                runtime.status.auto_check_enabled
                    && now >= runtime.next_check
                    && !matches!(
                        runtime.status.phase,
                        "checking" | "downloading" | "installing"
                    )
            })
            .unwrap_or(false)
    }
    fn begin_check(&self, automatic: bool, now: i64) -> AppResult<bool> {
        let mut runtime = self.lock()?;
        if matches!(
            runtime.status.phase,
            "checking" | "downloading" | "installing"
        ) || (automatic && (!runtime.status.auto_check_enabled || now < runtime.next_check))
        {
            return Ok(false);
        }
        // Claim the deadline with the phase, so startup and an enable-click cannot
        // run the same automatic check twice even when the first request is fast.
        runtime.next_check = now + INTERVAL_SECONDS;
        runtime.status.phase = "checking";
        runtime.status.error = None;
        Ok(true)
    }
    fn fail(&self, message: String) -> AppResult<()> {
        let mut runtime = self.lock()?;
        runtime.status.phase = if runtime.package.is_some() {
            "ready"
        } else {
            "idle"
        };
        runtime.status.error = Some(message);
        Ok(())
    }
}

pub fn initialize(app: &tauri::AppHandle) -> AppResult<()> {
    let directory =
        crate::config_directory(app.path().app_config_dir().map_err(|e| e.to_string())?);
    app.manage(UpdateService::load(
        directory,
        app.package_info().version.to_string(),
        is_installed(app),
    ));
    let app = app.clone();
    std::thread::Builder::new()
        .name("perfboard-update-check".into())
        .spawn(move || loop {
            let service = app.state::<UpdateService>();
            if service.due(Utc::now().timestamp()) {
                let _ = tauri::async_runtime::block_on(check(&app, true));
            }
            std::thread::sleep(Duration::from_secs(30));
        })
        .map_err(|e| format!("无法启动更新检查：{e}"))?;
    Ok(())
}

fn builder(app: &tauri::AppHandle, timeout: Duration) -> AppResult<tauri_plugin_updater::Updater> {
    let endpoint = ENDPOINT.to_string();
    #[cfg(debug_assertions)]
    let endpoint = std::env::var("PERFBOARD_TEST_UPDATE_ENDPOINT").unwrap_or(endpoint);
    app.updater_builder()
        .endpoints(vec![endpoint.parse().map_err(|_| "更新地址无效")?])
        .map_err(|e| e.to_string())?
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())
}
async fn check(app: &tauri::AppHandle, automatic: bool) -> AppResult<UpdateStatus> {
    let service = app.state::<UpdateService>();
    if !service.begin_check(automatic, Utc::now().timestamp())? {
        return service.publish(app);
    }
    service.publish(app)?;
    let result = async {
        let update = builder(app, Duration::from_secs(30))?
            .check()
            .await
            .map_err(|e| format!("检查更新失败，请检查网络后重试：{e}"))?;
        let mut runtime = service.lock()?;
        let update =
            update.filter(|update| newer(&update.version, &runtime.status.current_version));
        let available = update.as_ref().map(release_info);
        let mut preferences = runtime.preferences.clone();
        preferences.last_checked_at = Some(Utc::now().to_rfc3339());
        preferences.available = available.clone();
        runtime.status.last_checked_at = preferences.last_checked_at.clone();
        runtime.status.available = available;
        let keep_package = update
            .as_ref()
            .zip(runtime.package.as_deref())
            .is_some_and(|(update, bytes)| update.verify(bytes).is_ok());
        runtime.status.phase = if keep_package { "ready" } else { "idle" };
        if !keep_package {
            runtime.status.downloaded_bytes = 0;
            runtime.status.total_bytes = None;
            runtime.status.installer_path = None;
            runtime.package = None;
            runtime.installer = None;
            runtime.download_directory = None;
        }
        runtime.update = update;
        if let Some(error) = &runtime.load_error {
            return Err(error.clone());
        }
        save_preferences(&service.directory, &preferences)?;
        runtime.preferences = preferences;
        Ok(())
    }
    .await;
    service.lock()?.next_check = Utc::now().timestamp() + INTERVAL_SECONDS;
    if let Err(error) = result {
        service.fail(error)?;
    }
    service.publish(app)
}
fn release_info(update: &Update) -> ReleaseInfo {
    ReleaseInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
        pub_date: update
            .date
            .and_then(|date| {
                chrono::DateTime::<Utc>::from_timestamp(date.unix_timestamp(), date.nanosecond())
            })
            .map(|date| date.to_rfc3339()),
    }
}

#[tauri::command]
pub fn update_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> AppResult<UpdateStatus> {
    crate::tool_windows::require_main(&window)?;
    Ok(app.state::<UpdateService>().lock()?.status.clone())
}
#[tauri::command]
pub fn update_set_auto_check(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    enabled: bool,
) -> AppResult<UpdateStatus> {
    crate::tool_windows::require_main(&window)?;
    let service = app.state::<UpdateService>();
    {
        let mut runtime = service.lock()?;
        if let Some(error) = &runtime.load_error {
            return Err(error.clone());
        }
        let mut preferences = runtime.preferences.clone();
        preferences.auto_check_enabled = enabled;
        save_preferences(&service.directory, &preferences)?;
        runtime.preferences = preferences;
        runtime.status.auto_check_enabled = enabled;
        if enabled {
            runtime.next_check = 0;
        }
    }
    if enabled {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = check(&handle, true).await;
        });
    }
    service.publish(&app)
}
#[tauri::command]
pub async fn update_check(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> AppResult<UpdateStatus> {
    crate::tool_windows::require_main(&window)?;
    check(&app, false).await
}
#[tauri::command]
pub async fn update_download(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> AppResult<UpdateStatus> {
    crate::tool_windows::require_main(&window)?;
    let service = app.state::<UpdateService>();
    if !service.begin("downloading")? {
        return service.publish(&app);
    }
    service.publish(&app)?;
    let result = async {
        // Never install from cached display metadata. Re-resolve through the trusted endpoint.
        let update = builder(&app, Duration::from_secs(20 * 60))?
            .check()
            .await
            .map_err(|e| e.to_string())?
            .filter(|update| newer(&update.version, &app.package_info().version.to_string()))
            .ok_or("当前没有可下载的新版本，请重新检查更新")?;
        {
            let mut runtime = service.lock()?;
            runtime.status.available = Some(release_info(&update));
            runtime.status.last_checked_at = Some(Utc::now().to_rfc3339());
            runtime.status.downloaded_bytes = 0;
            runtime.status.total_bytes = None;
            runtime.package = None;
            runtime.installer = None;
            runtime.download_directory = None;
            runtime.status.installer_path = None;
            let mut preferences = runtime.preferences.clone();
            preferences.available = runtime.status.available.clone();
            preferences.last_checked_at = runtime.status.last_checked_at.clone();
            if let Some(error) = &runtime.load_error {
                runtime.status.error = Some(error.clone());
            } else if let Err(error) = save_preferences(&service.directory, &preferences) {
                runtime.status.error = Some(error);
            } else {
                runtime.preferences = preferences;
            }
        }
        let progress_app = app.clone();
        let mut last_progress = std::time::Instant::now();
        let bytes = update
            .download(
                move |chunk, total| {
                    let service = progress_app.state::<UpdateService>();
                    if let Ok(mut runtime) = service.lock() {
                        runtime.status.downloaded_bytes += chunk as u64;
                        runtime.status.total_bytes = total;
                    }
                    if last_progress.elapsed() >= Duration::from_millis(100) {
                        let _ = service.publish(&progress_app);
                        last_progress = std::time::Instant::now();
                    }
                },
                || {},
            )
            .await
            .map_err(|e| format!("更新下载或签名校验失败：{e}"))?;
        update
            .verify(&bytes)
            .map_err(|e| format!("更新签名校验失败：{e}"))?;
        let mut runtime = service.lock()?;
        runtime.status.downloaded_bytes = bytes.len() as u64;
        runtime.status.total_bytes = Some(bytes.len() as u64);
        // Keep verified bytes in native memory. WebViews cannot supply an executable path.
        if runtime.status.installation == "portable" {
            let folder = tempfile::Builder::new()
                .prefix("perfboard-update-")
                .tempdir()
                .map_err(|e| e.to_string())?;
            let path = folder
                .path()
                .join(format!("Perfboard_{}_x64-setup.exe", update.version));
            fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            runtime.status.installer_path = Some(path.to_string_lossy().into());
            runtime.installer = Some(path);
            runtime.download_directory = Some(folder);
        }
        runtime.update = Some(update);
        runtime.package = Some(bytes);
        runtime.status.phase = "ready";
        Ok(())
    }
    .await;
    if let Err(error) = result {
        service.fail(error)?;
    }
    service.publish(&app)
}

#[tauri::command]
pub async fn update_install(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> AppResult<UpdateStatus> {
    crate::tool_windows::require_main(&window)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || install(&handle))
        .await
        .map_err(|e| e.to_string())??;
    app.state::<UpdateService>().publish(&app)
}
fn install(app: &tauri::AppHandle) -> AppResult<()> {
    let service = app.state::<UpdateService>();
    let (update, bytes) = {
        let mut runtime = service.lock()?;
        if runtime.status.phase != "ready" {
            return Err("请先下载更新".into());
        }
        if !is_installed(app) {
            return Err("当前为便携运行，请运行已下载的安装包完成安装".into());
        }
        let update = runtime.update.clone().ok_or("更新信息已过期，请重新下载")?;
        let bytes = runtime.package.clone().ok_or("请先下载更新")?;
        runtime.status.phase = "installing";
        (update, bytes)
    };
    service.publish(app)?;
    let result = crate::workflow_ipc::with_flushed(app, |_| {
        // Windows updater exits directly. Save before invoking it, not in ExitRequested.
        crate::standing_reminder::checkpoint_for_update(app)?;
        if !is_installed(app) {
            return Err("安装目录已变化，更新已取消".into());
        }
        update
            .verify(&bytes)
            .map_err(|e| format!("更新签名校验失败：{e}"))?;
        update
            .install(bytes)
            .map_err(|e| format!("无法启动更新安装：{e}"))
    });
    if let Err(error) = result {
        service.fail(error)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn update_open_installer(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> AppResult<()> {
    crate::tool_windows::require_main(&window)?;
    let (update, bytes, path) = {
        let service = app.state::<UpdateService>();
        let mut runtime = service.lock()?;
        if runtime.status.phase != "ready" || runtime.status.installation != "portable" {
            return Err("请先下载便携运行所需的安装包".into());
        }
        let data = (
            runtime.update.clone().ok_or("更新信息不可用")?,
            runtime.package.clone().ok_or("请先下载更新")?,
            runtime.installer.clone().ok_or("安装包不可用")?,
        );
        runtime.status.phase = "installing";
        data
    };
    app.state::<UpdateService>().publish(&app)?;
    // Stop the running portable instance only after every window saved successfully.
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::workflow_ipc::with_flushed(&handle, |_| {
            // Keep a read handle denying replacement/write until CreateProcess has opened the image.
            let mut options = fs::OpenOptions::new();
            options.read(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(1);
            }
            let mut file = options
                .open(&path)
                .map_err(|e| format!("无法读取安装包：{e}"))?;
            let mut disk = Vec::new();
            file.read_to_end(&mut disk).map_err(|e| e.to_string())?;
            if disk != bytes {
                return Err("安装包已发生变化，请重新下载".into());
            }
            update.verify(&disk).map_err(|e| e.to_string())?;
            crate::standing_reminder::checkpoint_for_update(&handle)?;
            std::process::Command::new(&path)
                .spawn()
                .map_err(|e| format!("无法打开安装包：{e}"))?;
            handle
                .state::<crate::AppState>()
                .quit_confirmed
                .store(true, std::sync::atomic::Ordering::SeqCst);
            handle.exit(0);
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Err(error) = &result {
        app.state::<UpdateService>().fail(error.clone())?;
        app.state::<UpdateService>().publish(&app)?;
    }
    result
}

#[cfg(windows)]
fn plain_path(path: &Path, file: bool) -> bool {
    use std::os::windows::fs::MetadataExt;
    if !path.is_absolute() {
        return false;
    }
    for ancestor in path.ancestors() {
        let Ok(meta) = fs::symlink_metadata(ancestor) else {
            return false;
        };
        if meta.file_attributes() & 0x400 != 0 {
            return false;
        }
        if ancestor == path
            && (if file {
                !meta.is_file()
            } else {
                !meta.is_dir()
            })
        {
            return false;
        }
    }
    true
}
#[cfg(windows)]
fn same_path(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy()),
        _ => false,
    }
}
#[cfg(windows)]
fn is_installed(app: &tauri::AppHandle) -> bool {
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WOW64_64KEY},
        RegKey,
    };
    let product = app.config().product_name.as_deref().unwrap_or("Perfboard");
    let result = (|| -> Option<bool> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let flags = KEY_READ | KEY_WOW64_64KEY;
        let product_key = user
            .open_subkey_with_flags(format!("Software\\perfboard\\{product}"), flags)
            .ok()?;
        let uninstall = user
            .open_subkey_with_flags(
                format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{product}"),
                flags,
            )
            .ok()?;
        let directory: String = product_key.get_value("").ok()?;
        let location: String = uninstall.get_value("InstallLocation").ok()?;
        let name: String = uninstall.get_value("DisplayName").ok()?;
        let publisher: String = uninstall.get_value("Publisher").ok()?;
        let binary: String = uninstall.get_value("MainBinaryName").ok()?;
        let command: String = uninstall.get_value("UninstallString").ok()?;
        let directory = PathBuf::from(directory.trim_matches('"'));
        let executable = directory.join("perfboard.exe");
        let uninstaller = directory.join("uninstall.exe");
        let current = std::env::current_exe().ok()?;
        Some(
            name == product
                && publisher.eq_ignore_ascii_case("perfboard")
                && binary == "perfboard.exe"
                && plain_path(&directory, false)
                && plain_path(&executable, true)
                && plain_path(&uninstaller, true)
                && same_path(&current, &executable)
                && same_path(&directory, Path::new(location.trim_matches('"')))
                && same_path(&uninstaller, Path::new(command.trim_matches('"'))),
        )
    })();
    result.unwrap_or(false)
}
#[cfg(not(windows))]
fn is_installed(_: &tauri::AppHandle) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_newer_stable_semantic_versions_are_updates() {
        assert!(newer("0.1.10", "0.1.2"));
        assert!(newer("v0.2.0", "0.1.1"));
        for version in ["0.1.1", "0.1.0", "0.2.0-beta.1", "invalid"] {
            assert!(!newer(version, "0.1.1"));
        }
    }
    #[test]
    fn preferences_survive_restart_and_repository_is_not_required() {
        let directory = tempfile::tempdir().unwrap();
        let preferences = Preferences {
            auto_check_enabled: true,
            last_checked_at: Some("2026-10-29T00:00:00Z".into()),
            available: Some(ReleaseInfo {
                version: "0.2.0".into(),
                notes: None,
                pub_date: None,
            }),
        };
        save_preferences(directory.path(), &preferences).unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.1".into(), false);
        let runtime = service.lock().unwrap();
        assert!(runtime.status.auto_check_enabled);
        assert!(runtime.status.available.is_some());
        assert!(runtime.update.is_none());
        assert!(runtime.package.is_none());
        assert_eq!(runtime.next_check, 0);
        drop(runtime);
        let updated = UpdateService::load(directory.path().into(), "0.2.0".into(), true);
        assert!(updated.lock().unwrap().status.available.is_none());
    }
    #[test]
    fn corrupt_configuration_is_preserved_and_not_silently_reset() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("updater-settings.json");
        fs::write(&path, "invalid").unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.1".into(), false);
        assert!(service.lock().unwrap().status.error.is_some());
        assert!(!service.lock().unwrap().status.auto_check_enabled);
        assert_eq!(fs::read_to_string(path).unwrap(), "invalid");
    }
    #[test]
    fn concurrent_work_is_deduplicated_and_failures_keep_available_release() {
        let directory = tempfile::tempdir().unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.1".into(), false);
        service.lock().unwrap().status.available = Some(ReleaseInfo {
            version: "0.2.0".into(),
            notes: None,
            pub_date: None,
        });
        assert!(service.begin("checking").unwrap());
        assert!(!service.begin("downloading").unwrap());
        service.fail("offline".into()).unwrap();
        assert!(service.lock().unwrap().status.available.is_some());
        assert!(service.begin("downloading").unwrap());
    }
    #[test]
    fn schedule_is_opt_in_and_six_hour_deadline_resumes_only_once() {
        let directory = tempfile::tempdir().unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.1".into(), false);
        assert!(!service.due(100));
        {
            let mut runtime = service.lock().unwrap();
            runtime.status.auto_check_enabled = true;
            runtime.next_check = 100 + INTERVAL_SECONDS;
        }
        assert!(!service.due(100 + INTERVAL_SECONDS - 1));
        assert!(service.due(100 + INTERVAL_SECONDS));
        assert!(service.due(100 + 10 * INTERVAL_SECONDS));
        assert!(service.begin("checking").unwrap());
        assert!(!service.due(100 + 10 * INTERVAL_SECONDS));
        service.fail("offline".into()).unwrap();
        service.lock().unwrap().next_check = 100 + 11 * INTERVAL_SECONDS;
        assert!(!service.due(100 + 10 * INTERVAL_SECONDS));
        service.lock().unwrap().status.auto_check_enabled = false;
        assert!(!service.due(i64::MAX));
    }
    #[test]
    fn startup_and_enable_claim_a_single_automatic_check_but_manual_retry_is_allowed() {
        let directory = tempfile::tempdir().unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.1".into(), false);
        assert!(!service.begin_check(true, 100).unwrap());
        service.lock().unwrap().status.auto_check_enabled = true;
        assert!(service.begin_check(true, 100).unwrap());
        service.fail("offline".into()).unwrap();
        assert!(!service.begin_check(true, 101).unwrap());
        assert!(service.begin_check(false, 101).unwrap());
        service.fail("offline".into()).unwrap();
        assert!(service.begin_check(true, 101 + INTERVAL_SECONDS).unwrap());
    }
}
