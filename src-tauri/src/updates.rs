//! One application-wide updater. Cached release details are display-only.
mod catalog;
mod source;
pub use source::UpdateSource;

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
    source: UpdateSource,
    auto_check_enabled: bool,
    last_checked_at: Option<String>,
    available: Option<ReleaseInfo>,
    target: Option<ReleaseInfo>,
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
// Keep the pre-0.1.3 settings schema intact: old binaries reject unknown fields.
// This atomic record also binds cached discovery hints to their selected source.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceSettings {
    #[serde(default)]
    source: UpdateSource,
    last_checked_at: Option<String>,
    available: Option<ReleaseInfo>,
}
struct Runtime {
    status: UpdateStatus,
    preferences: Preferences,
    source_settings: SourceSettings,
    load_error: Option<String>,
    next_check: i64,
    update: Option<Update>,
    package: Option<Vec<u8>>,
    installer: Option<PathBuf>,
    download_directory: Option<tempfile::TempDir>,
    explicit_selection: bool,
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
    save_settings(directory, "updater-settings.json", preferences)
}
fn save_settings<T: Serialize>(directory: &Path, filename: &str, settings: &T) -> AppResult<()> {
    fs::create_dir_all(directory).map_err(|e| format!("无法建立更新设置目录：{e}"))?;
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut file, settings).map_err(|e| e.to_string())?;
    file.flush()
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    file.persist(directory.join(filename))
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
        let legacy_error = loaded
            .as_ref()
            .err()
            .map(|e| format!("无法读取更新设置，原文件已保留：{e}"));
        let preferences = loaded.unwrap_or_default();
        let source_loaded = match fs::read(directory.join("updater-source.json")) {
            Ok(bytes) => {
                serde_json::from_slice::<SourceSettings>(&bytes).map_err(|e| e.to_string())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SourceSettings {
                source: UpdateSource::Github,
                last_checked_at: preferences.last_checked_at.clone(),
                available: preferences.available.clone(),
            }),
            Err(e) => Err(e.to_string()),
        };
        let load_error = legacy_error.or_else(|| {
            source_loaded
                .as_ref()
                .err()
                .map(|e| format!("无法读取更新来源设置，原文件已保留：{e}"))
        });
        let mut source_settings = source_loaded.unwrap_or_default();
        source_settings.available = source_settings
            .available
            .filter(|info| newer(&info.version, &version));
        let status = UpdateStatus {
            current_version: version,
            source: source_settings.source,
            auto_check_enabled: preferences.auto_check_enabled,
            last_checked_at: source_settings.last_checked_at.clone(),
            available: source_settings.available.clone(),
            target: None,
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
                source_settings,
                load_error,
                next_check: 0,
                update: None,
                package: None,
                installer: None,
                download_directory: None,
                explicit_selection: false,
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
    fn switch_source(&self, source: UpdateSource) -> AppResult<()> {
        let mut runtime = self.lock()?;
        if runtime.status.source == source {
            return Ok(());
        }
        if matches!(
            runtime.status.phase,
            "checking" | "downloading" | "installing"
        ) {
            return Err("更新任务进行中，请完成后再切换更新来源".into());
        }
        if let Some(error) = &runtime.load_error {
            return Err(error.clone());
        }
        let settings = SourceSettings {
            source,
            ..SourceSettings::default()
        };
        // Persist before changing native-owned state. A failed write leaves the
        // old provider and any verified package usable together.
        save_settings(&self.directory, "updater-source.json", &settings)?;
        runtime.source_settings = settings;
        runtime.status.source = source;
        runtime.status.available = None;
        runtime.status.last_checked_at = None;
        runtime.status.target = None;
        runtime.status.error = None;
        runtime.status.phase = "idle";
        runtime.next_check = 0;
        runtime.update = None;
        runtime.explicit_selection = false;
        clear_package(&mut runtime);
        Ok(())
    }
    fn save_cache(
        &self,
        runtime: &mut Runtime,
        available: Option<ReleaseInfo>,
        checked: String,
    ) -> AppResult<()> {
        if let Some(error) = &runtime.load_error {
            return Err(error.clone());
        }
        let settings = SourceSettings {
            source: runtime.status.source,
            last_checked_at: Some(checked),
            available,
        };
        save_settings(&self.directory, "updater-source.json", &settings)?;
        runtime.status.last_checked_at = settings.last_checked_at.clone();
        runtime.status.available = settings.available.clone();
        runtime.source_settings = settings;
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

fn builder(
    app: &tauri::AppHandle,
    source: UpdateSource,
    timeout: Duration,
) -> AppResult<tauri_plugin_updater::Updater> {
    app.updater_builder()
        .endpoints(vec![source.latest()?])
        .map_err(|e| e.to_string())?
        .configure_client(move |client| source.configure_client(client, timeout))
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())
}

fn selected_builder(
    app: &tauri::AppHandle,
    source: UpdateSource,
    endpoint: String,
    selected: semver::Version,
    timeout: Duration,
) -> AppResult<tauri_plugin_updater::Updater> {
    app.updater_builder()
        .endpoints(vec![endpoint
            .parse()
            .map_err(|_| "所选版本的更新地址无效")?])
        .map_err(|e| e.to_string())?
        // Only this explicit, freshly resolved tag may bypass the usual newer-only
        // comparison. It never changes the default comparator used by auto-check.
        .version_comparator(move |current, release| {
            release.version == selected && release.version != current
        })
        .configure_client(move |client| source.configure_client(client, timeout))
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
    let source = service.lock()?.status.source;
    let result = async {
        let update = builder(app, source, Duration::from_secs(30))?
            .check()
            .await
            .map_err(|e| format!("检查更新失败，请检查网络后重试：{e}"))?;
        if let Some(update) = &update {
            validate_update_source(source, None, update)?;
        }
        let mut runtime = service.lock()?;
        let update =
            update.filter(|update| newer(&update.version, &runtime.status.current_version));
        let available = update.as_ref().map(release_info);
        service.save_cache(&mut runtime, available, Utc::now().to_rfc3339())?;
        apply_latest_result(&mut runtime, update);
        Ok(())
    }
    .await;
    service.lock()?.next_check = Utc::now().timestamp() + INTERVAL_SECONDS;
    if let Err(error) = result {
        service.fail(error)?;
    }
    service.publish(app)
}

fn apply_latest_result(runtime: &mut Runtime, update: Option<Update>) {
    // A six-hour/manual latest check must not replace the user's selected signed
    // package, its target, or its schema metadata, even when the target is older.
    if runtime.explicit_selection {
        runtime.status.phase = if runtime.package.is_some() {
            "ready"
        } else {
            "idle"
        };
        return;
    }
    let keep_package = update
        .as_ref()
        .zip(runtime.package.as_deref())
        .is_some_and(|(update, bytes)| update.verify(bytes).is_ok());
    runtime.status.phase = if keep_package { "ready" } else { "idle" };
    if !keep_package {
        clear_package(runtime);
        runtime.status.target = None;
    }
    runtime.update = update;
}

fn clear_package(runtime: &mut Runtime) {
    runtime.status.downloaded_bytes = 0;
    runtime.status.total_bytes = None;
    runtime.status.installer_path = None;
    runtime.package = None;
    runtime.installer = None;
    runtime.download_directory = None;
}

fn is_rollback(target: &str, current: &str) -> AppResult<bool> {
    let target = catalog::stable_tag(target)?;
    let current = semver::Version::parse(current).map_err(|_| "当前应用版本无效")?;
    if target == current {
        return Err("当前已是该版本，请选择其他版本".into());
    }
    Ok(target < current)
}

fn target_schema(version: &str, manifest: &serde_json::Value) -> AppResult<i64> {
    let version = catalog::stable_tag(version)?;
    let schema = match manifest.get("repositorySchemaVersion") {
        Some(value) => value
            .as_i64()
            .filter(|value| *value > 0)
            .ok_or("所选版本的数据库兼容声明无效，不能回退")?,
        None if version == semver::Version::new(0, 1, 1) => 6,
        None => return Err("所选历史版本未声明数据库兼容性，不能在应用内回退".into()),
    };
    // The only legacy manifest fallback is audited against the published 0.1.1
    // executable. A later edit to its JSON cannot claim a newer database schema.
    if version == semver::Version::new(0, 1, 1) && schema != 6 {
        return Err("0.1.1 仅支持数据库格式 6，版本兼容声明不符".into());
    }
    Ok(schema)
}

fn validate_rollback(app: &tauri::AppHandle, update: &Update, allow: bool) -> AppResult<()> {
    if !require_rollback_confirmation(
        &update.version,
        &app.package_info().version.to_string(),
        allow,
    )? {
        return Ok(());
    }
    let supported = target_schema(&update.version, &update.raw_json)?;
    let state = app.state::<crate::AppState>();
    let mut manager = state.repository.lock().map_err(|_| "数据仓库状态不可用")?;
    let status = manager.status();
    let current = if status.ready {
        Some(
            manager
                .ready()?
                .connection()
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .map_err(|_| "无法读取当前仓库格式，已取消回退")?,
        )
    } else {
        None
    };
    validate_repository_compatibility(status.configured, current, supported)
}

fn validate_repository_compatibility(
    configured: bool,
    current: Option<i64>,
    supported: i64,
) -> AppResult<()> {
    if !configured {
        return Ok(());
    }
    let current =
        current.ok_or("当前仓库未连接，无法确认旧版本能否读取数据；请先恢复仓库连接再回退")?;
    validate_schema_support(current, supported)
}

fn validate_schema_support(current: i64, supported: i64) -> AppResult<()> {
    if current < 1 || current > supported {
        return Err(format!(
            "当前仓库格式为 {current}，所选版本最多支持 {supported}；为保留数据已取消回退"
        ));
    }
    Ok(())
}

fn require_rollback_confirmation(target: &str, current: &str, allow: bool) -> AppResult<bool> {
    let rollback = is_rollback(target, current)?;
    if rollback && !allow {
        return Err("回退版本需要先明确确认，尚未开始安装".into());
    }
    Ok(rollback)
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
fn validate_update_source(
    source: UpdateSource,
    tag: Option<&str>,
    update: &Update,
) -> AppResult<()> {
    let version = catalog::stable_tag(&update.version)?;
    let canonical = format!("v{version}");
    source.installer(
        tag.unwrap_or(&canonical),
        &version.to_string(),
        update.download_url.as_str(),
    )
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
pub fn update_set_source(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    source: UpdateSource,
) -> AppResult<UpdateStatus> {
    crate::tool_windows::require_main(&window)?;
    let service = app.state::<UpdateService>();
    service.switch_source(source)?;
    service.publish(&app)
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
    download(&app, None).await
}

#[tauri::command]
pub async fn update_list_versions(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> AppResult<Vec<catalog::ReleaseVersion>> {
    crate::tool_windows::require_main(&window)?;
    let source = app.state::<UpdateService>().lock()?.status.source;
    catalog::list(source).await
}

#[tauri::command]
pub async fn update_download_version(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    tag: String,
) -> AppResult<UpdateStatus> {
    crate::tool_windows::require_main(&window)?;
    catalog::stable_tag(&tag)?;
    download(&app, Some(&tag)).await
}

#[tauri::command]
pub async fn update_open_release(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    tag: String,
) -> AppResult<()> {
    crate::tool_windows::require_main(&window)?;
    let source = app.state::<UpdateService>().lock()?.status.source;
    catalog::exists(source, &tag).await?;
    // Accept a tag, never an arbitrary WebView-provided executable or URL.
    open::that(source.page(&tag)?).map_err(|e| format!("无法打开 {} 版本页面：{e}", source.name()))
}

async fn download(app: &tauri::AppHandle, tag: Option<&str>) -> AppResult<UpdateStatus> {
    let service = app.state::<UpdateService>();
    if !service.begin("downloading")? {
        return service.publish(&app);
    }
    service.publish(&app)?;
    let source = service.lock()?.status.source;
    let result = async {
        // Never install from cached display metadata. Re-resolve through the trusted endpoint.
        let update = if let Some(tag) = tag {
            let (endpoint, version) = catalog::resolve(source, tag).await?;
            if version == app.package_info().version {
                return Err("当前已是该版本，请选择其他版本".into());
            }
            let update = selected_builder(
                app,
                source,
                endpoint,
                version.clone(),
                Duration::from_secs(20 * 60),
            )?
            .check()
            .await
            .map_err(|e| format!("无法读取所选版本的签名更新清单：{e}"))?
            .ok_or("所选版本与其更新清单不符，请刷新版本列表")?;
            if is_rollback(&update.version, &app.package_info().version.to_string())? {
                target_schema(&update.version, &update.raw_json)?;
            }
            update
        } else {
            builder(app, source, Duration::from_secs(20 * 60))?
                .check()
                .await
                .map_err(|e| e.to_string())?
                .filter(|update| newer(&update.version, &app.package_info().version.to_string()))
                .ok_or("当前没有可下载的新版本，请重新检查更新")?
        };
        validate_update_source(source, tag, &update)?;
        {
            let mut runtime = service.lock()?;
            runtime.explicit_selection = tag.is_some();
            runtime.status.target = Some(release_info(&update));
            clear_package(&mut runtime);
            runtime.update = None;
            if tag.is_none() {
                if let Err(error) = service.save_cache(
                    &mut runtime,
                    Some(release_info(&update)),
                    Utc::now().to_rfc3339(),
                ) {
                    runtime.status.error = Some(error);
                }
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
    allow_rollback: Option<bool>,
) -> AppResult<UpdateStatus> {
    crate::tool_windows::require_main(&window)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || install(&handle, allow_rollback.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())??;
    app.state::<UpdateService>().publish(&app)
}
fn install(app: &tauri::AppHandle, allow_rollback: bool) -> AppResult<()> {
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
        // Confirm and compare schema while the existing all-window save barrier
        // holds repository switching and editing. No rollback mutates a database.
        validate_rollback(app, &update, allow_rollback)?;
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
    allow_rollback: Option<bool>,
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
            validate_rollback(&handle, &update, allow_rollback.unwrap_or(false))?;
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
        assert!(runtime.status.target.is_none());
        assert!(!runtime.explicit_selection);
        assert_eq!(runtime.next_check, 0);
        assert_eq!(runtime.status.source, UpdateSource::Github);
        drop(runtime);
        let updated = UpdateService::load(directory.path().into(), "0.2.0".into(), true);
        assert!(updated.lock().unwrap().status.available.is_none());
    }
    #[test]
    fn source_and_its_display_cache_survive_restart_without_changing_legacy_settings() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = Preferences {
            auto_check_enabled: true,
            last_checked_at: Some("2026-10-28T00:00:00Z".into()),
            available: Some(ReleaseInfo {
                version: "0.1.4".into(),
                notes: Some("GitHub hint".into()),
                pub_date: None,
            }),
        };
        save_preferences(directory.path(), &legacy).unwrap();
        let path = directory.path().join("updater-settings.json");
        let original = fs::read(&path).unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.2".into(), false);
        service.switch_source(UpdateSource::Gitee).unwrap();
        {
            let mut runtime = service.lock().unwrap();
            assert!(runtime.status.available.is_none());
            assert!(runtime.status.last_checked_at.is_none());
            assert!(runtime.status.auto_check_enabled);
            service
                .save_cache(
                    &mut runtime,
                    Some(ReleaseInfo {
                        version: "0.1.3".into(),
                        notes: Some("Gitee hint".into()),
                        pub_date: None,
                    }),
                    "2026-10-30T00:00:00Z".into(),
                )
                .unwrap();
        }
        let reloaded = UpdateService::load(directory.path().into(), "0.1.2".into(), false);
        let runtime = reloaded.lock().unwrap();
        assert_eq!(runtime.status.source, UpdateSource::Gitee);
        assert_eq!(runtime.status.available.as_ref().unwrap().version, "0.1.3");
        assert_eq!(
            runtime.status.last_checked_at.as_deref(),
            Some("2026-10-30T00:00:00Z")
        );
        assert!(runtime.package.is_none());
        assert!(runtime.update.is_none());
        assert!(runtime.status.target.is_none());
        assert_eq!(fs::read(&path).unwrap(), original);
        // This is the exact deny_unknown_fields schema read by 0.1.2.
        assert!(serde_json::from_slice::<Preferences>(&fs::read(path).unwrap()).is_ok());
        drop(runtime);
        reloaded.switch_source(UpdateSource::Github).unwrap();
        let clean = UpdateService::load(directory.path().into(), "0.1.2".into(), false);
        assert_eq!(clean.lock().unwrap().status.source, UpdateSource::Github);
        assert!(clean.lock().unwrap().status.available.is_none());
        assert!(clean.lock().unwrap().status.last_checked_at.is_none());
    }

    #[test]
    fn source_switch_clears_ready_owned_bytes_but_cannot_race_active_work() {
        let directory = tempfile::tempdir().unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.2".into(), false);
        for phase in ["checking", "downloading", "installing"] {
            service.lock().unwrap().status.phase = phase;
            assert!(service.switch_source(UpdateSource::Gitee).is_err());
            assert_eq!(service.lock().unwrap().status.source, UpdateSource::Github);
            assert!(!directory.path().join("updater-source.json").exists());
        }
        let folder = tempfile::tempdir().unwrap();
        let old_path = folder.path().join("package.exe");
        fs::write(&old_path, [1, 2, 3]).unwrap();
        {
            let mut runtime = service.lock().unwrap();
            runtime.package = Some(vec![1, 2, 3]);
            runtime.installer = Some(old_path.clone());
            runtime.download_directory = Some(folder);
            runtime.explicit_selection = true;
            runtime.status.phase = "ready";
            runtime.status.installer_path = Some(old_path.to_string_lossy().into());
            runtime.status.target = Some(ReleaseInfo {
                version: "0.1.1".into(),
                notes: None,
                pub_date: None,
            });
            runtime.status.downloaded_bytes = 3;
            runtime.status.total_bytes = Some(3);
        }
        service.switch_source(UpdateSource::Gitee).unwrap();
        let runtime = service.lock().unwrap();
        assert_eq!(runtime.status.phase, "idle");
        assert!(runtime.package.is_none());
        assert!(runtime.update.is_none());
        assert!(runtime.installer.is_none());
        assert!(runtime.download_directory.is_none());
        assert!(!runtime.explicit_selection);
        assert!(runtime.status.target.is_none());
        assert!(runtime.status.installer_path.is_none());
        assert_eq!(runtime.status.downloaded_bytes, 0);
        assert!(runtime.status.total_bytes.is_none());
        assert_eq!(runtime.next_check, 0);
        assert!(!old_path.exists());
    }

    #[test]
    fn corrupt_source_file_is_preserved_and_cannot_be_overwritten_by_a_switch() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("updater-source.json");
        fs::write(
            &path,
            r#"{"source":"third-party","lastCheckedAt":null,"available":null}"#,
        )
        .unwrap();
        let original = fs::read(&path).unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.2".into(), false);
        assert!(service
            .lock()
            .unwrap()
            .status
            .error
            .as_deref()
            .unwrap()
            .contains("更新来源设置"));
        assert!(service.switch_source(UpdateSource::Gitee).is_err());
        assert_eq!(fs::read(path).unwrap(), original);
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

    #[test]
    fn latest_check_never_replaces_selected_rollback_target_or_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.2".into(), true);
        let mut runtime = service.lock().unwrap();
        let target = ReleaseInfo {
            version: "0.1.1".into(),
            notes: None,
            pub_date: None,
        };
        runtime.explicit_selection = true;
        runtime.status.target = Some(target.clone());
        runtime.status.available = Some(ReleaseInfo {
            version: "0.1.3".into(),
            notes: None,
            pub_date: None,
        });
        runtime.package = Some(vec![1, 2, 3]);
        runtime.status.phase = "checking";
        apply_latest_result(&mut runtime, None);
        assert_eq!(runtime.status.phase, "ready");
        assert_eq!(runtime.status.target, Some(target));
        assert_eq!(runtime.package.as_deref(), Some([1, 2, 3].as_slice()));
        assert_eq!(runtime.status.available.as_ref().unwrap().version, "0.1.3");
        assert!(runtime.explicit_selection);
    }

    #[test]
    fn ordinary_latest_recheck_discards_a_package_without_a_matching_verified_update() {
        let directory = tempfile::tempdir().unwrap();
        let service = UpdateService::load(directory.path().into(), "0.1.2".into(), true);
        let mut runtime = service.lock().unwrap();
        runtime.package = Some(vec![1, 2, 3]);
        runtime.status.target = Some(ReleaseInfo {
            version: "0.1.3".into(),
            notes: None,
            pub_date: None,
        });
        apply_latest_result(&mut runtime, None);
        assert_eq!(runtime.status.phase, "idle");
        assert!(runtime.package.is_none());
        assert!(runtime.status.target.is_none());
    }

    #[test]
    fn rollback_requires_known_schema_and_legacy_fallback_is_only_published_011() {
        assert_eq!(target_schema("0.1.1", &serde_json::json!({})).unwrap(), 6);
        assert_eq!(
            target_schema("0.1.2", &serde_json::json!({"repositorySchemaVersion": 6})).unwrap(),
            6
        );
        assert!(target_schema("0.1.0", &serde_json::json!({})).is_err());
        assert!(target_schema("0.1.2", &serde_json::json!({})).is_err());
        assert!(
            target_schema("0.1.1", &serde_json::json!({"repositorySchemaVersion": 7})).is_err()
        );
        assert!(target_schema(
            "0.1.2",
            &serde_json::json!({"repositorySchemaVersion": "6"})
        )
        .is_err());
        assert!(
            target_schema("0.1.2", &serde_json::json!({"repositorySchemaVersion": 0})).is_err()
        );
        assert!(validate_schema_support(6, 6).is_ok());
        assert!(validate_schema_support(7, 6).is_err());
        assert!(validate_schema_support(0, 6).is_err());
    }

    #[test]
    fn equal_and_prerelease_targets_are_not_rollback_choices() {
        assert!(is_rollback("0.1.1", "0.1.2").unwrap());
        assert!(!is_rollback("0.1.3", "0.1.2").unwrap());
        assert!(is_rollback("0.1.2", "0.1.2").is_err());
        assert!(is_rollback("0.1.1-beta.1", "0.1.2").is_err());
    }

    #[test]
    fn rollback_confirmation_is_required_even_after_a_package_was_selected_and_downloaded() {
        assert!(require_rollback_confirmation("0.1.1", "0.1.2", false).is_err());
        assert!(require_rollback_confirmation("0.1.1", "0.1.2", true).unwrap());
        assert!(!require_rollback_confirmation("0.1.3", "0.1.2", false).unwrap());
    }

    #[test]
    fn unconfigured_repository_is_allowed_but_disconnected_or_newer_schema_is_not() {
        assert!(validate_repository_compatibility(false, None, 6).is_ok());
        assert!(validate_repository_compatibility(true, None, 6)
            .unwrap_err()
            .contains("未连接"));
        assert!(validate_repository_compatibility(true, Some(6), 6).is_ok());
        assert!(validate_repository_compatibility(true, Some(7), 6).is_err());
    }
}
