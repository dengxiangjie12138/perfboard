use crate::{
    backup_scheduler as backup, dev_logs as logs, edit_leases, external_tools,
    repository::{AppResult, Repository},
    repository_stats, tool_windows, AppState,
};
use tauri::{Emitter, Manager, State};

fn changed(app: &tauri::AppHandle, result: bool) {
    if result {
        let _ = app.emit("perfboard:data-changed", "workflow");
    }
}
fn permission(window: &tauri::WebviewWindow, resource: &str) -> AppResult<()> {
    edit_leases::validate_resource(resource)?;
    tool_windows::require_main_or_page(
        window,
        if resource.starts_with("note:") {
            "notes"
        } else {
            "dev-logs"
        },
    )
}
#[tauri::command]
pub fn edit_lease_acquire(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    resource: String,
) -> AppResult<edit_leases::EditLeaseStatus> {
    permission(&window, &resource)?;
    state.edit_leases.acquire(&resource, window.label())
}
#[tauri::command]
pub fn edit_lease_status(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    resource: String,
) -> AppResult<edit_leases::EditLeaseStatus> {
    permission(&window, &resource)?;
    state.edit_leases.status(&resource, window.label())
}
#[tauri::command]
pub fn edit_lease_release(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    resource: String,
) -> AppResult<()> {
    permission(&window, &resource)?;
    state.edit_leases.release(&resource, window.label())
}

#[tauri::command]
pub fn external_tools_list(
    state: State<'_, AppState>,
) -> AppResult<Vec<external_tools::ExternalTool>> {
    external_tools::list(crate::lock(&state)?.ready()?.connection())
}
#[tauri::command]
pub fn external_tools_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    tool: external_tools::ExternalToolInput,
) -> AppResult<()> {
    tool_windows::require_main_or_tool(&window, "external-tools")?;
    let r = external_tools::save(crate::lock(&state)?.ready()?.connection(), tool);
    changed(&app, r.is_ok());
    r
}
#[tauri::command]
pub fn external_tools_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    tool_windows::require_main_or_tool(&window, "external-tools")?;
    let r = external_tools::delete(crate::lock(&state)?.ready()?.connection(), &id);
    changed(&app, r.is_ok());
    r
}
#[tauri::command]
pub fn external_tools_launch(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    tool_windows::require_main_or_tool(&window, "external-tools")?;
    external_tools::launch(crate::lock(&state)?.ready()?.connection(), &id)
}
#[tauri::command]
pub fn repository_statistics(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<repository_stats::RepositoryStatistics> {
    tool_windows::require_main(&window)?;
    repository_stats::statistics(crate::lock(&state)?.ready()?)
}
#[tauri::command]
pub fn auto_backup_status(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<backup::AutoBackupStatus> {
    tool_windows::require_main(&window)?;
    backup::setting_load(crate::lock(&state)?.ready()?.connection())
}
#[tauri::command]
pub fn auto_backup_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    settings: backup::AutoBackupSettings,
) -> AppResult<backup::AutoBackupStatus> {
    tool_windows::require_main(&window)?;
    let result = backup::setting_save(crate::lock(&state)?.ready()?.connection(), settings);
    if result.is_ok() {
        state.backups.wake();
    }
    changed(&app, result.is_ok());
    result
}

struct SaveBarrier(tauri::AppHandle);
impl Drop for SaveBarrier {
    fn drop(&mut self) {
        tool_windows::finish_all_windows_flush(&self.0);
    }
}
/// Runs on a worker, never while holding the repository mutex during WebView acknowledgements.
pub fn with_flushed<T>(
    app: &tauri::AppHandle,
    operation: impl FnOnce(&AppState) -> AppResult<T>,
) -> AppResult<T> {
    let state = app.state::<AppState>();
    let _operation = state
        .operations
        .lock()
        .map_err(|_| "Repository operation lock is unavailable")?;
    tool_windows::flush_all_windows(app)?;
    let _barrier = SaveBarrier(app.clone());
    operation(&state)
}
pub fn run_scheduled(app: &tauri::AppHandle) -> AppResult<Option<backup::AutoBackupResult>> {
    if !tool_windows::all_windows_ready(app) {
        return Ok(None);
    }
    let now = chrono::Local::now();
    {
        let state = app.state::<AppState>();
        let mut manager = state
            .repository
            .lock()
            .map_err(|_| "Repository lock is unavailable")?;
        let Some(repo) = manager.repository.as_mut() else {
            return Ok(None);
        };
        if !backup::is_due(repo, now)? {
            return Ok(None);
        }
    }
    let result = with_flushed(app, |state| {
        let mut manager = state
            .repository
            .lock()
            .map_err(|_| "Repository lock is unavailable")?;
        backup::run_due(manager.ready()?, chrono::Local::now())
    });
    match result {
        Ok(value) => {
            changed(app, value.is_some());
            Ok(value)
        }
        Err(error) => {
            let state = app.state::<AppState>();
            let _operation = state
                .operations
                .lock()
                .map_err(|_| "Repository operation lock is unavailable")?;
            let mut manager = state
                .repository
                .lock()
                .map_err(|_| "Repository lock is unavailable")?;
            let result =
                backup::record_flush_failure(manager.ready()?, chrono::Local::now(), error);
            changed(app, true);
            result
        }
    }
}

#[tauri::command]
pub fn dev_logs_snapshot(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<logs::LogSnapshot> {
    tool_windows::require_main_or_page(&window, "dev-logs")?;
    logs::snapshot(crate::lock(&state)?.ready()?.connection())
}
#[tauri::command]
pub fn dev_log_page_get(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<logs::LogPage> {
    tool_windows::require_main_or_page(&window, "dev-logs")?;
    logs::get_page(crate::lock(&state)?.ready()?.connection(), &id)
}
#[tauri::command]
pub fn dev_log_page_history(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<logs::LogHistory>> {
    tool_windows::require_main_or_page(&window, "dev-logs")?;
    logs::history(crate::lock(&state)?.ready()?.connection(), &id)
}

fn log_mutation<T>(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    state: &State<'_, AppState>,
    work: impl FnOnce(&mut Repository, &edit_leases::EditLeaseWriteGuard<'_>) -> AppResult<T>,
) -> AppResult<T> {
    tool_windows::require_main_or_page(window, "dev-logs")?;
    let guard = state.edit_leases.lock_for_repository_switch()?;
    let result = {
        let mut manager = crate::lock(state)?;
        work(manager.ready()?, &guard)
    };
    drop(guard);
    changed(app, result.is_ok());
    result
}
fn resources(
    repo: &Repository,
    project: Option<&str>,
    ids: Option<&[logs::RevisionInput]>,
) -> AppResult<Vec<String>> {
    let snapshot = logs::snapshot(repo.connection())?;
    Ok(snapshot
        .pages
        .into_iter()
        .filter(|p| {
            project.is_none_or(|id| p.project_id == id)
                && ids.is_none_or(|items| items.iter().any(|item| item.id == p.id))
        })
        .map(|p| format!("log:{}", p.id))
        .collect())
}
#[tauri::command]
pub fn dev_log_project_create(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    title: String,
) -> AppResult<logs::LogProject> {
    log_mutation(&app, &window, &state, |r, _| {
        logs::create_project(r.connection_mut(), &title)
    })
}
#[tauri::command]
pub fn dev_log_folder_create(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    project_id: String,
) -> AppResult<logs::LogFolder> {
    log_mutation(&app, &window, &state, |repo, _| {
        logs::create_folder(repo.connection_mut(), &project_id)
    })
}
#[tauri::command]
pub fn dev_log_folder_rename(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::RenameInput,
) -> AppResult<logs::LogFolder> {
    log_mutation(&app, &window, &state, |repo, _| {
        logs::rename_folder(repo.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_folder_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::RevisionInput,
) -> AppResult<()> {
    log_mutation(&app, &window, &state, |repo, guard| {
        let snapshot = logs::snapshot(repo.connection())?;
        let folder = snapshot
            .folders
            .iter()
            .find(|folder| folder.id == input.id)
            .ok_or("文件夹不存在，请刷新后重试")?;
        guard.assert_resources_available(
            &resources(repo, Some(&folder.project_id), None)?,
            window.label(),
        )?;
        logs::delete_folder(repo.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_tree_move(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::TreeMoveInput,
) -> AppResult<()> {
    log_mutation(&app, &window, &state, |repo, guard| {
        guard.assert_resources_available(
            &resources(repo, Some(&input.project_id), None)?,
            window.label(),
        )?;
        logs::move_tree_item(repo.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_project_rename(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::RenameInput,
) -> AppResult<logs::LogProject> {
    log_mutation(&app, &window, &state, |r, g| {
        g.assert_resources_available(&resources(r, Some(&input.id), None)?, window.label())?;
        logs::rename_project(r.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_project_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::RevisionInput,
) -> AppResult<logs::LogProject> {
    log_mutation(&app, &window, &state, |r, g| {
        g.assert_resources_available(&resources(r, Some(&input.id), None)?, window.label())?;
        logs::delete_project(r.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_project_restore(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::RevisionInput,
) -> AppResult<logs::LogProject> {
    log_mutation(&app, &window, &state, |r, g| {
        g.assert_resources_available(&resources(r, Some(&input.id), None)?, window.label())?;
        logs::restore_project(r.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_projects_reorder(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    items: Vec<logs::RevisionInput>,
) -> AppResult<Vec<logs::LogProject>> {
    log_mutation(&app, &window, &state, |r, _| {
        logs::reorder_projects(r.connection_mut(), items)
    })
}
#[tauri::command]
pub fn dev_log_page_create(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    project_id: String,
    title: String,
) -> AppResult<logs::LogPage> {
    log_mutation(&app, &window, &state, |r, _| {
        logs::create_page(r.connection_mut(), &project_id, &title)
    })
}
#[tauri::command]
pub fn dev_log_page_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::PageSaveInput,
) -> AppResult<logs::LogPage> {
    tool_windows::require_main_or_page(&window, "dev-logs")?;
    let _g = state
        .edit_leases
        .assert_can_write(&format!("log:{}", input.id), window.label())?;
    let result = logs::save_page(crate::lock(&state)?.ready()?.connection_mut(), input);
    changed(&app, result.is_ok());
    result
}
#[tauri::command]
pub fn dev_log_page_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::RevisionInput,
) -> AppResult<logs::LogPage> {
    log_mutation(&app, &window, &state, |r, g| {
        g.assert_resources_available(&[format!("log:{}", input.id)], window.label())?;
        logs::delete_page(r.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_page_restore(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::RevisionInput,
) -> AppResult<logs::LogPage> {
    log_mutation(&app, &window, &state, |r, g| {
        g.assert_resources_available(&[format!("log:{}", input.id)], window.label())?;
        logs::restore_page(r.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_pages_reorder(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    project_id: String,
    items: Vec<logs::RevisionInput>,
) -> AppResult<Vec<logs::LogPage>> {
    log_mutation(&app, &window, &state, |r, g| {
        g.assert_resources_available(
            &resources(r, Some(&project_id), Some(&items))?,
            window.label(),
        )?;
        logs::reorder_pages(r.connection_mut(), &project_id, items)
    })
}
#[tauri::command]
pub fn dev_log_page_restore_history(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::HistoryRestoreInput,
) -> AppResult<logs::LogPage> {
    tool_windows::require_main_or_page(&window, "dev-logs")?;
    let _g = state
        .edit_leases
        .assert_can_write(&format!("log:{}", input.id), window.label())?;
    let result = logs::restore_history(crate::lock(&state)?.ready()?.connection_mut(), input);
    changed(&app, result.is_ok());
    result
}

#[tauri::command]
pub fn dev_log_trash_snapshot(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<logs::TrashSnapshot> {
    tool_windows::require_main_or_page(&window, "dev-logs")?;
    logs::trash_snapshot(crate::lock(&state)?.ready()?.connection())
}
#[tauri::command]
pub fn dev_log_project_purge(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::TrashPurgeInput,
) -> AppResult<logs::TrashDeleteResult> {
    log_mutation(&app, &window, &state, |r, g| {
        g.assert_resources_available(&resources(r, Some(&input.id), None)?, window.label())?;
        logs::permanently_delete_project(r.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_page_purge(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::TrashPurgeInput,
) -> AppResult<logs::TrashDeleteResult> {
    log_mutation(&app, &window, &state, |r, g| {
        g.assert_resources_available(&[format!("log:{}", input.id)], window.label())?;
        logs::permanently_delete_page(r.connection_mut(), input)
    })
}
#[tauri::command]
pub fn dev_log_trash_clear(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: logs::TrashClearInput,
) -> AppResult<logs::TrashDeleteResult> {
    log_mutation(&app, &window, &state, |r, g| {
        let affected = logs::trash_snapshot(r.connection())?
            .pages
            .into_iter()
            .map(|page| format!("log:{}", page.id))
            .collect::<Vec<_>>();
        g.assert_resources_available(&affected, window.label())?;
        logs::clear_trash(r.connection_mut(), input)
    })
}
