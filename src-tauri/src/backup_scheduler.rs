//! One process scheduler; settings and daily attempts belong to the active warehouse.
//! A running app may attempt today's backup after HH:mm, never a missed prior day.
use crate::repository::{
    workflow_storage::{save_setting, setting, warehouse_id},
    Repository,
};
use chrono::{DateTime, Local, Timelike};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};

const SETTINGS_KEY: &str = "auto_backup.settings";
const RESULT_KEY: &str = "auto_backup.last_result";
const ATTEMPTED_DAYS_KEY: &str = "auto_backup.attempted_days";
const ROOT_MANIFEST: &str = ".perfboard-auto-root.json";
const MANIFEST: &str = ".perfboard-auto-backup.json";
const OWNER: &str = "Perfboard.AutomaticBackup";
const MAX_BACKUPS: usize = 5;
static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoBackupSettings {
    pub enabled: bool,
    pub parent_directory: Option<String>,
    pub time: String,
}
impl Default for AutoBackupSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            parent_directory: None,
            time: "20:00".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoBackupResult {
    pub day: String,
    pub attempted_at: String,
    pub status: String,
    pub backup_path: Option<String>,
    pub error: Option<String>,
    pub cleanup_warning: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupStatus {
    pub settings: AutoBackupSettings,
    pub last_result: Option<AutoBackupResult>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerRuntime {
    pub running: bool,
    pub last_error: Option<String>,
}
#[derive(Clone, Default)]
pub struct BackupScheduler {
    signal: Arc<(Mutex<u64>, Condvar)>,
    runtime: Arc<Mutex<SchedulerRuntime>>,
}
impl BackupScheduler {
    /// Root owns the callback and locks the one RepositoryManager for the complete tick.
    /// It resolves the CURRENT warehouse each time; no repository pointer crosses threads.
    pub fn start<F>(&self, callback: F)
    where
        F: Fn() -> Result<Option<AutoBackupResult>, String> + Send + 'static,
    {
        if STARTED.swap(true, Ordering::SeqCst) {
            return;
        }
        let signal = Arc::clone(&self.signal);
        let runtime = Arc::clone(&self.runtime);
        let spawn = std::thread::Builder::new()
            .name("perfboard-daily-backup".into())
            .spawn(move || loop {
                if let Ok(mut state) = runtime.lock() {
                    state.running = true;
                }
                let error = callback().err();
                if let Ok(mut state) = runtime.lock() {
                    state.running = false;
                    state.last_error = error;
                }
                let (mutex, wake) = &*signal;
                let Ok(generation) = mutex.lock() else {
                    break;
                };
                let _wait = wake.wait_timeout(generation, Duration::from_secs(20));
            });
        if let Err(error) = spawn {
            STARTED.store(false, Ordering::SeqCst);
            if let Ok(mut state) = self.runtime.lock() {
                state.last_error = Some(error.to_string());
            }
        }
    }
    pub fn wake(&self) {
        let (mutex, wake) = &*self.signal;
        if let Ok(mut generation) = mutex.lock() {
            *generation = generation.wrapping_add(1);
            wake.notify_one();
        }
    }
    pub fn runtime_status(&self) -> SchedulerRuntime {
        self.runtime
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| SchedulerRuntime {
                running: false,
                last_error: Some("Backup scheduler state is unavailable".into()),
            })
    }
}
fn hhmm(time: &str) -> Result<u32, String> {
    let bytes = time.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || ![bytes[0], bytes[1], bytes[3], bytes[4]]
            .iter()
            .all(u8::is_ascii_digit)
    {
        return Err("请选择有效的本地时间 HH:mm。".into());
    }
    let hour = u32::from(bytes[0] - b'0') * 10 + u32::from(bytes[1] - b'0');
    let minute = u32::from(bytes[3] - b'0') * 10 + u32::from(bytes[4] - b'0');
    if hour > 23 || minute > 59 {
        return Err("请选择有效的本地时间 HH:mm。".into());
    }
    Ok(hour * 60 + minute)
}
fn reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}
fn plain(path: &Path, directory: bool) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if reparse(&metadata)
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err(format!(
            "备份路径不是普通{}或已被重定向：{}",
            if directory { "目录" } else { "文件" },
            path.display()
        ));
    }
    Ok(metadata)
}
fn check_ancestors(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        plain(ancestor, true)?;
    }
    Ok(())
}
fn selected_parent(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    let is_unc = raw.starts_with("//")
        || (raw.starts_with("\\\\") && !raw.starts_with("\\\\?\\"))
        || raw.starts_with("\\\\?\\UNC\\");
    if raw.is_empty()
        || !path.is_absolute()
        || is_unc
        || raw.contains('\0')
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err("请选择已存在的本机备份父目录。".into());
    }
    check_ancestors(&path)?;
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    check_ancestors(&canonical)?;
    Ok(canonical)
}
pub fn setting_load(conn: &Connection) -> Result<AutoBackupStatus, String> {
    let settings: AutoBackupSettings = match setting(conn, SETTINGS_KEY)? {
        Some(value) => {
            serde_json::from_str(&value).map_err(|e| format!("自动备份设置损坏：{e}"))?
        }
        None => AutoBackupSettings::default(),
    };
    hhmm(&settings.time)?;
    let last_result = setting(conn, RESULT_KEY)?
        .map(|value| serde_json::from_str(&value).map_err(|e| format!("自动备份结果损坏：{e}")))
        .transpose()?;
    Ok(AutoBackupStatus {
        settings,
        last_result,
    })
}
pub fn setting_save(
    conn: &Connection,
    settings: AutoBackupSettings,
) -> Result<AutoBackupStatus, String> {
    hhmm(&settings.time)?;
    if settings.enabled && settings.parent_directory.is_none() {
        return Err("启用自动备份前请选择备份父目录。".into());
    }
    if settings.enabled {
        if let Some(path) = &settings.parent_directory {
            selected_parent(path)?;
        }
    }
    save_setting(
        conn,
        SETTINGS_KEY,
        &serde_json::to_string(&settings).map_err(|e| e.to_string())?,
    )?;
    setting_load(conn)
}
/// Call only when opening/loading a warehouse before a backup worker can use it.
pub fn recover_interrupted(conn: &Connection) -> Result<(), String> {
    if let Some(mut result) = setting_load(conn)?.last_result {
        if result.status == "running" {
            result.status = "failed".into();
            result.error = Some("上次自动备份在完成验证前中断；当天不会重复尝试。".into());
            persist_result(conn, &result)?;
        }
    }
    Ok(())
}
fn persist_result(conn: &Connection, result: &AutoBackupResult) -> Result<(), String> {
    save_setting(
        conn,
        RESULT_KEY,
        &serde_json::to_string(result).map_err(|e| e.to_string())?,
    )
}
fn attempted_days(conn: &Connection) -> Result<BTreeSet<String>, String> {
    let days: BTreeSet<String> = match setting(conn, ATTEMPTED_DAYS_KEY)? {
        Some(value) => serde_json::from_str(&value)
            .map_err(|error| format!("自动备份日期记录损坏：{error}"))?,
        None => BTreeSet::new(),
    };
    for day in &days {
        chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
            .map_err(|_| "自动备份日期记录无效。".to_string())?;
    }
    Ok(days)
}
fn record_attempt(conn: &Connection, result: &AutoBackupResult) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let mut days = attempted_days(&tx)?;
    if !days.insert(result.day.clone()) {
        return Err("当天已尝试自动备份。".into());
    }
    save_setting(
        &tx,
        ATTEMPTED_DAYS_KEY,
        &serde_json::to_string(&days).map_err(|error| error.to_string())?,
    )?;
    persist_result(&tx, result)?;
    tx.commit().map_err(|error| error.to_string())
}
fn due(status: &AutoBackupStatus, now: DateTime<Local>) -> Result<bool, String> {
    if !status.settings.enabled || now.hour() * 60 + now.minute() < hhmm(&status.settings.time)? {
        return Ok(false);
    }
    Ok(!status
        .last_result
        .as_ref()
        .is_some_and(|result| result.day == now.format("%Y-%m-%d").to_string()))
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RootManifest {
    version: u32,
    owner: String,
    root_id: String,
    warehouse_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Entry {
    directory: bool,
    size: u64,
    sha256: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManagedManifest {
    version: u32,
    owner: String,
    root_id: String,
    warehouse_id: String,
    directory: String,
    created_at: String,
    entries: BTreeMap<String, Entry>,
}
fn write_new_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    output
        .write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    output.sync_all().map_err(|e| e.to_string())
}
fn managed_root(parent: &Path, warehouse: &str) -> Result<(PathBuf, RootManifest), String> {
    check_ancestors(parent)?;
    let root = parent.join(format!(".perfboard-auto-{warehouse}"));
    let created = match fs::create_dir(&root) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
        Err(error) => return Err(error.to_string()),
    };
    plain(&root, true)?;
    let file = root.join(ROOT_MANIFEST);
    if created {
        write_new_json(
            &file,
            &RootManifest {
                version: 1,
                owner: OWNER.into(),
                root_id: uuid::Uuid::new_v4().to_string(),
                warehouse_id: warehouse.into(),
            },
        )?;
    }
    plain(&file, false)?;
    let manifest: RootManifest =
        serde_json::from_slice(&fs::read(&file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("自动备份目录所有权凭据无效：{e}"))?;
    if manifest.version != 1
        || manifest.owner != OWNER
        || manifest.warehouse_id != warehouse
        || uuid::Uuid::parse_str(&manifest.root_id).is_err()
    {
        return Err("自动备份目录未通过所有权验证；已有内容已保留。".into());
    }
    if root.canonicalize().map_err(|e| e.to_string())? != root {
        return Err("自动备份目录已被重定向。".into());
    }
    Ok((root, manifest))
}
fn relative(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if raw.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("备份清单包含不安全的相对路径。".into());
    }
    Ok(path)
}
fn relative_name(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|value| value.replace('\\', "/"))
        .ok_or("备份路径无法编码。".into())
}
fn file_sha256(path: &Path) -> Result<String, String> {
    let before = plain(path, false)?;
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let length = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if length == 0 {
            break;
        }
        digest.update(&buffer[..length]);
    }
    let after = plain(path, false)?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("备份文件在校验时发生变化，已跳过清理。".into());
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn inventory(directory: &Path, ignore_manifest: bool) -> Result<BTreeMap<String, Entry>, String> {
    plain(directory, true)?;
    let mut entries = BTreeMap::new();
    let mut pending = vec![directory.to_path_buf()];
    while let Some(parent) = pending.pop() {
        plain(&parent, true)?;
        for child in fs::read_dir(&parent).map_err(|e| e.to_string())? {
            let path = child.map_err(|e| e.to_string())?.path();
            if ignore_manifest && path == directory.join(MANIFEST) {
                plain(&path, false)?;
                continue;
            }
            let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if reparse(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
                return Err("备份目录含链接或特殊文件，已跳过清理。".into());
            }
            if !path
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(directory)
            {
                return Err("备份文件超出目录边界，已跳过清理。".into());
            }
            let name = relative_name(path.strip_prefix(directory).map_err(|e| e.to_string())?)?;
            entries.insert(
                name,
                Entry {
                    directory: metadata.is_dir(),
                    size: if metadata.is_file() {
                        metadata.len()
                    } else {
                        0
                    },
                    sha256: if metadata.is_file() {
                        Some(file_sha256(&path)?)
                    } else {
                        None
                    },
                },
            );
            if metadata.is_dir() {
                pending.push(path);
            }
        }
    }
    Ok(entries)
}
/// Only the database, backup manifest, registered attachments and their parent directories
/// qualify as a backup payload. An unrelated file is never acquired into our deletion list.
fn verified_payload(directory: &Path) -> Result<BTreeMap<String, Entry>, String> {
    plain(directory, true)?;
    let database = directory.join("perfboard.sqlite3");
    plain(&database, false)?;
    Repository::validate(directory.to_str().ok_or("备份目录无法编码。")?)?;
    plain(&directory.join("backup-manifest.json"), false)?;
    let backup_manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(directory.join("backup-manifest.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if backup_manifest
        .get("version")
        .and_then(|value| value.as_u64())
        != Some(1)
        || backup_manifest
            .get("database")
            .and_then(|value| value.as_str())
            != Some("perfboard.sqlite3")
    {
        return Err("备份基础清单无效。".into());
    }
    let conn = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT relative_path,size FROM attachments WHERE kind='file'")
        .map_err(|e| e.to_string())?;
    let attachments = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    // Validation/query handles must close before checksumming the standalone snapshot.
    drop(stmt);
    drop(conn);
    let mut expected = BTreeMap::new();
    for name in ["perfboard.sqlite3", "backup-manifest.json"] {
        let metadata = plain(&directory.join(name), false)?;
        expected.insert(
            name.into(),
            Entry {
                directory: false,
                size: metadata.len(),
                sha256: Some(file_sha256(&directory.join(name))?),
            },
        );
    }
    for name in ["attachments", "backups"] {
        plain(&directory.join(name), true)?;
        expected.insert(
            name.into(),
            Entry {
                directory: true,
                size: 0,
                sha256: None,
            },
        );
    }
    for (name, size) in attachments {
        let rel = relative(&name)?;
        if rel.components().next() != Some(Component::Normal(std::ffi::OsStr::new("attachments")))
            || size < 0
        {
            return Err("附件备份路径或大小无效。".into());
        }
        let file = directory.join(&rel);
        let metadata = plain(&file, false)?;
        if metadata.len() != size as u64 {
            return Err(format!("附件备份不完整：{name}"));
        }
        expected.insert(
            relative_name(&rel)?,
            Entry {
                directory: false,
                size: metadata.len(),
                sha256: Some(file_sha256(&file)?),
            },
        );
        for parent in rel.parent().into_iter().flat_map(Path::ancestors) {
            if parent.as_os_str().is_empty() {
                continue;
            }
            plain(&directory.join(parent), true)?;
            expected.insert(
                relative_name(parent)?,
                Entry {
                    directory: true,
                    size: 0,
                    sha256: None,
                },
            );
        }
    }
    let actual = inventory(directory, true)?;
    if actual != expected {
        let extra = actual
            .keys()
            .filter(|name| !expected.contains_key(*name))
            .collect::<Vec<_>>();
        let missing = expected
            .keys()
            .filter(|name| !actual.contains_key(*name))
            .collect::<Vec<_>>();
        let changed = expected
            .iter()
            .filter(|(name, entry)| {
                actual
                    .get(*name)
                    .is_some_and(|actual_entry| actual_entry != *entry)
            })
            .map(|(name, _)| name)
            .collect::<Vec<_>>();
        return Err(format!("备份目录未通过完整清单校验，已保留且未清理旧备份。额外内容：{extra:?}；缺失内容：{missing:?}；变更内容：{changed:?}"));
    }
    Ok(expected)
}
fn audit(
    root: &Path,
    ownership: &RootManifest,
    directory: &Path,
) -> Result<ManagedManifest, String> {
    check_ancestors(root)?;
    plain(directory, true)?;
    if directory.parent() != Some(root)
        || directory.canonicalize().map_err(|e| e.to_string())? != directory
    {
        return Err("自动备份目录边界无效，已跳过清理。".into());
    }
    let name = directory
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("自动备份目录名称无效。")?;
    if !name.starts_with("daily-") {
        return Err("自动备份目录包含未知内容，已跳过清理。".into());
    }
    let manifest_file = directory.join(MANIFEST);
    plain(&manifest_file, false)?;
    let manifest: ManagedManifest =
        serde_json::from_slice(&fs::read(manifest_file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if manifest.version != 1
        || manifest.owner != OWNER
        || manifest.root_id != ownership.root_id
        || manifest.warehouse_id != ownership.warehouse_id
        || manifest.directory != name
        || DateTime::parse_from_rfc3339(&manifest.created_at).is_err()
    {
        return Err("自动备份所有权不匹配，已跳过清理。".into());
    }
    for name in manifest.entries.keys() {
        relative(name)?;
    }
    if verified_payload(directory)? != manifest.entries {
        return Err("自动备份目录内容已变更，已跳过清理。".into());
    }
    Ok(manifest)
}
fn remove_audited(root: &Path, ownership: &RootManifest, directory: &Path) -> Result<(), String> {
    let manifest = audit(root, ownership, directory)?;
    // No recursive delete: remove only audited known regular files, then empty directories.
    for (name, entry) in &manifest.entries {
        if !entry.directory {
            let path = directory.join(relative(name)?);
            check_ancestors(path.parent().ok_or("文件父目录无效")?)?;
            plain(&path, false)?;
            if Some(file_sha256(&path)?) != entry.sha256 {
                return Err("备份文件内容已改变，已停止清理。".into());
            }
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    let mut directories = manifest
        .entries
        .iter()
        .filter(|(_, entry)| entry.directory)
        .map(|(name, _)| directory.join(name))
        .collect::<Vec<_>>();
    directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for path in directories {
        check_ancestors(&path)?;
        fs::remove_dir(path).map_err(|e| e.to_string())?;
    }
    plain(&directory.join(MANIFEST), false)?;
    fs::remove_file(directory.join(MANIFEST)).map_err(|e| e.to_string())?;
    check_ancestors(directory)?;
    fs::remove_dir(directory).map_err(|e| e.to_string())
}
fn retain(root: &Path, ownership: &RootManifest) -> Result<(), String> {
    check_ancestors(root)?;
    let mut candidates = Vec::new();
    // Audit the ENTIRE namespace before deleting anything. Orphans/foreign files stop retention.
    for child in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = child.map_err(|e| e.to_string())?.path();
        if path == root.join(ROOT_MANIFEST) {
            plain(&path, false)?;
            continue;
        }
        let manifest = audit(root, ownership, &path)?;
        let created =
            DateTime::parse_from_rfc3339(&manifest.created_at).map_err(|e| e.to_string())?;
        candidates.push((created, path));
    }
    candidates.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let excess = candidates.len().saturating_sub(MAX_BACKUPS);
    for (_, path) in candidates.into_iter().take(excess) {
        remove_audited(root, ownership, &path)?;
    }
    Ok(())
}
pub fn is_due(repo: &Repository, now: DateTime<Local>) -> Result<bool, String> {
    Ok(due(&setting_load(repo.connection())?, now)?
        && !attempted_days(repo.connection())?.contains(&now.format("%Y-%m-%d").to_string()))
}
/// A failed save barrier is a daily failed attempt, without touching backup filesystem data.
/// Root rechecks warehouse identity and calls this under the same repository mutex.
pub fn record_flush_failure(
    repo: &Repository,
    now: DateTime<Local>,
    error: String,
) -> Result<Option<AutoBackupResult>, String> {
    if !is_due(repo, now)? {
        return Ok(None);
    }
    let result = AutoBackupResult {
        day: now.format("%Y-%m-%d").to_string(),
        attempted_at: now.to_rfc3339(),
        status: "failed".into(),
        backup_path: None,
        error: Some(format!("窗口内容保存失败，未开始备份：{error}")),
        cleanup_warning: None,
    };
    record_attempt(repo.connection(), &result)?;
    Ok(Some(result))
}
pub fn run_due(
    repo: &Repository,
    now: DateTime<Local>,
) -> Result<Option<AutoBackupResult>, String> {
    let status = setting_load(repo.connection())?;
    if !due(&status, now)?
        || attempted_days(repo.connection())?.contains(&now.format("%Y-%m-%d").to_string())
    {
        return Ok(None);
    }
    let mut result = AutoBackupResult {
        day: now.format("%Y-%m-%d").to_string(),
        attempted_at: now.to_rfc3339(),
        status: "running".into(),
        backup_path: None,
        error: None,
        cleanup_warning: None,
    };
    // The marker precedes ALL filesystem operations. Failure/crash is not retried today.
    record_attempt(repo.connection(), &result)?;
    let backup = (|| -> Result<(PathBuf, PathBuf, RootManifest), String> {
        let parent = selected_parent(
            status
                .settings
                .parent_directory
                .as_deref()
                .ok_or("请选择备份父目录。")?,
        )?;
        let (root, ownership) = managed_root(&parent, &warehouse_id(repo.connection())?)?;
        let name = format!(
            "daily-{}-{}",
            now.format("%Y-%m-%d-%H%M%S"),
            uuid::Uuid::new_v4()
        );
        let destination = root.join(&name);
        result.backup_path = Some(destination.to_string_lossy().into_owned());
        repo.backup(destination.to_str().ok_or("备份目录无法编码。")?)?;
        let entries = verified_payload(&destination)?;
        write_new_json(
            &destination.join(MANIFEST),
            &ManagedManifest {
                version: 1,
                owner: OWNER.into(),
                root_id: ownership.root_id.clone(),
                warehouse_id: ownership.warehouse_id.clone(),
                directory: name,
                created_at: now.to_rfc3339(),
                entries,
            },
        )?;
        audit(&root, &ownership, &destination)?;
        Ok((destination, root, ownership))
    })();
    match backup {
        Ok((_, root, ownership)) => {
            result.status = "success".into();
            if let Err(error) = retain(&root, &ownership) {
                result.cleanup_warning = Some(format!("新备份已验证；旧备份清理已跳过：{error}"));
            }
        }
        Err(error) => {
            result.status = "failed".into();
            result.error = Some(error);
        }
    }
    persist_result(repo.connection(), &result)?;
    Ok(Some(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, TimeZone};
    fn at(day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .from_local_datetime(
                &NaiveDate::from_ymd_opt(2026, 10, day)
                    .unwrap()
                    .and_hms_opt(hour, minute, 0)
                    .unwrap(),
            )
            .single()
            .unwrap()
    }
    fn setup() -> (tempfile::TempDir, Repository, PathBuf) {
        let fixture_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".quality/workflow-update-20261003/storage/fixtures");
        fs::create_dir_all(&fixture_root).unwrap();
        let temp = tempfile::Builder::new()
            .prefix("automatic-backup-")
            .tempdir_in(fixture_root)
            .unwrap();
        let warehouse = temp.path().join("warehouse");
        let parent = temp.path().join("backup-parent");
        fs::create_dir(&parent).unwrap();
        let repo = Repository::open(warehouse.to_str().unwrap(), true).unwrap();
        (temp, repo, parent)
    }
    fn enable(repo: &Repository, parent: &Path) {
        setting_save(
            repo.connection(),
            AutoBackupSettings {
                enabled: true,
                parent_directory: Some(parent.to_string_lossy().into()),
                time: "20:00".into(),
            },
        )
        .unwrap();
    }
    fn namespace(repo: &Repository, parent: &Path) -> PathBuf {
        parent.canonicalize().unwrap().join(format!(
            ".perfboard-auto-{}",
            warehouse_id(repo.connection()).unwrap()
        ))
    }
    fn daily_dirs(root: &Path) -> Vec<PathBuf> {
        fs::read_dir(root)
            .unwrap()
            .filter_map(|entry| {
                let path = entry.unwrap().path();
                path.is_dir().then_some(path)
            })
            .collect()
    }
    #[test]
    fn defaults_disabled_strict_clock_and_current_day_only() {
        let (_temp, repo, parent) = setup();
        assert!(!setting_load(repo.connection()).unwrap().settings.enabled);
        assert!(run_due(&repo, at(1, 23, 59)).unwrap().is_none());
        assert!(!parent.join("unknown").exists());
        for time in ["8:00", "24:00", "12:60", "10:00:00", " 10:00", "aa:bb"] {
            assert!(hhmm(time).is_err());
        }
        assert!(setting_save(
            repo.connection(),
            AutoBackupSettings {
                enabled: true,
                parent_directory: None,
                time: "20:00".into()
            }
        )
        .is_err());
        enable(&repo, &parent);
        assert!(run_due(&repo, at(3, 19, 59)).unwrap().is_none());
        let result = run_due(&repo, at(3, 22, 0)).unwrap().unwrap();
        assert_eq!(result.day, "2026-10-03");
        assert_eq!(result.status, "success");
        assert!(run_due(&repo, at(3, 23, 30)).unwrap().is_none());
        assert_eq!(daily_dirs(&namespace(&repo, &parent)).len(), 1);
    }
    #[test]
    fn five_owned_backups_retained_manual_and_other_files_untouched() {
        let (_temp, repo, parent) = setup();
        let manual = parent.join("Manual user backup");
        fs::create_dir(&manual).unwrap();
        fs::write(manual.join("user.txt"), b"do not delete").unwrap();
        fs::write(parent.join("other.txt"), b"foreign").unwrap();
        enable(&repo, &parent);
        for day in 1..=7 {
            let result = run_due(&repo, at(day, 20, 0)).unwrap().unwrap();
            assert_eq!(result.status, "success", "{:?}", result.error);
            assert!(
                result.cleanup_warning.is_none(),
                "{:?}",
                result.cleanup_warning
            );
        }
        assert_eq!(daily_dirs(&namespace(&repo, &parent)).len(), MAX_BACKUPS);
        assert_eq!(fs::read(manual.join("user.txt")).unwrap(), b"do not delete");
        assert_eq!(fs::read(parent.join("other.txt")).unwrap(), b"foreign");
    }
    #[test]
    fn orphan_or_foreign_files_skip_all_cleanup_after_verified_new_backup() {
        let (_temp, repo, parent) = setup();
        enable(&repo, &parent);
        for day in 1..=5 {
            assert_eq!(
                run_due(&repo, at(day, 20, 0)).unwrap().unwrap().status,
                "success"
            );
        }
        let root = namespace(&repo, &parent);
        let old = daily_dirs(&root);
        fs::write(old[0].join("user-added.txt"), b"preserve").unwrap();
        let result = run_due(&repo, at(6, 20, 0)).unwrap().unwrap();
        assert_eq!(result.status, "success");
        assert!(result.cleanup_warning.is_some());
        assert_eq!(daily_dirs(&root).len(), 6);
        assert!(old.iter().all(|path| path.exists()));
        assert_eq!(
            fs::read(old[0].join("user-added.txt")).unwrap(),
            b"preserve"
        );
        fs::write(root.join("orphan.txt"), b"unknown").unwrap();
        let result = run_due(&repo, at(7, 20, 0)).unwrap().unwrap();
        assert!(result.cleanup_warning.is_some());
        assert_eq!(daily_dirs(&root).len(), 7);
        assert!(root.join("orphan.txt").exists());
    }
    #[test]
    fn failed_backup_preserves_old_backups_and_is_not_retried_today() {
        let (_temp, repo, parent) = setup();
        enable(&repo, &parent);
        for day in 1..=5 {
            assert_eq!(
                run_due(&repo, at(day, 20, 0)).unwrap().unwrap().status,
                "success"
            );
        }
        let root = namespace(&repo, &parent);
        let old = daily_dirs(&root);
        // A registered attachment is deliberately absent inside this isolated test warehouse.
        repo.connection().execute("INSERT INTO parts(id,name,category,package_name,parameters,stock_status,location,brief,url,created_at,updated_at) VALUES('test','test','','','','unknown','','','','now','now')", []).unwrap();
        repo.connection().execute("INSERT INTO attachments(id,part_id,name,mime,size,relative_path,kind,url) VALUES('missing','test','missing','image/png',3,'attachments/missing.png','file',NULL)", []).unwrap();
        let result = run_due(&repo, at(6, 20, 0)).unwrap().unwrap();
        assert_eq!(result.status, "failed");
        assert!(result.error.is_some());
        assert!(old.iter().all(|path| path.exists()));
        assert!(run_due(&repo, at(6, 23, 0)).unwrap().is_none());
    }
    #[test]
    fn switching_warehouses_has_separate_defaults_and_daily_results() {
        let (temp, repo, parent) = setup();
        enable(&repo, &parent);
        assert_eq!(
            run_due(&repo, at(3, 20, 0)).unwrap().unwrap().status,
            "success"
        );
        let other = Repository::open(temp.path().join("other").to_str().unwrap(), true).unwrap();
        assert!(!setting_load(other.connection()).unwrap().settings.enabled);
        assert!(run_due(&other, at(3, 21, 0)).unwrap().is_none());
        assert!(setting_load(other.connection())
            .unwrap()
            .last_result
            .is_none());
        enable(&other, &parent);
        assert_eq!(
            run_due(&other, at(3, 21, 0)).unwrap().unwrap().status,
            "success"
        );
        assert_ne!(namespace(&repo, &parent), namespace(&other, &parent));
    }
    #[test]
    fn manifest_escape_and_foreign_namespace_are_rejected() {
        let (_temp, repo, parent) = setup();
        enable(&repo, &parent);
        let root = namespace(&repo, &parent);
        fs::create_dir(&root).unwrap();
        fs::write(root.join("foreign.txt"), b"not ours").unwrap();
        let result = run_due(&repo, at(3, 20, 0)).unwrap().unwrap();
        assert_eq!(result.status, "failed");
        assert_eq!(fs::read(root.join("foreign.txt")).unwrap(), b"not ours");
        for name in ["../user", "/absolute", "", "attachments/../../user"] {
            assert!(relative(name).is_err());
        }
    }
    #[test]
    fn complete_backup_preserves_sqlite_payload_attachment_bytes_and_scene() {
        let (_temp, repo, parent) = setup();
        let scene = r#"{"type":"excalidraw","version":2,"source":"Perfboard","elements":[],"appState":{"name":" preserved "},"files":{}}"#;
        let document = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":" exact log payload "}]}]}"#;
        let conn = repo.connection();
        conn.execute("INSERT INTO notes(id,title,category,search_text,scene_json,created_at,updated_at) VALUES('note','scene','test','search',?1,'now','now')", [scene]).unwrap();
        conn.execute("INSERT INTO parts(id,name,category,package_name,parameters,stock_status,location,brief,url,created_at,updated_at) VALUES('part','part','','','','unknown','','','','now','now')", []).unwrap();
        let attachment = repo.root.join("attachments/fixture.png");
        fs::write(&attachment, b"attachment bytes\0exact").unwrap();
        conn.execute("INSERT INTO attachments(id,part_id,name,mime,size,relative_path,kind,url) VALUES('attachment','part','fixture','image/png',?1,'attachments/fixture.png','file',NULL)", [fs::metadata(&attachment).unwrap().len() as i64]).unwrap();
        save_setting(conn, "fixture.setting", " exact setting\nsecond line ").unwrap();
        crate::external_tools::save(
            conn,
            crate::external_tools::ExternalToolInput {
                id: None,
                name: " exact tool ".into(),
                path: parent.join("missing.exe").to_string_lossy().into(),
                description: " exact tool description\nsecond line ".into(),
            },
        )
        .unwrap();
        conn.execute("INSERT INTO dev_log_projects(id,title,position,revision,created_at,updated_at) VALUES('project','Project',0,1,'now','now')", []).unwrap();
        conn.execute("INSERT INTO dev_log_pages(id,project_id,title,document_json,schema_version,position,revision,created_at,updated_at) VALUES('page','project','Log',?1,1,0,1,'now','now')", [document]).unwrap();
        conn.execute("INSERT INTO dev_log_page_history(page_id,revision,title,document_json,schema_version,saved_at) VALUES('page',1,'Log',?1,1,'now')", [document]).unwrap();
        enable(&repo, &parent);
        let result = run_due(&repo, at(3, 20, 0)).unwrap().unwrap();
        assert_eq!(result.status, "success", "{:?}", result.error);
        let backup = PathBuf::from(result.backup_path.unwrap());
        Repository::validate(backup.to_str().unwrap()).unwrap();
        let saved = Connection::open_with_flags(
            backup.join("perfboard.sqlite3"),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let saved_scene: String = saved
            .query_row("SELECT scene_json FROM notes WHERE id='note'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(saved_scene, scene);
        let saved_document: String = saved
            .query_row(
                "SELECT document_json FROM dev_log_pages WHERE id='page'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(saved_document, document);
        let history_document: String = saved
            .query_row(
                "SELECT document_json FROM dev_log_page_history WHERE page_id='page'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(history_document, document);
        assert_eq!(
            setting(&saved, "fixture.setting").unwrap().unwrap(),
            " exact setting\nsecond line "
        );
        assert_eq!(
            fs::read(backup.join("attachments/fixture.png")).unwrap(),
            fs::read(attachment).unwrap()
        );
        let tool = crate::external_tools::list(&saved).unwrap().remove(0);
        assert_eq!(tool.name, " exact tool ");
        assert_eq!(tool.description, " exact tool description\nsecond line ");
        assert!(!tool.available);
    }
    #[test]
    fn interrupted_attempt_is_visible_and_still_once_per_day() {
        let (_temp, repo, parent) = setup();
        enable(&repo, &parent);
        let interrupted = AutoBackupResult {
            day: "2026-10-03".into(),
            attempted_at: at(3, 20, 0).to_rfc3339(),
            status: "running".into(),
            backup_path: None,
            error: None,
            cleanup_warning: None,
        };
        persist_result(repo.connection(), &interrupted).unwrap();
        recover_interrupted(repo.connection()).unwrap();
        let result = setting_load(repo.connection())
            .unwrap()
            .last_result
            .unwrap();
        assert_eq!(result.status, "failed");
        assert!(result.error.is_some());
        assert!(run_due(&repo, at(3, 22, 0)).unwrap().is_none());
        assert_eq!(
            run_due(&repo, at(4, 20, 0)).unwrap().unwrap().status,
            "success"
        );
    }
    #[test]
    fn user_can_disable_after_parent_directory_disappears() {
        let (_temp, repo, parent) = setup();
        enable(&repo, &parent);
        fs::remove_dir(&parent).unwrap();
        let mut settings = setting_load(repo.connection()).unwrap().settings;
        settings.enabled = false;
        assert!(
            !setting_save(repo.connection(), settings)
                .unwrap()
                .settings
                .enabled
        );
        assert!(run_due(&repo, at(3, 23, 0)).unwrap().is_none());
    }
    #[test]
    fn calendar_rollback_does_not_duplicate_an_earlier_attempt() {
        let (_temp, repo, parent) = setup();
        enable(&repo, &parent);
        assert_eq!(
            run_due(&repo, at(3, 20, 0)).unwrap().unwrap().status,
            "success"
        );
        assert_eq!(
            run_due(&repo, at(4, 20, 0)).unwrap().unwrap().status,
            "success"
        );
        assert!(!is_due(&repo, at(3, 23, 0)).unwrap());
        assert!(run_due(&repo, at(3, 23, 0)).unwrap().is_none());
        assert_eq!(daily_dirs(&namespace(&repo, &parent)).len(), 2);
    }
    #[test]
    fn same_size_payload_replacement_skips_all_retention() {
        let (_temp, repo, parent) = setup();
        enable(&repo, &parent);
        for day in 1..=5 {
            assert_eq!(
                run_due(&repo, at(day, 20, 0)).unwrap().unwrap().status,
                "success"
            );
        }
        let root = namespace(&repo, &parent);
        let old = daily_dirs(&root);
        let file = old[0].join("backup-manifest.json");
        let bytes = fs::read(&file).unwrap();
        let mut manifest: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let source = manifest
            .get("source")
            .and_then(|value| value.as_str())
            .unwrap()
            .to_string();
        let mut replacement = source.clone();
        let last = replacement.pop().unwrap();
        replacement.push(if last == 'x' { 'y' } else { 'x' });
        manifest["source"] = serde_json::Value::String(replacement);
        let altered = serde_json::to_vec_pretty(&manifest).unwrap();
        assert_eq!(altered.len(), bytes.len());
        assert_ne!(altered, bytes);
        fs::write(&file, altered).unwrap();
        let result = run_due(&repo, at(6, 20, 0)).unwrap().unwrap();
        assert_eq!(result.status, "success");
        assert!(result.cleanup_warning.is_some());
        assert!(old.iter().all(|directory| directory.exists()));
        assert_eq!(daily_dirs(&root).len(), 6);
    }
    #[test]
    fn failed_flush_is_visible_once_and_touches_no_backup_files() {
        let (_temp, repo, parent) = setup();
        enable(&repo, &parent);
        let result = record_flush_failure(&repo, at(3, 20, 0), "injected save failure".into())
            .unwrap()
            .unwrap();
        assert_eq!(result.status, "failed");
        assert!(result.error.unwrap().contains("injected save failure"));
        assert!(result.backup_path.is_none());
        assert!(!namespace(&repo, &parent).exists());
        assert!(run_due(&repo, at(3, 23, 0)).unwrap().is_none());
        assert!(
            record_flush_failure(&repo, at(3, 23, 0), "later failure".into())
                .unwrap()
                .is_none()
        );
        assert_eq!(
            setting_load(repo.connection())
                .unwrap()
                .last_result
                .unwrap()
                .status,
            "failed"
        );
    }
    #[cfg(windows)]
    #[test]
    fn junction_parent_is_rejected_without_deleting_target() {
        use std::process::Command;
        let (temp, repo, parent) = setup();
        let target = temp.path().join("junction-target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("user.txt"), b"preserve").unwrap();
        let junction = parent.join("junction");
        // The junction and its target are both isolated under the test's own temporary root.
        let fixture_root = temp.path().canonicalize().unwrap();
        assert!(target.canonicalize().unwrap().starts_with(&fixture_root));
        assert!(junction
            .parent()
            .unwrap()
            .canonicalize()
            .unwrap()
            .starts_with(&fixture_root));
        // CMD interprets mixed '/' separators as switches; pass ordinary native Windows paths.
        let command_path = |path: &Path| {
            let native = path.to_string_lossy().replace('/', "\\");
            native
                .strip_prefix("\\\\?\\")
                .unwrap_or(&native)
                .to_string()
        };
        let status = Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(command_path(&junction))
            .arg(command_path(&target))
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "project fixture junction creation failed; stdout={} stderr={}",
            String::from_utf8_lossy(&status.stdout),
            String::from_utf8_lossy(&status.stderr)
        );
        assert!(setting_save(
            repo.connection(),
            AutoBackupSettings {
                enabled: true,
                parent_directory: Some(junction.to_string_lossy().into()),
                time: "20:00".into()
            }
        )
        .is_err());
        assert_eq!(fs::read(target.join("user.txt")).unwrap(), b"preserve");
        fs::remove_dir(junction).unwrap();
    }
}
