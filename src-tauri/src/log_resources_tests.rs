use super::*;
use crate::dev_logs::{self as logs, PageSaveInput, RevisionInput, TrashPurgeInput};
use crate::repository::Repository;
use base64::Engine;

fn png() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4E8AAAAASUVORK5CYII="
    ).unwrap()
}
fn revision(page: &logs::LogPage) -> RevisionInput {
    RevisionInput {
        id: page.id.clone(),
        expected_revision: page.revision,
    }
}
fn fixture() -> (tempfile::TempDir, Repository, logs::LogPage) {
    let dir = tempfile::tempdir().unwrap();
    let mut repo = Repository::open(dir.path().join("repo").to_str().unwrap(), true).unwrap();
    let project = logs::create_project(repo.connection_mut(), "Resources").unwrap();
    let page = logs::create_page(repo.connection_mut(), &project.id, "Original").unwrap();
    (dir, repo, page)
}
fn document(image: &ResourceMetadata, file: &ResourceMetadata) -> String {
    serde_json::json!({"type":"doc","content":[
        {"type":"image","attrs":{"resourceId":image.id,"alt":"测试图片"}},
        {"type":"fileAttachment","attrs":{"resourceId":file.id,"name":file.name}},
        {"type":"paragraph"}
    ]})
    .to_string()
}
fn save(repo: &mut Repository, page: &logs::LogPage, json: String) -> logs::LogPage {
    logs::save_page(
        repo.connection_mut(),
        PageSaveInput {
            id: page.id.clone(),
            expected_revision: page.revision,
            title: page.title.clone(),
            document_json: json,
            schema_version: 1,
        },
    )
    .unwrap()
}

#[test]
fn resources_round_trip_save_reopen_backup_restore_export_without_duplication() {
    let (dir, mut repo, page) = fixture();
    let image_bytes = png();
    let file_bytes = b"original bytes\0\xff\r\nimmutable attachment";
    let source = dir.path().join("源文件.bin");
    fs::write(&source, file_bytes).unwrap();
    let (name, imported_bytes) = read_source(source.to_str().unwrap()).unwrap();
    let image = import_bytes(repo.connection(), &page.id, "截图.png", "", &image_bytes).unwrap();
    let file = import_bytes(repo.connection(), &page.id, &name, "", &imported_bytes).unwrap();
    assert!(image.is_image);
    assert!(!file.is_image);
    assert_eq!(file.size, file_bytes.len() as u64);
    let page = save(&mut repo, &page, document(&image, &file));
    let resource_revision = page.revision;
    let page = save(
        &mut repo,
        &page,
        r#"{"type":"doc","content":[{"type":"paragraph"}]}"#.into(),
    );
    assert_eq!(
        read(repo.connection(), &page.id, &image.id).unwrap(),
        image_bytes
    );
    let page = logs::restore_history(
        repo.connection_mut(),
        logs::HistoryRestoreInput {
            id: page.id,
            expected_revision: page.revision,
            history_revision: resource_revision,
        },
    )
    .unwrap();
    assert!(page.document_json.contains(&file.id));
    assert!(!page.document_json.contains("base64"));
    let count: i64 = repo
        .connection()
        .query_row("SELECT COUNT(*) FROM dev_log_resources", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2);
    let backup = dir.path().join("backup");
    repo.backup(backup.to_str().unwrap()).unwrap();
    let root = repo.root.clone();
    drop(repo);
    for path in [root, backup] {
        let reopened = Repository::open(path.to_str().unwrap(), false).unwrap();
        assert_eq!(
            read(reopened.connection(), &page.id, &image.id).unwrap(),
            image_bytes
        );
        let restored = read(reopened.connection(), &page.id, &file.id).unwrap();
        assert_eq!(restored, file_bytes);
        assert_eq!(digest(&restored), file.sha256);
        assert_eq!(
            logs::get_page(reopened.connection(), &page.id)
                .unwrap()
                .document_json,
            page.document_json
        );
        let output = dir.path().join("export.bin");
        export_bytes(&reopened.root, output.to_str().unwrap(), &restored).unwrap();
        assert_eq!(fs::read(output).unwrap(), file_bytes);
    }
    assert_eq!(fs::read(source).unwrap(), file_bytes);
}

#[test]
fn image_display_width_survives_reset_history_and_reopen_without_changing_bytes() {
    let (_dir, mut repo, page) = fixture();
    let bytes = png();
    let image = import_bytes(repo.connection(), &page.id, "resize.png", "", &bytes).unwrap();
    let document = |width: Option<serde_json::Value>| {
        let mut attrs = serde_json::json!({ "resourceId": image.id });
        if let Some(width) = width {
            attrs["displayWidth"] = width;
        }
        serde_json::json!({
            "type": "doc",
            "content": [{ "type": "image", "attrs": attrs }, { "type": "paragraph" }]
        })
        .to_string()
    };
    // Documents saved before resizing existed remain valid without migration.
    let legacy = save(&mut repo, &page, document(None));
    let resized = save(&mut repo, &legacy, document(Some(serde_json::json!(320))));
    let resized_revision = resized.revision;
    let reset = save(&mut repo, &resized, document(Some(serde_json::Value::Null)));
    let reset_doc: serde_json::Value = serde_json::from_str(&reset.document_json).unwrap();
    assert!(reset_doc["content"][0]["attrs"]["displayWidth"].is_null());
    let restored = logs::restore_history(
        repo.connection_mut(),
        logs::HistoryRestoreInput {
            id: reset.id,
            expected_revision: reset.revision,
            history_revision: resized_revision,
        },
    )
    .unwrap();
    let root = repo.root.clone();
    drop(repo);
    let reopened = Repository::open(root.to_str().unwrap(), false).unwrap();
    let page = logs::get_page(reopened.connection(), &restored.id).unwrap();
    let stored: serde_json::Value = serde_json::from_str(&page.document_json).unwrap();
    assert_eq!(stored["content"][0]["attrs"]["displayWidth"], 320);
    assert_eq!(
        read(reopened.connection(), &page.id, &image.id).unwrap(),
        bytes
    );
    let metadata = owned_metadata(reopened.connection(), &page.id, &image.id).unwrap();
    assert_eq!(metadata.sha256, image.sha256);
    assert_eq!(metadata.size, image.size);
    let count: i64 = reopened
        .connection()
        .query_row("SELECT COUNT(*) FROM dev_log_resources", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn cross_page_clone_survives_source_soft_delete_restore_and_permanent_purge() {
    let (_dir, mut repo, page) = fixture();
    let target = logs::create_page(repo.connection_mut(), &page.project_id, "Target").unwrap();
    let source = import_bytes(repo.connection(), &page.id, "image.png", "", &png()).unwrap();
    let cloned = clone_to_page(repo.connection(), &target.id, &source.id).unwrap();
    assert_ne!(source.id, cloned.id);
    assert_eq!(source.sha256, cloned.sha256);
    assert!(owned_metadata(repo.connection(), &target.id, &source.id).is_err());
    let deleted = logs::delete_page(repo.connection_mut(), revision(&page)).unwrap();
    assert_eq!(
        read(repo.connection(), &page.id, &source.id).unwrap(),
        png()
    );
    let from_trash = clone_to_page(repo.connection(), &target.id, &source.id).unwrap();
    assert_eq!(from_trash.sha256, source.sha256);
    let restored = logs::restore_page(repo.connection_mut(), revision(&deleted)).unwrap();
    assert!(read(repo.connection(), &restored.id, &source.id).is_ok());
    let deleted = logs::delete_page(repo.connection_mut(), revision(&restored)).unwrap();
    let token = logs::trash_snapshot(repo.connection())
        .unwrap()
        .snapshot_token;
    logs::permanently_delete_page(
        repo.connection_mut(),
        TrashPurgeInput {
            id: deleted.id,
            expected_revision: deleted.revision,
            snapshot_token: token,
        },
    )
    .unwrap();
    assert!(metadata(repo.connection(), &source.id).is_err());
    assert_eq!(
        read(repo.connection(), &target.id, &cloned.id).unwrap(),
        png()
    );
    assert_eq!(
        read(repo.connection(), &target.id, &from_trash.id).unwrap(),
        png()
    );
}

#[test]
fn resource_limits_context_ownership_and_content_validation() {
    let (dir, mut repo, page) = fixture();
    let target = logs::create_page(repo.connection_mut(), &page.project_id, "Other").unwrap();
    let file = import_bytes(
        repo.connection(),
        &page.id,
        "file.txt",
        "image/png",
        b"not an image",
    )
    .unwrap();
    assert!(!file.is_image);
    let oversized = vec![0; MAX_RESOURCE_BYTES + 1];
    assert!(import_bytes(repo.connection(), &page.id, "big.bin", "", &oversized).is_err());
    assert!(import_bytes(repo.connection(), &page.id, "../escape.txt", "", b"a").is_err());
    let context = ResourceContext {
        repository_key: repository_key(&repo.root).unwrap(),
        page_id: page.id.clone(),
        expected_revision: page.revision,
    };
    check_context(&repo.root, repo.connection(), &context, true).unwrap();
    let mut wrong = context.clone();
    wrong.repository_key.push_str("-different");
    assert!(check_context(&repo.root, repo.connection(), &wrong, true).is_err());
    let mut stale = context.clone();
    stale.expected_revision += 1;
    assert!(check_context(&repo.root, repo.connection(), &stale, true).is_err());
    let foreign = serde_json::json!({"type":"doc","content":[{"type":"fileAttachment","attrs":{"resourceId":file.id}}]}).to_string();
    assert!(logs::save_page(
        repo.connection_mut(),
        PageSaveInput {
            id: target.id,
            expected_revision: target.revision,
            title: target.title,
            document_json: foreign,
            schema_version: 1
        }
    )
    .is_err());
    let fake_image = serde_json::json!({"type":"doc","content":[{"type":"image","attrs":{"resourceId":file.id}}]}).to_string();
    assert!(validate_document_resources(repo.connection(), &page.id, &fake_image).is_err());
    assert!(export_bytes(
        &repo.root,
        repo.root.join("perfboard.sqlite3").to_str().unwrap(),
        b"no"
    )
    .is_err());
    assert!(export_bytes(&repo.root, dir.path().to_str().unwrap(), b"no").is_err());
    let exe = import_bytes(repo.connection(), &page.id, "tool.exe", "", b"MZnot run").unwrap();
    assert!(cache_for_open(&dir.path().join("cache"), &repo.root, &exe, b"MZnot run").is_err());
    repo.connection()
        .execute(
            "UPDATE dev_log_resources SET data=?2 WHERE id=?1",
            params![file.id, b"short".as_slice()],
        )
        .unwrap_err();
    repo.connection()
        .execute(
            "UPDATE dev_log_resources SET data=?2 WHERE id=?1",
            params![file.id, b"bad an image".as_slice()],
        )
        .unwrap();
    assert!(read(repo.connection(), &page.id, &file.id).is_err());
}

#[test]
fn v4_migration_keeps_pre_migration_backup_and_opens_v5_resources() {
    let (_dir, repo, page) = fixture();
    repo.connection()
        .execute_batch("DROP TABLE dev_log_resources; PRAGMA user_version=4;")
        .unwrap();
    let root = repo.root.clone();
    drop(repo);
    let reopened = Repository::open(root.to_str().unwrap(), false).unwrap();
    let version: i64 = reopened
        .connection()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 6);
    assert_eq!(
        logs::get_page(reopened.connection(), &page.id)
            .unwrap()
            .document_json,
        page.document_json
    );
    validate_schema(reopened.connection()).unwrap();
    let backups = fs::read_dir(root.join("backups"))
        .unwrap()
        .map(|v| v.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    let before = Connection::open_with_flags(
        backups[0].join("perfboard.sqlite3"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let version: i64 = before
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 4);
    assert!(validate_schema(&before).is_err());
    assert_eq!(
        logs::get_page(&before, &page.id).unwrap().document_json,
        page.document_json
    );
}

#[test]
fn cache_copy_keeps_original_bytes_and_does_not_write_back_external_edits() {
    let (dir, repo, page) = fixture();
    let image = import_bytes(repo.connection(), &page.id, "截图.png", "", &png()).unwrap();
    let target = cache_for_open(&dir.path().join("cache"), &repo.root, &image, &png()).unwrap();
    assert_eq!(fs::read(&target).unwrap(), png());
    fs::write(&target, b"external edit").unwrap();
    assert_eq!(read(repo.connection(), &page.id, &image.id).unwrap(), png());
    let next = cache_for_open(&dir.path().join("cache"), &repo.root, &image, &png()).unwrap();
    assert_ne!(target, next);
    assert_eq!(fs::read(&target).unwrap(), b"external edit");
    assert_eq!(fs::read(next).unwrap(), png());
}

#[test]
fn image_header_bounds_and_resource_attributes_preserve_id_without_external_src() {
    let (_dir, repo, page) = fixture();
    let image = import_bytes(repo.connection(), &page.id, "image.png", "", &png()).unwrap();
    let raw = serde_json::json!({"type":"doc","content":[{"type":"image","attrs":{
        "resourceId":image.id,"src":"https://untrusted.example/image.png","onclick":"no","alt":"test"
    }}]}).to_string();
    let normalized = logs::validate_document(&raw, 1).unwrap();
    assert!(normalized.contains(&image.id));
    assert!(!normalized.contains("https://"));
    assert!(!normalized.contains("onclick"));
    validate_document_resources(repo.connection(), &page.id, &normalized).unwrap();
    assert!(logs::validate_document(
        r#"{"type":"doc","content":[{"type":"image","attrs":{"src":"data:image/png;base64,AA"}}]}"#,
        1
    )
    .is_err());
    let mut oversized = png();
    oversized[16..20].copy_from_slice(&100_000u32.to_be_bytes());
    let stored = import_bytes(
        repo.connection(),
        &page.id,
        "huge-pixels.png",
        "",
        &oversized,
    )
    .unwrap();
    assert!(!stored.is_image);
    assert_eq!(
        read(repo.connection(), &page.id, &stored.id).unwrap(),
        oversized
    );
    assert_eq!(image_mime(&png()), Some("image/png"));
    assert_eq!(image_mime(b"GIF89a\x01\0\x01\0"), Some("image/gif"));
    assert_eq!(
        image_mime(b"\xff\xd8\xff\xc0\0\x0b\x08\0\x01\0\x01\x01\x01\x11\0"),
        Some("image/jpeg")
    );
}

#[test]
fn cache_cleanup_removes_only_old_recognizable_extractions() {
    let (dir, repo, page) = fixture();
    let item = import_bytes(repo.connection(), &page.id, "file.txt", "", b"content").unwrap();
    let cache = dir.path().join("cache");
    let old = cache_for_open(&cache, &repo.root, &item, b"content").unwrap();
    let fresh = cache_for_open(&cache, &repo.root, &item, b"content").unwrap();
    let old_time = SystemTime::now() - Duration::from_secs(8 * 24 * 60 * 60);
    fs::File::options()
        .write(true)
        .open(&old)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(old_time))
        .unwrap();
    let namespace = old.parent().unwrap().parent().unwrap().parent().unwrap();
    let foreign = namespace.join("user-file.txt");
    fs::write(&foreign, b"keep").unwrap();
    cleanup_old_cache(namespace, SystemTime::now());
    assert!(!old.exists());
    assert!(fresh.exists());
    assert_eq!(fs::read(foreign).unwrap(), b"keep");
}
