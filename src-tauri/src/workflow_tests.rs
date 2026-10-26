use crate::{dev_logs, models::NoteInput, repository::Repository};
use rusqlite::Connection;
use std::fs;
fn fixture() -> tempfile::TempDir {
    let root = std::env::temp_dir().join("Perfboard/workflow-integration-fixtures");
    fs::create_dir_all(&root).unwrap();
    tempfile::Builder::new()
        .prefix("integration-")
        .tempdir_in(root)
        .unwrap()
}
fn legacy(root: &std::path::Path, version: i64, missing_attachment: bool) -> String {
    fs::create_dir_all(root.join("attachments")).unwrap();
    let conn = Connection::open(root.join("perfboard.sqlite3")).unwrap();
    conn.execute_batch(&format!("PRAGMA application_id=1346781764;PRAGMA user_version={version};CREATE TABLE parts(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,package_name TEXT NOT NULL,parameters TEXT NOT NULL,stock_status TEXT NOT NULL,quantity REAL,location TEXT NOT NULL,brief TEXT NOT NULL,url TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE notes(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,search_text TEXT NOT NULL,scene_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE attachments(id TEXT PRIMARY KEY,part_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,relative_path TEXT NOT NULL,kind TEXT NOT NULL,url TEXT);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);")).unwrap();
    if version == 2 {
        conn.execute_batch("ALTER TABLE parts ADD COLUMN lcsc_number TEXT NOT NULL DEFAULT '';ALTER TABLE parts ADD COLUMN brand TEXT NOT NULL DEFAULT '';").unwrap();
    }
    conn.execute("INSERT INTO parts(id,name,category,package_name,parameters,stock_status,quantity,location,brief,url,created_at,updated_at)VALUES('p','STM32F103','MCU','LQFP48','72MHz','in_stock',0,'A1','original brief','','old','old')",[]).unwrap();
    let scene="{\n  \"elements\": [], \"appState\": {\"viewBackgroundColor\":\"#abcdef\"}, \"files\": {}\n}".to_string();
    conn.execute(
        "INSERT INTO notes VALUES('n','Untouched scene','随笔','search',?1,'old','old')",
        [&scene],
    )
    .unwrap();
    conn.execute("INSERT INTO attachments VALUES('a','p','a.pdf','application/pdf',4,'attachments/a.pdf','file',NULL)",[]).unwrap();
    conn.execute("INSERT INTO settings VALUES('original','preserve')", [])
        .unwrap();
    if !missing_attachment {
        fs::write(root.join("attachments/a.pdf"), b"keep").unwrap();
    }
    scene
}
#[test]
fn migration_preserves_old_scenes_and_complete_backup_before_change() {
    for version in [1, 2] {
        let fixture = fixture();
        let source = fixture.path().join("warehouse");
        fs::create_dir(&source).unwrap();
        let scene = legacy(&source, version, false);
        let mut repo = Repository::open(source.to_str().unwrap(), false).unwrap();
        assert_eq!(repo.note_get("n").unwrap().scene_json, scene);
        assert_eq!(repo.note_get("n").unwrap().revision, 0);
        assert_eq!(
            repo.connection()
                .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            6
        );
        assert_eq!(repo.snapshot().unwrap().settings["original"], "preserve");
        let backups: Vec<_> = fs::read_dir(source.join("backups"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert_eq!(backups.len(), 1);
        let old = Connection::open_with_flags(
            backups[0].join("perfboard.sqlite3"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        assert_eq!(
            old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            version
        );
        assert_eq!(
            old.query_row("SELECT scene_json FROM notes WHERE id='n'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            scene
        );
        assert_eq!(
            fs::read(backups[0].join("attachments/a.pdf")).unwrap(),
            b"keep"
        );
        drop(repo);
        let reopened = Repository::open(source.to_str().unwrap(), false).unwrap();
        assert_eq!(reopened.note_get("n").unwrap().scene_json, scene);
        assert_eq!(fs::read_dir(source.join("backups")).unwrap().count(), 1);
    }
}
#[test]
fn failed_pre_migration_backup_leaves_old_database_unmodified() {
    let fixture = fixture();
    let source = fixture.path().join("warehouse");
    fs::create_dir(&source).unwrap();
    let scene = legacy(&source, 2, true);
    assert!(Repository::open(source.to_str().unwrap(), false).is_err());
    let conn = Connection::open(source.join("perfboard.sqlite3")).unwrap();
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        conn.query_row("SELECT scene_json FROM notes", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        scene
    );
    assert!(conn.prepare("SELECT revision FROM notes").is_err());
}
#[test]
fn note_compare_and_swap_rejects_stale_writer_and_preserves_scene_bytes() {
    let fixture = fixture();
    let source = fixture.path().join("warehouse");
    let mut repo = Repository::open(source.to_str().unwrap(), true).unwrap();
    let make = |revision, title: &str, scene: Option<String>| NoteInput {
        id: "note".into(),
        title: title.into(),
        category: "随笔".into(),
        search_text: "".into(),
        scene_json: scene,
        expected_revision: Some(revision),
    };
    let scene = "{\"elements\": [],\"appState\": {},\"files\": {}}";
    let first = repo
        .note_save(make(0, "first", Some(scene.into())))
        .unwrap();
    assert_eq!(first.revision, 1);
    assert!(repo.note_save(make(0, "stale", Some("{}".into()))).is_err());
    let second = repo.note_save(make(1, "second", None)).unwrap();
    assert_eq!(second.revision, 2);
    assert_eq!(second.scene_json, scene);
    assert_eq!(repo.note_get("note").unwrap().title, "second");
}
#[test]
fn log_revision_history_restore_and_backup_stay_in_selected_warehouse() {
    let fixture = fixture();
    let source = fixture.path().join("warehouse");
    let mut repo = Repository::open(source.to_str().unwrap(), true).unwrap();
    let project = dev_logs::create_project(repo.connection_mut(), "project").unwrap();
    let page = dev_logs::create_page(repo.connection_mut(), &project.id, "page").unwrap();
    let doc = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Persistent log"}]}]}"#;
    let saved = dev_logs::save_page(
        repo.connection_mut(),
        dev_logs::PageSaveInput {
            id: page.id.clone(),
            expected_revision: page.revision,
            title: "page".into(),
            document_json: doc.into(),
            schema_version: 1,
        },
    )
    .unwrap();
    assert!(dev_logs::save_page(
        repo.connection_mut(),
        dev_logs::PageSaveInput {
            id: page.id.clone(),
            expected_revision: page.revision,
            title: "stale".into(),
            document_json: doc.into(),
            schema_version: 1
        }
    )
    .is_err());
    assert_eq!(
        dev_logs::history(repo.connection(), &page.id)
            .unwrap()
            .len(),
        2
    );
    let deleted = dev_logs::delete_page(
        repo.connection_mut(),
        dev_logs::RevisionInput {
            id: page.id.clone(),
            expected_revision: saved.revision,
        },
    )
    .unwrap();
    assert!(deleted.deleted_at.is_some());
    let restored = dev_logs::restore_page(
        repo.connection_mut(),
        dev_logs::RevisionInput {
            id: page.id.clone(),
            expected_revision: deleted.revision,
        },
    )
    .unwrap();
    assert!(restored.deleted_at.is_none());
    assert_eq!(restored.document_json, saved.document_json);
    repo.connection().execute("INSERT INTO external_tools VALUES('tool','Unavailable tool','D:\\missing.exe','Keep record','old','old')",[]).unwrap();
    let backup = fixture.path().join("manual-backup");
    repo.backup(backup.to_str().unwrap()).unwrap();
    let restored_repo = Repository::open(backup.to_str().unwrap(), false).unwrap();
    assert_eq!(
        dev_logs::get_page(restored_repo.connection(), &page.id)
            .unwrap()
            .document_json,
        saved.document_json
    );
    assert_eq!(
        crate::external_tools::list(restored_repo.connection())
            .unwrap()
            .len(),
        1
    );
    let other = Repository::open(fixture.path().join("other").to_str().unwrap(), true).unwrap();
    assert!(dev_logs::snapshot(other.connection())
        .unwrap()
        .pages
        .is_empty());
    assert!(crate::external_tools::list(other.connection())
        .unwrap()
        .is_empty());
}
#[test]
fn failed_schema_transaction_rolls_back_after_verified_backup() {
    let fixture = fixture();
    let source = fixture.path().join("warehouse");
    fs::create_dir(&source).unwrap();
    legacy(&source, 2, false);
    let c = Connection::open(source.join("perfboard.sqlite3")).unwrap();
    c.execute_batch("CREATE TABLE external_tools(wrong_column TEXT)")
        .unwrap();
    drop(c);
    assert!(Repository::open(source.to_str().unwrap(), false).is_err());
    let c = Connection::open(source.join("perfboard.sqlite3")).unwrap();
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert!(c.prepare("SELECT revision FROM notes").is_err());
    assert!(fs::read_dir(source.join("backups")).unwrap().any(|e| e
        .unwrap()
        .path()
        .join("perfboard.sqlite3")
        .exists()));
}
