pub(crate) mod workflow_storage;
use crate::models::*;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

pub type AppResult<T> = Result<T, String>;
const DB_NAME: &str = "perfboard.sqlite3";
const APP_ID: i64 = 0x50464244;
const SCHEMA_VERSION: i64 = 6;
const EMPTY_SCENE: &str = r#"{"type":"excalidraw","version":2,"source":"Perfboard","elements":[],"appState":{},"files":{}}"#;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn input_id(id: String) -> String {
    if id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        id
    }
}
fn required(value: &str, label: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    Ok(())
}
pub fn validate_url(raw: &str) -> AppResult<String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "Invalid URL".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Only http:// and https:// URLs may be opened".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("URLs containing credentials are not allowed".into());
    }
    Ok(parsed.to_string())
}
fn user_path(path: &str) -> AppResult<PathBuf> {
    required(path, "Repository path")?;
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("Choose an absolute directory path".into());
    }
    Ok(p)
}
fn canonical_repository_root(root: &Path) -> AppResult<PathBuf> {
    let resolved = root.canonicalize().map_err(err)?;
    if resolved != root || !resolved.is_dir() {
        return Err(
            "Repository directory has been replaced or redirected. Reopen its actual location."
                .into(),
        );
    }
    Ok(resolved)
}
fn validated_attachment_directory(root: &Path) -> AppResult<PathBuf> {
    let canonical_root = canonical_repository_root(root)?;
    let attachment_root = canonical_root
        .join("attachments")
        .canonicalize()
        .map_err(err)?;
    if !attachment_root.starts_with(&canonical_root) || !attachment_root.is_dir() {
        return Err("Attachment directory escapes repository".into());
    }
    Ok(attachment_root)
}
fn safe_attachment(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let rel = Path::new(relative);
    if rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Invalid attachment relative path".into());
    }
    // Recheck both containment boundaries for every operation, including after a
    // directory was replaced by an externally created junction.
    let attachment_root = validated_attachment_directory(root)?;
    let path = root.join(rel).canonicalize().map_err(err)?;
    if !path.starts_with(&attachment_root) || !path.is_file() {
        return Err("Attachment does not resolve inside this repository".into());
    }
    Ok(path)
}
fn attachment_directory(root: &Path) -> AppResult<PathBuf> {
    let canonical_root = canonical_repository_root(root)?;
    fs::create_dir_all(canonical_root.join("attachments")).map_err(err)?;
    validated_attachment_directory(root)
}
fn allowed_extension(path: &Path) -> AppResult<String> {
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "pdf"
    ) {
        return Err("Only PNG, JPEG, WebP, GIF and PDF attachments are supported".into());
    }
    Ok(ext)
}

pub struct Repository {
    pub root: PathBuf,
    conn: Connection,
}
impl Repository {
    pub fn validate(path: &str) -> AppResult<()> {
        let root = user_path(path)?;
        if !root.is_dir() || !root.join(DB_NAME).is_file() {
            return Err("Repository directory or database is missing".into());
        }
        let conn =
            Connection::open_with_flags(root.join(DB_NAME), OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(err)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        Self::validate_schema(&conn)
    }
    pub fn open(path: &str, create: bool) -> AppResult<Self> {
        let requested = user_path(path)?;
        if !requested.exists() {
            if !create {
                return Err("Repository directory is missing. Choose its current location or restore a backup.".into());
            }
            fs::create_dir_all(&requested).map_err(err)?;
        }
        if !requested.is_dir() {
            return Err("Repository path is not a directory".into());
        }
        let root = requested.canonicalize().map_err(err)?;
        let db = root.join(DB_NAME);
        let new = !db.exists();
        if new {
            if !create {
                return Err(
                    "Repository database is missing. No empty database was created.".into(),
                );
            }
            if fs::read_dir(&root).map_err(err)?.next().is_some() {
                return Err(
                    "Cannot initialize a non-empty directory without a Perfboard database".into(),
                );
            }
        } else if !db.is_file() {
            return Err("Repository database is not a file".into());
        }
        if !new {
            let metadata = fs::symlink_metadata(&db).map_err(err)?;
            #[cfg(windows)]
            let redirected = {
                use std::os::windows::fs::MetadataExt;
                metadata.file_attributes() & 0x400 != 0
            };
            #[cfg(not(windows))]
            let redirected = metadata.file_type().is_symlink();
            if redirected || db.canonicalize().map_err(err)?.parent() != Some(root.as_path()) {
                return Err(
                    "Repository database has been redirected; reopen its actual directory".into(),
                );
            }
        }
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | if new {
                OpenFlags::SQLITE_OPEN_CREATE
            } else {
                OpenFlags::empty()
            };
        let conn = Connection::open_with_flags(&db, flags).map_err(err)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        if new {
            conn.execute_batch(&format!(r#"
                BEGIN IMMEDIATE;
                PRAGMA application_id = {APP_ID};
                PRAGMA user_version = 2;
                CREATE TABLE parts (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
                    package_name TEXT NOT NULL, parameters TEXT NOT NULL,
                    stock_status TEXT NOT NULL CHECK(stock_status IN ('in_stock','low','out_of_stock','unknown')),
                    quantity REAL CHECK(quantity IS NULL OR quantity >= 0),
                    location TEXT NOT NULL, brief TEXT NOT NULL, url TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lcsc_number TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '');
                CREATE TABLE notes (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
                    search_text TEXT NOT NULL, scene_json TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE attachments (
                    id TEXT PRIMARY KEY, part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
                    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL CHECK(size >= 0),
                    relative_path TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('file','url')), url TEXT);
                CREATE INDEX attachments_part ON attachments(part_id);
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                COMMIT;
            "#)).map_err(err)?;
        }
        Self::validate_schema(&conn)?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )
        .map_err(err)?;
        attachment_directory(&root)?;
        let backups = root.join("backups");
        fs::create_dir_all(&backups).map_err(err)?;
        if !backups.canonicalize().map_err(err)?.starts_with(&root) {
            return Err("Backup directory escapes repository".into());
        }
        let repo = Self { root, conn };
        repo.migrate_workflow(new)?;
        Self::validate_schema(&repo.conn)?;
        Ok(repo)
    }
    fn validate_schema(conn: &Connection) -> AppResult<()> {
        let app_id: i64 = conn
            .query_row("PRAGMA application_id", [], |r| r.get(0))
            .map_err(err)?;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        if app_id != APP_ID {
            return Err("This database is not a Perfboard repository".into());
        }
        if !(1..=SCHEMA_VERSION).contains(&version) {
            return Err(format!(
                "Unsupported repository schema {version}; expected {SCHEMA_VERSION}"
            ));
        }
        let integrity: String = conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(err)?;
        if integrity != "ok" {
            return Err(format!("Repository integrity check failed: {integrity}"));
        }
        // Preparing explicit column lists also rejects incomplete or incompatible schemas.
        for sql in [
            "SELECT id,name,category,package_name,parameters,stock_status,quantity,location,brief,url,created_at,updated_at FROM parts LIMIT 0",
            "SELECT id,title,category,search_text,scene_json,created_at,updated_at FROM notes LIMIT 0",
            "SELECT id,part_id,name,mime,size,relative_path,kind,url FROM attachments LIMIT 0",
            "SELECT key,value FROM settings LIMIT 0"
        ] { conn.prepare(sql).map_err(err)?; }
        if version >= 2 {
            conn.prepare("SELECT lcsc_number,brand FROM parts LIMIT 0")
                .map_err(err)?;
        }
        if version >= 3 {
            conn.prepare("SELECT revision FROM notes LIMIT 0")
                .map_err(err)?;
            crate::external_tools::validate_schema(conn)?;
            conn.prepare(
                "SELECT id,document_json,schema_version,revision FROM dev_log_pages LIMIT 0",
            )
            .map_err(err)?;
            conn.prepare("SELECT id,revision FROM dev_log_projects LIMIT 0")
                .map_err(err)?;
            conn.prepare("SELECT page_id,revision,document_json FROM dev_log_page_history LIMIT 0")
                .map_err(err)?;
        }
        if version >= 4 {
            crate::transformer_designs::validate_schema(conn)?;
        }
        if version >= 5 {
            crate::log_resources::validate_schema(conn)?;
        }
        if version >= 6 {
            crate::dev_logs::validate_folder_schema(conn)?;
        }
        Ok(())
    }
    fn migrate_workflow(&self, new: bool) -> AppResult<()> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        if version == SCHEMA_VERSION {
            return Ok(());
        }
        // A complete old-schema snapshot precedes the first database mutation.
        if !new {
            let destination = self.root.join("backups").join(format!(
                "pre-migration-v{version}-to-v{SCHEMA_VERSION}-{}-{}",
                chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
                Uuid::new_v4()
            ));
            self.backup(&destination.to_string_lossy())?;
        }
        self.conn.execute_batch("BEGIN IMMEDIATE").map_err(err)?;
        let result = (|| -> AppResult<()> {
            if version == 1 {
                self.conn.execute_batch("ALTER TABLE parts ADD COLUMN lcsc_number TEXT NOT NULL DEFAULT ''; ALTER TABLE parts ADD COLUMN brand TEXT NOT NULL DEFAULT ''; UPDATE parts SET brief = CASE WHEN brief = '' THEN '历史参数：' || parameters ELSE brief || char(10) || '历史参数：' || parameters END WHERE trim(parameters) != '' AND trim(parameters) != trim(name) AND instr(brief, parameters) = 0;").map_err(err)?;
            }
            if version < 3 {
                self.conn.execute_batch("ALTER TABLE notes ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);").map_err(err)?;
                self.conn
                    .execute_batch(crate::external_tools::SCHEMA_SQL)
                    .map_err(err)?;
                crate::dev_logs::create_schema(&self.conn)?;
                workflow_storage::warehouse_id(&self.conn)?;
            }
            crate::transformer_designs::create_schema(&self.conn)?;
            crate::log_resources::create_schema(&self.conn)?;
            crate::dev_logs::create_folder_schema(&self.conn)?;
            self.conn
                .execute_batch("PRAGMA user_version=6;")
                .map_err(err)?;
            Self::validate_schema(&self.conn)?;
            Ok(())
        })();
        match result {
            Ok(()) => self.conn.execute_batch("COMMIT").map_err(err),
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }
    pub(crate) fn connection(&self) -> &Connection {
        &self.conn
    }
    pub(crate) fn connection_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }
    pub fn ensure_available(&self) -> AppResult<()> {
        let canonical_root = canonical_repository_root(&self.root)?;
        if !self.root.join(DB_NAME).is_file() {
            return Err("Repository is unavailable. Locate it or restore a backup; no new database was created.".into());
        }
        let database = self.root.join(DB_NAME).canonicalize().map_err(err)?;
        if !database.starts_with(&canonical_root) {
            return Err("Repository database escapes repository".into());
        }
        Ok(())
    }
    pub fn snapshot(&mut self) -> AppResult<Snapshot> {
        self.ensure_available()?;
        let tx = self.conn.transaction().map_err(err)?;
        let parts = {
            let mut stmt = tx.prepare("SELECT id,name,category,package_name,parameters,stock_status,quantity,location,brief,url,created_at,updated_at,lcsc_number,brand FROM parts ORDER BY updated_at DESC,id").map_err(err)?;
            let result = stmt
                .query_map([], part_row)
                .map_err(err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(err)?;
            result
        };
        let notes = {
            let mut stmt = tx.prepare("SELECT id,title,category,search_text,created_at,updated_at,revision FROM notes ORDER BY updated_at DESC,id").map_err(err)?;
            let result = stmt
                .query_map([], |r| {
                    Ok(NoteSummary {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        category: r.get(2)?,
                        search_text: r.get(3)?,
                        created_at: r.get(4)?,
                        updated_at: r.get(5)?,
                        revision: r.get(6)?,
                    })
                })
                .map_err(err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(err)?;
            result
        };
        let attachments = {
            let mut stmt = tx.prepare("SELECT id,part_id,name,mime,size,relative_path,kind,url FROM attachments ORDER BY name,id").map_err(err)?;
            let result = stmt
                .query_map([], attachment_row)
                .map_err(err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(err)?;
            result
        };
        let settings = {
            let mut stmt = tx
                .prepare("SELECT key,value FROM settings ORDER BY key")
                .map_err(err)?;
            let result = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(err)?
                .collect::<Result<BTreeMap<_, _>, _>>()
                .map_err(err)?;
            result
        };
        tx.commit().map_err(err)?;
        Ok(Snapshot {
            parts,
            notes,
            attachments,
            settings,
        })
    }
    pub fn part_save(&mut self, input: PartInput) -> AppResult<Part> {
        self.ensure_available()?;
        required(&input.name, "Part name")?;
        if !matches!(
            input.stock_status.as_str(),
            "in_stock" | "low" | "out_of_stock" | "unknown"
        ) {
            return Err("Invalid stock status".into());
        }
        if input.quantity.is_some_and(|q| !q.is_finite() || q < 0.0) {
            return Err("Quantity must be nonnegative or empty".into());
        }
        if !input.url.trim().is_empty() {
            validate_url(&input.url)?;
        }
        let id = input_id(input.id);
        let now = timestamp();
        self.conn.execute(r#"INSERT INTO parts (id,name,category,package_name,parameters,stock_status,quantity,location,brief,url,created_at,updated_at,lcsc_number,brand) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?12,?13)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category,
            package_name=excluded.package_name, parameters=excluded.parameters, stock_status=excluded.stock_status,
            quantity=excluded.quantity, location=excluded.location, brief=excluded.brief,
            url=excluded.url, lcsc_number=excluded.lcsc_number, brand=excluded.brand, updated_at=excluded.updated_at"#,
            params![id,input.name,input.category,input.package_name,input.parameters,input.stock_status,input.quantity,input.location,input.brief,input.url,now,input.lcsc_number,input.brand]).map_err(err)?;
        self.conn.query_row("SELECT id,name,category,package_name,parameters,stock_status,quantity,location,brief,url,created_at,updated_at,lcsc_number,brand FROM parts WHERE id=?1", [id], part_row).map_err(err)
    }
    pub fn part_delete(&mut self, id: &str) -> AppResult<()> {
        self.ensure_available()?;
        // Remove only rows. Imported copies may remain until an explicit attachment delete;
        // source files are never moved or removed, and dangling files cannot break a commit.
        self.conn
            .execute("DELETE FROM parts WHERE id=?1", [id])
            .map_err(err)?;
        Ok(())
    }
    pub fn note_get(&self, id: &str) -> AppResult<Note> {
        self.ensure_available()?;
        self.conn.query_row("SELECT id,title,category,search_text,scene_json,created_at,updated_at,revision FROM notes WHERE id=?1", [id], note_row).optional().map_err(err)?.ok_or_else(|| "Note not found".into())
    }
    pub fn note_save(&mut self, input: NoteInput) -> AppResult<Note> {
        self.ensure_available()?;
        required(&input.title, "Note title")?;
        if !matches!(
            input.category.as_str(),
            "硬件错题本" | "软件错题本" | "随笔" | "学习笔记"
        ) {
            return Err("Invalid note category".into());
        }
        let id = input_id(input.id);
        let existing = self
            .conn
            .query_row(
                "SELECT scene_json,revision FROM notes WHERE id=?1",
                [&id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(err)?;
        let revision = existing.as_ref().map(|item| item.1).unwrap_or(0);
        let expected = input.expected_revision.unwrap_or(revision);
        if expected != revision {
            return Err("笔记已被修改，当前草稿已保留，请重新载入后重试。".into());
        }
        let scene = input.scene_json.unwrap_or_else(|| {
            existing
                .map(|item| item.0)
                .unwrap_or_else(|| EMPTY_SCENE.to_owned())
        });
        let parsed: serde_json::Value =
            serde_json::from_str(&scene).map_err(|e| format!("Invalid Excalidraw JSON: {e}"))?;
        if !parsed.get("elements").is_some_and(|v| v.is_array())
            || !parsed.get("appState").is_some_and(|v| v.is_object())
            || !parsed.get("files").is_some_and(|v| v.is_object())
        {
            return Err("Excalidraw scene must contain elements, appState and files".into());
        }
        let now = timestamp();
        let changed = self.conn.execute(r#"INSERT INTO notes (id,title,category,search_text,scene_json,created_at,updated_at,revision) VALUES (?1,?2,?3,?4,?5,?6,?6,1)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,
            search_text=excluded.search_text,scene_json=excluded.scene_json,updated_at=excluded.updated_at,revision=notes.revision+1 WHERE notes.revision=?7"#,
            params![id,input.title,input.category,input.search_text,scene,now,expected]).map_err(err)?;
        if changed != 1 {
            return Err("笔记版本冲突，当前草稿已保留。".into());
        }
        self.note_get(&id)
    }
    pub fn note_delete(&mut self, id: &str) -> AppResult<()> {
        self.ensure_available()?;
        self.conn
            .execute("DELETE FROM notes WHERE id=?1", [id])
            .map_err(err)?;
        Ok(())
    }
    fn require_part(&self, id: &str) -> AppResult<()> {
        self.ensure_available()?;
        let exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM parts WHERE id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists {
            return Err("Part not found".into());
        }
        Ok(())
    }
    pub fn attachment_import(&mut self, part_id: &str, source_path: &str) -> AppResult<Attachment> {
        self.require_part(part_id)?;
        let source = user_path(source_path)?.canonicalize().map_err(err)?;
        if !source.is_file() {
            return Err("Attachment source is not a file".into());
        }
        let ext = allowed_extension(&source)?;
        let name = source
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or("Invalid attachment filename")?
            .to_owned();
        let id = Uuid::new_v4().to_string();
        let relative_path = format!("attachments/{id}.{ext}");
        let dest = attachment_directory(&self.root)?.join(format!("{id}.{ext}"));
        let size = fs::copy(&source, &dest).map_err(err)?;
        let item = Attachment {
            id,
            part_id: part_id.into(),
            name,
            mime: mime_guess::from_path(&source)
                .first_or_octet_stream()
                .to_string(),
            size,
            relative_path,
            kind: "file".into(),
            url: None,
        };
        if let Err(e) = self.insert_attachment(&item) {
            let _ = fs::remove_file(&dest);
            return Err(e);
        }
        Ok(item)
    }
    fn insert_attachment(&self, a: &Attachment) -> AppResult<()> {
        self.conn
            .execute(
                "INSERT INTO attachments VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    a.id,
                    a.part_id,
                    a.name,
                    a.mime,
                    a.size,
                    a.relative_path,
                    a.kind,
                    a.url
                ],
            )
            .map_err(err)?;
        Ok(())
    }
    pub fn attachment_add_url(
        &mut self,
        part_id: &str,
        url: &str,
        name: &str,
    ) -> AppResult<Attachment> {
        self.require_part(part_id)?;
        let url = validate_url(url)?;
        let item = Attachment {
            id: Uuid::new_v4().to_string(),
            part_id: part_id.into(),
            name: if name.trim().is_empty() {
                url.clone()
            } else {
                name.into()
            },
            mime: "text/uri-list".into(),
            size: 0,
            relative_path: String::new(),
            kind: "url".into(),
            url: Some(url),
        };
        self.insert_attachment(&item)?;
        Ok(item)
    }
    pub fn attachment_get(&self, id: &str) -> AppResult<Attachment> {
        self.ensure_available()?;
        self.conn.query_row("SELECT id,part_id,name,mime,size,relative_path,kind,url FROM attachments WHERE id=?1", [id], attachment_row).optional().map_err(err)?.ok_or_else(|| "Attachment not found".into())
    }
    pub fn attachment_target(&self, id: &str) -> AppResult<String> {
        let item = self.attachment_get(id)?;
        if item.kind == "url" {
            return validate_url(item.url.as_deref().ok_or("Missing URL")?);
        }
        let target = safe_attachment(&self.root, &item.relative_path)?;
        allowed_extension(&target)?;
        Ok(target.to_string_lossy().into_owned())
    }
    pub fn attachment_delete(&mut self, id: &str) -> AppResult<()> {
        let item = self.attachment_get(id)?;
        if item.kind == "file" {
            validated_attachment_directory(&self.root)?;
        }
        // A missing imported copy does not prevent deletion; do not touch source paths.
        let target = if item.kind == "file" && self.root.join(&item.relative_path).exists() {
            Some(safe_attachment(&self.root, &item.relative_path)?)
        } else {
            None
        };
        self.conn
            .execute("DELETE FROM attachments WHERE id=?1", [id])
            .map_err(err)?;
        if let Some(path) = target {
            let _ = fs::remove_file(path);
        }
        Ok(())
    }
    pub fn setting_save(&mut self, key: &str, value: &str) -> AppResult<()> {
        self.ensure_available()?;
        required(key, "Setting key")?;
        self.conn.execute("INSERT INTO settings VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(err)?;
        Ok(())
    }
    pub fn backup(&self, destination: &str) -> AppResult<String> {
        validated_attachment_directory(&self.root)?;
        self.ensure_available()?;
        let requested = user_path(destination)?;
        if requested.exists() {
            return Err(
                "Choose a new backup directory; existing directories are not overwritten".into(),
            );
        }
        let parent = requested
            .parent()
            .ok_or("Invalid backup destination")?
            .canonicalize()
            .map_err(err)?;
        let name = requested
            .file_name()
            .ok_or("Invalid backup directory name")?;
        let dest = parent.join(name);
        if dest.starts_with(self.root.join("attachments")) {
            return Err("Backup cannot be inside attachments".into());
        }
        fs::create_dir(&dest).map_err(err)?;
        let result = (|| -> AppResult<()> {
            let mut target = Connection::open(dest.join(DB_NAME)).map_err(err)?;
            {
                let backup = rusqlite::backup::Backup::new(&self.conn, &mut target).map_err(err)?;
                backup
                    .run_to_completion(128, Duration::from_millis(10), None)
                    .map_err(err)?;
            }
            // A completed backup is standalone: source WAL remains untouched.
            target
                .execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")
                .map_err(err)?;
            Self::validate_schema(&target)?;
            fs::create_dir(dest.join("attachments")).map_err(err)?;
            let mut stmt = target
                .prepare("SELECT relative_path FROM attachments WHERE kind='file'")
                .map_err(err)?;
            let paths = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(err)?;
            for relative in paths {
                let source = safe_attachment(&self.root, &relative)?;
                let target = dest.join(&relative);
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(err)?;
                }
                fs::copy(&source, &target).map_err(err)?;
                if file_digest(&source)? != file_digest(&target)? {
                    return Err("Attachment backup content differs from source".into());
                }
            }
            fs::create_dir(dest.join("backups")).map_err(err)?;
            fs::write(dest.join("backup-manifest.json"),serde_json::to_vec_pretty(&serde_json::json!({"version":1,"createdAt":timestamp(),"source":self.root,"database":DB_NAME})).map_err(err)?).map_err(err)?;
            Ok(())
        })();
        if let Err(e) = result {
            // Keep partial data for inspection; never report an incomplete backup as success.
            return Err(format!("Backup incomplete at {}: {e}", dest.display()));
        }
        Ok(dest.to_string_lossy().into_owned())
    }
}
fn file_digest(path: &Path) -> AppResult<Vec<u8>> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(err)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(err)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hash.finalize().to_vec())
}
fn part_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Part> {
    Ok(Part {
        id: r.get(0)?,
        name: r.get(1)?,
        category: r.get(2)?,
        package_name: r.get(3)?,
        parameters: r.get(4)?,
        lcsc_number: r.get(12)?,
        brand: r.get(13)?,
        stock_status: r.get(5)?,
        quantity: r.get(6)?,
        location: r.get(7)?,
        brief: r.get(8)?,
        url: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}
fn note_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        title: r.get(1)?,
        category: r.get(2)?,
        search_text: r.get(3)?,
        scene_json: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
        revision: r.get(7)?,
    })
}
fn attachment_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: r.get(0)?,
        part_id: r.get(1)?,
        name: r.get(2)?,
        mime: r.get(3)?,
        size: r.get(4)?,
        relative_path: r.get(5)?,
        kind: r.get(6)?,
        url: r.get(7)?,
    })
}

pub struct RepositoryManager {
    config_dir: PathBuf,
    pub repository: Option<Repository>,
    configured: bool,
    configured_path: Option<String>,
    load_error: Option<String>,
}
impl RepositoryManager {
    pub fn load(config_dir: PathBuf) -> Self {
        let mut manager = Self {
            config_dir,
            repository: None,
            configured: false,
            configured_path: None,
            load_error: None,
        };
        let pointer_path = manager.config_dir.join("repository.json");
        if !pointer_path.exists() {
            return manager;
        }
        manager.configured = true;
        let loaded = (|| -> AppResult<Repository> {
            let pointer: RepositoryPointer =
                serde_json::from_slice(&fs::read(pointer_path).map_err(err)?)
                    .map_err(|e| format!("Invalid repository pointer: {e}"))?;
            manager.configured_path = Some(pointer.path.clone());
            if pointer.version != 1 {
                return Err(format!(
                    "Unsupported repository pointer version {}",
                    pointer.version
                ));
            }
            let repo = Repository::open(&pointer.path, false)?;
            crate::external_tools::migrate_legacy(repo.connection(), &manager.config_dir)?;
            crate::backup_scheduler::recover_interrupted(repo.connection())?;
            Ok(repo)
        })();
        match loaded {
            Ok(repo) => manager.repository = Some(repo),
            Err(e) => manager.load_error = Some(e),
        }
        manager
    }
    pub fn status(&self) -> RepoStatus {
        let error = self
            .repository
            .as_ref()
            .and_then(|r| r.ensure_available().err())
            .or_else(|| self.load_error.clone());
        RepoStatus {
            configured: self.configured,
            ready: self.repository.is_some() && error.is_none(),
            path: self.configured_path.clone(),
            error,
        }
    }
    pub fn open(&mut self, path: &str, create: bool) -> AppResult<RepoStatus> {
        let repo = Repository::open(path, create)?;
        crate::external_tools::migrate_legacy(repo.connection(), &self.config_dir)?;
        crate::backup_scheduler::recover_interrupted(repo.connection())?;
        let canonical = repo.root.to_string_lossy().into_owned();
        fs::create_dir_all(&self.config_dir).map_err(err)?;
        let temp = self
            .config_dir
            .join(format!("repository-{}.tmp", Uuid::new_v4()));
        let pointer = RepositoryPointer {
            version: 1,
            path: canonical.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&pointer).map_err(err)?;
        let write = (|| -> AppResult<()> {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(err)?;
            file.write_all(&bytes).map_err(err)?;
            file.sync_all().map_err(err)?;
            drop(file);
            fs::rename(&temp, self.config_dir.join("repository.json")).map_err(err)?;
            Ok(())
        })();
        if let Err(e) = write {
            let _ = fs::remove_file(temp);
            return Err(format!("Could not save repository pointer: {e}"));
        }
        self.repository = Some(repo);
        self.configured = true;
        self.configured_path = Some(canonical);
        self.load_error = None;
        Ok(self.status())
    }
    pub fn ready(&mut self) -> AppResult<&mut Repository> {
        let repo = self.repository.as_mut().ok_or_else(|| {
            self.load_error
                .clone()
                .unwrap_or_else(|| "Choose a repository first".into())
        })?;
        repo.ensure_available()?;
        Ok(repo)
    }
}

#[cfg(test)]
mod tests;
