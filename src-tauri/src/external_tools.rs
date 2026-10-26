//! External-tool records belong to the selected warehouse. Never execute during CRUD/import.
use crate::repository::workflow_storage::{save_setting, setting, warehouse_id};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

pub const SCHEMA_SQL: &str = "CREATE TABLE external_tools (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, description TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalToolInput {
    pub id: Option<String>,
    pub name: String,
    pub path: String,
    pub description: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct ToolRecord {
    id: String,
    name: String,
    path: String,
    description: String,
}
#[derive(Debug, Serialize)]
pub struct ExternalTool {
    pub id: String,
    pub name: String,
    pub path: String,
    pub description: String,
    pub available: bool,
    pub status: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    version: u32,
    tools: Vec<ToolRecord>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyConfig {
    superconnectx_path: serde_json::Value,
}
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportOutcome {
    pub imported: usize,
    pub skipped: usize,
    pub claimed_elsewhere: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ImportClaim {
    version: u32,
    warehouse_id: String,
    import_id: String,
}

pub fn validate_schema(conn: &Connection) -> Result<(), String> {
    conn.prepare(
        "SELECT id,name,path,description,created_at,updated_at FROM external_tools LIMIT 0",
    )
    .map(|_| ())
    .map_err(|error| error.to_string())
}
fn validate_text(name: &str, description: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 100 {
        return Err("请输入工具名称（最多 100 字）。".into());
    }
    if description.trim().is_empty() || description.chars().count() > 4000 {
        return Err("请输入应用介绍（最多 4000 字），便于搜索工具。".into());
    }
    Ok(())
}
/// Missing files are allowed in records after migration or repair. Syntax is always checked.
fn validate_local_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    #[cfg(windows)]
    if raw.get(2..).is_some_and(|suffix| suffix.contains(':')) {
        return Err("EXE 路径不能包含备用数据流。".into());
    }
    if raw.starts_with("\\\\")
        || raw.starts_with("//")
        || raw.contains('"')
        || raw.contains('\0')
        || raw.contains(['\r', '\n'])
        || !path.is_absolute()
        || !path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err("请选择本机绝对路径的 EXE 文件，不支持网络路径或脚本。".into());
    }
    Ok(path)
}
fn validate_executable(raw: &str) -> Result<PathBuf, String> {
    let path = validate_local_path(raw)?;
    let canonical = fs::canonicalize(path)
        .map_err(|_| "程序文件缺失或无法访问，请重新选择 EXE 路径。".to_string())?;
    if !canonical.is_file()
        || !canonical
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err("所选路径不是 EXE 文件，请重新选择。".into());
    }
    #[cfg(windows)]
    if canonical.to_string_lossy().starts_with("\\\\?\\UNC\\") {
        return Err("不支持网络程序路径。".into());
    }
    Ok(canonical)
}
fn view(record: ToolRecord) -> ExternalTool {
    let (available, status) = match validate_executable(&record.path) {
        Ok(_) => (true, "可启动".into()),
        Err(error) => (false, error),
    };
    ExternalTool {
        id: record.id,
        name: record.name,
        path: record.path,
        description: record.description,
        available,
        status,
    }
}
fn records(conn: &Connection) -> Result<Vec<ToolRecord>, String> {
    let mut stmt = conn
        .prepare("SELECT id,name,path,description FROM external_tools ORDER BY created_at,id")
        .map_err(|e| e.to_string())?;
    let result = stmt
        .query_map([], |row| {
            Ok(ToolRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                description: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}
pub fn list(conn: &Connection) -> Result<Vec<ExternalTool>, String> {
    Ok(records(conn)?.into_iter().map(view).collect())
}
pub fn save(conn: &Connection, tool: ExternalToolInput) -> Result<(), String> {
    validate_text(&tool.name, &tool.description)?;
    validate_local_path(&tool.path)?;
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(id) = tool.id {
        let changed = conn.execute("UPDATE external_tools SET name=?2,path=?3,description=?4,updated_at=?5 WHERE id=?1", params![id, tool.name, tool.path, tool.description, now]).map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("工具不存在，请刷新列表。".into());
        }
    } else {
        conn.execute("INSERT INTO external_tools(id,name,path,description,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)", params![uuid::Uuid::new_v4().to_string(), tool.name, tool.path, tool.description, now]).map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    if conn
        .execute("DELETE FROM external_tools WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        != 1
    {
        return Err("工具不存在，请刷新列表。".into());
    }
    Ok(())
}
fn launch_command(conn: &Connection, id: &str) -> Result<Command, String> {
    let path: String = conn
        .query_row("SELECT path FROM external_tools WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("工具不存在，请刷新列表。")?;
    let executable = validate_executable(&path)?;
    let mut command = Command::new(&executable);
    command.current_dir(executable.parent().ok_or("程序目录不存在")?);
    Ok(command)
}
/// Called only by the explicit user launch command after the warehouse lock is held.
pub fn launch(conn: &Connection, id: &str) -> Result<(), String> {
    launch_command(conn, id)?
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法启动工具：{error}"))
}
fn legacy_records(file: &Path) -> Result<Option<Vec<ToolRecord>>, String> {
    let bytes = match fs::read(file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let corrupt = || "旧外部工具配置损坏，原文件已保留，未导入。".to_string();
    let tools = if let Ok(config) = serde_json::from_slice::<Config>(&bytes) {
        if config.version != 1 {
            return Err("旧外部工具配置版本不受支持，原文件已保留。".into());
        }
        config.tools
    } else {
        let legacy: LegacyConfig = serde_json::from_slice(&bytes).map_err(|_| corrupt())?;
        let path: Option<String> =
            serde_json::from_value(legacy.superconnectx_path).map_err(|_| corrupt())?;
        path.into_iter()
            .filter(|path| !path.is_empty())
            .map(|path| ToolRecord {
                id: "legacy-superconnectx".into(),
                name: "SuperConnectX".into(),
                path,
                description: "串口调试工具，使用本机现有程序".into(),
            })
            .collect()
    };
    let mut ids = HashSet::new();
    for tool in &tools {
        // Preserve even an obsolete path: status displays the problem and allows repair.
        if tool.id.is_empty()
            || validate_text(&tool.name, &tool.description).is_err()
            || !ids.insert(&tool.id)
        {
            return Err(corrupt());
        }
    }
    Ok(Some(tools))
}
/// The app-config receipt claims a single warehouse BEFORE inserting any record.
/// A crash retries only that warehouse; the DB receipt makes a committed import idempotent.
/// The original JSON remains byte-for-byte unchanged, including on every failure.
pub fn migrate_legacy(conn: &Connection, config_dir: &Path) -> Result<LegacyImportOutcome, String> {
    validate_schema(conn)?;
    let claim_path = config_dir.join("external-tools-warehouse-import.json");
    let existing_claim = match fs::read(&claim_path) {
        Ok(bytes) => Some(
            serde_json::from_slice::<ImportClaim>(&bytes)
                .map_err(|_| "旧工具导入凭据损坏，未重复导入。".to_string())?,
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if let Some(claim) = &existing_claim {
        if claim.version != 1
            || uuid::Uuid::parse_str(&claim.import_id).is_err()
            || uuid::Uuid::parse_str(&claim.warehouse_id).is_err()
        {
            return Err("旧工具导入凭据无效，未重复导入。".into());
        }
        if claim.warehouse_id != warehouse_id(conn)? {
            return Ok(LegacyImportOutcome {
                claimed_elsewhere: true,
                ..Default::default()
            });
        }
        if setting(conn, "external_tools.legacy_import_id")?.as_deref()
            == Some(claim.import_id.as_str())
        {
            return Ok(LegacyImportOutcome::default());
        }
    }
    let prior_import = setting(conn, "external_tools.legacy_import_id")?;
    if let Some(id) = &prior_import {
        uuid::Uuid::parse_str(id).map_err(|_| "旧工具仓库导入凭据无效。".to_string())?;
    }
    let Some(tools) = legacy_records(&config_dir.join("external-tools.json"))? else {
        return Ok(LegacyImportOutcome::default());
    };
    let claim = if let Some(claim) = existing_claim {
        claim
    } else {
        let claim = ImportClaim {
            version: 1,
            warehouse_id: warehouse_id(conn)?,
            import_id: prior_import
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        };
        fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
        // Publish complete bytes atomically without replacing any existing receipt.
        // A failed or interrupted write leaves no claimed warehouse and cannot swallow records.
        let temporary = config_dir.join(format!(
            ".external-tools-import-{}.tmp",
            uuid::Uuid::new_v4()
        ));
        let publish = (|| -> Result<(), String> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| error.to_string())?;
            file.write_all(&serde_json::to_vec_pretty(&claim).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            drop(file);
            // Creating a hard link fails if claim_path already exists; unlike rename it never replaces it.
            fs::hard_link(&temporary, &claim_path)
                .map_err(|error| format!("无法保存旧工具导入凭据，未导入：{error}"))
        })();
        let _ = fs::remove_file(&temporary);
        publish?;
        claim
    };
    if prior_import.is_some() {
        return Ok(LegacyImportOutcome::default());
    }
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut current = records(&transaction)?;
    let mut outcome = LegacyImportOutcome::default();
    let now = chrono::Utc::now().to_rfc3339();
    for mut tool in tools {
        if current.iter().any(|record| {
            record.name == tool.name
                && record.path == tool.path
                && record.description == tool.description
        }) {
            outcome.skipped += 1;
            continue;
        }
        while current.iter().any(|record| record.id == tool.id) {
            tool.id = uuid::Uuid::new_v4().to_string();
        }
        transaction.execute("INSERT INTO external_tools(id,name,path,description,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)", params![tool.id, tool.name, tool.path, tool.description, now]).map_err(|e| e.to_string())?;
        current.push(tool);
        outcome.imported += 1;
    }
    save_setting(
        &transaction,
        "external_tools.legacy_import_id",
        &claim.import_id,
    )?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tempdir() -> tempfile::TempDir {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".quality/workflow-update-20261003/storage/fixtures");
        fs::create_dir_all(&root).unwrap();
        tempfile::Builder::new()
            .prefix("external-tools-")
            .tempdir_in(root)
            .unwrap()
    }
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);")
            .unwrap();
        conn.execute_batch(SCHEMA_SQL).unwrap();
        conn
    }
    fn input(path: &Path) -> ExternalToolInput {
        ExternalToolInput {
            id: None,
            name: "  工具名称  ".into(),
            path: path.to_string_lossy().into(),
            description: "  应用介绍\n第二行  ".into(),
        }
    }
    #[test]
    fn warehouse_crud_keeps_exact_text_missing_records_and_never_runs() {
        let temp = tempdir();
        let exe = temp.path().join("Local app.EXE");
        fs::write(&exe, b"test fixture; never executed").unwrap();
        let conn = db();
        let other = db();
        let source = input(&exe);
        save(&conn, source.clone()).unwrap();
        let first = list(&conn).unwrap().remove(0);
        assert_eq!(first.name, source.name);
        assert_eq!(first.description, source.description);
        assert_eq!(first.path, source.path);
        assert!(list(&other).unwrap().is_empty());
        let command = launch_command(&conn, &first.id).unwrap();
        assert_eq!(command.get_program(), fs::canonicalize(&exe).unwrap());
        assert_eq!(command.get_args().count(), 0);
        fs::remove_file(&exe).unwrap();
        let missing = list(&conn).unwrap().remove(0);
        assert!(!missing.available);
        assert!(missing.status.contains("缺失"));
        assert!(launch_command(&conn, &first.id).is_err());
        let mut edit = source;
        edit.id = Some(first.id.clone());
        edit.description = "  Description preserved while missing  ".into();
        save(&conn, edit).unwrap();
        assert_eq!(
            list(&conn).unwrap()[0].description,
            "  Description preserved while missing  "
        );
        let repaired = temp.path().join("repaired.exe");
        fs::write(&repaired, []).unwrap();
        let mut repair = input(&repaired);
        repair.id = Some(first.id.clone());
        save(&conn, repair).unwrap();
        assert!(list(&conn).unwrap()[0].available);
        delete(&conn, &first.id).unwrap();
        assert!(repaired.exists());
        assert!(list(&conn).unwrap().is_empty());
    }
    #[test]
    fn unsafe_paths_rejected_but_absolute_missing_exe_saved() {
        let conn = db();
        let temp = tempdir();
        let missing = temp.path().join("missing.exe");
        save(&conn, input(&missing)).unwrap();
        assert!(!list(&conn).unwrap()[0].available);
        for raw in [
            "tool.exe",
            "https://host/tool.exe",
            "\\\\host\\tool.exe",
            "//host/tool.exe",
            "C:tool.exe",
            "\"C:\\tool.exe\"",
            "C:\\tool\0.exe",
            "C:\\tool.cmd",
            "C:\\tool.exe --args",
        ] {
            assert!(validate_local_path(raw).is_err(), "{raw:?}");
        }
    }
    #[test]
    fn legacy_import_is_once_preserves_source_collision_and_existing_entries() {
        let temp = tempdir();
        let conn = db();
        let other = db();
        let original = br#"{"version":1,"tools":[{"id":"collision","name":" Original ","path":"C:/missing/tool.exe","description":" exact description "},{"id":"duplicate","name":"Existing","path":"C:/existing.exe","description":"existing introduction"}]}"#;
        fs::write(temp.path().join("external-tools.json"), original).unwrap();
        conn.execute("INSERT INTO external_tools VALUES('collision','Existing','C:/existing.exe','existing introduction','before','before')", []).unwrap();
        let imported = migrate_legacy(&conn, temp.path()).unwrap();
        assert_eq!(imported.imported, 1);
        assert_eq!(imported.skipped, 1);
        let tools = list(&conn).unwrap();
        assert_eq!(tools.len(), 2);
        let old = tools.iter().find(|tool| tool.id == "collision").unwrap();
        assert_eq!(old.name, "Existing");
        let migrated = tools.iter().find(|tool| tool.name == " Original ").unwrap();
        assert_ne!(migrated.id, "collision");
        assert!(!migrated.available);
        assert_eq!(migrated.description, " exact description ");
        assert_eq!(migrate_legacy(&conn, temp.path()).unwrap().imported, 0);
        assert!(
            migrate_legacy(&other, temp.path())
                .unwrap()
                .claimed_elsewhere
        );
        assert!(list(&other).unwrap().is_empty());
        assert_eq!(
            fs::read(temp.path().join("external-tools.json")).unwrap(),
            original
        );
        // Restored DB keeps its receipt and cannot import a second time on a new machine.
        let fresh_config = tempdir();
        fs::write(fresh_config.path().join("external-tools.json"), original).unwrap();
        assert_eq!(
            migrate_legacy(&conn, fresh_config.path()).unwrap().imported,
            0
        );
        assert_eq!(list(&conn).unwrap().len(), 2);
        assert!(
            migrate_legacy(&other, fresh_config.path())
                .unwrap()
                .claimed_elsewhere
        );
    }
    #[test]
    fn corrupted_legacy_config_is_not_claimed_or_changed() {
        let temp = tempdir();
        let conn = db();
        let file = temp.path().join("external-tools.json");
        for bytes in ["broken", "{}", "{\"version\":99,\"tools\":[]}", "{\"superconnectx_path\":false}", "{\"version\":1,\"tools\":[{\"id\":\"x\",\"name\":\"x\",\"path\":\"bad\",\"description\":\"\"}]}"] { fs::write(&file, bytes).unwrap(); assert!(migrate_legacy(&conn, temp.path()).is_err()); assert_eq!(fs::read(&file).unwrap(), bytes.as_bytes()); assert!(!temp.path().join("external-tools-warehouse-import.json").exists()); assert!(list(&conn).unwrap().is_empty()); }
    }
    #[test]
    fn interrupted_claim_resumes_only_in_the_same_warehouse() {
        let temp = tempdir();
        let conn = db();
        let other = db();
        let claim = ImportClaim {
            version: 1,
            warehouse_id: warehouse_id(&conn).unwrap(),
            import_id: uuid::Uuid::new_v4().to_string(),
        };
        fs::write(
            temp.path().join("external-tools-warehouse-import.json"),
            serde_json::to_vec(&claim).unwrap(),
        )
        .unwrap();
        fs::write(
            temp.path().join("external-tools.json"),
            br#"{"superconnectx_path":"C:/missing/tool.exe"}"#,
        )
        .unwrap();
        assert!(
            migrate_legacy(&other, temp.path())
                .unwrap()
                .claimed_elsewhere
        );
        assert_eq!(migrate_legacy(&conn, temp.path()).unwrap().imported, 1);
        assert_eq!(migrate_legacy(&conn, temp.path()).unwrap().imported, 0);
    }
}
