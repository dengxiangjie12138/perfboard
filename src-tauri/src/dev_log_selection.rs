//! Restore development-log navigation only; drafts and documents remain in their editors.
use crate::{
    edit_leases::{EditLeaseWriteGuard, EditLeases},
    repository::AppResult,
    tool_windows,
    view_state::{ViewSelection, ViewStateStore},
    AppState,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};
use tauri::{Manager, State};

const VIEW_KEY: &str = "dev-logs";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionOutput {
    pub repository_key: String,
    pub project_id: Option<String>,
    pub page_id: Option<String>,
    pub has_saved_selection: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionSaveInput {
    pub repository_key: String,
    pub project_id: Option<String>,
    pub page_id: Option<String>,
}

/// An unavailable optional store is still managed, so startup remains usable and
/// feature commands can explain the failure instead of losing all application state.
pub struct SelectionService {
    store: Mutex<AppResult<ViewStateStore>>,
}

impl SelectionService {
    fn with_store<T>(
        &self,
        operation: impl FnOnce(&ViewStateStore) -> AppResult<T>,
    ) -> AppResult<T> {
        let state = self
            .store
            .lock()
            .map_err(|_| "日志选择记录暂不可用：状态锁无法访问".to_owned())?;
        let store = state
            .as_ref()
            .map_err(|error| format!("日志选择记录暂不可用：{error}"))?;
        operation(store).map_err(|error| format!("日志选择记录操作失败：{error}"))
    }
}

/// Store/configuration errors are optional-feature errors, not setup failures.
/// Only duplicate service registration is a programming error returned to setup.
pub fn initialize(app: &tauri::AppHandle) -> AppResult<()> {
    let opened = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())
        .and_then(|directory| ViewStateStore::open(&crate::config_directory(directory)));
    if !app.manage(SelectionService {
        store: Mutex::new(opened),
    }) {
        return Err("Log selection service was already initialized".into());
    }
    Ok(())
}

/// Repository::root is already canonical and is revalidated by manager.ready().
/// Keep filename case intact for case-sensitive directories, strip the Windows
/// verbatim prefix, and use one separator spelling for a stable native key.
fn repository_key(root: &Path) -> AppResult<String> {
    let value = root
        .to_str()
        .ok_or("日志选择记录无法使用非 Unicode 仓库路径")?;
    #[cfg(windows)]
    let value = if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(value).to_owned()
    }
    .replace('\\', "/");
    #[cfg(not(windows))]
    let value = value.to_owned();
    Ok(value)
}

fn active_project(connection: &Connection, project_id: &str) -> AppResult<bool> {
    connection
        .query_row(
            "SELECT 1 FROM dev_log_projects WHERE id=?1 AND deleted_at IS NULL",
            [project_id],
            |_| Ok(()),
        )
        .optional()
        .map(|value| value.is_some())
        .map_err(|error| error.to_string())
}

fn active_page_project(connection: &Connection, page_id: &str) -> AppResult<Option<String>> {
    connection
        .query_row(
            "SELECT page.project_id FROM dev_log_pages AS page
             JOIN dev_log_projects AS project ON project.id=page.project_id
             WHERE page.id=?1 AND page.deleted_at IS NULL AND project.deleted_at IS NULL",
            [page_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn resolve_selection(
    connection: &Connection,
    current_repository_key: &str,
    saved: Option<ViewSelection>,
) -> AppResult<SelectionOutput> {
    let mut output = SelectionOutput {
        repository_key: current_repository_key.to_owned(),
        project_id: None,
        page_id: None,
        has_saved_selection: saved.is_some(),
    };
    let Some(saved) = saved else {
        return Ok(output);
    };
    let Some(project_id) = saved.container_id else {
        return Ok(output);
    };
    if !active_project(connection, &project_id)? {
        return Ok(output);
    }
    if let Some(page_id) = saved.item_id {
        if active_page_project(connection, &page_id)?.as_deref() == Some(project_id.as_str()) {
            output.page_id = Some(page_id);
        }
    }
    output.project_id = Some(project_id);
    Ok(output)
}

fn selection_write_guard<'a>(
    leases: &'a EditLeases,
    sender_label: &str,
    input: &SelectionSaveInput,
) -> AppResult<EditLeaseWriteGuard<'a>> {
    if let Some(page_id) = &input.page_id {
        leases.assert_can_write(&format!("log:{page_id}"), sender_label)
    } else {
        leases.lock_for_repository_switch()
    }
}

fn validate_save(
    connection: &Connection,
    current_repository_key: &str,
    input: &SelectionSaveInput,
) -> AppResult<ViewSelection> {
    if input.repository_key != current_repository_key {
        return Err("[repository-changed] 资料仓库已切换，请重新读取日志选择后再试。".into());
    }
    if input.page_id.is_some() && input.project_id.is_none() {
        return Err("记录页面选择时必须指定所属项目".into());
    }
    if let Some(project_id) = &input.project_id {
        if !active_project(connection, project_id)? {
            return Err("所选日志项目不存在或已在回收站".into());
        }
    }
    if let Some(page_id) = &input.page_id {
        if active_page_project(connection, page_id)?.as_deref() != input.project_id.as_deref() {
            return Err("所选日志页面不存在、已在回收站或不属于该项目".into());
        }
    }
    Ok(ViewSelection {
        container_id: input.project_id.clone(),
        item_id: input.page_id.clone(),
    })
}

/// The command owns the lease -> repository -> store lock order around this work.
fn persist_selection(
    connection: &Connection,
    store: &ViewStateStore,
    current_repository_key: &str,
    sender_label: &str,
    input: &SelectionSaveInput,
) -> AppResult<SelectionOutput> {
    let validated = validate_save(connection, current_repository_key, input)?;
    store.save(current_repository_key, VIEW_KEY, sender_label, &validated)?;
    Ok(SelectionOutput {
        repository_key: current_repository_key.to_owned(),
        project_id: validated.container_id,
        page_id: validated.item_id,
        has_saved_selection: true,
    })
}

#[tauri::command]
pub fn dev_log_selection_get(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    selection: State<'_, SelectionService>,
) -> AppResult<SelectionOutput> {
    tool_windows::require_main_or_page(&window, VIEW_KEY)?;
    let mut manager = crate::lock(&state)?;
    let repository = manager.ready()?;
    let key = repository_key(&repository.root)?;
    selection.with_store(|store| {
        resolve_selection(
            repository.connection(),
            &key,
            store.load(&key, VIEW_KEY, window.label())?,
        )
    })
}

#[tauri::command]
pub fn dev_log_selection_save(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    selection: State<'_, SelectionService>,
    input: SelectionSaveInput,
) -> AppResult<SelectionOutput> {
    tool_windows::require_main_or_page(&window, VIEW_KEY)?;
    let _lease = selection_write_guard(&state.edit_leases, window.label(), &input)?;
    let mut manager = crate::lock(&state)?;
    let repository = manager.ready()?;
    let key = repository_key(&repository.root)?;
    selection.with_store(|store| {
        persist_selection(repository.connection(), store, &key, window.label(), &input)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn warehouse() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE dev_log_projects(id TEXT PRIMARY KEY,deleted_at TEXT);
                 CREATE TABLE dev_log_pages(id TEXT PRIMARY KEY,project_id TEXT,deleted_at TEXT);
                 INSERT INTO dev_log_projects VALUES('project-a',NULL),('project-b',NULL),('project-deleted','deleted');
                 INSERT INTO dev_log_pages VALUES
                    ('page-a','project-a',NULL),('page-b','project-b',NULL),
                    ('page-deleted','project-a','deleted'),('page-in-deleted-project','project-deleted',NULL);",
            )
            .unwrap();
        connection
    }

    fn saved(project: Option<&str>, page: Option<&str>) -> ViewSelection {
        ViewSelection {
            container_id: project.map(str::to_owned),
            item_id: page.map(str::to_owned),
        }
    }

    fn input(key: &str, project: Option<&str>, page: Option<&str>) -> SelectionSaveInput {
        SelectionSaveInput {
            repository_key: key.into(),
            project_id: project.map(str::to_owned),
            page_id: page.map(str::to_owned),
        }
    }

    #[test]
    fn never_saved_and_explicitly_cleared_are_distinct() {
        let db = warehouse();
        let unseen = resolve_selection(&db, "A", None).unwrap();
        assert!(!unseen.has_saved_selection);
        assert_eq!(unseen.project_id, None);
        assert_eq!(unseen.page_id, None);
        let cleared = resolve_selection(&db, "A", Some(ViewSelection::default())).unwrap();
        assert!(cleared.has_saved_selection);
        assert_eq!(cleared.project_id, None);
        assert_eq!(cleared.page_id, None);
    }

    #[test]
    fn restores_only_the_active_page_in_its_saved_project() {
        let db = warehouse();
        let value =
            resolve_selection(&db, "A", Some(saved(Some("project-a"), Some("page-a")))).unwrap();
        assert_eq!(value.project_id.as_deref(), Some("project-a"));
        assert_eq!(value.page_id.as_deref(), Some("page-a"));
        assert!(value.has_saved_selection);
    }

    #[test]
    fn missing_deleted_or_mismatched_page_keeps_only_the_valid_project() {
        let db = warehouse();
        for page in [
            "page-missing",
            "page-deleted",
            "page-b",
            "page-in-deleted-project",
        ] {
            let value =
                resolve_selection(&db, "A", Some(saved(Some("project-a"), Some(page)))).unwrap();
            assert_eq!(value.project_id.as_deref(), Some("project-a"), "{page}");
            assert_eq!(value.page_id, None, "{page}");
            assert!(value.has_saved_selection);
        }
    }

    #[test]
    fn missing_or_deleted_project_never_selects_an_unrelated_page() {
        let db = warehouse();
        for project in ["project-missing", "project-deleted"] {
            let value =
                resolve_selection(&db, "A", Some(saved(Some(project), Some("page-a")))).unwrap();
            assert_eq!(value.project_id, None, "{project}");
            assert_eq!(value.page_id, None, "{project}");
            assert!(value.has_saved_selection);
        }
    }

    #[test]
    fn project_only_selection_remains_project_only() {
        let db = warehouse();
        let value = resolve_selection(&db, "A", Some(saved(Some("project-b"), None))).unwrap();
        assert_eq!(value.project_id.as_deref(), Some("project-b"));
        assert_eq!(value.page_id, None);
        assert!(value.has_saved_selection);
    }

    #[test]
    fn same_ids_in_another_repository_do_not_restore_the_first_repository() {
        let config = tempfile::tempdir().unwrap();
        let store = ViewStateStore::open(config.path()).unwrap();
        let a = warehouse();
        let b = warehouse();
        persist_selection(
            &a,
            &store,
            "A",
            "main",
            &input("A", Some("project-a"), Some("page-a")),
        )
        .unwrap();
        let absent =
            resolve_selection(&b, "B", store.load("B", VIEW_KEY, "main").unwrap()).unwrap();
        assert!(!absent.has_saved_selection);
        assert_eq!(absent.page_id, None);
        persist_selection(
            &b,
            &store,
            "B",
            "main",
            &input("B", Some("project-a"), None),
        )
        .unwrap();
        let from_a =
            resolve_selection(&a, "A", store.load("A", VIEW_KEY, "main").unwrap()).unwrap();
        let from_b =
            resolve_selection(&b, "B", store.load("B", VIEW_KEY, "main").unwrap()).unwrap();
        assert_eq!(from_a.page_id.as_deref(), Some("page-a"));
        assert_eq!(from_b.project_id.as_deref(), Some("project-a"));
        assert_eq!(from_b.page_id, None);
    }

    #[test]
    fn child_window_saves_do_not_change_the_main_window_selection() {
        let config = tempfile::tempdir().unwrap();
        let store = ViewStateStore::open(config.path()).unwrap();
        let db = warehouse();
        for (label, project, page) in [
            ("main", Some("project-a"), Some("page-a")),
            ("window-dev-logs", Some("project-b"), Some("page-b")),
            ("window-dev-logs-2", Some("project-a"), None),
        ] {
            persist_selection(&db, &store, "A", label, &input("A", project, page)).unwrap();
        }
        let main = resolve_selection(&db, "A", store.load("A", VIEW_KEY, "main").unwrap()).unwrap();
        let first = resolve_selection(
            &db,
            "A",
            store.load("A", VIEW_KEY, "window-dev-logs").unwrap(),
        )
        .unwrap();
        let second = resolve_selection(
            &db,
            "A",
            store.load("A", VIEW_KEY, "window-dev-logs-2").unwrap(),
        )
        .unwrap();
        assert_eq!(main.page_id.as_deref(), Some("page-a"));
        assert_eq!(first.page_id.as_deref(), Some("page-b"));
        assert_eq!(second.project_id.as_deref(), Some("project-a"));
        assert_eq!(second.page_id, None);
    }

    #[test]
    fn read_only_and_unclaimed_pages_cannot_write_selection_history() {
        let config = tempfile::tempdir().unwrap();
        let store = ViewStateStore::open(config.path()).unwrap();
        let db = warehouse();
        let leases = EditLeases::default();
        let request = input("A", Some("project-a"), Some("page-a"));
        assert!(selection_write_guard(&leases, "main", &request).is_err());
        leases.acquire("log:page-a", "window-dev-logs").unwrap();
        let result = selection_write_guard(&leases, "main", &request)
            .and_then(|_guard| persist_selection(&db, &store, "A", "main", &request));
        assert!(result.is_err());
        assert_eq!(store.load("A", VIEW_KEY, "main").unwrap(), None);
        let result = selection_write_guard(&leases, "window-dev-logs", &request)
            .and_then(|_guard| persist_selection(&db, &store, "A", "window-dev-logs", &request));
        assert!(result.is_ok());
        assert_eq!(store.load("A", VIEW_KEY, "main").unwrap(), None);
        assert!(store
            .load("A", VIEW_KEY, "window-dev-logs")
            .unwrap()
            .is_some());
    }

    #[test]
    fn old_repository_request_cannot_overwrite_the_new_repository_selection() {
        let config = tempfile::tempdir().unwrap();
        let store = ViewStateStore::open(config.path()).unwrap();
        let db = warehouse();
        persist_selection(
            &db,
            &store,
            "B",
            "main",
            &input("B", Some("project-b"), Some("page-b")),
        )
        .unwrap();
        let failure = persist_selection(
            &db,
            &store,
            "B",
            "main",
            &input("A", Some("project-a"), Some("page-a")),
        )
        .unwrap_err();
        assert!(failure.contains("[repository-changed]"));
        let retained =
            resolve_selection(&db, "B", store.load("B", VIEW_KEY, "main").unwrap()).unwrap();
        assert_eq!(retained.project_id.as_deref(), Some("project-b"));
        assert_eq!(retained.page_id.as_deref(), Some("page-b"));
        assert_eq!(store.load("A", VIEW_KEY, "main").unwrap(), None);
    }

    #[test]
    fn saves_allow_clear_and_project_only_but_reject_invalid_page_contexts() {
        let db = warehouse();
        assert_eq!(
            validate_save(&db, "A", &input("A", None, None)).unwrap(),
            ViewSelection::default()
        );
        assert_eq!(
            validate_save(&db, "A", &input("A", Some("project-a"), None)).unwrap(),
            saved(Some("project-a"), None)
        );
        for (project, page) in [
            (None, Some("page-a")),
            (Some("project-a"), Some("page-b")),
            (Some("project-a"), Some("page-deleted")),
            (Some("project-deleted"), Some("page-in-deleted-project")),
            (Some("project-missing"), None),
            (Some("project-a"), Some("page-missing")),
        ] {
            assert!(
                validate_save(&db, "A", &input("A", project, page)).is_err(),
                "{project:?} {page:?}"
            );
        }
    }

    #[test]
    fn payload_contains_only_selection_and_rejects_drafts_or_scope_spoofing() {
        let allowed = json!({"repositoryKey":"A","projectId":"project-a","pageId":"page-a"});
        let parsed: SelectionSaveInput = serde_json::from_value(allowed.clone()).unwrap();
        assert_eq!(parsed.page_id.as_deref(), Some("page-a"));
        for field in [
            "documentJson",
            "document",
            "draft",
            "windowLabel",
            "windowScope",
        ] {
            let mut denied = allowed.clone();
            denied[field] = json!("do not persist");
            assert!(
                serde_json::from_value::<SelectionSaveInput>(denied).is_err(),
                "{field}"
            );
        }
        let output = resolve_selection(
            &warehouse(),
            "A",
            Some(saved(Some("project-a"), Some("page-a"))),
        )
        .unwrap();
        let encoded = serde_json::to_value(output).unwrap();
        assert_eq!(
            encoded,
            json!({"repositoryKey":"A","projectId":"project-a","pageId":"page-a","hasSavedSelection":true})
        );
    }

    #[test]
    fn unavailable_store_is_a_visible_feature_error_without_panicking() {
        let service = SelectionService {
            store: Mutex::new(Err("private test store unavailable".into())),
        };
        let failure = service
            .with_store(|store| store.load("A", VIEW_KEY, "main"))
            .unwrap_err();
        assert!(failure.contains("日志选择记录暂不可用"));
        assert!(failure.contains("private test store unavailable"));
    }

    #[cfg(windows)]
    #[test]
    fn native_repository_keys_normalize_verbatim_and_unc_spelling_without_case_folding() {
        assert_eq!(
            repository_key(Path::new(r"\\?\D:\Warehouse\A")).unwrap(),
            "D:/Warehouse/A"
        );
        assert_eq!(
            repository_key(Path::new(r"D:\Warehouse\A")).unwrap(),
            "D:/Warehouse/A"
        );
        assert_eq!(
            repository_key(Path::new(r"\\?\UNC\server\share\A")).unwrap(),
            "//server/share/A"
        );
        assert_ne!(
            repository_key(Path::new(r"D:\Warehouse\A")).unwrap(),
            repository_key(Path::new(r"D:\Warehouse\a")).unwrap()
        );
    }
}
