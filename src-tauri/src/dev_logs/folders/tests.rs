use super::*;
use crate::dev_logs as logs;
fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    logs::create_schema(&conn).unwrap();
    conn
}
#[test]
fn deleting_folder_promotes_pages_in_place_without_changing_content_trash_or_history() {
    let mut conn = db();
    let project = logs::create_project(&mut conn, "项目").unwrap();
    let before = logs::create_page(&mut conn, &project.id, "前面的根页面").unwrap();
    let folder = create(&mut conn, &project.id).unwrap();
    let after = logs::create_page(&mut conn, &project.id, "后面的根页面").unwrap();
    let mut children = Vec::new();
    for name in ["第一篇", "第二篇", "已在回收站"] {
        let page = logs::create_page(&mut conn, &project.id, name).unwrap();
        move_item(
            &mut conn,
            input(
                TreeKind::Page,
                &page.id,
                page.revision,
                &project.id,
                Some(&folder.id),
            ),
        )
        .unwrap();
        children.push(logs::get_page(&conn, &page.id).unwrap());
    }
    logs::delete_page(
        &mut conn,
        logs::RevisionInput {
            id: children[2].id.clone(),
            expected_revision: children[2].revision,
        },
    )
    .unwrap();
    let original: Vec<_> = children
        .iter()
        .map(|p| {
            let page = logs::get_page(&conn, &p.id).unwrap();
            (
                page.document_json,
                page.deleted_at,
                serde_json::to_string(&logs::history(&conn, &p.id).unwrap()).unwrap(),
            )
        })
        .collect();
    let other = logs::create_project(&mut conn, "其他项目").unwrap();
    let other_folder = create(&mut conn, &other.id).unwrap();
    let revision = get(&conn, &folder.id).unwrap().revision;
    delete(
        &mut conn,
        RevisionInput {
            id: folder.id.clone(),
            expected_revision: revision,
        },
    )
    .unwrap();
    assert!(get(&conn, &folder.id).is_err());
    let roots = siblings(&conn, &project.id, None).unwrap();
    assert_eq!(
        roots.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
        vec![
            before.id.as_str(),
            children[0].id.as_str(),
            children[1].id.as_str(),
            after.id.as_str()
        ]
    );
    for (page, saved) in children.iter().zip(original) {
        let fresh = logs::get_page(&conn, &page.id).unwrap();
        assert_eq!(fresh.document_json, saved.0);
        assert_eq!(fresh.deleted_at, saved.1);
        assert_eq!(
            serde_json::to_string(&logs::history(&conn, &page.id).unwrap()).unwrap(),
            saved.2
        );
        assert_eq!(page_folder(&conn, &page.id).unwrap(), None);
    }
    assert_eq!(
        get(&conn, &other_folder.id).unwrap().revision,
        other_folder.revision
    );
    assert!(conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
}
#[test]
fn deleting_folder_rejects_stale_or_deleted_project_and_can_delete_empty_folder() {
    let mut conn = db();
    let project = logs::create_project(&mut conn, "项目").unwrap();
    let folder = create(&mut conn, &project.id).unwrap();
    let folder = rename(
        &mut conn,
        RenameInput {
            id: folder.id,
            expected_revision: 1,
            title: "已经改名".into(),
        },
    )
    .unwrap();
    let before = serde_json::to_string(&logs::snapshot(&conn).unwrap()).unwrap();
    assert!(delete(
        &mut conn,
        RevisionInput {
            id: folder.id.clone(),
            expected_revision: 1
        }
    )
    .is_err());
    assert_eq!(
        serde_json::to_string(&logs::snapshot(&conn).unwrap()).unwrap(),
        before
    );
    logs::delete_project(
        &mut conn,
        RevisionInput {
            id: project.id,
            expected_revision: project.revision,
        },
    )
    .unwrap();
    assert!(delete(
        &mut conn,
        RevisionInput {
            id: folder.id.clone(),
            expected_revision: folder.revision
        }
    )
    .is_err());
    let project = logs::create_project(&mut conn, "可编辑项目").unwrap();
    let empty = create(&mut conn, &project.id).unwrap();
    delete(
        &mut conn,
        RevisionInput {
            id: empty.id.clone(),
            expected_revision: empty.revision,
        },
    )
    .unwrap();
    assert!(get(&conn, &empty.id).is_err());
}
#[test]
fn deleting_folder_rolls_back_membership_and_container_if_order_update_fails() {
    let mut conn = db();
    let project = logs::create_project(&mut conn, "项目").unwrap();
    let folder = create(&mut conn, &project.id).unwrap();
    let page = logs::create_page(&mut conn, &project.id, "页面").unwrap();
    move_item(
        &mut conn,
        input(
            TreeKind::Page,
            &page.id,
            page.revision,
            &project.id,
            Some(&folder.id),
        ),
    )
    .unwrap();
    let before = serde_json::to_string(&logs::snapshot(&conn).unwrap()).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_page_reorder BEFORE UPDATE OF position ON dev_log_pages BEGIN SELECT RAISE(ABORT,'模拟写入失败'); END;").unwrap();
    assert!(delete(
        &mut conn,
        RevisionInput {
            id: folder.id.clone(),
            expected_revision: folder.revision
        }
    )
    .is_err());
    assert_eq!(
        serde_json::to_string(&logs::snapshot(&conn).unwrap()).unwrap(),
        before
    );
    assert_eq!(page_folder(&conn, &page.id).unwrap(), Some(folder.id));
}
fn input(
    kind: TreeKind,
    id: &str,
    revision: i64,
    project: &str,
    folder: Option<&str>,
) -> TreeMoveInput {
    TreeMoveInput {
        kind,
        id: id.into(),
        expected_revision: revision,
        project_id: project.into(),
        folder_id: folder.map(str::to_owned),
        before: None,
    }
}
#[test]
fn default_names_and_folder_rename_are_persisted() {
    let mut conn = db();
    let project = logs::create_project(&mut conn, "项目").unwrap();
    let first = create(&mut conn, &project.id).unwrap();
    let second = create(&mut conn, &project.id).unwrap();
    assert_eq!(first.title, "新建文件夹");
    assert_eq!(second.title, "新建文件夹 2");
    let renamed = rename(
        &mut conn,
        RenameInput {
            id: first.id.clone(),
            expected_revision: 1,
            title: "  电路图  ".into(),
        },
    )
    .unwrap();
    assert_eq!(renamed.title, "电路图");
    assert_eq!(renamed.revision, 2);
    assert!(rename(
        &mut conn,
        RenameInput {
            id: first.id,
            expected_revision: 1,
            title: "旧窗口".into()
        }
    )
    .is_err());
}
#[test]
fn pages_move_into_between_and_out_of_folders_without_rewriting_content_or_history() {
    let mut conn = db();
    let project = logs::create_project(&mut conn, "项目").unwrap();
    let page = logs::create_page(&mut conn, &project.id, "已有中文页面").unwrap();
    let first = create(&mut conn, &project.id).unwrap();
    let second = create(&mut conn, &project.id).unwrap();
    for target in [Some(first.id.as_str()), Some(second.id.as_str()), None] {
        let latest = logs::get_page(&conn, &page.id).unwrap();
        move_item(
            &mut conn,
            input(
                TreeKind::Page,
                &page.id,
                latest.revision,
                &project.id,
                target,
            ),
        )
        .unwrap();
        assert_eq!(page_folder(&conn, &page.id).unwrap().as_deref(), target);
        assert_eq!(
            logs::get_page(&conn, &page.id).unwrap().document_json,
            page.document_json
        );
        assert_eq!(logs::history(&conn, &page.id).unwrap().len(), 1);
    }
    assert_eq!(logs::snapshot(&conn).unwrap().pages.len(), 1);
}
#[test]
fn folders_and_root_pages_share_order_and_stale_moves_are_atomic() {
    let mut conn = db();
    let project = logs::create_project(&mut conn, "项目").unwrap();
    let page = logs::create_page(&mut conn, &project.id, "页面").unwrap();
    let folder = create(&mut conn, &project.id).unwrap();
    let mut movement = input(
        TreeKind::Folder,
        &folder.id,
        folder.revision,
        &project.id,
        None,
    );
    movement.before = Some(TreeTarget {
        kind: TreeKind::Page,
        id: page.id.clone(),
        expected_revision: page.revision,
    });
    move_item(&mut conn, movement.clone()).unwrap();
    let items = siblings(&conn, &project.id, None).unwrap();
    assert_eq!(items[0].id, folder.id);
    assert_eq!(items[1].id, page.id);
    let before = serde_json::to_string(&logs::snapshot(&conn).unwrap()).unwrap();
    assert!(move_item(&mut conn, movement).is_err());
    assert_eq!(
        before,
        serde_json::to_string(&logs::snapshot(&conn).unwrap()).unwrap()
    );
}
#[test]
fn cross_project_and_deleted_page_moves_are_rejected() {
    let mut conn = db();
    let project = logs::create_project(&mut conn, "项目A").unwrap();
    let other = logs::create_project(&mut conn, "项目B").unwrap();
    let page = logs::create_page(&mut conn, &project.id, "页面").unwrap();
    let foreign = create(&mut conn, &other.id).unwrap();
    assert!(move_item(
        &mut conn,
        input(
            TreeKind::Page,
            &page.id,
            page.revision,
            &project.id,
            Some(&foreign.id)
        )
    )
    .is_err());
    assert!(move_item(
        &mut conn,
        input(TreeKind::Page, &page.id, page.revision, &other.id, None)
    )
    .is_err());
    logs::delete_page(
        &mut conn,
        logs::RevisionInput {
            id: page.id.clone(),
            expected_revision: page.revision,
        },
    )
    .unwrap();
    assert!(move_item(
        &mut conn,
        input(
            TreeKind::Page,
            &page.id,
            page.revision + 1,
            &project.id,
            None
        )
    )
    .is_err());
}
#[test]
fn project_trash_restore_preserves_folders_and_purge_cleans_memberships() {
    let mut conn = db();
    let project = logs::create_project(&mut conn, "项目").unwrap();
    let page = logs::create_page(&mut conn, &project.id, "页面").unwrap();
    let folder = create(&mut conn, &project.id).unwrap();
    move_item(
        &mut conn,
        input(
            TreeKind::Page,
            &page.id,
            page.revision,
            &project.id,
            Some(&folder.id),
        ),
    )
    .unwrap();
    let deleted = logs::delete_project(
        &mut conn,
        logs::RevisionInput {
            id: project.id.clone(),
            expected_revision: project.revision,
        },
    )
    .unwrap();
    let restored = logs::restore_project(
        &mut conn,
        logs::RevisionInput {
            id: project.id.clone(),
            expected_revision: deleted.revision,
        },
    )
    .unwrap();
    assert_eq!(page_folder(&conn, &page.id).unwrap(), Some(folder.id));
    let deleted = logs::delete_project(
        &mut conn,
        logs::RevisionInput {
            id: project.id.clone(),
            expected_revision: restored.revision,
        },
    )
    .unwrap();
    let trash = logs::trash_snapshot(&conn).unwrap();
    logs::permanently_delete_project(
        &mut conn,
        logs::TrashPurgeInput {
            id: project.id,
            expected_revision: deleted.revision,
            snapshot_token: trash.snapshot_token,
        },
    )
    .unwrap();
    assert!(list(&conn).unwrap().is_empty());
    assert!(page_folder(&conn, &page.id).unwrap().is_none());
}
#[test]
fn v5_upgrade_backs_up_before_adding_folder_tables_and_preserves_pages() {
    use crate::repository::Repository;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("repo");
    let mut repo = Repository::open(root.to_str().unwrap(), true).unwrap();
    let project = logs::create_project(repo.connection_mut(), "项目").unwrap();
    let page = logs::create_page(repo.connection_mut(), &project.id, "已有页面").unwrap();
    repo.connection()
        .execute_batch(
            "DROP TABLE dev_log_page_folders; DROP TABLE dev_log_folders; PRAGMA user_version=5;",
        )
        .unwrap();
    drop(repo);
    let repo = Repository::open(root.to_str().unwrap(), false).unwrap();
    assert_eq!(
        repo.connection()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        6
    );
    assert_eq!(
        logs::get_page(repo.connection(), &page.id)
            .unwrap()
            .document_json,
        page.document_json
    );
    let backups = std::fs::read_dir(root.join("backups"))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(backups.len(), 1);
    let before = Connection::open_with_flags(
        backups[0].path().join("perfboard.sqlite3"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    assert_eq!(
        before
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        5
    );
    assert!(validate_schema(&before).is_err());
    assert_eq!(logs::get_page(&before, &page.id).unwrap().title, page.title);
}
