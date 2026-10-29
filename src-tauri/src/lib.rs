mod backup_scheduler;
mod dev_log_pdf;
mod dev_log_selection;
mod dev_logs;
mod edit_leases;
mod external_tools;
mod hardware_calculators;
mod log_resource_ipc;
mod log_resources;
mod models;
mod opamp;
mod repository;
mod repository_stats;
mod standing_reminder;
mod startup;
mod tool_windows;
mod transformer_designs;
mod transformer_ipc;
mod view_state;
mod updates;
mod workflow_ipc;
use models::*;
use repository::{validate_url, AppResult, RepositoryManager};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, MutexGuard,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};

struct AppState {
    repository: Mutex<RepositoryManager>,
    tray_ready: AtomicBool,
    quit_confirmed: AtomicBool,
    windows: tool_windows::WindowState,
    edit_leases: edit_leases::EditLeases,
    operations: Mutex<()>,
    backups: backup_scheduler::BackupScheduler,
    transformer_imports: Mutex<transformer_designs::ImportPreviews>,
}
fn lock<'a>(state: &'a State<'_, AppState>) -> AppResult<MutexGuard<'a, RepositoryManager>> {
    state
        .repository
        .lock()
        .map_err(|_| "Repository lock is unavailable".into())
}
#[tauri::command]
fn repo_status(state: State<'_, AppState>) -> AppResult<RepoStatus> {
    Ok(lock(&state)?.status())
}
#[tauri::command]
async fn repo_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
    create: bool,
) -> AppResult<RepoStatus> {
    tool_windows::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = workflow_ipc::with_flushed(&app, |state| {
            let mut leases = state.edit_leases.lock_for_repository_switch()?;
            let mut manager = state
                .repository
                .lock()
                .map_err(|_| "Repository lock is unavailable")?;
            let result = manager.open(&path, create);
            if result.is_ok() {
                leases.clear_all();
                if let Ok(mut previews) = state.transformer_imports.lock() {
                    previews.clear();
                }
                let _ = app.emit("perfboard:data-changed", "repository");
            }
            result
        });
        if result.is_ok() {
            app.state::<AppState>().backups.wake();
        }
        result
    })
    .await
    .map_err(|e| format!("Repository worker failed: {e}"))?
}
#[tauri::command]
fn data_snapshot(state: State<'_, AppState>) -> AppResult<Snapshot> {
    lock(&state)?.ready()?.snapshot()
}
#[tauri::command]
fn part_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    part: PartInput,
) -> AppResult<Part> {
    tool_windows::require_main_or_page(&window, "parts")?;
    let result = { lock(&state)?.ready()?.part_save(part) };
    if result.is_ok() {
        let _ = app.emit("perfboard:data-changed", "snapshot");
    }
    result
}
#[tauri::command]
fn part_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    tool_windows::require_main_or_page(&window, "parts")?;
    let result = { lock(&state)?.ready()?.part_delete(&id) };
    if result.is_ok() {
        let _ = app.emit("perfboard:data-changed", "snapshot");
    }
    result
}
#[tauri::command]
fn note_get(state: State<'_, AppState>, id: String) -> AppResult<Note> {
    lock(&state)?.ready()?.note_get(&id)
}
#[tauri::command]
fn note_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    note: NoteInput,
) -> AppResult<Note> {
    tool_windows::require_main_or_page(&window, "notes")?;
    if note.expected_revision.is_none() {
        return Err("Missing expected note revision".into());
    }
    let _lease = state
        .edit_leases
        .assert_can_write(&format!("note:{}", note.id), window.label())?;
    let result = { lock(&state)?.ready()?.note_save(note) };
    if result.is_ok() {
        let _ = app.emit("perfboard:data-changed", "snapshot");
    }
    result
}
#[tauri::command]
fn note_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    tool_windows::require_main_or_page(&window, "notes")?;
    let _lease = state
        .edit_leases
        .assert_available(&format!("note:{id}"), window.label())?;
    let result = { lock(&state)?.ready()?.note_delete(&id) };
    if result.is_ok() {
        let _ = app.emit("perfboard:data-changed", "snapshot");
    }
    result
}
#[tauri::command]
fn attachment_import(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    part_id: String,
    source_path: String,
) -> AppResult<Attachment> {
    tool_windows::require_main_or_page(&window, "parts")?;
    let result = {
        lock(&state)?
            .ready()?
            .attachment_import(&part_id, &source_path)
    };
    if result.is_ok() {
        let _ = app.emit("perfboard:data-changed", "snapshot");
    }
    result
}
#[tauri::command]
fn attachment_add_url(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    part_id: String,
    url: String,
    name: String,
) -> AppResult<Attachment> {
    tool_windows::require_main_or_page(&window, "parts")?;
    let result = {
        lock(&state)?
            .ready()?
            .attachment_add_url(&part_id, &url, &name)
    };
    if result.is_ok() {
        let _ = app.emit("perfboard:data-changed", "snapshot");
    }
    result
}
#[tauri::command]
fn attachment_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    tool_windows::require_main_or_page(&window, "parts")?;
    let result = { lock(&state)?.ready()?.attachment_delete(&id) };
    if result.is_ok() {
        let _ = app.emit("perfboard:data-changed", "snapshot");
    }
    result
}
#[tauri::command]
fn attachment_open(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    tool_windows::require_main_or_page(&window, "parts")?;
    let target = lock(&state)?.ready()?.attachment_target(&id)?;
    open::that_detached(target).map_err(|e| format!("Could not open attachment: {e}"))
}
#[tauri::command]
fn external_url_open(window: tauri::WebviewWindow, url: String) -> AppResult<()> {
    tool_windows::require_main(&window)?;
    open::that_detached(validate_url(&url)?).map_err(|e| format!("Could not open URL: {e}"))
}
#[tauri::command]
fn setting_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> AppResult<()> {
    tool_windows::require_main(&window)?;
    let result = { lock(&state)?.ready()?.setting_save(&key, &value) };
    if result.is_ok() {
        let _ = app.emit("perfboard:data-changed", "snapshot");
    }
    result
}
#[tauri::command]
async fn repository_backup(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    destination: String,
) -> AppResult<String> {
    tool_windows::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        workflow_ipc::with_flushed(&app, |state| {
            state
                .repository
                .lock()
                .map_err(|_| "Repository lock is unavailable")?
                .ready()?
                .backup(&destination)
        })
    })
    .await
    .map_err(|e| format!("Backup worker failed: {e}"))?
}
#[tauri::command]
fn app_close_request(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    action: String,
) -> AppResult<()> {
    tool_windows::require_main(&window)?;
    if !matches!(action.as_str(), "hide" | "quit") {
        return Err("Invalid close action".into());
    }
    request_close(&app, &action);
    Ok(())
}
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn request_close(app: &tauri::AppHandle, requested: &str) {
    tool_windows::request_main_close(app, requested);
}
fn preferred_close(app: &tauri::AppHandle) -> String {
    let state = app.state::<AppState>();
    state
        .repository
        .lock()
        .ok()
        .and_then(|mut manager| manager.ready().ok().and_then(|r| r.snapshot().ok()))
        .and_then(|s| s.settings.get("closeAction").cloned())
        .filter(|v| v == "quit")
        .unwrap_or_else(|| "hide".into())
}
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "打开 Perfboard", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏到托盘", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "保存并退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    let icon = app
        .default_window_icon()
        .ok_or("Application icon unavailable")?
        .clone();
    TrayIconBuilder::with_id("perfboard-tray")
        .icon(icon)
        .tooltip("Perfboard 工程工具箱")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "hide" => request_close(app, "hide"),
            "quit" => {
                show_main(app);
                request_close(app, "quit");
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    app.state::<AppState>()
        .tray_ready
        .store(true, Ordering::SeqCst);
    Ok(())
}
fn config_directory(default: std::path::PathBuf) -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("PERFBOARD_TEST_CONFIG_DIR") {
        return std::path::PathBuf::from(path);
    }
    default
}
fn initialize_from_cli() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    let action = args.next()?;
    let action = action.to_str()?;
    if !matches!(action, "--initialize-repository" | "--validate-repository") {
        return None;
    }
    let result = (|| -> AppResult<()> {
        let path = args.next().ok_or("Missing repository path")?;
        if args.next().is_some() {
            return Err("Unexpected initialization arguments".into());
        }
        let raw = path.to_str().ok_or("Repository path is not Unicode")?;
        if action == "--validate-repository" {
            return repository::Repository::validate(raw);
        }
        #[cfg(target_os = "windows")]
        let config =
            std::path::PathBuf::from(std::env::var_os("APPDATA").ok_or("APPDATA unavailable")?)
                .join("com.perfboard.toolbox");
        #[cfg(not(target_os = "windows"))]
        let config = return Err("Installer initialization is only supported on Windows".into());
        RepositoryManager::load(config_directory(config)).open(raw, true)?;
        Ok(())
    })();
    match result {
        Ok(()) => Some(0),
        Err(e) => {
            eprintln!("Perfboard repository initialization failed: {e}");
            Some(1)
        }
    }
}
pub fn run() {
    if let Some(code) = initialize_from_cli() {
        std::process::exit(code);
    }
    let app = tauri::Builder::default()
        // Keep first: another process must not open a second SQLite connection.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !startup::is_autostart_args(args) {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            let config = config_directory(app.path().app_config_dir()?);
            let mut repository = RepositoryManager::load(config);
            let theme = repository
                .ready()
                .ok()
                .and_then(|repo| repo.snapshot().ok())
                .and_then(|snapshot| snapshot.settings.get("theme").cloned())
                .filter(|theme| matches!(theme.as_str(), "light" | "dark" | "codex"))
                .unwrap_or_else(|| "codex".into());
            app.manage(AppState {
                repository: Mutex::new(repository),
                tray_ready: AtomicBool::new(false),
                quit_confirmed: AtomicBool::new(false),
                windows: tool_windows::WindowState::new(theme),
                edit_leases: edit_leases::EditLeases::default(),
                operations: Mutex::new(()),
                backups: backup_scheduler::BackupScheduler::default(),
                transformer_imports: Mutex::new(transformer_designs::ImportPreviews::default()),
            });
            if let Err(error) = setup_tray(app) {
                eprintln!("System tray unavailable: {error}; close will request a saved quit.");
            }
            standing_reminder::initialize(app.handle())?;
            dev_log_selection::initialize(app.handle())?;
            updates::initialize(app.handle())?;
            let handle = app.handle().clone();
            app.state::<AppState>()
                .backups
                .start(move || workflow_ipc::run_scheduled(&handle));
            if startup::should_show_main(
                std::env::args_os().skip(1),
                app.state::<AppState>().tray_ready.load(Ordering::SeqCst),
            ) {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                standing_reminder::prompt_destroyed(window.app_handle(), window.label());
                tool_windows::window_destroyed(window.app_handle(), window.label());
                let _ = window
                    .app_handle()
                    .state::<AppState>()
                    .edit_leases
                    .release_window(window.label());
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                if !state.quit_confirmed.load(Ordering::SeqCst) {
                    if standing_reminder::handle_prompt_close(window.app_handle(), window.label()) {
                        api.prevent_close();
                    } else if window.label() == "main" {
                        api.prevent_close();
                        request_close(window.app_handle(), &preferred_close(window.app_handle()));
                    } else if tool_windows::is_tool_label(window.label()) {
                        if !state.windows.consume_tool_close(window.label()) {
                            api.prevent_close();
                            if let Err(error) = tool_windows::request_tool_close(
                                window.app_handle(),
                                window.label(),
                            ) {
                                eprintln!("Could not close tool: {error}");
                            }
                        }
                    } else {
                        api.prevent_close();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            updates::update_status,
            updates::update_set_source,
            updates::update_set_auto_check,
            updates::update_check,
            updates::update_list_versions,
            updates::update_download_version,
            updates::update_open_release,
            updates::update_download,
            updates::update_install,
            updates::update_open_installer,
            dev_log_pdf::dev_log_export_pdf,
            workflow_ipc::dev_log_folder_create,
            workflow_ipc::dev_log_folder_rename,
            workflow_ipc::dev_log_folder_delete,
            workflow_ipc::dev_log_tree_move,
            log_resource_ipc::log_resource_import_path,
            log_resource_ipc::log_resource_import_bytes,
            log_resource_ipc::log_resource_clone,
            log_resource_ipc::log_resource_metadata,
            log_resource_ipc::log_resource_read,
            log_resource_ipc::log_resource_export,
            log_resource_ipc::log_resource_open,
            standing_reminder::attention_runtime::reminder_attention_status,
            standing_reminder::attention_runtime::reminder_attention_configure,
            standing_reminder::attention_runtime::reminder_attention_action,
            standing_reminder::attention_runtime::reminder_attention_ready,
            standing_reminder::fitness_status,
            standing_reminder::fitness_configure,
            standing_reminder::fitness_action,
            standing_reminder::activity_log_day,
            standing_reminder::activity_log_days,
            standing_reminder::standing_reminder_status,
            standing_reminder::standing_reminder_configure,
            standing_reminder::standing_reminder_action,
            standing_reminder::standing_reminder_prompt_presented,
            standing_reminder::standing_reminder_test_event,
            workflow_ipc::external_tools_list,
            workflow_ipc::external_tools_save,
            workflow_ipc::external_tools_delete,
            workflow_ipc::external_tools_launch,
            workflow_ipc::edit_lease_acquire,
            workflow_ipc::edit_lease_status,
            workflow_ipc::edit_lease_release,
            workflow_ipc::repository_statistics,
            workflow_ipc::auto_backup_status,
            workflow_ipc::auto_backup_save,
            workflow_ipc::dev_logs_snapshot,
            workflow_ipc::dev_log_trash_snapshot,
            workflow_ipc::dev_log_project_purge,
            workflow_ipc::dev_log_page_purge,
            workflow_ipc::dev_log_trash_clear,
            dev_log_selection::dev_log_selection_get,
            dev_log_selection::dev_log_selection_save,
            workflow_ipc::dev_log_page_get,
            workflow_ipc::dev_log_page_history,
            workflow_ipc::dev_log_project_create,
            transformer_ipc::transformer_design_list,
            transformer_ipc::transformer_design_get,
            transformer_ipc::transformer_design_save,
            transformer_ipc::transformer_design_delete,
            transformer_ipc::transformer_design_import_preview,
            transformer_ipc::transformer_design_import_confirm,
            transformer_ipc::transformer_design_export_json,
            transformer_ipc::transformer_export_write,
            workflow_ipc::dev_log_project_rename,
            workflow_ipc::dev_log_project_delete,
            workflow_ipc::dev_log_project_restore,
            workflow_ipc::dev_log_projects_reorder,
            workflow_ipc::dev_log_page_create,
            workflow_ipc::dev_log_page_save,
            workflow_ipc::dev_log_page_delete,
            workflow_ipc::dev_log_page_restore,
            workflow_ipc::dev_log_pages_reorder,
            workflow_ipc::dev_log_page_restore_history,
            startup::login_startup_status,
            startup::login_startup_set,
            tool_windows::window_open,
            tool_windows::window_context,
            tool_windows::window_ready,
            repo_status,
            repo_open,
            data_snapshot,
            part_save,
            part_delete,
            note_get,
            note_save,
            note_delete,
            attachment_import,
            attachment_add_url,
            attachment_delete,
            attachment_open,
            external_url_open,
            opamp::opamp_reference_open,
            hardware_calculators::hardware_reference_open,
            setting_save,
            repository_backup,
            app_close_request,
            tool_windows::close_response,
            tool_windows::tool_window_open,
            tool_windows::tool_window_context,
            tool_windows::tool_window_close_request,
            tool_windows::tool_window_show_main,
            tool_windows::app_theme_get,
            tool_windows::app_theme_set
        ])
        .build(tauri::generate_context!())
        .expect("Failed to initialize Perfboard");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app
                .state::<AppState>()
                .quit_confirmed
                .load(Ordering::SeqCst)
            {
                api.prevent_exit();
                show_main(app);
                request_close(app, "quit");
            }
        }
    });
}

#[cfg(test)]
mod workflow_tests;
