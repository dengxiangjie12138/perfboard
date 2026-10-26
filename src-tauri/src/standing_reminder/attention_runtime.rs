//! A single activity reminder container, with optional passive secondary backdrops.
use super::*;
use serde::{Deserialize, Serialize};
use tauri::{WebviewUrl, WebviewWindowBuilder};

const PREFIX: &str = "reminder-attention-";
const EVENT: &str = "perfboard:reminder-attention";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionSnapshot {
    pub settings: attention::Settings,
    pub active: bool,
    pub escalated: bool,
    pub standing: Option<Snapshot>,
    pub fitness: Option<fitness::Snapshot>,
    pub error: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum AttentionAction {
    Standing {
        action: StandingChoice,
    },
    Fitness {
        action: FitnessChoice,
        #[serde(rename = "reminderId")]
        reminder_id: u64,
    },
    LaterAll,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StandingChoice {
    StartRest,
    Later,
    Skip,
    CancelLock,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FitnessChoice {
    Start,
    Complete,
    Later,
    Skip,
}
pub(super) fn is_label(label: &str) -> bool {
    label
        .strip_prefix(PREFIX)
        .is_some_and(|suffix| !suffix.is_empty() && suffix.bytes().all(|x| x.is_ascii_digit()))
}
fn reader(window: &tauri::WebviewWindow) -> Result<(), String> {
    if is_label(window.label())
        || window.label() == PROMPT_LABEL
        || window.label() == FITNESS_PROMPT_LABEL
    {
        Ok(())
    } else if crate::tool_windows::require_main_or_tool(window, "standing-reminder").is_ok() {
        Ok(())
    } else {
        crate::tool_windows::require_main_or_tool(window, "fitness")
    }
}
fn snapshot(r: &Runtime) -> AttentionSnapshot {
    let standing = super::snapshot(r);
    let fitness = r.fitness.snapshot();
    let standing = (!r.engine.blocked() && standing.prompt_visible).then_some(standing);
    let fitness = (!r.engine.blocked() && fitness.prompt_visible).then_some(fitness);
    let active = standing.is_some() || fitness.is_some();
    AttentionSnapshot {
        settings: r.attention.settings.clone(),
        active,
        escalated: active && r.attention.active(),
        standing,
        fitness,
        error: r.attention.error.clone(),
    }
}
pub(super) fn observe(r: &mut Runtime) {
    let standing = super::snapshot(r);
    let fitness = r.fitness.snapshot();
    let standing_key = (standing.prompt_visible && standing.due && standing.mode == Mode::Working)
        .then_some(standing.prompt_token);
    let fitness_key = fitness
        .prompt_visible
        .then_some(fitness.state.pending.as_ref())
        .flatten()
        // A compact acknowledged exercise never escalates. An expanded one stays
        // in this same container until completed, postponed or skipped.
        .filter(|pending| !pending.started || r.attention.active())
        .map(|pending| pending.id);
    r.attention.observe(
        now(r),
        r.engine.blocked() || !r.monitor_available,
        standing_key,
        fitness_key,
    );
}
pub(super) fn sync(app: &tauri::AppHandle) {
    let Some(service) = app.try_state::<StandingReminderService>() else {
        return;
    };
    if service.stopping.load(Ordering::SeqCst) {
        return;
    }
    let changed = {
        let Ok(mut r) = service.inner.lock() else {
            return;
        };
        observe(&mut r);
        if snapshot(&r).active
            && r.attention_loading_since
                .is_some_and(|start| start.elapsed() > Duration::from_secs(8))
        {
            let current = now(&r);
            r.engine
                .prompt_failed("提醒界面加载超时，已取消自动锁屏。".into());
            r.fitness
                .display_failed("提醒界面加载超时，可从工具页再次显示。".into());
            r.attention
                .display_failed("提醒界面加载超时，已关闭提醒。".into(), current);
            r.attention_loading_since = None;
        }
        let retry = service
            .attention_presentation_pending
            .swap(false, Ordering::SeqCst);
        // Content (including countdowns, errors and a start acknowledgement) can
        // change without changing presentation. Keep the same native window.
        let visible = snapshot(&r);
        let signature = (
            visible.active,
            visible.escalated,
            visible.standing.as_ref().map(|s| s.prompt_token),
            visible
                .fitness
                .as_ref()
                .and_then(|s| s.state.pending.as_ref().map(|p| p.id)),
        );
        let _ = app.emit(EVENT, visible);
        if r.attention_rendered_revision == r.attention.revision
            && r.attention_rendered_state == Some(signature)
            && !retry
        {
            false
        } else {
            r.attention_rendered_revision = r.attention.revision;
            r.attention_rendered_state = Some(signature);
            true
        }
    };
    if changed {
        let handle = app.clone();
        // Native builds/shows are serialized on the UI thread, never while holding Runtime.
        if let Err(error) = app.run_on_main_thread(move || {
            if let Err(error) = present(&handle) {
                display_failed(&handle, error);
            }
        }) {
            display_failed(app, error.to_string());
        }
    }
}
fn reminder_label(label: &str) -> bool {
    is_label(label) || label == PROMPT_LABEL || label == FITNESS_PROMPT_LABEL
}
pub(super) fn hide_all(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if reminder_label(&label) {
            if let Err(error) = windows::hide_without_activation(&window) {
                eprintln!("Unable to hide reminder {label}: {error}");
                let _ = window.hide();
            }
        }
    }
}
fn display_failed(app: &tauri::AppHandle, error: String) {
    hide_all(app);
    if let Some(service) = app.try_state::<StandingReminderService>() {
        if let Ok(mut r) = service.inner.lock() {
            let current = now(&r);
            let message = format!("提醒窗口显示失败，已关闭提醒并取消自动锁屏：{error}");
            r.engine.prompt_failed(message.clone());
            r.fitness.display_failed(message.clone());
            r.attention.display_failed(message, current);
            r.attention_rendered_revision = r.attention.revision;
            let _ = app.emit(EVENT, snapshot(&r));
        }
    }
}
fn presentation_suppressed(service: &StandingReminderService) -> bool {
    if service.stopping.load(Ordering::SeqCst)
        || service.attention_dismissing.load(Ordering::SeqCst)
    {
        return true;
    }
    #[cfg(debug_assertions)]
    if service.attention_test_expired.load(Ordering::SeqCst) {
        return true;
    }
    false
}
fn defer_presentation(app: &tauri::AppHandle, service: &StandingReminderService) {
    if service
        .attention_presentation_pending
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    // A state publication may be the last event (for example, an acknowledged
    // exercise or isolated clock advance). Retry after contention even if there
    // will be no subsequent timer tick. Wait on a worker, never on the UI thread.
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(service) = app.try_state::<StandingReminderService>() else {
            return;
        };
        {
            let Ok(_runtime) = service.inner.lock() else {
                return;
            };
        }
        sync(&app);
    });
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}
fn distinct_bounds(values: impl IntoIterator<Item = Bounds>) -> Vec<Bounds> {
    let mut bounds = Vec::new();
    for value in values {
        if value.width > 0 && value.height > 0 && !bounds.contains(&value) {
            bounds.push(value);
        }
    }
    bounds
}
fn compact_bounds(monitor: Bounds, scale: f64) -> Bounds {
    let width = ((480.0 * scale).round() as u32).min(monitor.width);
    let height = ((600.0 * scale).round() as u32).min(monitor.height);
    Bounds {
        x: monitor.x + (monitor.width.saturating_sub(width) / 2) as i32,
        y: monitor.y + (monitor.height.saturating_sub(height) / 2) as i32,
        width,
        height,
    }
}
fn present(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(service) = app.try_state::<StandingReminderService>() else {
        hide_all(app);
        return Ok(());
    };
    if presentation_suppressed(&service) {
        hide_all(app);
        return Ok(());
    }
    let state = {
        let Ok(r) = service.inner.try_lock() else {
            defer_presentation(app, &service);
            return Ok(());
        };
        snapshot(&r)
    };
    // Legacy windows are always withdrawn before showing the shared container.
    for label in [PROMPT_LABEL, FITNESS_PROMPT_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            windows::hide_without_activation(&window)?;
        }
    }
    if !state.active {
        hide_all(app);
        return Ok(());
    }
    let mut monitors = app.available_monitors().map_err(|e| e.to_string())?;
    if let Some(primary) = app.primary_monitor().map_err(|e| e.to_string())? {
        if let Some(index) = monitors
            .iter()
            .position(|m| m.position() == primary.position() && m.size() == primary.size())
        {
            monitors.swap(0, index);
        }
    }
    let scale = monitors.first().map(|m| m.scale_factor()).unwrap_or(1.0);
    let bounds = distinct_bounds(monitors.into_iter().map(|m| Bounds {
        x: m.position().x,
        y: m.position().y,
        width: m.size().width,
        height: m.size().height,
    }));
    let Some(primary_bounds) = bounds.first().copied() else {
        return Err("没有可用显示器".into());
    };
    let layouts = if state.escalated {
        bounds
    } else {
        vec![compact_bounds(primary_bounds, scale)]
    };
    let mut ready = Vec::new();
    for (index, bounds) in layouts.iter().enumerate() {
        let label = format!("{PREFIX}{index}");
        let window = match app.get_webview_window(&label) {
            Some(window) => window,
            None => WebviewWindowBuilder::new(
                app,
                &label,
                WebviewUrl::App(
                    if index == 0 {
                        "index.html#reminder-attention"
                    } else {
                        "index.html#reminder-attention-backdrop"
                    }
                    .into(),
                ),
            )
            .title(if index == 0 {
                "活动提醒 · Perfboard"
            } else {
                "活动提醒遮罩 · Esc 稍后"
            })
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .disable_drag_drop_handler()
            .build()
            .map_err(|e| e.to_string())?,
        };
        window
            .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| e.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|e| e.to_string())?;
        ready.push(window);
    }
    {
        let Ok(mut r) = service.inner.try_lock() else {
            defer_presentation(app, &service);
            return Ok(());
        };
        if !ready
            .iter()
            .all(|window| r.attention_ready.contains(window.label()))
        {
            r.attention_loading_since
                .get_or_insert_with(std::time::Instant::now);
            return Ok(());
        }
        r.attention_loading_since = None;
        if !snapshot(&r).active || r.engine.blocked() {
            hide_all(app);
            return Ok(());
        }
    }
    for (label, window) in app.webview_windows() {
        if is_label(&label) && !ready.iter().any(|item| item.label() == label) {
            windows::hide_without_activation(&window)?;
        }
    }
    for window in &ready {
        if presentation_suppressed(&service) {
            hide_all(app);
            return Ok(());
        }
        // hide_all uses native visibility, which can differ from Tauri's cached
        // flag. Use the matching verified native show on every presentation.
        windows::show_without_activation(window)?;
    }
    if state.escalated {
        if let Some(window) = ready.first() {
            let _ = window.set_focus();
        }
    }
    // Only acknowledge a warning after the real, ready primary container is visible.
    let pending = {
        let Ok(mut r) = service.inner.try_lock() else {
            defer_presentation(app, &service);
            return Ok(());
        };
        let current = now(&r);
        let token = super::snapshot(&r).prompt_token;
        let pending = r.engine.presented(token, current);
        let _ = persist(&mut r);
        pending
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !pending.is_empty() {
            effects(&app, pending);
        }
        if let Err(error) = persist_runtime(&app) {
            eprintln!("Reminder presentation checkpoint: {error}");
        }
    });
    Ok(())
}
#[tauri::command]
pub async fn reminder_attention_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, StandingReminderService>,
) -> Result<(), String> {
    if !is_label(window.label()) {
        return Err("只有提醒遮罩可以确认界面就绪".into());
    }
    {
        let mut r = state.inner.lock().map_err(|_| "提醒状态不可用")?;
        if r.attention_ready.insert(window.label().to_owned()) {
            r.attention.revision = r.attention.revision.wrapping_add(1);
        }
    }
    sync(&app);
    Ok(())
}
#[tauri::command]
pub fn reminder_attention_status(
    window: tauri::WebviewWindow,
    state: State<'_, StandingReminderService>,
) -> Result<AttentionSnapshot, String> {
    reader(&window)?;
    let r = state.inner.lock().map_err(|_| "提醒状态不可用")?;
    Ok(snapshot(&r))
}
#[tauri::command]
pub async fn reminder_attention_configure(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, StandingReminderService>,
    settings: attention::Settings,
) -> Result<AttentionSnapshot, String> {
    reader(&window)?;
    settings.validate()?;
    {
        let mut r = state.inner.lock().map_err(|_| "提醒状态不可用")?;
        r.store.save_attention(&settings)?;
        let current = now(&r);
        r.attention.configure(settings, current)?;
    }
    sync(&app);
    persist_runtime(&app)?;
    let r = state.inner.lock().map_err(|_| "提醒状态不可用")?;
    Ok(snapshot(&r))
}
fn standing_action(r: &mut Runtime, action: Action) -> Result<Vec<Effect>, String> {
    let current = now(r);
    let effects = r.engine.action(action, current, input(r).map(|x| x.0))?;
    collect_log(r);
    sync_input_monitor(r);
    // The save only enqueues. UI effects run before waiting for durable storage.
    if let Err(error) = persist(r) {
        r.engine.storage_failed(error);
    }
    Ok(effects)
}
fn later_all(r: &mut Runtime) -> (Vec<Effect>, Vec<fitness::Effect>) {
    let mut standing = Vec::new();
    let mut fitness = Vec::new();
    let mut failures = Vec::new();
    if super::snapshot(r).prompt_visible {
        match standing_action(r, Action::Dismiss) {
            Ok(effects) => standing = effects,
            Err(e) => failures.push(e),
        }
    }
    if r.fitness.snapshot().prompt_visible {
        match apply_fitness_action(r, fitness::Action::Collapse) {
            Ok((_, effects)) => fitness = effects,
            Err(e) => failures.push(e),
        }
    }
    let current = now(r);
    r.attention.release(current);
    if !failures.is_empty() {
        r.attention.error = Some(format!(
            "提醒已关闭；稍后操作出现错误：{}",
            failures.join("；")
        ));
    }
    (standing, fitness)
}
fn begin_dismiss(app: &tauri::AppHandle) -> bool {
    let first = app
        .try_state::<StandingReminderService>()
        .is_some_and(|service| !service.attention_dismissing.swap(true, Ordering::SeqCst));
    // Hide before acquiring any engine/storage lock. The atomic gate also stops queued shows.
    hide_all(app);
    first
}
fn finish_dismiss(app: &tauri::AppHandle) -> Result<AttentionSnapshot, String> {
    let service = app
        .try_state::<StandingReminderService>()
        .ok_or("提醒服务不可用")?;
    let (standing, fitness) = {
        let mut r = service.inner.lock().map_err(|_| "提醒状态不可用")?;
        let pending = later_all(&mut r);
        flush_log(app, &mut r);
        pending
    };
    // later_all always releases escalation, including when either save failed.
    service.attention_dismissing.store(false, Ordering::SeqCst);
    effects(app, standing);
    fitness_effects(app, fitness);
    fitness_publish(app);
    sync(app);
    persist_runtime(app)?;
    let r = service.inner.lock().map_err(|_| "提醒状态不可用")?;
    Ok(snapshot(&r))
}
fn apply_card_action(
    r: &mut Runtime,
    action: AttentionAction,
) -> Result<(Vec<Effect>, Vec<fitness::Effect>), String> {
    observe(r);
    let result = match action {
        AttentionAction::LaterAll => return Err("请使用关闭遮罩操作".into()),
        AttentionAction::Standing { action } => {
            if snapshot(r).standing.is_none() {
                return Err("久坐提醒已变化，请刷新后重试。".into());
            }
            let effects = standing_action(
                r,
                match action {
                    StandingChoice::StartRest => Action::StartRest,
                    StandingChoice::Later => Action::Dismiss,
                    StandingChoice::Skip => Action::Skip,
                    StandingChoice::CancelLock => Action::CancelLock,
                },
            )?;
            (effects, vec![])
        }
        AttentionAction::Fitness {
            action,
            reminder_id,
        } => {
            if snapshot(r).fitness.is_none() {
                return Err("健身提醒已变化，请刷新后重试。".into());
            }
            let action = match action {
                FitnessChoice::Start => fitness::Action::Start { reminder_id },
                FitnessChoice::Complete => fitness::Action::Respond {
                    reminder_id,
                    outcome: fitness::Outcome::Complete,
                },
                FitnessChoice::Later => fitness::Action::Respond {
                    reminder_id,
                    outcome: fitness::Outcome::Later,
                },
                FitnessChoice::Skip => fitness::Action::Respond {
                    reminder_id,
                    outcome: fitness::Outcome::Skip,
                },
            };
            let (_, effects) = apply_fitness_action(r, action)?;
            (vec![], effects)
        }
    };
    // Invalidate the shared card before another monitor can submit its stale action.
    observe(r);
    Ok(result)
}
#[tauri::command]
pub async fn reminder_attention_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, StandingReminderService>,
    action: AttentionAction,
) -> Result<AttentionSnapshot, String> {
    reader(&window)?;
    if matches!(&action, AttentionAction::LaterAll) {
        let first = begin_dismiss(&app);
        return tauri::async_runtime::spawn_blocking(move || {
            if first {
                finish_dismiss(&app)
            } else {
                let service = app.state::<StandingReminderService>();
                let r = service.inner.lock().map_err(|_| "提醒状态不可用")?;
                Ok(snapshot(&r))
            }
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    let (standing, fitness) = {
        let mut r = state.inner.lock().map_err(|_| "提醒状态不可用")?;
        let result = apply_card_action(&mut r, action)?;
        flush_log(&app, &mut r);
        result
    };
    effects(&app, standing);
    fitness_effects(&app, fitness);
    fitness_publish(&app);
    sync(&app);
    persist_runtime(&app)?;
    let r = state.inner.lock().map_err(|_| "提醒状态不可用")?;
    Ok(snapshot(&r))
}
pub(super) fn close(app: &tauri::AppHandle, label: &str) -> bool {
    if !reminder_label(label) {
        return false;
    }
    if begin_dismiss(app) {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = finish_dismiss(&app) {
                eprintln!("Reminder closed, persistence failed: {error}");
            }
        });
    }
    true
}
pub(super) fn destroyed(app: &tauri::AppHandle, label: &str) -> bool {
    if !reminder_label(label) {
        return false;
    }
    if let Some(service) = app.try_state::<StandingReminderService>() {
        if service.stopping.load(Ordering::SeqCst) {
            return true;
        }
    }
    let first = begin_dismiss(app);
    let app = app.clone();
    let label = label.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(service) = app.try_state::<StandingReminderService>() {
            if let Ok(mut r) = service.inner.lock() {
                r.attention_ready.remove(&label);
            }
        }
        if first {
            if let Err(error) = finish_dismiss(&app) {
                eprintln!("Reminder destroyed, persistence failed: {error}");
            }
        }
    });
    true
}
pub(super) fn shutdown(app: &tauri::AppHandle) {
    hide_all(app);
}
#[cfg(debug_assertions)]
pub(super) fn test_shutdown(app: &tauri::AppHandle) {
    if let Some(service) = app.try_state::<StandingReminderService>() {
        // Sticky for this isolated process, even if storage currently holds the mutex.
        service.attention_test_expired.store(true, Ordering::SeqCst);
        if let Ok(mut r) = service.inner.try_lock() {
            let current = now(&r);
            r.attention
                .display_failed("隔离验证已超时，增强提醒已停用。".into(), current);
        }
    }
    hide_all(app);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_card_start_keeps_expanded_container_and_completion_is_available() {
        let directory = tempfile::tempdir().unwrap();
        let mut r = super::super::prompt_close_transaction_tests::runtime(directory.path());
        observe(&mut r);
        for _ in 0..600 {
            r.engine.last_ms += 500;
            observe(&mut r);
        }
        assert!(r.attention.standing() && r.attention.fitness());
        apply_card_action(
            &mut r,
            AttentionAction::Standing {
                action: StandingChoice::Skip,
            },
        )
        .unwrap();
        // No UI publication/effects occur between these two monitor submissions.
        let after_skip = serde_json::to_value(r.engine.checkpoint()).unwrap();
        assert!(apply_card_action(
            &mut r,
            AttentionAction::Standing {
                action: StandingChoice::StartRest,
            },
        )
        .is_err());
        assert_eq!(
            serde_json::to_value(r.engine.checkpoint()).unwrap(),
            after_skip
        );
        assert!(r.attention.fitness());
        let id = r.fitness.checkpoint().pending.unwrap().id;
        apply_card_action(
            &mut r,
            AttentionAction::Fitness {
                action: FitnessChoice::Start,
                reminder_id: id,
            },
        )
        .unwrap();
        let after_start = r.fitness.checkpoint();
        assert!(snapshot(&r).active && snapshot(&r).escalated);
        apply_card_action(
            &mut r,
            AttentionAction::Fitness {
                action: FitnessChoice::Complete,
                reminder_id: id,
            },
        )
        .unwrap();
        assert!(after_start.pending.unwrap().started);
        assert!(r.fitness.checkpoint().pending.is_none());
        assert!(!r.attention.active());
    }
    #[test]
    fn screens_keep_physical_negative_coordinates_and_deduplicate_mirrors() {
        let left = Bounds {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let primary = Bounds {
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
        };
        assert_eq!(
            distinct_bounds([left, primary, primary]),
            vec![left, primary]
        );
        assert!(distinct_bounds([Bounds {
            width: 0,
            ..primary
        }])
        .is_empty());
        assert!(is_label("reminder-attention-0"));
        assert!(!is_label("reminder-attention-../x"));
    }
    #[test]
    fn failed_snooze_persistence_never_keeps_the_shield_active() {
        let directory = tempfile::tempdir().unwrap();
        let mut runtime = super::super::prompt_close_transaction_tests::runtime(directory.path());
        runtime.attention.observe(0, false, Some(1), Some(9));
        for now in (500..=300_000).step_by(500) {
            runtime.attention.observe(now, false, Some(1), Some(9));
        }
        assert!(runtime.attention.active());
        runtime.store = Store::unavailable("injected save failure".into());
        let _ = later_all(&mut runtime);
        assert!(!runtime.attention.active());
        assert!(!snapshot(&runtime).active);
        assert!(!runtime.fitness.snapshot().prompt_visible);
        assert!(
            runtime
                .fitness
                .checkpoint()
                .pending
                .unwrap()
                .snooze_active_remaining_ms
                > 0
        );
        assert!(!super::super::snapshot(&runtime).prompt_visible);
        assert!(runtime.engine.error.is_some());
    }
    #[test]
    fn start_exercise_is_durable_without_crediting_completion_and_skip_starts_a_new_round() {
        let directory = tempfile::tempdir().unwrap();
        let mut r = super::super::prompt_close_transaction_tests::runtime(directory.path());
        let id = r.fitness.checkpoint().pending.unwrap().id;
        let history = r.fitness.checkpoint().history;
        apply_fitness_action(&mut r, fitness::Action::Start { reminder_id: id }).unwrap();
        assert!(r.fitness.checkpoint().pending.unwrap().started);
        assert_eq!(r.fitness.checkpoint().history, history);
        r.store.finish().unwrap();
        let persisted = r.store.load_fitness().unwrap().unwrap();
        assert!(persisted.pending.unwrap().started);
        standing_action(&mut r, Action::Skip).unwrap();
        let standing = super::super::snapshot(&r);
        assert!(!standing.due);
        assert!(!standing.prompt_visible);
        assert_eq!(standing.work_ms, 0);
        assert_eq!(standing.rest_ms, 0);
        apply_fitness_action(
            &mut r,
            fitness::Action::Respond {
                reminder_id: id,
                outcome: fitness::Outcome::Complete,
            },
        )
        .unwrap();
        assert!(r.fitness.checkpoint().pending.is_none());
        assert_eq!(
            r.fitness.checkpoint().history[0].outcome,
            fitness::Outcome::Complete
        );
    }
    #[test]
    fn shared_configuration_defaults_roundtrips_and_rejects_invalid_waits() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).unwrap();
        assert_eq!(
            store.load_attention().unwrap(),
            attention::Settings::default()
        );
        let settings = attention::Settings {
            enabled: false,
            delay_seconds: 60,
        };
        store.save_attention(&settings).unwrap();
        store.finish().unwrap();
        assert_eq!(store.load_attention().unwrap(), settings);
        assert!(store
            .save_attention(&attention::Settings {
                enabled: true,
                delay_seconds: 59
            })
            .is_err());
        assert_eq!(store.load_attention().unwrap(), settings);
    }
    #[test]
    fn compact_combines_both_and_started_fitness_does_not_escalate() {
        let directory = tempfile::tempdir().unwrap();
        let mut r = super::super::prompt_close_transaction_tests::runtime(directory.path());
        let s = snapshot(&r);
        assert!(s.active && s.standing.is_some() && s.fitness.is_some());
        assert!(!s.escalated);
        apply_card_action(
            &mut r,
            AttentionAction::Standing {
                action: StandingChoice::Skip,
            },
        )
        .unwrap();
        let id = r.fitness.checkpoint().pending.unwrap().id;
        apply_card_action(
            &mut r,
            AttentionAction::Fitness {
                action: FitnessChoice::Start,
                reminder_id: id,
            },
        )
        .unwrap();
        for _ in 0..1200 {
            r.engine.last_ms += 500;
            observe(&mut r);
        }
        assert!(snapshot(&r).active);
        assert!(!snapshot(&r).escalated);
        assert!(snapshot(&r).fitness.unwrap().state.pending.unwrap().started);
    }
}
