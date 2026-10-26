use super::*;
use tempfile::TempDir;

fn path(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}
fn part(id: &str, quantity: Option<f64>) -> PartInput {
    PartInput {
        id: id.into(),
        name: "STM32F103C8T6".into(),
        category: "MCU".into(),
        package_name: "LQFP48".into(),
        parameters: "72 MHz".into(),
        lcsc_number: "C00123A".into(),
        brand: "ST".into(),
        stock_status: "unknown".into(),
        quantity,
        location: "A1".into(),
        brief: "development".into(),
        url: String::new(),
    }
}
fn note(id: &str, scene: Option<String>) -> NoteInput {
    NoteInput {
        expected_revision: None,
        id: id.into(),
        title: "Image test".into(),
        category: "硬件错题本".into(),
        search_text: "oscillator".into(),
        scene_json: scene,
    }
}
fn repo(temp: &TempDir) -> Repository {
    Repository::open(&path(&temp.path().join("repo")), true).unwrap()
}

#[test]
fn crud_persists_when_reopened_and_quantity_is_optional() {
    let temp = TempDir::new().unwrap();
    let mut db = repo(&temp);
    let saved = db.part_save(part("p1", None)).unwrap();
    assert_eq!(saved.quantity, None);
    let created = saved.created_at;
    let saved = db.part_save(part("p1", Some(12.0))).unwrap();
    assert_eq!(saved.created_at, created);
    assert_eq!(saved.quantity, Some(12.0));
    db.setting_save("theme", "codex").unwrap();
    let root = db.root.clone();
    drop(db);
    let mut reopened = Repository::open(&path(&root), false).unwrap();
    let snapshot = reopened.snapshot().unwrap();
    assert_eq!(snapshot.parts.len(), 1);
    assert_eq!(snapshot.parts[0].quantity, Some(12.0));
    assert_eq!(snapshot.parts[0].name, "STM32F103C8T6");
    assert_eq!(snapshot.parts[0].lcsc_number, "C00123A");
    assert_eq!(snapshot.parts[0].brand, "ST");
    assert_eq!(snapshot.settings["theme"], "codex");
    reopened.part_delete("p1").unwrap();
    assert!(reopened.snapshot().unwrap().parts.is_empty());
}
#[test]
fn full_excalidraw_image_json_roundtrips_exactly() {
    let temp = TempDir::new().unwrap();
    let mut db = repo(&temp);
    let scene=r##"{"type":"excalidraw","version":2,"elements":[{"id":"img","type":"image","fileId":"image-file"}],"appState":{"viewBackgroundColor":"#fff","zoom":{"value":1}},"files":{"image-file":{"id":"image-file","mimeType":"image/png","dataURL":"data:image/png;base64,iVBORw0KGgo=","created":123}},"future":{"keep":true}}"##.to_owned();
    let saved = db.note_save(note("n1", Some(scene.clone()))).unwrap();
    assert_eq!(saved.scene_json, scene);
    let mut metadata = note("n1", None);
    metadata.title = "Renamed".into();
    let saved = db.note_save(metadata).unwrap();
    assert_eq!(saved.scene_json, scene);
    let root = db.root.clone();
    drop(db);
    let mut reopened = Repository::open(&path(&root), false).unwrap();
    assert_eq!(reopened.note_get("n1").unwrap().scene_json, scene);
    let summaries = serde_json::to_value(reopened.snapshot().unwrap()).unwrap();
    assert!(summaries["notes"][0].get("sceneJson").is_none());
    assert_eq!(summaries["notes"][0]["title"], "Renamed");
    reopened.note_delete("n1").unwrap();
    assert!(reopened.note_get("n1").is_err());
}
#[test]
fn attachment_copy_delete_and_part_delete_never_remove_original_source() {
    let temp = TempDir::new().unwrap();
    let mut db = repo(&temp);
    db.part_save(part("p1", None)).unwrap();
    let source = temp.path().join("original diagram.pdf");
    let content = b"%PDF-1.4 Original source";
    fs::write(&source, content).unwrap();
    let attachment = db.attachment_import("p1", &path(&source)).unwrap();
    assert_eq!(attachment.name, "original diagram.pdf");
    assert_eq!(attachment.size, content.len() as u64);
    assert!(attachment.relative_path.starts_with("attachments/"));
    assert!(!attachment.relative_path.contains("original"));
    let copy = db.root.join(&attachment.relative_path);
    assert_eq!(fs::read(&copy).unwrap(), content);
    db.attachment_delete(&attachment.id).unwrap();
    assert!(!copy.exists());
    assert_eq!(fs::read(&source).unwrap(), content);
    let another = db.attachment_import("p1", &path(&source)).unwrap();
    db.part_delete("p1").unwrap();
    assert!(db.attachment_get(&another.id).is_err());
    assert_eq!(fs::read(&source).unwrap(), content);
}
#[test]
fn backup_contains_committed_database_scene_settings_and_attachment_copies() {
    let temp = TempDir::new().unwrap();
    let mut db = repo(&temp);
    db.part_save(part("p1", Some(8.0))).unwrap();
    db.note_save(note("n1", Some(EMPTY_SCENE.into()))).unwrap();
    db.setting_save("closeAction", "hide").unwrap();
    let source = temp.path().join("scope.png");
    fs::write(&source, b"\x89PNG\r\n\x1a\nimage payload").unwrap();
    let attachment = db.attachment_import("p1", &path(&source)).unwrap();
    db.attachment_add_url("p1", "https://example.com/datasheet", "Datasheet")
        .unwrap();
    let dest = temp.path().join("snapshot-backup");
    let backed_up = db.backup(&path(&dest)).unwrap();
    assert_eq!(PathBuf::from(backed_up), dest.canonicalize().unwrap());
    let mut backup = Repository::open(&path(&dest), false).unwrap();
    let snap = backup.snapshot().unwrap();
    assert_eq!(snap.parts[0].quantity, Some(8.0));
    assert_eq!(snap.attachments.len(), 2);
    assert_eq!(snap.settings["closeAction"], "hide");
    assert_eq!(backup.note_get("n1").unwrap().scene_json, EMPTY_SCENE);
    assert_eq!(
        fs::read(dest.join(attachment.relative_path)).unwrap(),
        fs::read(source).unwrap()
    );
    assert!(db.backup(&path(&dest)).is_err());
}
#[test]
fn missing_repository_pointer_does_not_create_empty_database() {
    let temp = TempDir::new().unwrap();
    let config = temp.path().join("config");
    fs::create_dir(&config).unwrap();
    let missing = temp.path().join("offline-drive").join("repo");
    fs::write(
        config.join("repository.json"),
        serde_json::to_vec(&RepositoryPointer {
            version: 1,
            path: path(&missing),
        })
        .unwrap(),
    )
    .unwrap();
    let mut manager = RepositoryManager::load(config.clone());
    let status = manager.status();
    assert!(status.configured);
    assert!(!status.ready);
    assert_eq!(status.path, Some(path(&missing)));
    assert!(status.error.is_some());
    assert!(manager.ready().is_err());
    assert!(!missing.exists());
    let pointer: RepositoryPointer =
        serde_json::from_slice(&fs::read(config.join("repository.json")).unwrap()).unwrap();
    assert_eq!(pointer.path, path(&missing));
}
#[test]
fn missing_database_in_existing_directory_does_not_reinitialize() {
    let temp = TempDir::new().unwrap();
    let empty = temp.path().join("missing-db");
    fs::create_dir(&empty).unwrap();
    assert!(Repository::open(&path(&empty), false).is_err());
    assert!(!empty.join(DB_NAME).exists());
}
#[test]
fn refuses_foreign_nonempty_directory_foreign_database_and_future_schema() {
    let temp = TempDir::new().unwrap();
    let foreign = temp.path().join("foreign");
    fs::create_dir(&foreign).unwrap();
    fs::write(foreign.join("user.txt"), "must stay").unwrap();
    assert!(Repository::open(&path(&foreign), true).is_err());
    assert!(!foreign.join(DB_NAME).exists());
    Connection::open(foreign.join(DB_NAME))
        .unwrap()
        .execute_batch("CREATE TABLE important(value TEXT);")
        .unwrap();
    assert!(Repository::open(&path(&foreign), false).is_err());
    assert!(Repository::validate(&path(&foreign)).is_err());
    let db = repo(&temp);
    let root = db.root.clone();
    db.conn.execute_batch("PRAGMA user_version=999").unwrap();
    drop(db);
    assert!(Repository::open(&path(&root), false)
        .unwrap_err_string()
        .contains("Unsupported"));
}
trait ErrorString<T> {
    fn unwrap_err_string(self) -> String;
}
impl<T> ErrorString<T> for Result<T, String> {
    fn unwrap_err_string(self) -> String {
        match self {
            Err(e) => e,
            Ok(_) => panic!("expected error"),
        }
    }
}
#[test]
fn pointer_roundtrip_and_failed_switch_preserve_working_repository() {
    let temp = TempDir::new().unwrap();
    let config = temp.path().join("config");
    let root = temp.path().join("repo");
    let mut manager = RepositoryManager::load(config.clone());
    assert!(!manager.status().configured);
    manager.open(&path(&root), true).unwrap();
    manager
        .ready()
        .unwrap()
        .part_save(part("p1", None))
        .unwrap();
    assert!(manager
        .open(&path(&temp.path().join("not-found")), false)
        .is_err());
    assert!(manager.status().ready);
    assert_eq!(manager.ready().unwrap().snapshot().unwrap().parts.len(), 1);
    let second = temp.path().join("second");
    manager.open(&path(&second), true).unwrap();
    assert!(manager
        .ready()
        .unwrap()
        .snapshot()
        .unwrap()
        .parts
        .is_empty());
    drop(manager);
    let reopened = RepositoryManager::load(config);
    assert!(reopened.status().ready);
    assert_eq!(
        reopened.status().path,
        Some(path(&second.canonicalize().unwrap()))
    );
}
#[test]
fn corrupted_or_unsupported_pointer_is_a_recovery_error() {
    let temp = TempDir::new().unwrap();
    let config = temp.path().join("config");
    fs::create_dir(&config).unwrap();
    fs::write(config.join("repository.json"), "not json").unwrap();
    let manager = RepositoryManager::load(config.clone());
    assert!(manager.status().configured);
    assert!(!manager.status().ready);
    assert!(manager
        .status()
        .error
        .unwrap()
        .contains("Invalid repository pointer"));
    fs::write(
        config.join("repository.json"),
        r#"{"version":2,"path":"C:\\missing\\repo"}"#,
    )
    .unwrap();
    assert!(RepositoryManager::load(config)
        .status()
        .error
        .unwrap()
        .contains("Unsupported"));
}
#[test]
fn rejects_dangerous_urls_invalid_values_and_attachment_traversal() {
    for url in [
        "javascript:alert(1)",
        "file:///C:/Windows/system32/cmd.exe",
        "data:text/plain,hello",
        "https://user:pass@example.com",
        "mailto:x@example.com",
    ] {
        assert!(validate_url(url).is_err(), "{url}");
    }
    assert_eq!(
        validate_url("https://example.com").unwrap(),
        "https://example.com/"
    );
    let temp = TempDir::new().unwrap();
    let mut db = repo(&temp);
    assert!(db.part_save(part("negative", Some(-1.0))).is_err());
    assert!(db.part_save(part("nan", Some(f64::NAN))).is_err());
    assert!(db
        .note_save(note("bad", Some(r#"{"elements":[],"appState":{}}"#.into())))
        .is_err());
    assert!(safe_attachment(&db.root, "../source.pdf").is_err());
    assert!(safe_attachment(&db.root, "C:\\Windows\\file.pdf").is_err());
    db.part_save(part("p1", None)).unwrap();
    let executable = temp.path().join("bad.exe");
    fs::write(&executable, b"MZ").unwrap();
    assert!(db.attachment_import("p1", &path(&executable)).is_err());
    assert!(db
        .attachment_add_url("p1", "file:///secret", "bad")
        .is_err());
}
#[test]
fn read_only_validation_does_not_create_repository_or_pointer() {
    let temp = TempDir::new().unwrap();
    let missing = temp.path().join("missing");
    assert!(Repository::validate(&path(&missing)).is_err());
    assert!(!missing.exists());
    let db = repo(&temp);
    let root = db.root.clone();
    drop(db);
    Repository::validate(&path(&root)).unwrap();
    assert!(!root.join("repository.json").exists());
}
#[test]
fn dto_fields_are_camel_case() {
    let temp = TempDir::new().unwrap();
    let mut db = repo(&temp);
    let saved = db.part_save(part("p1", None)).unwrap();
    let value = serde_json::to_value(saved).unwrap();
    assert!(value.get("packageName").is_some());
    assert!(value.get("stockStatus").is_some());
    assert!(value.get("createdAt").is_some());
    assert!(value.get("package_name").is_none());
    assert!(value["quantity"].is_null());
}

#[test]
fn all_four_contract_note_categories_can_be_created_and_reopened() {
    let temp = TempDir::new().unwrap();
    let mut db = repo(&temp);
    for (index, category) in ["硬件错题本", "软件错题本", "随笔", "学习笔记"]
        .iter()
        .enumerate()
    {
        let mut input = note(&format!("category-{index}"), None);
        input.category = category.to_string();
        assert_eq!(db.note_save(input).unwrap().category, *category);
    }
    let root = db.root.clone();
    drop(db);
    let mut reopened = Repository::open(&path(&root), false).unwrap();
    assert_eq!(reopened.snapshot().unwrap().notes.len(), 4);
    for (index, category) in ["硬件错题本", "软件错题本", "随笔", "学习笔记"]
        .iter()
        .enumerate()
    {
        assert_eq!(
            reopened
                .note_get(&format!("category-{index}"))
                .unwrap()
                .category,
            *category
        );
    }
}

#[cfg(target_os = "windows")]
mod junction_tests {
    use super::*;

    struct JunctionGuard {
        link: PathBuf,
    }
    impl Drop for JunctionGuard {
        fn drop(&mut self) {
            // remove_dir removes the junction itself on Windows, never its target.
            let _ = fs::remove_dir(&self.link);
        }
    }
    fn synthetic_directory() -> TempDir {
        let project = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .canonicalize()
            .unwrap();
        let quality = project.join(".quality");
        fs::create_dir_all(&quality).unwrap();
        assert!(quality.canonicalize().unwrap().starts_with(&project));
        tempfile::Builder::new()
            .prefix("storage-junction-")
            .tempdir_in(quality)
            .unwrap()
    }
    fn junction(link: &Path, target: &Path, scratch: &Path) -> JunctionGuard {
        let scratch = scratch.canonicalize().unwrap();
        assert!(link
            .parent()
            .unwrap()
            .canonicalize()
            .unwrap()
            .starts_with(&scratch));
        assert!(target.canonicalize().unwrap().starts_with(&scratch));
        assert!(!link.exists());
        let status = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command",
                "New-Item -ItemType Junction -Path $env:PERFBOARD_JUNCTION_LINK -Target $env:PERFBOARD_JUNCTION_TARGET -ErrorAction Stop | Out-Null"])
            .env("PERFBOARD_JUNCTION_LINK", link)
            .env("PERFBOARD_JUNCTION_TARGET", target)
            .status().unwrap();
        assert!(status.success(), "Windows test junction creation failed");
        JunctionGuard {
            link: link.to_owned(),
        }
    }

    #[test]
    fn replaced_attachment_junction_cannot_open_backup_import_or_delete_external_file() {
        let temp = synthetic_directory();
        let mut db = repo(&temp);
        db.part_save(part("p1", None)).unwrap();
        let source = temp.path().join("original.pdf");
        fs::write(&source, b"%PDF-1.4 original source").unwrap();
        let attachment = db.attachment_import("p1", &path(&source)).unwrap();
        let original_attachments = db.root.join("attachments");
        fs::rename(&original_attachments, db.root.join("attachments-parked")).unwrap();
        let outside = temp.path().join("external-owned-target");
        fs::create_dir(&outside).unwrap();
        let victim = outside.join(Path::new(&attachment.relative_path).file_name().unwrap());
        let content = b"%PDF-1.4 unrelated victim preserved";
        fs::write(&victim, content).unwrap();
        let link = junction(&original_attachments, &outside, temp.path());
        let read_rejected = safe_attachment(&db.root, &attachment.relative_path).is_err();
        let open_rejected = db.attachment_target(&attachment.id).is_err();
        let backup_path = temp.path().join("should-not-create-backup");
        let backup_rejected = db.backup(&path(&backup_path)).is_err();
        let import_rejected = db.attachment_import("p1", &path(&source)).is_err();
        let delete_rejected = db.attachment_delete(&attachment.id).is_err();
        let record_preserved = db.attachment_get(&attachment.id).is_ok();
        let victim_contents = fs::read(&victim).unwrap();
        let target_file_count = fs::read_dir(&outside).unwrap().count();
        drop(link);
        assert!(
            read_rejected && open_rejected && backup_rejected && import_rejected && delete_rejected
        );
        assert!(record_preserved);
        assert_eq!(victim_contents, content);
        assert_eq!(target_file_count, 1);
        assert!(!backup_path.exists());
        assert_eq!(fs::read(source).unwrap(), b"%PDF-1.4 original source");
    }

    #[test]
    fn replacing_repository_root_with_junction_rejects_every_repository_operation() {
        let temp = synthetic_directory();
        let root = temp.path().join("tracked-repository");
        fs::create_dir(&root).unwrap();
        fs::write(root.join(DB_NAME), b"synthetic file only").unwrap();
        let canonical_root = root.canonicalize().unwrap();
        // The held connection is in-memory so the fixture can replace a directory
        // without depending on Windows SQLite file-lock behavior.
        let mut db = Repository {
            root: canonical_root,
            conn: Connection::open_in_memory().unwrap(),
        };
        fs::rename(&root, temp.path().join("original-repository-parked")).unwrap();
        let target = temp.path().join("external-owned-repository");
        fs::create_dir(&target).unwrap();
        let victim = target.join(DB_NAME);
        fs::write(&victim, b"external database preserved").unwrap();
        let link = junction(&root, &target, temp.path());
        let availability_rejected = db.ensure_available().is_err();
        let snapshot_rejected = db.snapshot().is_err();
        let write_rejected = db.part_save(part("p1", None)).is_err();
        let import_rejected = attachment_directory(&db.root).is_err();
        let delete_rejected = db.attachment_delete("id").is_err();
        let backup_rejected = db.backup(&path(&temp.path().join("bad-backup"))).is_err();
        let victim_contents = fs::read(&victim).unwrap();
        drop(link);
        assert!(
            availability_rejected
                && snapshot_rejected
                && write_rejected
                && import_rejected
                && delete_rejected
                && backup_rejected
        );
        assert_eq!(victim_contents, b"external database preserved");
        assert!(!target.join("attachments").exists());
    }
}

#[test]
fn legacy_parts_migrate_once_without_losing_parameters() {
    let temp = TempDir::new().unwrap();
    let db = repo(&temp);
    let root = db.root.clone();
    db.conn.execute_batch("DROP TABLE dev_log_page_folders; DROP TABLE dev_log_folders; DROP TABLE dev_log_resources; DROP TABLE transformer_design_history; DROP TABLE transformer_designs; DROP TABLE dev_log_page_history; DROP TABLE dev_log_pages; DROP TABLE dev_log_projects; DROP TABLE external_tools; ALTER TABLE notes DROP COLUMN revision; ALTER TABLE parts DROP COLUMN brand; ALTER TABLE parts DROP COLUMN lcsc_number; PRAGMA user_version=1;
        INSERT INTO parts VALUES ('legacy','0Ω','电阻','0805','额定功率 0.1W','unknown',NULL,'0805电阻盒','第一行' || char(10) || '第二行','','old','old');
        INSERT INTO parts VALUES ('duplicate','STM32F103C8T6','MCU','LQFP48','STM32F103C8T6','unknown',NULL,'A1','原简介','','old','old');").unwrap();
    drop(db);
    Repository::validate(&path(&root)).unwrap();
    let inspect = Connection::open(root.join(DB_NAME)).unwrap();
    assert_eq!(
        inspect
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(inspect);
    let mut migrated = Repository::open(&path(&root), false).unwrap();
    let parts = migrated.snapshot().unwrap().parts;
    let legacy = parts.iter().find(|p| p.id == "legacy").unwrap();
    assert_eq!(legacy.brief, "第一行\n第二行\n历史参数：额定功率 0.1W");
    assert_eq!(legacy.parameters, "额定功率 0.1W");
    assert_eq!(legacy.lcsc_number, "");
    assert_eq!(legacy.brand, "");
    assert_eq!(
        parts.iter().find(|p| p.id == "duplicate").unwrap().brief,
        "原简介"
    );
    let brief = legacy.brief.clone();
    let mut edit = part("legacy", Some(3.0));
    edit.name = "0Ω".into();
    edit.brief = brief.clone();
    edit.lcsc_number = "00C123A".into();
    migrated.part_save(edit).unwrap();
    drop(migrated);
    let mut reopened = Repository::open(&path(&root), false).unwrap();
    let snap = reopened.snapshot().unwrap();
    let saved = snap.parts.iter().find(|p| p.id == "legacy").unwrap();
    assert_eq!(saved.brief, brief);
    assert_eq!(saved.name, "0Ω");
    assert_eq!(saved.lcsc_number, "00C123A");
    assert_eq!(saved.brand, "ST");
    assert_eq!(saved.quantity, Some(3.0));
    let value = serde_json::to_value(saved).unwrap();
    assert_eq!(value["lcscNumber"], "00C123A");
    reopened.part_delete("legacy").unwrap();
    assert_eq!(reopened.snapshot().unwrap().parts.len(), 1);
}

#[test]
fn optional_brand_and_supplier_number_can_be_cleared_and_reopened() {
    let temp = TempDir::new().unwrap();
    let mut db = repo(&temp);
    db.part_save(part("p1", None)).unwrap();
    let mut input = part("p1", None);
    input.brand.clear();
    input.lcsc_number.clear();
    db.part_save(input).unwrap();
    let root = db.root.clone();
    drop(db);
    let mut reopened = Repository::open(&path(&root), false).unwrap();
    let parts = reopened.snapshot().unwrap().parts;
    assert_eq!(parts[0].brand, "");
    assert_eq!(parts[0].lcsc_number, "");
}

#[test]
fn read_only_v1_validation_preserves_database_bytes_columns_and_version() {
    let temp = TempDir::new().unwrap();
    let db = repo(&temp);
    let root = db.root.clone();
    db.conn
        .execute_batch(
            "ALTER TABLE parts DROP COLUMN brand;
        ALTER TABLE parts DROP COLUMN lcsc_number; PRAGMA user_version=1;",
        )
        .unwrap();
    drop(db);
    let database = root.join(DB_NAME);
    let before = fs::read(&database).unwrap();
    Repository::validate(&path(&root)).unwrap();
    assert_eq!(fs::read(&database).unwrap(), before);
    let inspect = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        inspect
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(inspect.prepare("SELECT lcsc_number FROM parts").is_err());
    assert!(inspect.prepare("SELECT brand FROM parts").is_err());
    assert!(!root.join("repository.json").exists());
}

#[test]
fn failed_v1_migration_rolls_back_partial_alter_and_preserves_legacy_rows() {
    let temp = TempDir::new().unwrap();
    let db = repo(&temp);
    let root = db.root.clone();
    // A conflicting brand column forces the second ALTER to fail after the first succeeds.
    db.conn.execute_batch("ALTER TABLE parts DROP COLUMN lcsc_number; PRAGMA user_version=1;
        INSERT INTO parts (id,name,category,package_name,parameters,stock_status,quantity,location,brief,url,created_at,updated_at,brand)
        VALUES ('legacy','0Ω','电阻','0805','额定功率 0.1W','unknown',NULL,'0805电阻盒','第一行' || char(10) || '第二行','','old','old','existing brand');").unwrap();
    drop(db);
    assert!(Repository::open(&path(&root), false).is_err());
    let inspect =
        Connection::open_with_flags(root.join(DB_NAME), OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        inspect
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(inspect.prepare("SELECT lcsc_number FROM parts").is_err());
    let original = inspect
        .query_row(
            "SELECT brief,parameters,brand FROM parts WHERE id='legacy'",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        original,
        (
            "第一行\n第二行".into(),
            "额定功率 0.1W".into(),
            "existing brand".into()
        )
    );
}

#[test]
fn v3_to_v4_preserves_every_existing_table_and_attachments_and_backs_up_first() {
    let temp = TempDir::new().unwrap();
    let mut db = repo(&temp);
    db.part_save(part("old-part", Some(7.0))).unwrap();
    let exact_scene = "{\n \"type\":\"excalidraw\",\"elements\":[],\"appState\":{},\"files\":{}\n}";
    db.note_save(note("old-note", Some(exact_scene.into())))
        .unwrap();
    db.setting_save("user-choice", "keep-exactly").unwrap();
    let original = temp.path().join("source.png");
    fs::write(&original, b"unchanged-local-attachment").unwrap();
    let attachment = db.attachment_import("old-part", &path(&original)).unwrap();
    let project = crate::dev_logs::create_project(db.connection_mut(), "旧项目").unwrap();
    crate::dev_logs::create_page(db.connection_mut(), &project.id, "旧页面").unwrap();
    db.conn.execute_batch("DROP TABLE dev_log_resources; DROP TABLE transformer_design_history; DROP TABLE transformer_designs; PRAGMA user_version=3;").unwrap();
    let tables = [
        "parts",
        "notes",
        "attachments",
        "settings",
        "external_tools",
        "dev_log_projects",
        "dev_log_pages",
        "dev_log_page_history",
    ];
    fn rows(conn: &Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
        let mut statement = conn
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .unwrap();
        let count = statement.column_count();
        statement
            .query_map([], |row| {
                (0..count)
                    .map(|i| row.get(i))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    }
    let before: Vec<_> = tables.iter().map(|table| rows(&db.conn, table)).collect();
    let root = db.root.clone();
    drop(db);
    let migrated = Repository::open(&path(&root), false).unwrap();
    assert_eq!(
        migrated
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    for (table, expected) in tables.iter().zip(&before) {
        assert_eq!(rows(&migrated.conn, table), *expected, "{table} changed");
    }
    assert!(crate::transformer_designs::list(&migrated.conn)
        .unwrap()
        .is_empty());
    assert_eq!(
        fs::read(root.join(&attachment.relative_path)).unwrap(),
        b"unchanged-local-attachment"
    );
    let backups: Vec<_> = fs::read_dir(root.join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(backups.len(), 1);
    assert!(backups[0]
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("pre-migration-v3-to-v6-"));
    let old =
        Connection::open_with_flags(backups[0].join(DB_NAME), OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    assert_eq!(
        old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert!(old.prepare("SELECT id FROM transformer_designs").is_err());
    for (table, expected) in tables.iter().zip(&before) {
        assert_eq!(rows(&old, table), *expected);
    }
    assert_eq!(
        fs::read(backups[0].join(&attachment.relative_path)).unwrap(),
        b"unchanged-local-attachment"
    );
    drop(old);
    drop(migrated);
    Repository::open(&path(&root), false).unwrap();
    assert_eq!(fs::read_dir(root.join("backups")).unwrap().count(), 1);
}
