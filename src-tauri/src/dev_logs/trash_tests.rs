use super::*;
use crate::dev_logs::{
    create_page, create_project, create_schema, delete_page, delete_project, get_page, get_project,
    restore_page, restore_project, save_page, snapshot, PageSaveInput, RevisionInput,
};
use serde_json::{json, Value};
fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    create_schema(&conn).unwrap();
    conn
}
fn revision(id: &str, expected_revision: i64) -> RevisionInput {
    RevisionInput {
        id: id.into(),
        expected_revision,
    }
}
fn purge(conn: &Connection, id: &str, revision: i64) -> TrashPurgeInput {
    TrashPurgeInput {
        id: id.into(),
        expected_revision: revision,
        snapshot_token: trash_snapshot(conn).unwrap().snapshot_token,
    }
}
fn clear(conn: &Connection) -> TrashClearInput {
    TrashClearInput {
        snapshot_token: trash_snapshot(conn).unwrap().snapshot_token,
    }
}
fn state(conn: &Connection) -> Value {
    let logs = snapshot(conn).unwrap();
    let histories=conn.prepare("SELECT page_id,revision,title,document_json,schema_version,saved_at FROM dev_log_page_history ORDER BY page_id,revision")
        .unwrap().query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?,r.get::<_,String>(5)?)))
        .unwrap().collect::<Result<Vec<_>,_>>().unwrap();
    json!({"logs":logs,"histories":histories})
}
fn changed_page(conn: &mut Connection, page: &LogPage) -> LogPage {
    save_page(conn,PageSaveInput{id:page.id.clone(),expected_revision:page.revision,title:page.title.clone(),
        document_json:r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Saved history"}]}]}"#.into(),
        schema_version:1}).unwrap()
}
#[test]
fn page_purge_removes_its_versions_and_keeps_active_project_siblings() {
    let mut conn = db();
    let project = create_project(&mut conn, "Project").unwrap();
    let page = create_page(&mut conn, &project.id, "Trash").unwrap();
    let saved = changed_page(&mut conn, &page);
    let sibling = create_page(&mut conn, &project.id, "Active").unwrap();
    let deleted = delete_page(&mut conn, revision(&page.id, saved.revision)).unwrap();
    let input = purge(&conn, &deleted.id, deleted.revision);
    let result = permanently_delete_page(&mut conn, input).unwrap();
    assert_eq!(
        result,
        TrashDeleteResult {
            deleted_projects: 0,
            deleted_pages: 1,
            deleted_history: 2
        }
    );
    assert!(get_page(&conn, &page.id).is_err());
    assert_eq!(get_project(&conn, &project.id).unwrap().revision, 1);
    assert_eq!(
        get_page(&conn, &sibling.id).unwrap().document_json,
        sibling.document_json
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM dev_log_page_history", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(!conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .exists([])
        .unwrap());
}
#[test]
fn project_purge_includes_independently_deleted_pages_and_every_history() {
    let mut conn = db();
    let project = create_project(&mut conn, "Trash project").unwrap();
    let independent = create_page(&mut conn, &project.id, "Previously removed").unwrap();
    delete_page(&mut conn, revision(&independent.id, independent.revision)).unwrap();
    let page = create_page(&mut conn, &project.id, "Project cascade").unwrap();
    changed_page(&mut conn, &page);
    let other = create_project(&mut conn, "Keep").unwrap();
    let kept = create_page(&mut conn, &other.id, "Keep page").unwrap();
    let deleted = delete_project(&mut conn, revision(&project.id, project.revision)).unwrap();
    let input = purge(&conn, &project.id, deleted.revision);
    let result = permanently_delete_project(&mut conn, input).unwrap();
    assert_eq!(
        result,
        TrashDeleteResult {
            deleted_projects: 1,
            deleted_pages: 2,
            deleted_history: 3
        }
    );
    assert!(get_project(&conn, &project.id).is_err());
    assert!(get_page(&conn, &independent.id).is_err());
    assert_eq!(
        get_page(&conn, &kept.id).unwrap().document_json,
        kept.document_json
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM dev_log_page_history", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
#[test]
fn single_purge_cas_failure_rolls_back_pages_and_history() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let page = create_page(&mut conn, &project.id, "Page").unwrap();
    let deleted = delete_page(&mut conn, revision(&page.id, page.revision)).unwrap();
    let before = state(&conn);
    let input = purge(&conn, &page.id, deleted.revision - 1);
    assert!(permanently_delete_page(&mut conn, input)
        .unwrap_err()
        .contains("revision-conflict"));
    assert_eq!(state(&conn), before);
    let project = delete_project(&mut conn, revision(&project.id, project.revision)).unwrap();
    let before = state(&conn);
    let input = purge(&conn, &project.id, project.revision - 1);
    assert!(permanently_delete_project(&mut conn, input)
        .unwrap_err()
        .contains("revision-conflict"));
    assert_eq!(state(&conn), before);
}
#[test]
fn active_project_and_page_are_never_permanently_deleted() {
    let mut conn = db();
    let project = create_project(&mut conn, "Keep active").unwrap();
    let page = create_page(&mut conn, &project.id, "Keep").unwrap();
    let deleted = create_page(&mut conn, &project.id, "Soft page").unwrap();
    delete_page(&mut conn, revision(&deleted.id, deleted.revision)).unwrap();
    let before = state(&conn);
    let input = purge(&conn, &page.id, page.revision);
    assert!(permanently_delete_page(&mut conn, input)
        .unwrap_err()
        .contains("not-deleted"));
    let input = purge(&conn, &project.id, project.revision);
    assert!(permanently_delete_project(&mut conn, input)
        .unwrap_err()
        .contains("not-deleted"));
    assert_eq!(state(&conn), before);
}
#[test]
fn restored_page_invalidates_entire_confirmed_clear() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let a = create_page(&mut conn, &project.id, "A").unwrap();
    let b = create_page(&mut conn, &project.id, "B").unwrap();
    let a = delete_page(&mut conn, revision(&a.id, a.revision)).unwrap();
    delete_page(&mut conn, revision(&b.id, b.revision)).unwrap();
    let input = clear(&conn);
    restore_page(&mut conn, revision(&a.id, a.revision)).unwrap();
    let before = state(&conn);
    assert!(clear_trash(&mut conn, input)
        .unwrap_err()
        .contains("trash-snapshot-conflict"));
    assert_eq!(state(&conn), before);
    assert!(get_page(&conn, &a.id).unwrap().deleted_at.is_none());
}
#[test]
fn restored_project_invalidates_clear_and_preserves_original_independent_trash() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let a = create_page(&mut conn, &project.id, "A").unwrap();
    delete_page(&mut conn, revision(&a.id, a.revision)).unwrap();
    let b = create_page(&mut conn, &project.id, "B").unwrap();
    let project = delete_project(&mut conn, revision(&project.id, project.revision)).unwrap();
    let input = clear(&conn);
    restore_project(&mut conn, revision(&project.id, project.revision)).unwrap();
    let before = state(&conn);
    assert!(clear_trash(&mut conn, input)
        .unwrap_err()
        .contains("trash-snapshot-conflict"));
    assert_eq!(state(&conn), before);
    assert!(get_page(&conn, &a.id).unwrap().deleted_at.is_some());
    assert!(get_page(&conn, &b.id).unwrap().deleted_at.is_none());
}
#[test]
fn new_soft_delete_invalidates_clear_and_single_item_confirmations() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let a = create_page(&mut conn, &project.id, "A").unwrap();
    let b = create_page(&mut conn, &project.id, "B").unwrap();
    let a = delete_page(&mut conn, revision(&a.id, a.revision)).unwrap();
    let bulk = clear(&conn);
    let single = purge(&conn, &a.id, a.revision);
    delete_page(&mut conn, revision(&b.id, b.revision)).unwrap();
    let before = state(&conn);
    assert!(clear_trash(&mut conn, bulk)
        .unwrap_err()
        .contains("trash-snapshot-conflict"));
    assert!(permanently_delete_page(&mut conn, single)
        .unwrap_err()
        .contains("trash-snapshot-conflict"));
    assert_eq!(state(&conn), before);
}
#[test]
fn changed_deleted_revision_invalidates_whole_confirmation() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let page = create_page(&mut conn, &project.id, "A").unwrap();
    delete_page(&mut conn, revision(&page.id, page.revision)).unwrap();
    let input = clear(&conn);
    conn.execute(
        "UPDATE dev_log_pages SET revision=revision+1 WHERE id=?1",
        [&page.id],
    )
    .unwrap();
    let before = state(&conn);
    assert!(clear_trash(&mut conn, input)
        .unwrap_err()
        .contains("trash-snapshot-conflict"));
    assert_eq!(state(&conn), before);
}
#[test]
fn project_child_signature_detects_changes_without_project_revision_change() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let page = create_page(&mut conn, &project.id, "A").unwrap();
    let project = delete_project(&mut conn, revision(&project.id, project.revision)).unwrap();
    let input = purge(&conn, &project.id, project.revision);
    conn.execute(
        "UPDATE dev_log_pages SET position=position+10 WHERE id=?1",
        [&page.id],
    )
    .unwrap();
    let before = state(&conn);
    assert!(permanently_delete_project(&mut conn, input)
        .unwrap_err()
        .contains("trash-snapshot-conflict"));
    assert_eq!(state(&conn), before);
}
#[test]
fn changed_history_is_part_of_confirmation_even_if_page_revision_unchanged() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let page = create_page(&mut conn, &project.id, "A").unwrap();
    delete_page(&mut conn, revision(&page.id, page.revision)).unwrap();
    let input = clear(&conn);
    conn.execute(
        "UPDATE dev_log_page_history SET title='Concurrent history change' WHERE page_id=?1",
        [&page.id],
    )
    .unwrap();
    let before = state(&conn);
    assert!(clear_trash(&mut conn, input)
        .unwrap_err()
        .contains("trash-snapshot-conflict"));
    assert_eq!(state(&conn), before);
}
#[test]
fn clear_removes_all_confirmed_trash_once_and_preserves_active_records() {
    let mut conn = db();
    let trashed = create_project(&mut conn, "Trash").unwrap();
    let child = create_page(&mut conn, &trashed.id, "Child").unwrap();
    delete_page(&mut conn, revision(&child.id, child.revision)).unwrap();
    delete_project(&mut conn, revision(&trashed.id, trashed.revision)).unwrap();
    let active = create_project(&mut conn, "Keep").unwrap();
    let keep = create_page(&mut conn, &active.id, "Keep page").unwrap();
    let removed = create_page(&mut conn, &active.id, "Remove only page").unwrap();
    delete_page(&mut conn, revision(&removed.id, removed.revision)).unwrap();
    let input = clear(&conn);
    let result = clear_trash(&mut conn, input).unwrap();
    assert_eq!(
        result,
        TrashDeleteResult {
            deleted_projects: 1,
            deleted_pages: 2,
            deleted_history: 2
        }
    );
    assert_eq!(snapshot(&conn).unwrap().projects.len(), 1);
    assert_eq!(snapshot(&conn).unwrap().pages.len(), 1);
    assert_eq!(
        get_page(&conn, &keep.id).unwrap().document_json,
        keep.document_json
    );
    let empty = trash_snapshot(&conn).unwrap();
    assert!(empty.projects.is_empty());
    assert!(empty.pages.is_empty());
}
#[test]
fn unexpected_active_child_blocks_entire_clear_and_project_purge() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let page = create_page(&mut conn, &project.id, "A").unwrap();
    let project = delete_project(&mut conn, revision(&project.id, project.revision)).unwrap();
    conn.execute("UPDATE dev_log_pages SET deleted_at=NULL,deletion_batch=NULL,revision=revision+1 WHERE id=?1",[&page.id]).unwrap();
    let before = state(&conn);
    let bulk = clear(&conn);
    let single = purge(&conn, &project.id, project.revision);
    assert!(clear_trash(&mut conn, bulk)
        .unwrap_err()
        .contains("not-deleted"));
    assert!(permanently_delete_project(&mut conn, single)
        .unwrap_err()
        .contains("not-deleted"));
    assert_eq!(state(&conn), before);
}
#[test]
fn failing_final_project_delete_rolls_back_all_pages_and_versions() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let a = create_page(&mut conn, &project.id, "A").unwrap();
    changed_page(&mut conn, &a);
    create_page(&mut conn, &project.id, "B").unwrap();
    let project = delete_project(&mut conn, revision(&project.id, project.revision)).unwrap();
    let before = state(&conn);
    conn.execute_batch("CREATE TRIGGER private_failure BEFORE DELETE ON dev_log_projects BEGIN SELECT RAISE(ABORT,'private delete failure'); END").unwrap();
    let bulk = clear(&conn);
    assert!(clear_trash(&mut conn, bulk)
        .unwrap_err()
        .contains("private delete failure"));
    assert_eq!(state(&conn), before);
    let single = purge(&conn, &project.id, project.revision);
    assert!(permanently_delete_project(&mut conn, single)
        .unwrap_err()
        .contains("private delete failure"));
    assert_eq!(state(&conn), before);
}
#[test]
fn empty_snapshot_is_stable_noop_even_with_unrelated_active_work() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let page = create_page(&mut conn, &project.id, "A").unwrap();
    let token = trash_snapshot(&conn).unwrap().snapshot_token;
    changed_page(&mut conn, &page);
    for _ in 0..2 {
        assert_eq!(
            clear_trash(
                &mut conn,
                TrashClearInput {
                    snapshot_token: token.clone()
                }
            )
            .unwrap(),
            TrashDeleteResult::default()
        );
        assert_eq!(trash_snapshot(&conn).unwrap().snapshot_token, token);
    }
    assert_eq!(get_page(&conn, &page.id).unwrap().revision, 2);
}
#[test]
fn shared_attachment_rows_and_actual_files_are_untouched() {
    let folder = tempfile::tempdir().unwrap();
    let files = folder.path().join("attachments");
    std::fs::create_dir(&files).unwrap();
    let attachment = files.join("shared.pdf");
    let bytes = b"%PDF shared by active notes and parts";
    std::fs::write(&attachment, bytes).unwrap();
    let mut conn = db();
    conn.execute_batch("CREATE TABLE attachments(id TEXT PRIMARY KEY,owner TEXT,path TEXT); INSERT INTO attachments VALUES('one','part','shared.pdf'),('two','note','shared.pdf')").unwrap();
    let project = create_project(&mut conn, "P").unwrap();
    let page = create_page(&mut conn, &project.id, "A").unwrap();
    delete_page(&mut conn, revision(&page.id, page.revision)).unwrap();
    let input = clear(&conn);
    clear_trash(&mut conn, input).unwrap();
    assert_eq!(std::fs::read(&attachment).unwrap(), bytes);
    assert_eq!(std::fs::read_dir(&files).unwrap().count(), 1);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM attachments", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
}
#[test]
fn identical_backup_warehouse_cannot_use_other_warehouse_confirmation() {
    let folder = tempfile::tempdir().unwrap();
    let a = folder.path().join("a.sqlite");
    let b = folder.path().join("b.sqlite");
    let mut conn = Connection::open(&a).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    create_schema(&conn).unwrap();
    let project = create_project(&mut conn, "P").unwrap();
    let page = create_page(&mut conn, &project.id, "A").unwrap();
    let project = delete_project(&mut conn, revision(&project.id, project.revision)).unwrap();
    let token = trash_snapshot(&conn).unwrap().snapshot_token;
    let page_revision = get_page(&conn, &page.id).unwrap().revision;
    drop(conn);
    std::fs::copy(&a, &b).unwrap();
    let mut copied = Connection::open(&b).unwrap();
    copied.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    let before = state(&copied);
    assert_ne!(trash_snapshot(&copied).unwrap().snapshot_token, token);
    assert!(clear_trash(
        &mut copied,
        TrashClearInput {
            snapshot_token: token.clone()
        }
    )
    .unwrap_err()
    .contains("trash-snapshot-conflict"));
    assert!(permanently_delete_page(
        &mut copied,
        TrashPurgeInput {
            id: page.id.clone(),
            expected_revision: page_revision,
            snapshot_token: token.clone()
        }
    )
    .unwrap_err()
    .contains("trash-snapshot-conflict"));
    assert!(permanently_delete_project(
        &mut copied,
        TrashPurgeInput {
            id: project.id.clone(),
            expected_revision: project.revision,
            snapshot_token: token
        }
    )
    .unwrap_err()
    .contains("trash-snapshot-conflict"));
    assert_eq!(state(&copied), before);
}
#[test]
fn restore_from_second_connection_invalidates_confirmation_without_partial_removal() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("private.sqlite");
    let mut a = Connection::open(&path).unwrap();
    a.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    create_schema(&a).unwrap();
    let project = create_project(&mut a, "P").unwrap();
    let page = create_page(&mut a, &project.id, "A").unwrap();
    let page = delete_page(&mut a, revision(&page.id, page.revision)).unwrap();
    let input = clear(&a);
    let mut b = Connection::open(&path).unwrap();
    b.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    restore_page(&mut b, revision(&page.id, page.revision)).unwrap();
    let before = state(&b);
    assert!(clear_trash(&mut a, input)
        .unwrap_err()
        .contains("trash-snapshot-conflict"));
    assert_eq!(state(&a), before);
}
#[test]
fn competing_immediate_writer_rejects_before_any_history_is_removed() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("private.sqlite");
    let mut a = Connection::open(&path).unwrap();
    a.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    create_schema(&a).unwrap();
    a.busy_timeout(std::time::Duration::from_millis(10))
        .unwrap();
    let project = create_project(&mut a, "P").unwrap();
    let page = create_page(&mut a, &project.id, "A").unwrap();
    delete_page(&mut a, revision(&page.id, page.revision)).unwrap();
    let input = clear(&a);
    let before = state(&a);
    let mut b = Connection::open(&path).unwrap();
    let blocker = b
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    assert!(clear_trash(&mut a, input).is_err());
    assert_eq!(state(&a), before);
    blocker.rollback().unwrap();
    let input = clear(&a);
    assert_eq!(clear_trash(&mut a, input).unwrap().deleted_pages, 1);
}
#[test]
fn malformed_confirmation_or_unknown_dto_fields_are_rejected() {
    let mut conn = db();
    let project = create_project(&mut conn, "P").unwrap();
    let page = create_page(&mut conn, &project.id, "A").unwrap();
    delete_page(&mut conn, revision(&page.id, page.revision)).unwrap();
    let before = state(&conn);
    assert!(clear_trash(
        &mut conn,
        TrashClearInput {
            snapshot_token: String::new()
        }
    )
    .is_err());
    assert_eq!(state(&conn), before);
    assert!(serde_json::from_str::<TrashPurgeInput>(
        r#"{"id":"x","expectedRevision":1,"snapshotToken":"x","allowActive":true}"#
    )
    .is_err());
}
