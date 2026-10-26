use crate::{repository::AppResult, AppState};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::{Condvar, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const MAX_INSTANCES: usize = 16;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum WindowRoute {
    Tool {
        #[serde(rename = "toolId")]
        tool_id: String,
        #[serde(
            rename = "externalToolId",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        external_tool_id: Option<String>,
    },
    Parts {
        #[serde(rename = "partId", default, skip_serializing_if = "Option::is_none")]
        part_id: Option<String>,
    },
    Notes {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        category: Option<String>,
        #[serde(rename = "noteId", default, skip_serializing_if = "Option::is_none")]
        note_id: Option<String>,
    },
    DevLogs {
        #[serde(rename = "projectId", default, skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        #[serde(rename = "pageId", default, skip_serializing_if = "Option::is_none")]
        page_id: Option<String>,
    },
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub id: String,
    pub title: String,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowContext {
    #[serde(flatten)]
    tool: ToolSpec,
    pub label: String,
    instance_id: usize,
    pub route: WindowRoute,
}
fn specifications() -> AppResult<Vec<ToolSpec>> {
    serde_json::from_str(include_str!("../../src/windows/tool-windows.json"))
        .map_err(|e| e.to_string())
}
fn specification(id: &str) -> AppResult<ToolSpec> {
    specifications()?
        .into_iter()
        .find(|tool| tool.id == id)
        .ok_or_else(|| "This tool cannot open an independent window".into())
}
fn valid_record_id(id: &Option<String>) -> bool {
    id.as_ref().is_none_or(|id| {
        !id.is_empty()
            && id.chars().count() <= 200
            && !id.contains("://")
            && !id
                .chars()
                .any(|c| c.is_control() || matches!(c, '/' | '\\' | '#'))
    })
}
impl WindowRoute {
    fn spec(&self) -> AppResult<ToolSpec> {
        let (id, title) = match self {
            Self::Tool {
                tool_id,
                external_tool_id,
            } => {
                if !valid_record_id(external_tool_id)
                    || (external_tool_id.is_some() && tool_id != "external-tools")
                {
                    return Err("Invalid external tool context".into());
                }
                return specification(tool_id);
            }
            Self::Parts { part_id } => {
                if !valid_record_id(part_id) {
                    return Err("Invalid part context".into());
                }
                ("parts", "资料仓库".to_string())
            }
            Self::Notes { category, note_id } => {
                if !valid_record_id(note_id)
                    || category.as_ref().is_some_and(|c| {
                        !["硬件错题本", "软件错题本", "随笔", "学习笔记"].contains(&c.as_str())
                    })
                {
                    return Err("Invalid notes context".into());
                }
                (
                    "notes",
                    category.clone().unwrap_or_else(|| "全部笔记".into()),
                )
            }
            Self::DevLogs {
                project_id,
                page_id,
            } => {
                if !valid_record_id(project_id) || !valid_record_id(page_id) {
                    return Err("Invalid development log context".into());
                }
                ("dev-logs", "开发日志".to_string())
            }
        };
        Ok(ToolSpec {
            id: id.into(),
            title,
            width: 1200.0,
            height: 850.0,
            min_width: 640.0,
            min_height: 480.0,
        })
    }
    fn family(&self) -> &str {
        match self {
            Self::Tool { tool_id, .. } => tool_id,
            Self::Parts { .. } => "parts",
            Self::Notes { .. } => "notes",
            Self::DevLogs { .. } => "dev-logs",
        }
    }
    fn page_kind(&self) -> &str {
        match self {
            Self::Tool { .. } => "tool",
            Self::Parts { .. } => "parts",
            Self::Notes { .. } => "notes",
            Self::DevLogs { .. } => "dev-logs",
        }
    }
    fn base_label(&self) -> String {
        format!(
            "{}-{}",
            if matches!(self, Self::Tool { .. }) {
                "tool"
            } else {
                "page"
            },
            self.family()
        )
    }
}
fn slot_label(base: &str, instance: usize) -> String {
    if instance == 1 {
        base.into()
    } else {
        format!("{base}-{instance}")
    }
}
fn label_matches_base(label: &str, base: &str) -> bool {
    label == base
        || label.strip_prefix(&format!("{base}-")).is_some_and(|slot| {
            slot.parse::<usize>()
                .ok()
                .is_some_and(|n| (2..=MAX_INSTANCES).contains(&n) && n.to_string() == slot)
        })
}
pub fn is_child_label(label: &str) -> bool {
    ["page-parts", "page-notes", "page-dev-logs"]
        .iter()
        .any(|base| label_matches_base(label, base))
        || specifications().is_ok_and(|tools| {
            tools
                .iter()
                .any(|tool| label_matches_base(label, &format!("tool-{}", tool.id)))
        })
}
// Compatibility name used by the existing native close hook; includes document children.
pub fn is_tool_label(label: &str) -> bool {
    is_child_label(label)
}
pub fn require_main(window: &WebviewWindow) -> AppResult<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("This action is only available in the main window".into())
    }
}
fn context_for(window: &WebviewWindow) -> AppResult<WindowContext> {
    window
        .app_handle()
        .state::<AppState>()
        .windows
        .contexts
        .lock()
        .map_err(|_| "Window context unavailable")?
        .get(window.label())
        .cloned()
        .ok_or_else(|| "Unknown independent window".into())
}
pub fn require_main_or_page(window: &WebviewWindow, page: &str) -> AppResult<()> {
    if window.label() == "main" {
        return Ok(());
    }
    if !["parts", "notes", "dev-logs"].contains(&page) {
        return Err("Unknown content permission".into());
    }
    let context = context_for(window)?;
    if context.route.page_kind() == page {
        Ok(())
    } else {
        Err(format!(
            "This action requires the main window or a trusted {page} window"
        ))
    }
}
pub fn require_main_or_tool(window: &WebviewWindow, tool_id: &str) -> AppResult<()> {
    specification(tool_id)?;
    if window.label() == "main" {
        return Ok(());
    }
    let context = context_for(window)?;
    if matches!(&context.route, WindowRoute::Tool { tool_id: current, .. } if current == tool_id) {
        Ok(())
    } else {
        Err(format!(
            "This action requires the main window or a trusted {tool_id} window"
        ))
    }
}
pub fn require_content_window(window: &WebviewWindow) -> AppResult<()> {
    if window.label() == "main" {
        return Ok(());
    }
    if context_for(window)?.route.page_kind() != "tool" {
        Ok(())
    } else {
        Err("This action requires a trusted content window".into())
    }
}

#[derive(Clone, PartialEq)]
struct Pending {
    action: String,
    id: u64,
}
#[derive(Debug, PartialEq)]
enum Outcome {
    Wait,
    Hide,
    CloseTool,
    Quit,
    Cancel,
}
#[derive(Default)]
struct CloseCoordinator {
    next_id: u64,
    pending: BTreeMap<String, Pending>,
    retired: BTreeMap<(String, u64), String>,
    approved_tools: BTreeSet<String>,
    active_flush: Option<u64>,
    flush_results: BTreeMap<u64, AppResult<()>>,
}
impl CloseCoordinator {
    fn quitting(&self) -> bool {
        self.pending
            .values()
            .any(|request| request.action == "quit")
    }
    fn flushing(&self) -> bool {
        self.active_flush.is_some()
    }
    fn retire(&mut self, label: String, request: Pending) {
        self.retired.insert((label, request.id), request.action);
        while self.retired.len() > 256 {
            if let Some(key) = self.retired.keys().min_by_key(|(_, id)| *id).cloned() {
                self.retired.remove(&key);
            }
        }
    }
    fn remove_pending(&mut self, label: &str) {
        if let Some(request) = self.pending.remove(label) {
            self.retire(label.into(), request);
        }
    }
    /// Repeated native/UI close requests share one save operation.
    fn start(&mut self, action: &str, labels: &[String]) -> (u64, bool) {
        if action == "quit" {
            if let Some(request) = self
                .pending
                .values()
                .find(|request| request.action == "quit")
            {
                return (request.id, false);
            }
        } else if labels.len() == 1 {
            if let Some(request) = self
                .pending
                .get(&labels[0])
                .filter(|request| request.action == action)
            {
                return (request.id, false);
            }
        }
        self.next_id += 1;
        let id = self.next_id;
        if action == "flush" {
            self.active_flush = Some(id);
        }
        if action == "quit" {
            for (label, pending) in std::mem::take(&mut self.pending) {
                self.retire(label, pending);
            }
        }
        for label in labels {
            self.remove_pending(label);
            self.pending.insert(
                label.clone(),
                Pending {
                    action: action.into(),
                    id,
                },
            );
        }
        (id, true)
    }
    fn acknowledge(
        &mut self,
        label: &str,
        action: &str,
        id: u64,
        saved: bool,
    ) -> AppResult<Outcome> {
        // A duplicate or a response arriving after cancellation/supersession is harmless.
        // Only previously issued matching responses qualify; forged IDs still fail.
        if self
            .retired
            .get(&(label.into(), id))
            .is_some_and(|previous| previous == action)
        {
            return Ok(Outcome::Wait);
        }
        let pending = self
            .pending
            .get(label)
            .ok_or("No close request is pending for this window")?;
        if pending.action != action || pending.id != id {
            return Err("Close response does not match this window and request".into());
        }
        if !saved {
            if action == "quit" || action == "flush" {
                let labels: Vec<_> = self
                    .pending
                    .iter()
                    .filter(|(_, value)| value.id == id)
                    .map(|(label, _)| label.clone())
                    .collect();
                for label in labels {
                    self.remove_pending(&label);
                }
            } else {
                self.remove_pending(label);
            }
            if action == "flush" {
                self.active_flush = None;
                self.flush_results.insert(
                    id,
                    Err(format!("Window {label} could not save; operation canceled")),
                );
            }
            return Ok(Outcome::Cancel);
        }
        self.remove_pending(label);
        Ok(match action {
            "hide" => Outcome::Hide,
            "close-tool" => {
                self.approved_tools.insert(label.into());
                Outcome::CloseTool
            }
            "quit" if !self.pending.values().any(|request| request.id == id) => Outcome::Quit,
            "quit" => Outcome::Wait,
            "flush" => {
                if !self.pending.values().any(|request| request.id == id) {
                    self.flush_results.insert(id, Ok(()));
                }
                Outcome::Wait
            }
            _ => return Err("Unknown close action".into()),
        })
    }
}
pub struct WindowState {
    close: Mutex<CloseCoordinator>,
    open: Mutex<()>,
    theme: Mutex<String>,
    contexts: Mutex<BTreeMap<String, WindowContext>>,
    ready: Mutex<BTreeSet<String>>,
    wake: Condvar,
}
impl WindowState {
    pub fn new(theme: String) -> Self {
        Self {
            close: Mutex::new(CloseCoordinator::default()),
            open: Mutex::new(()),
            theme: Mutex::new(theme),
            contexts: Mutex::new(BTreeMap::new()),
            ready: Mutex::new(BTreeSet::new()),
            wake: Condvar::new(),
        }
    }
    pub fn consume_tool_close(&self, label: &str) -> bool {
        self.close
            .lock()
            .map(|mut close| close.approved_tools.remove(label))
            .unwrap_or(false)
    }
}
/// Called only from native Destroyed; hiding or canceled close must retain window/lease state.
pub fn window_destroyed(app: &tauri::AppHandle, label: &str) {
    let state = app.state::<AppState>();
    if let Ok(mut contexts) = state.windows.contexts.lock() {
        contexts.remove(label);
    }
    if let Ok(mut ready) = state.windows.ready.lock() {
        ready.remove(label);
    }
    if let Ok(mut close) = state.windows.close.lock() {
        close.remove_pending(label);
        close.approved_tools.remove(label);
    };
}
fn emit_close(app: &tauri::AppHandle, label: &str, action: &str, request_id: u64) -> AppResult<()> {
    app.emit_to(
        label,
        "perfboard:close-request",
        serde_json::json!({"action": action, "requestId": request_id}),
    )
    .map_err(|e| e.to_string())
}
fn emit_when_ready(app: &tauri::AppHandle, label: &str, action: &str, id: u64) -> AppResult<()> {
    if app
        .state::<AppState>()
        .windows
        .ready
        .lock()
        .map_err(|_| "Window readiness unavailable")?
        .contains(label)
    {
        emit_close(app, label, action, id)?;
    }
    Ok(())
}
#[tauri::command]
pub fn window_ready(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
) -> AppResult<()> {
    if window.label() != "main" {
        context_for(&window)?;
    }
    state
        .windows
        .ready
        .lock()
        .map_err(|_| "Window readiness unavailable")?
        .insert(window.label().into());
    let request = state
        .windows
        .close
        .lock()
        .map_err(|_| "Window close state unavailable")?
        .pending
        .get(window.label())
        .cloned();
    if let Some(request) = request {
        emit_close(&app, window.label(), &request.action, request.id)?;
    }
    Ok(())
}
pub fn request_main_close(app: &tauri::AppHandle, action: &str) {
    let state = app.state::<AppState>();
    let action = if action == "hide" && !state.tray_ready.load(std::sync::atomic::Ordering::SeqCst)
    {
        "quit"
    } else {
        action
    };
    let Ok(mut close) = state.windows.close.lock() else {
        crate::show_main(app);
        return;
    };
    // Registry entries are installed while holding close state before native creation.
    // This includes a child whose webview is still starting, so quit cannot miss it.
    let labels: Vec<String> = if action == "quit" {
        let Ok(contexts) = state.windows.contexts.lock() else {
            crate::show_main(app);
            return;
        };
        std::iter::once("main".to_string())
            .chain(contexts.keys().cloned())
            .collect()
    } else {
        vec!["main".into()]
    };
    if close.flushing() || (close.quitting() && action != "quit") {
        return;
    }
    let (id, created) = close.start(action, &labels);
    drop(close);
    if !created {
        return;
    }
    for label in &labels {
        if let Err(error) = emit_when_ready(app, label, action, id) {
            eprintln!("Could not request window save: {error}");
            if let Ok(mut close) = state.windows.close.lock() {
                for label in &labels {
                    if close
                        .pending
                        .get(label)
                        .is_some_and(|request| request.id == id)
                    {
                        close.remove_pending(label);
                    }
                }
            }
            crate::show_main(app);
            return;
        }
    }
}
pub fn request_tool_close(app: &tauri::AppHandle, label: &str) -> AppResult<()> {
    let state = app.state::<AppState>();
    if !state
        .windows
        .contexts
        .lock()
        .map_err(|_| "Window context unavailable")?
        .contains_key(label)
    {
        return Err("Unknown independent window".into());
    }
    let mut close = state
        .windows
        .close
        .lock()
        .map_err(|_| "Window close state unavailable")?;
    if close.flushing() {
        return Err("A cross-window save is pending; retry closing afterward".into());
    }
    if close.quitting() || close.approved_tools.contains(label) {
        return Ok(());
    }
    let (id, created) = close.start("close-tool", &[label.into()]);
    drop(close);
    if created {
        if let Err(error) = emit_when_ready(app, label, "close-tool", id) {
            if let Ok(mut close) = state.windows.close.lock() {
                close.remove_pending(label);
            }
            return Err(error);
        }
    }
    Ok(())
}
#[tauri::command]
pub fn close_response(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    action: String,
    request_id: u64,
    saved: bool,
) -> AppResult<()> {
    let label = window.label();
    if label != "main" {
        context_for(&window)?;
    }
    let outcome = state
        .windows
        .close
        .lock()
        .map_err(|_| "Window close state unavailable")?
        .acknowledge(label, &action, request_id, saved)?;
    state.windows.wake.notify_all();
    match outcome {
        Outcome::Wait => {}
        Outcome::Hide => {
            if label != "main" || !state.tray_ready.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("System tray unavailable; main window remains visible".into());
            }
            window.hide().map_err(|e| e.to_string())?;
        }
        Outcome::CloseTool => {
            if let Err(error) = window.close() {
                if let Ok(mut close) = state.windows.close.lock() {
                    close.approved_tools.remove(label);
                }
                return Err(error.to_string());
            }
        }
        Outcome::Quit => {
            if let Err(error) = crate::standing_reminder::flush(&app) {
                eprintln!("Could not save optional standing reminder before exit: {error}");
            }
            state
                .quit_confirmed
                .store(true, std::sync::atomic::Ordering::SeqCst);
            app.exit(0);
        }
        Outcome::Cancel => {
            crate::show_main(&app);
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit(
                "perfboard:close-failed",
                serde_json::json!({"window": label, "action": action, "requestId": request_id}),
            );
        }
    }
    Ok(())
}
/// Scheduler readiness only: no invoke command or repository mutex required.
/// Include registered children still starting so a due backup waits for their savers.
pub fn all_windows_ready(app: &tauri::AppHandle) -> bool {
    if app.get_webview_window("main").is_none() {
        return false;
    }
    let state = app.state::<AppState>();
    let Ok(contexts) = state.windows.contexts.lock() else {
        return false;
    };
    let labels: Vec<_> = contexts.keys().cloned().collect();
    drop(contexts);
    let Ok(ready) = state.windows.ready.lock() else {
        return false;
    };
    ready.contains("main") && labels.iter().all(|label| ready.contains(label))
}

/// Release a successful save barrier after the caller finishes its operation.
/// Invoke in a finally-style path; editing and window creation resume together.
pub fn finish_all_windows_flush(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let id = if let Ok(mut close) = state.windows.close.lock() {
        let id = close.active_flush.take();
        if let Some(id) = id {
            let labels: Vec<_> = close
                .pending
                .iter()
                .filter(|(_, pending)| pending.id == id)
                .map(|(label, _)| label.clone())
                .collect();
            if !labels.is_empty() {
                for label in labels {
                    close.remove_pending(&label);
                }
                close
                    .flush_results
                    .insert(id, Err("Cross-window save canceled".into()));
            }
        }
        id
    } else {
        None
    };
    state.windows.wake.notify_all();
    if let Some(id) = id {
        let _ = app.emit(
            "perfboard:flush-completed",
            serde_json::json!({"requestId": id}),
        );
    }
}

/// Blocking worker-only barrier. Call before taking the repository mutex.
/// A timeout or any failed save rejects the operation and leaves every window open.
pub fn flush_all_windows(app: &tauri::AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let opening = state
        .windows
        .open
        .lock()
        .map_err(|_| "Window creation unavailable")?;
    if state
        .quit_confirmed
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("Application exit is pending".into());
    }
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| label.as_str() == "main" || is_child_label(label))
        .cloned()
        .collect();
    let mut close = state
        .windows
        .close
        .lock()
        .map_err(|_| "Window close state unavailable")?;
    if close.quitting()
        || close.flushing()
        || !close.pending.is_empty()
        || !close.approved_tools.is_empty()
    {
        return Err(
            "Another window save or close is pending; retry the operation afterward".into(),
        );
    }
    if labels.is_empty() {
        return Ok(());
    }
    let (id, _) = close.start("flush", &labels);
    drop(close);
    drop(opening);
    for label in &labels {
        if let Err(error) = emit_when_ready(app, label, "flush", id) {
            let mut close = state
                .windows
                .close
                .lock()
                .map_err(|_| "Window close state unavailable")?;
            for label in &labels {
                if close
                    .pending
                    .get(label)
                    .is_some_and(|pending| pending.id == id)
                {
                    close.remove_pending(label);
                }
            }
            close.active_flush = None;
            state.windows.wake.notify_all();
            drop(close);
            let _ = app.emit(
                "perfboard:flush-completed",
                serde_json::json!({"requestId": id}),
            );
            return Err(format!("Could not request cross-window save: {error}"));
        }
    }
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut close = state
        .windows
        .close
        .lock()
        .map_err(|_| "Window close state unavailable")?;
    loop {
        if let Some(result) = close.flush_results.remove(&id) {
            return result;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            for label in &labels {
                if close
                    .pending
                    .get(label)
                    .is_some_and(|pending| pending.id == id)
                {
                    close.remove_pending(label);
                }
            }
            close.active_flush = None;
            state.windows.wake.notify_all();
            drop(close);
            let _ = app.emit(
                "perfboard:flush-completed",
                serde_json::json!({"requestId": id}),
            );
            crate::show_main(app);
            return Err("A window did not finish saving within 30 seconds; operation canceled and windows remain open".into());
        }
        close = state
            .windows
            .wake
            .wait_timeout(close, remaining)
            .map_err(|_| "Window save barrier unavailable")?
            .0;
    }
}

fn internal_navigation(url: &tauri::Url) -> bool {
    let app_origin = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none());
    let app_path = url.path() == "/" || url.path() == "/index.html";
    if app_origin && app_path {
        return true;
    }
    #[cfg(debug_assertions)]
    if url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(1420)
        && app_path
    {
        return true;
    }
    false
}
fn route_hash(route: &WindowRoute) -> AppResult<String> {
    let json = serde_json::to_string(route).map_err(|e| e.to_string())?;
    let mut encoded = String::from("#window=");
    for byte in json.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    Ok(encoded)
}
#[tauri::command]
pub async fn window_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    route: WindowRoute,
) -> AppResult<String> {
    let tool = route.spec()?;
    if window.label() != "main" {
        let current = context_for(&window)?;
        if current.route != route {
            return Err(
                "Independent windows may only open another instance of their own route".into(),
            );
        }
    }
    let _guard = state
        .windows
        .open
        .lock()
        .map_err(|_| "Window creation unavailable")?;
    let close = state
        .windows
        .close
        .lock()
        .map_err(|_| "Window close state unavailable")?;
    if state
        .quit_confirmed
        .load(std::sync::atomic::Ordering::SeqCst)
        || close.quitting()
        || close.flushing()
    {
        return Err("A cross-window save is pending; finish it before opening windows".into());
    }
    let base = route.base_label();
    let mut contexts = state
        .windows
        .contexts
        .lock()
        .map_err(|_| "Window context unavailable")?;
    let instance_id = (1..=MAX_INSTANCES)
        .find(|slot| {
            let label = slot_label(&base, *slot);
            !contexts.contains_key(&label) && app.get_webview_window(&label).is_none()
        })
        .ok_or("This page already has 16 independent windows; close one before opening another")?;
    let label = slot_label(&base, instance_id);
    contexts.insert(
        label.clone(),
        WindowContext {
            tool: tool.clone(),
            label: label.clone(),
            instance_id,
            route: route.clone(),
        },
    );
    drop(contexts);
    drop(close);
    let builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(PathBuf::from(format!("index.html{}", route_hash(&route)?))),
    )
    .title(format!(
        "{}{} — Perfboard",
        tool.title,
        if instance_id == 1 {
            String::new()
        } else {
            format!(" · {instance_id}")
        }
    ))
    .inner_size(tool.width, tool.height)
    .min_inner_size(tool.min_width, tool.min_height)
    .on_navigation(internal_navigation);
    // Dev logs reorder DOM rows; notes use Excalidraw's HTML file drop.
    // Other independent tools retain their native handler default.
    let builder = if matches!(
        &route,
        WindowRoute::DevLogs { .. } | WindowRoute::Notes { .. }
    ) {
        builder.disable_drag_drop_handler()
    } else {
        builder
    };
    let result = builder.build();
    if let Err(error) = result {
        window_destroyed(&app, &label);
        return Err(error.to_string());
    }
    Ok(label)
}
#[tauri::command]
pub async fn tool_window_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    tool_id: String,
) -> AppResult<String> {
    window_open(
        app,
        state,
        window,
        WindowRoute::Tool {
            tool_id,
            external_tool_id: None,
        },
    )
    .await
}
#[tauri::command]
pub fn window_context(window: WebviewWindow) -> AppResult<WindowContext> {
    context_for(&window)
}
#[tauri::command]
pub fn tool_window_context(window: WebviewWindow) -> AppResult<WindowContext> {
    context_for(&window)
}
#[tauri::command]
pub fn tool_window_close_request(app: tauri::AppHandle, window: WebviewWindow) -> AppResult<()> {
    context_for(&window)?;
    request_tool_close(&app, window.label())
}
#[tauri::command]
pub fn tool_window_show_main(app: tauri::AppHandle, window: WebviewWindow) -> AppResult<()> {
    context_for(&window)?;
    crate::show_main(&app);
    Ok(())
}
#[tauri::command]
pub fn app_theme_get(state: State<'_, AppState>) -> AppResult<String> {
    Ok(state
        .windows
        .theme
        .lock()
        .map_err(|_| "Theme unavailable")?
        .clone())
}
#[tauri::command]
pub fn app_theme_set(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    theme: String,
) -> AppResult<()> {
    require_main(&window)?;
    if !matches!(theme.as_str(), "light" | "dark" | "codex") {
        return Err("Unknown theme".into());
    }
    *state
        .windows
        .theme
        .lock()
        .map_err(|_| "Theme unavailable")? = theme.clone();
    app.emit("perfboard:theme-changed", theme)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn start(close: &mut CloseCoordinator, action: &str, labels: &[&str]) -> u64 {
        close
            .start(
                action,
                &labels
                    .iter()
                    .map(|label| (*label).into())
                    .collect::<Vec<_>>(),
            )
            .0
    }
    #[test]
    fn supported_routes_have_exact_local_instances() {
        let specs = specifications().unwrap();
        for id in [
            "cores", "external-tools", "voltage-divider", "tl431",
            "pullup-divider", "uc28-38xx", "pmos-switch",
        ] {
            assert!(specs.iter().any(|spec| spec.id == id));
        }
        for id in ["unsupported", "https://example.com", "../json", "JSON"] {
            assert!(specification(id).is_err());
        }
        for label in [
            "tool-json",
            "tool-json-2",
            "tool-voltage-divider",
            "tool-voltage-divider-2",
            "tool-resistor-series-16",
            "page-parts-2",
            "page-notes",
            "page-dev-logs-8",
        ] {
            assert!(is_child_label(label), "{label}");
        }
        for label in [
            "tool-json-1",
            "tool-json-02",
            "tool-json-17",
            "tool-voltage-divider-17",
            "tool-json-extra",
            "page-evil",
            "page-notes-2-extra",
        ] {
            assert!(!is_child_label(label), "{label}");
        }
        assert!(WindowRoute::Notes {
            category: Some("unknown".into()),
            note_id: None
        }
        .spec()
        .is_err());
        assert!(
            serde_json::from_str::<WindowRoute>(r#"{"kind":"parts","url":"https://evil"}"#)
                .is_err()
        );
        assert!(WindowRoute::Parts {
            part_id: Some("../secret".into())
        }
        .spec()
        .is_err());
        assert!(route_hash(&WindowRoute::Tool {
            tool_id: "json".into(),
            external_tool_id: None
        })
        .unwrap()
        .starts_with("#window=%7B"));
    }
    #[test]
    fn navigation_stays_on_local_application_documents() {
        for url in [
            "tauri://localhost/index.html#window=x",
            "http://tauri.localhost/index.html",
        ] {
            assert!(internal_navigation(&url.parse().unwrap()));
        }
        for url in [
            "https://example.com",
            "file:///C:/secret",
            "javascript:alert(1)",
            "http://tauri.localhost.evil/index.html",
            "http://tauri.localhost/other.html",
            "http://tauri.localhost:99/",
        ] {
            assert!(!internal_navigation(&url.parse().unwrap()));
        }
    }
    #[test]
    fn repeated_close_requests_and_responses_are_idempotent() {
        let mut close = CloseCoordinator::default();
        let id = start(&mut close, "close-tool", &["tool-json"]);
        assert_eq!(
            close.start("close-tool", &["tool-json".into()]),
            (id, false)
        );
        assert!(close.acknowledge("main", "close-tool", id, true).is_err());
        assert_eq!(
            close
                .acknowledge("tool-json", "close-tool", id, true)
                .unwrap(),
            Outcome::CloseTool
        );
        assert_eq!(
            close
                .acknowledge("tool-json", "close-tool", id, true)
                .unwrap(),
            Outcome::Wait
        );
        assert!(close.approved_tools.contains("tool-json"));
        assert!(!close.quitting());
    }
    #[test]
    fn quit_waits_for_all_tool_and_document_instances() {
        let mut close = CloseCoordinator::default();
        let id = start(
            &mut close,
            "quit",
            &["main", "tool-json", "tool-json-2", "page-notes"],
        );
        for label in ["tool-json-2", "main", "page-notes"] {
            assert_eq!(
                close.acknowledge(label, "quit", id, true).unwrap(),
                Outcome::Wait
            );
        }
        assert_eq!(
            close.acknowledge("tool-json", "quit", id, true).unwrap(),
            Outcome::Quit
        );
    }
    #[test]
    fn failed_save_cancels_quit_and_late_known_responses_are_harmless() {
        let mut close = CloseCoordinator::default();
        let id = start(&mut close, "quit", &["main", "tool-json"]);
        assert_eq!(
            close.acknowledge("tool-json", "quit", id, false).unwrap(),
            Outcome::Cancel
        );
        assert_eq!(
            close.acknowledge("main", "quit", id, true).unwrap(),
            Outcome::Wait
        );
        assert!(!close.quitting());
        assert!(close.approved_tools.is_empty());
        assert!(close.acknowledge("main", "quit", id + 100, true).is_err());
    }
    #[test]
    fn failed_child_save_allows_retry_and_old_ack_cannot_close_reopened_slot() {
        let mut close = CloseCoordinator::default();
        let old = start(&mut close, "close-tool", &["tool-json"]);
        assert_eq!(
            close
                .acknowledge("tool-json", "close-tool", old, false)
                .unwrap(),
            Outcome::Cancel
        );
        let new = start(&mut close, "close-tool", &["tool-json"]);
        assert_ne!(old, new);
        assert_eq!(
            close
                .acknowledge("tool-json", "close-tool", old, true)
                .unwrap(),
            Outcome::Wait
        );
        assert!(!close.approved_tools.contains("tool-json"));
        assert_eq!(
            close
                .acknowledge("tool-json", "close-tool", new, true)
                .unwrap(),
            Outcome::CloseTool
        );
    }
    #[test]
    fn quit_supersedes_child_close_without_reporting_a_save_failure() {
        let mut close = CloseCoordinator::default();
        let old = start(&mut close, "close-tool", &["tool-json"]);
        let new = start(&mut close, "quit", &["main", "tool-json"]);
        assert_eq!(
            close
                .acknowledge("tool-json", "close-tool", old, true)
                .unwrap(),
            Outcome::Wait
        );
        assert_eq!(
            close.acknowledge("tool-json", "quit", new, true).unwrap(),
            Outcome::Wait
        );
    }
    #[test]
    fn flush_barrier_waits_for_every_window_and_never_closes() {
        let mut close = CloseCoordinator::default();
        let id = start(&mut close, "flush", &["main", "page-notes", "tool-json-2"]);
        assert!(close.flushing());
        assert_eq!(
            close.acknowledge("page-notes", "flush", id, true).unwrap(),
            Outcome::Wait
        );
        assert!(close.flush_results.is_empty());
        assert!(close.flushing());
        assert_eq!(
            close.acknowledge("main", "flush", id, true).unwrap(),
            Outcome::Wait
        );
        assert_eq!(
            close.acknowledge("tool-json-2", "flush", id, true).unwrap(),
            Outcome::Wait
        );
        assert_eq!(close.flush_results.remove(&id), Some(Ok(())));
        assert!(close.flushing());
        close.active_flush = None;
        assert!(close.approved_tools.is_empty());
    }
    #[test]
    fn flush_failure_cancels_operation_and_late_success_cannot_approve_close() {
        let mut close = CloseCoordinator::default();
        let id = start(&mut close, "flush", &["main", "page-notes"]);
        assert_eq!(
            close.acknowledge("page-notes", "flush", id, false).unwrap(),
            Outcome::Cancel
        );
        assert!(close.flush_results.remove(&id).unwrap().is_err());
        assert!(!close.flushing());
        assert_eq!(
            close.acknowledge("main", "flush", id, true).unwrap(),
            Outcome::Wait
        );
        assert!(close.pending.is_empty());
        assert!(close.approved_tools.is_empty());
    }
    #[test]
    fn main_hide_leaves_children_open() {
        let mut close = CloseCoordinator::default();
        let id = start(&mut close, "hide", &["main"]);
        assert!(close.acknowledge("tool-json", "hide", id, true).is_err());
        assert_eq!(
            close.acknowledge("main", "hide", id, true).unwrap(),
            Outcome::Hide
        );
        assert_eq!(
            close.acknowledge("main", "hide", id, true).unwrap(),
            Outcome::Wait
        );
    }
}
