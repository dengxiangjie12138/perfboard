//! Optional, warehouse-independent reminder service. One native engine serves all windows.
mod activity;
mod activity_log;
mod activity_recorder;
mod attention;
pub(crate) mod attention_runtime;
#[cfg(debug_assertions)]
mod debug_driver;
mod engine;
mod fitness;
mod fitness_store;
mod input_monitor;
mod persistence;
#[cfg(test)]
mod tests;
mod windows;
use activity::{sample_then_clock, ActivityTimeline, ResumeSample, Worker};
use engine::{
    Action, Effect, Engine, InputSourceStatus, Mode, SessionKind, SettingsPatch, Snapshot,
};
use input_monitor::InputMonitor;
use persistence::Store;
use serde::Deserialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, State};

pub const PROMPT_LABEL: &str = "standing-reminder-prompt";
const EVENT: &str = "perfboard:standing-reminder";
struct Runtime {
    attention: attention::Coordinator,
    attention_rendered_revision: u64,
    attention_rendered_state: Option<(bool, bool, Option<u64>, Option<u64>)>,
    attention_ready: std::collections::HashSet<String>,
    attention_loading_since: Option<std::time::Instant>,
    engine: Engine,
    fitness: fitness::FitnessEngine,
    log: activity_recorder::Recorder,
    fitness_last_save: u64,
    fitness_writable: bool,
    log_last_save: u64,
    store: Store,
    test_mode: bool,
    monitor_available: bool,
    last_save: u64,
    test_input: u64,
    test_idle: u64,
    simulated_locks: u64,
    fail_next_lock: bool,
    input_monitor: Option<InputMonitor>,
    test_activity: ActivityTimeline,
}
pub struct StandingReminderService {
    inner: Mutex<Runtime>,
    persistence: Mutex<()>,
    worker: Mutex<Option<Worker>>,
    stopping: Arc<AtomicBool>,
    attention_dismissing: AtomicBool,
    attention_presentation_pending: AtomicBool,
    attention_display_failed: AtomicBool,
    #[cfg(debug_assertions)]
    attention_test_expired: AtomicBool,
}
fn editor_allowed(window: &tauri::WebviewWindow) -> Result<(), String> {
    crate::tool_windows::require_main_or_tool(window, "standing-reminder")
}
fn reader_allowed(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == PROMPT_LABEL || attention_runtime::is_label(window.label()) {
        Ok(())
    } else {
        editor_allowed(window)
    }
}
fn now(r: &Runtime) -> u64 {
    if r.test_mode {
        r.engine.last_ms
    } else {
        windows::monotonic_ms()
    }
}
fn input(r: &Runtime) -> Option<(u64, u64)> {
    if r.test_mode {
        Some((r.test_input, r.test_idle))
    } else if r.engine.settings.enabled {
        windows::input()
    } else {
        None
    }
}
fn sync_input_monitor(r: &mut Runtime) {
    let active = !r.test_mode
        && ((r.engine.settings.enabled && r.engine.mode != Mode::Paused) || r.fitness.enabled());
    if active && r.input_monitor.is_none() {
        r.input_monitor = Some(InputMonitor::new());
    }
    if !active {
        r.input_monitor.take();
    }
}
fn resume_input(r: &Runtime) -> ResumeSample {
    if r.test_mode {
        ResumeSample {
            available: true,
            window: r.test_activity.window(),
        }
    } else {
        r.input_monitor
            .as_ref()
            .map(InputMonitor::sample)
            .unwrap_or_default()
    }
}
fn snapshot(r: &Runtime) -> Snapshot {
    let mut s = r.engine.snapshot(r.test_mode, r.monitor_available);
    s.simulated_lock_requests = r.simulated_locks;
    s.input_source_status = if r.test_mode {
        InputSourceStatus::Test
    } else if !r.engine.settings.enabled || r.engine.mode == Mode::Paused {
        InputSourceStatus::Inactive
    } else if r
        .input_monitor
        .as_ref()
        .map(InputMonitor::starting)
        .unwrap_or(false)
    {
        InputSourceStatus::Starting
    } else if resume_input(r).available {
        InputSourceStatus::Filtered
    } else {
        InputSourceStatus::Unavailable
    };
    s
}
fn publish(app: &tauri::AppHandle) {
    let service = app.state::<StandingReminderService>();
    if let Ok(r) = service.inner.lock() {
        let _ = app.emit(EVENT, snapshot(&r));
    };
}
/// A failed checkpoint disables pending lock effects before any OS call.
fn persist(r: &mut Runtime) -> Result<(), String> {
    if let Err(error) = r.store.save(&r.engine.checkpoint()) {
        r.engine.storage_failed(error.clone());
        return Err(error);
    }
    r.last_save = r.engine.last_ms;
    Ok(())
}
fn effects(app: &tauri::AppHandle, pending: Vec<Effect>) {
    for effect in pending {
        let service = app.state::<StandingReminderService>();
        if service.stopping.load(Ordering::SeqCst) {
            return;
        }
        match effect {
            Effect::ShowPrompt | Effect::HidePrompt => {
                // All presentation now belongs to the one shared activity container.
                service
                    .attention_presentation_pending
                    .store(true, Ordering::SeqCst);
            }
            Effect::Sound => {
                let sound = service
                    .inner
                    .lock()
                    .map(|r| {
                        !r.test_mode
                            && r.engine.settings.enabled
                            && r.engine.settings.sound
                            && snapshot(&r).prompt_visible
                    })
                    .unwrap_or(false);
                if sound {
                    windows::sound();
                }
            }
            Effect::Lock => {
                let store = {
                    let Ok(mut r) = service.inner.lock() else {
                        continue;
                    };
                    if service.attention_dismissing.load(Ordering::SeqCst)
                        || !r.engine.can_issue_lock()
                        || !r.monitor_available
                    {
                        continue;
                    }
                    if persist(&mut r).is_err() {
                        continue;
                    }
                    r.store.clone()
                };
                // The OS lock still requires a durable checkpoint, but storage must
                // never hold Runtime while a close or cancellation is trying to run.
                let saved = {
                    let Ok(_serial) = service.persistence.lock() else {
                        continue;
                    };
                    store.finish()
                };
                if let Err(error) = saved {
                    if let Ok(mut r) = service.inner.lock() {
                        r.engine.storage_failed(error.clone());
                        r.attention.error = Some(error);
                    }
                    continue;
                }
                let Ok(mut r) = service.inner.lock() else {
                    continue;
                };
                if service.stopping.load(Ordering::SeqCst)
                    || service.attention_dismissing.load(Ordering::SeqCst)
                    || !r.engine.can_issue_lock()
                    || !r.monitor_available
                {
                    continue;
                }
                let result = if r.test_mode {
                    r.simulated_locks += 1;
                    if r.fail_next_lock {
                        r.fail_next_lock = false;
                        Err("模拟 Windows 锁屏失败，本轮不会重试".into())
                    } else {
                        Ok(())
                    }
                } else {
                    windows::lock()
                };
                r.engine.lock_result(result);
                let _ = persist(&mut r);
            }
        }
    }
    publish(app);
    attention_runtime::sync(app);
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let directory =
        crate::config_directory(app.path().app_config_dir().map_err(|e| e.to_string())?);
    #[cfg(debug_assertions)]
    let test_mode = std::env::args_os().any(|arg| arg == "--standing-reminder-test");
    #[cfg(not(debug_assertions))]
    let test_mode = false;
    let store = match Store::open(&directory) {
        Ok(store) => store,
        Err(error) => Store::unavailable(error),
    };
    let start = if test_mode {
        0
    } else {
        windows::monotonic_ms()
    };
    let mut engine = Engine::new(start);
    match store.load() {
        Ok(Some(c)) => engine = Engine::restore(c, start),
        Ok(None) => {}
        Err(error) => engine.error = Some(error), // A corrupt state is OFF; never silently enable.
    }
    let mut fitness = fitness::FitnessEngine::default();
    let mut fitness_writable = true;
    match store.load_fitness() {
        Ok(Some(c)) => match fitness::FitnessEngine::restore(c) {
            Ok(value) => fitness = value,
            Err(e) => {
                fitness_writable = false;
                fitness.storage_failed(e);
            }
        },
        Ok(None) => {}
        Err(e) => {
            fitness_writable = false;
            fitness.storage_failed(e);
        }
    }
    if fitness_writable {
        let initialized = fitness
            .normalize_daily(fitness_wall_ms(), &activity_log::WindowsLocalCalendar)
            .and_then(|changed| {
                if changed {
                    store.save_fitness(&fitness.checkpoint())
                } else {
                    Ok(())
                }
            });
        if let Err(error) = initialized {
            fitness_writable = false;
            fitness.storage_failed(error);
        }
    }
    let log = activity_recorder::Recorder::new(&directory, start);
    let mut attention = attention::Coordinator::default();
    match store.load_attention() {
        Ok(settings) => attention.settings = settings,
        Err(error) => attention.display_failed(error, start),
    }
    let stop = Arc::new(AtomicBool::new(false));
    let input_monitor = if !test_mode
        && ((engine.settings.enabled && engine.mode != Mode::Paused) || fitness.enabled())
    {
        Some(InputMonitor::new())
    } else {
        None
    };
    app.manage(StandingReminderService {
        inner: Mutex::new(Runtime {
            attention,
            attention_rendered_revision: u64::MAX,
            attention_rendered_state: None,
            attention_ready: std::collections::HashSet::new(),
            attention_loading_since: None,
            engine,
            fitness,
            log,
            fitness_last_save: start,
            fitness_writable,
            log_last_save: start,
            store,
            test_mode,
            monitor_available: test_mode,
            last_save: start,
            test_input: 0,
            test_idle: 0,
            simulated_locks: 0,
            fail_next_lock: false,
            input_monitor,
            test_activity: ActivityTimeline::default(),
        }),
        worker: Mutex::new(None),
        persistence: Mutex::new(()),
        stopping: stop.clone(),
        attention_dismissing: AtomicBool::new(false),
        attention_presentation_pending: AtomicBool::new(false),
        attention_display_failed: AtomicBool::new(false),
        #[cfg(debug_assertions)]
        attention_test_expired: AtomicBool::new(false),
    });
    if test_mode {
        #[cfg(debug_assertions)]
        {
            debug_driver::start_attention_watchdog(app, test_mode)?;
            debug_driver::start(app, stop)?;
        }
        return Ok(());
    }
    let thread_app = app.clone();
    let thread_stop = stop.clone();
    let handle = std::thread::Builder::new()
        .name("perfboard-standing-reminder".into())
        .spawn(move || {
            let app = thread_app;
            let monitor = windows::Monitor::new();
            {
                let state = app.state::<StandingReminderService>();
                if let Ok(mut r) = state.inner.lock() {
                    r.monitor_available = monitor.available();
                    if !r.monitor_available {
                        r.engine.error =
                            Some("系统会话监测不可用，自动锁屏已停用；请手动休息".into());
                    }
                };
            }
            while !thread_stop.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(500));
                if thread_stop.load(Ordering::SeqCst) {
                    break;
                }
                let events = monitor.drain();
                let pending = {
                    let state = app.state::<StandingReminderService>();
                    let Ok(mut r) = state.inner.lock() else {
                        break;
                    };
                    if thread_stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let mut pending = vec![];
                    for event in events {
                        r.attention.release(event.now);
                        r.fitness.reset_observation();
                        pending.extend(r.engine.session(event.kind, event.active, event.now));
                        collect_log(&mut r);
                    }
                    // Apply queued recoveries to their original clock era before rotating it.
                    let clock_now = windows::monotonic_ms();
                    {
                        let Runtime { log, engine, .. } = &mut *r;
                        log.observe_clock(clock_now, engine);
                    }
                    // Input adapters read their own clock; tick time must follow both samples.
                    let (current, (sample, resume)) =
                        sample_then_clock(|| (input(&r), resume_input(&r)), windows::monotonic_ms);
                    // Pair clocks before SQLite flushes can delay this poll across midnight.
                    let fitness_wall = fitness_wall_ms();
                    pending.extend(r.engine.tick(current, sample, resume));
                    collect_log(&mut r);
                    if r.log.needs_flush() || current.saturating_sub(r.log_last_save) >= 30_000 {
                        flush_log(&app, &mut r);
                        r.log_last_save = current;
                    }
                    let blocked = r.engine.blocked();
                    let monitor_available = r.monitor_available;
                    let fitness_day_before = r.fitness.daily_day().map(str::to_owned);
                    let mut fitness_pending = r.fitness.tick(
                        fitness::Sample {
                            now_ms: current,
                            latest_input_ms: resume.window.map(|w| w.latest_ms),
                            available: resume.available,
                            blocked,
                        },
                        fitness_wall,
                        monitor_available,
                        fitness_random_u32,
                    );
                    if r.fitness_writable
                        && (!fitness_pending.is_empty()
                            || fitness_day_before.as_deref() != r.fitness.daily_day()
                            || current.saturating_sub(r.fitness_last_save) >= 30_000)
                    {
                        if let Err(error) = r.store.save_fitness(&r.fitness.checkpoint()) {
                            r.fitness.storage_failed(error);
                            r.fitness_writable = false;
                            fitness_pending.clear();
                            fitness_pending.push(fitness::Effect::HidePrompt);
                            sync_input_monitor(&mut r);
                        } else {
                            r.fitness_last_save = current;
                        }
                    }
                    if !pending.is_empty() || current.saturating_sub(r.last_save) >= 30_000 {
                        if persist(&mut r).is_err() {
                            pending.retain(|effect| *effect != Effect::Lock);
                        }
                    }
                    (pending, fitness_pending)
                };
                effects(&app, pending.0);
                fitness_effects(&app, pending.1);
                fitness_publish(&app);
                let _ = persist_runtime(&app);
            }
        })
        .map_err(|e| format!("无法启动久坐提醒后台：{e}"))?;
    *app.state::<StandingReminderService>()
        .worker
        .lock()
        .map_err(|_| "提醒线程锁已损坏")? = Some(Worker::new(stop, handle));
    Ok(())
}

#[tauri::command]
pub fn standing_reminder_status(
    window: tauri::WebviewWindow,
    state: State<'_, StandingReminderService>,
) -> Result<Snapshot, String> {
    reader_allowed(&window)?;
    let r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
    Ok(snapshot(&r))
}
/// Keep configuration and monitor ownership consistent even when persistence fails.
fn configure_runtime(
    r: &mut Runtime,
    settings: SettingsPatch,
    current: u64,
) -> Result<Vec<Effect>, String> {
    let mut candidate = r.engine.clone();
    let pending = candidate.configure(settings.merge(&r.engine.settings), current)?;
    if let Err(error) = r.store.save(&candidate.checkpoint()) {
        r.engine.storage_failed(error.clone());
        if !candidate.settings.enabled {
            let _ = r.engine.configure(candidate.settings, current);
            collect_log(r);
            sync_input_monitor(r);
        }
        return Err(error);
    }
    r.engine = candidate;
    collect_log(r);
    sync_input_monitor(r);
    r.last_save = current;
    Ok(pending)
}

#[tauri::command]
pub async fn standing_reminder_configure(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, StandingReminderService>,
    settings: SettingsPatch,
) -> Result<Snapshot, String> {
    editor_allowed(&window)?;
    let configured;
    {
        let mut r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
        let current = now(&r);
        configured = configure_runtime(&mut r, settings, current);
        flush_log(&app, &mut r);
    }
    effects(
        &app,
        configured
            .as_ref()
            .cloned()
            .unwrap_or_else(|_| vec![Effect::HidePrompt]),
    );
    let saved = persist_runtime(&app);
    configured?;
    saved?;
    let r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
    Ok(snapshot(&r))
}
#[tauri::command]
pub async fn standing_reminder_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, StandingReminderService>,
    action: Action,
) -> Result<Snapshot, String> {
    reader_allowed(&window)?;
    if window.label() == PROMPT_LABEL && matches!(action, Action::Pause | Action::Resume) {
        return Err("提醒窗口不能改变会议暂停设置".into());
    }
    let pending;
    {
        let mut r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
        let (current, stamp) = sample_then_clock(|| input(&r).map(|(s, _)| s), || now(&r));
        let result = if action == Action::Dismiss {
            apply_standing_dismiss(&mut r, current, stamp)
        } else {
            r.engine.action(action, current, stamp)
        };
        collect_log(&mut r);
        pending = result?;
        flush_log(&app, &mut r);
        sync_input_monitor(&mut r);
        if action != Action::Dismiss {
            let _ = persist(&mut r);
        }
    }
    effects(&app, pending);
    persist_runtime(&app)?;
    let r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
    Ok(snapshot(&r))
}
#[tauri::command]
pub async fn standing_reminder_prompt_presented(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, StandingReminderService>,
    token: u64,
) -> Result<Snapshot, String> {
    if window.label() != PROMPT_LABEL || !window.is_visible().unwrap_or(false) {
        return Err("提醒尚未实际显示，不能开始自动锁屏预警".into());
    }
    let pending;
    {
        let mut r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
        let current = now(&r);
        pending = r.engine.presented(token, current);
        let _ = persist(&mut r);
    }
    effects(&app, pending);
    persist_runtime(&app)?;
    let r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
    Ok(snapshot(&r))
}
fn apply_standing_dismiss(
    runtime: &mut Runtime,
    current: u64,
    stamp: Option<u64>,
) -> Result<Vec<Effect>, String> {
    let mut candidate = runtime.engine.clone();
    let pending = candidate.action(Action::Dismiss, current, stamp)?;
    runtime.last_save = candidate.last_ms;
    runtime.engine = candidate;
    if let Err(error) = runtime.store.save(&runtime.engine.checkpoint()) {
        runtime.engine.storage_failed(error);
    }
    Ok(pending)
}
pub fn handle_prompt_close(app: &tauri::AppHandle, label: &str) -> bool {
    if attention_runtime::close(app, label) {
        return true;
    }
    #[cfg(debug_assertions)]
    debug_driver::trace(app, label, "closeRequested");
    if label == FITNESS_PROMPT_LABEL {
        let result = {
            let state = app.state::<StandingReminderService>();
            state.inner.lock().ok().and_then(|mut r| {
                match apply_fitness_action(&mut r, fitness::Action::Collapse) {
                    Ok((_, pending)) => Some(pending),
                    Err(error) => {
                        // Publish the unchanged state directly: a second date-normalization
                        // save must not hide a prompt whose close transaction just failed.
                        r.fitness.report_error(error);
                        let _ = app.emit(FITNESS_EVENT, r.fitness.snapshot());
                        None
                    }
                }
            })
        };
        if let Some(pending) = result {
            fitness_effects(app, pending);
            fitness_publish(app);
        }
        return true;
    }
    if label != PROMPT_LABEL {
        return false;
    }
    let pending = {
        let state = app.state::<StandingReminderService>();
        let Ok(mut r) = state.inner.lock() else {
            return true;
        };
        let current = now(&r);
        let pending = match apply_standing_dismiss(&mut r, current, None) {
            Ok(pending) => pending,
            Err(error) => {
                r.engine.storage_failed(error);
                vec![]
            }
        };
        collect_log(&mut r);
        flush_log(app, &mut r);
        pending
    };
    effects(app, pending);
    true
}
pub fn prompt_destroyed(app: &tauri::AppHandle, label: &str) {
    if attention_runtime::destroyed(app, label) {
        return;
    }
    #[cfg(debug_assertions)]
    debug_driver::trace(app, label, "destroyed");
    if label == FITNESS_PROMPT_LABEL {
        if let Ok(mut r) = app.state::<StandingReminderService>().inner.lock() {
            r.fitness
                .display_failed("健身提醒窗口已关闭，可从工具页再次显示".into());
        }
        fitness_publish(app);
        return;
    }
    if label != PROMPT_LABEL {
        return;
    }
    if let Ok(mut r) = app.state::<StandingReminderService>().inner.lock() {
        if r.engine
            .snapshot(r.test_mode, r.monitor_available)
            .prompt_visible
        {
            r.engine
                .prompt_failed("提醒窗口意外关闭，已取消本轮自动锁屏".into());
        }
    };
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TestEvent {
    Advance {
        milliseconds: u64,
        activity: bool,
        #[serde(default)]
        injected: bool,
    },
    Session {
        session: SessionKind,
        active: bool,
    },
    LockFailure {
        enabled: bool,
    },
    Reset,
}
/// Explicit private mode only; production OS adapter is never reached by this command.
#[tauri::command]
pub async fn standing_reminder_test_event(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, StandingReminderService>,
    event: TestEvent,
) -> Result<Snapshot, String> {
    crate::tool_windows::require_main(&window)?;
    let pending;
    let mut fitness_pending = vec![];
    {
        let mut r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
        if !r.test_mode {
            return Err("仅隔离久坐提醒测试模式允许模拟系统事件".into());
        }
        let mut result = vec![];
        match event {
            TestEvent::Advance {
                milliseconds,
                activity,
                injected,
            } => {
                if milliseconds > 86_400_000 {
                    return Err("模拟推进不能超过一天".into());
                }
                let mut remaining = milliseconds;
                while remaining > 0 {
                    let step = remaining.min(500);
                    let current = r.engine.last_ms.saturating_add(step);
                    if activity {
                        r.test_input = current;
                        r.test_idle = 0;
                        r.test_activity.record(current, injected);
                    } else {
                        r.test_idle = r.test_idle.saturating_add(step);
                    }
                    let sample = Some((r.test_input, r.test_idle));
                    let resume = resume_input(&r);
                    result.extend(r.engine.tick(current, sample, resume));
                    let blocked = r.engine.blocked();
                    fitness_pending.extend(r.fitness.tick(
                        fitness::Sample {
                            now_ms: current,
                            latest_input_ms: resume.window.map(|w| w.latest_ms),
                            available: resume.available,
                            blocked,
                        },
                        current,
                        true,
                        fitness_random_u32,
                    ));
                    attention_runtime::observe(&mut r);
                    collect_log(&mut r);
                    remaining -= step;
                }
            }
            TestEvent::Session { session, active } => {
                let current = r.engine.last_ms;
                result.extend(r.engine.session(session, active, current));
                r.fitness.reset_observation();
                r.attention.release(current);
                let blocked = r.engine.blocked();
                fitness_pending.extend(r.fitness.tick(
                    fitness::Sample {
                        now_ms: current,
                        latest_input_ms: None,
                        available: true,
                        blocked,
                    },
                    current,
                    true,
                    fitness_random_u32,
                ));
                collect_log(&mut r);
            }
            TestEvent::LockFailure { enabled } => {
                r.fail_next_lock = enabled;
            }
            TestEvent::Reset => {
                let current = r.engine.last_ms;
                {
                    let Runtime { log, engine, .. } = &mut *r;
                    log.close(engine);
                }
                flush_log(&app, &mut r);
                r.engine = Engine::new(current);
                r.test_input = current;
                r.test_idle = 0;
                r.test_activity = ActivityTimeline::default();
                r.simulated_locks = 0;
                r.fail_next_lock = false;
                r.attention.release(current);
                result.push(Effect::HidePrompt);
            }
        }
        persist(&mut r)?;
        if r.fitness_writable {
            r.store.save_fitness(&r.fitness.checkpoint())?;
        }
        pending = result;
    }
    effects(&app, pending);
    fitness_effects(&app, fitness_pending);
    fitness_publish(&app);
    persist_runtime(&app)?;
    let r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
    Ok(snapshot(&r))
}

/// Called once before the host's genuine process exit; never on an individual tool close.
/// A failure cancels pending lock but does not need to prevent the user from quitting.
pub fn flush(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<StandingReminderService>();
    // A synchronous exit command must not join a Tauri effect worker that may be
    // waiting on the host's UI thread. Stop it before final state serialization.
    state.stopping.store(true, Ordering::SeqCst);
    attention_runtime::shutdown(app);
    if let Some(worker) = state.worker.lock().map_err(|_| "提醒线程锁已损坏")?.take() {
        worker.stop_without_join();
    }
    {
        let mut r = state.inner.lock().map_err(|_| "久坐提醒状态不可用")?;
        if let Some(mut monitor) = r.input_monitor.take() {
            monitor.shutdown();
        }
        let Runtime { log, engine, .. } = &mut *r;
        log.close(engine);
        r.fitness
            .normalize_daily(fitness_wall_ms(), &activity_log::WindowsLocalCalendar)?;
        if r.fitness_writable {
            if let Err(error) = r.store.save_fitness(&r.fitness.checkpoint()) {
                r.fitness.report_error(error);
            }
        }
        let _ = persist(&mut r);
    }
    persist_runtime(app)
}

pub const FITNESS_PROMPT_LABEL: &str = "fitness-prompt";
const FITNESS_EVENT: &str = "perfboard:fitness";
fn fitness_reader_allowed(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == FITNESS_PROMPT_LABEL || attention_runtime::is_label(window.label()) {
        Ok(())
    } else {
        crate::tool_windows::require_main_or_tool(window, "fitness")
    }
}

/// Save a changed date before exposing it, retaining the original activity baseline.
fn fitness_normalize_runtime(runtime: &mut Runtime) -> Result<(), String> {
    let mut candidate = runtime.fitness.clone();
    if candidate.normalize_daily(fitness_wall_ms(), &activity_log::WindowsLocalCalendar)? {
        if runtime.fitness_writable {
            if let Err(error) = runtime.store.save_fitness(&candidate.checkpoint()) {
                candidate.storage_failed(error.clone());
                runtime.fitness = candidate;
                runtime.fitness_writable = false;
                sync_input_monitor(runtime);
                return Err(error);
            }
            runtime.fitness_last_save = now(runtime);
        }
        runtime.fitness = candidate;
    }
    Ok(())
}

fn fitness_publish(app: &tauri::AppHandle) {
    let service = app.state::<StandingReminderService>();
    let hide = if let Ok(mut runtime) = service.inner.lock() {
        let error = fitness_normalize_runtime(&mut runtime).err();
        if let Some(error) = &error {
            runtime.fitness.report_error(error.clone());
        }
        let _ = app.emit(FITNESS_EVENT, runtime.fitness.snapshot());
        error.is_some()
    } else {
        false
    };
    if hide {
        fitness_effects(app, vec![fitness::Effect::HidePrompt]);
    }
    attention_runtime::sync(app);
}
fn fitness_wall_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(9_007_199_254_740_991) as u64
}
fn fitness_random_u32() -> u32 {
    let bytes = uuid::Uuid::new_v4().into_bytes();
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}
fn fitness_effects(app: &tauri::AppHandle, pending: Vec<fitness::Effect>) {
    if !pending.is_empty() {
        app.state::<StandingReminderService>()
            .attention_presentation_pending
            .store(true, Ordering::SeqCst);
    }
    attention_runtime::sync(app);
}

#[tauri::command]
pub fn fitness_status(
    app: tauri::AppHandle,
    state: State<'_, StandingReminderService>,
    window: tauri::WebviewWindow,
) -> Result<fitness::Snapshot, String> {
    fitness_reader_allowed(&window)?;
    let result = {
        let mut runtime = state.inner.lock().map_err(|_| "提醒状态不可用")?;
        fitness_normalize_runtime(&mut runtime).map(|_| runtime.fitness.snapshot())
    };
    if result.is_err() {
        fitness_effects(&app, vec![fitness::Effect::HidePrompt]);
    }
    result
}
#[tauri::command]
pub async fn fitness_configure(
    app: tauri::AppHandle,
    state: State<'_, StandingReminderService>,
    window: tauri::WebviewWindow,
    request: fitness::Configure,
) -> Result<fitness::Snapshot, String> {
    crate::tool_windows::require_main_or_tool(&window, "fitness")?;
    let (snapshot, pending) = {
        let mut runtime = state.inner.lock().map_err(|_| "提醒状态不可用")?;
        let mut candidate = runtime.fitness.clone();
        candidate.normalize_daily(fitness_wall_ms(), &activity_log::WindowsLocalCalendar)?;
        let pending = candidate.configure(request)?;
        runtime.fitness = candidate;
        if let Err(error) = runtime.store.save_fitness(&runtime.fitness.checkpoint()) {
            runtime.fitness.report_error(error);
        }
        runtime.fitness_writable = true;
        runtime.fitness_last_save = now(&runtime);
        sync_input_monitor(&mut runtime);
        (runtime.fitness.snapshot(), pending)
    };
    fitness_effects(&app, pending);
    fitness_publish(&app);
    persist_runtime(&app)?;
    Ok(snapshot)
}
#[tauri::command]
pub async fn fitness_action(
    app: tauri::AppHandle,
    state: State<'_, StandingReminderService>,
    window: tauri::WebviewWindow,
    action: fitness::Action,
) -> Result<fitness::Snapshot, String> {
    fitness_reader_allowed(&window)?;
    if matches!(&action, fitness::Action::Reset) {
        crate::tool_windows::require_main_or_tool(&window, "fitness")?;
    }
    let (snapshot, pending) = {
        let mut runtime = state.inner.lock().map_err(|_| "提醒状态不可用")?;
        apply_fitness_action(&mut runtime, action)?
    };
    fitness_effects(&app, pending);
    fitness_publish(&app);
    persist_runtime(&app)?;
    Ok(snapshot)
}

fn apply_fitness_action(
    runtime: &mut Runtime,
    action: fitness::Action,
) -> Result<(fitness::Snapshot, Vec<fitness::Effect>), String> {
    if !runtime.fitness_writable
        && !matches!(&action, fitness::Action::Show | fitness::Action::Collapse)
    {
        return Err("健身配置无法读取，请先在工具页显式保存设置；原文件未被覆盖".into());
    }
    let mut candidate = runtime.fitness.clone();
    let wall_ms = fitness_wall_ms();
    candidate.normalize_daily(wall_ms, &activity_log::WindowsLocalCalendar)?;
    let pending = candidate.action(action, wall_ms)?;
    runtime.fitness = candidate;
    // Commit the user's response before storage; failure must never resurrect a prompt.
    if runtime.fitness_writable {
        if let Err(error) = runtime.store.save_fitness(&runtime.fitness.checkpoint()) {
            runtime.fitness.report_error(error);
        }
        runtime.fitness_last_save = now(runtime);
    }
    Ok((runtime.fitness.snapshot(), pending))
}

const ACTIVITY_EVENT: &str = "perfboard:activity-log-changed";
fn collect_log(r: &mut Runtime) {
    let Runtime { log, engine, .. } = r;
    log.collect(engine);
}
fn flush_log(_app: &tauri::AppHandle, r: &mut Runtime) {
    // Observations are already queued by collect_log. persist_runtime detaches and
    // flushes them without holding the shared engine mutex.
    r.log.request_flush();
}
fn persist_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<StandingReminderService>();
    let _serial = state.persistence.lock().map_err(|_| "提醒存储同步不可用")?;
    let (store, mut log) = {
        let mut runtime = state.inner.lock().map_err(|_| "提醒状态不可用")?;
        let log = runtime
            .log
            .flush_requested()
            .then(|| runtime.log.take_flush());
        (runtime.store.clone(), log)
    };
    let saved = store.finish();
    let logged = log.as_mut().map_or_else(|| Ok(Vec::new()), |log| log.run());
    {
        let mut runtime = state.inner.lock().map_err(|_| "提醒状态不可用")?;
        if let Some(log) = log {
            runtime.log.finish_flush(log);
        }
        if let Err(error) = &saved {
            let error = format!("操作已生效，但提醒状态未保存：{error}");
            runtime.engine.storage_failed(error.clone());
            runtime.fitness.report_error(error.clone());
            runtime.attention.error = Some(error);
        }
        if let Err(error) = &logged {
            runtime.attention.error = Some(format!("活动日志未保存：{error}"));
        }
    }
    if let Ok(days) = &logged {
        for day in days {
            let _ = app.emit(ACTIVITY_EVENT, serde_json::json!({"day":day}));
        }
    }
    publish(app);
    fitness_publish(app);
    saved?;
    logged.map(|_| ())
}
#[tauri::command]
pub async fn activity_log_day(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    day: String,
) -> Result<activity_log::ActivityLogDay, String> {
    editor_allowed(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<StandingReminderService>();
        let _serial = state
            .persistence
            .lock()
            .map_err(|_| "活动日志存储同步不可用")?;
        let mut log = {
            let mut r = state.inner.lock().map_err(|_| "活动日志状态不可用")?;
            collect_log(&mut r);
            r.log.take_flush()
        };
        let result = log.run().and_then(|_| log.day(&day));
        state
            .inner
            .lock()
            .map_err(|_| "活动日志状态不可用")?
            .log
            .finish_flush(log);
        result
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn activity_log_days(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    limit: Option<u32>,
    before_day: Option<String>,
) -> Result<activity_log::ActivityLogDays, String> {
    editor_allowed(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<StandingReminderService>();
        let _serial = state
            .persistence
            .lock()
            .map_err(|_| "活动日志存储同步不可用")?;
        let mut log = {
            let mut r = state.inner.lock().map_err(|_| "活动日志状态不可用")?;
            collect_log(&mut r);
            r.log.take_flush()
        };
        let result = log
            .run()
            .and_then(|_| log.days(limit, before_day.as_deref()));
        state
            .inner
            .lock()
            .map_err(|_| "活动日志状态不可用")?
            .log
            .finish_flush(log);
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod log_engine_tests;

#[cfg(test)]
mod prompt_close_transaction_tests {
    use super::*;

    pub(super) fn runtime(directory: &std::path::Path) -> Runtime {
        let mut engine = Engine::new(0);
        engine
            .configure(
                engine::Settings {
                    enabled: true,
                    work_seconds: 1,
                    ..engine::Settings::default()
                },
                0,
            )
            .unwrap();
        engine.tick(1000, Some((1000, 0)), ResumeSample::default());
        let mut checkpoint = fitness::Checkpoint::default();
        checkpoint.settings.enabled = true;
        checkpoint.settings.interval_ms = 60_000;
        checkpoint.pool[0].selected = true;
        let mut fitness = fitness::FitnessEngine::restore(checkpoint).unwrap();
        for t in (0..=60_000).step_by(500) {
            fitness.tick(
                fitness::Sample {
                    now_ms: t,
                    latest_input_ms: Some(t),
                    available: true,
                    blocked: false,
                },
                fitness_wall_ms(),
                true,
                || 0,
            );
        }
        Runtime {
            attention: attention::Coordinator::default(),
            attention_rendered_revision: u64::MAX,
            attention_rendered_state: None,
            attention_ready: std::collections::HashSet::new(),
            attention_loading_since: None,
            engine,
            fitness,
            log: activity_recorder::Recorder::new(directory, 0),
            fitness_last_save: 0,
            fitness_writable: true,
            log_last_save: 0,
            store: Store::open(directory).unwrap(),
            test_mode: true,
            monitor_available: true,
            last_save: 0,
            test_input: 0,
            test_idle: 0,
            simulated_locks: 0,
            fail_next_lock: false,
            input_monitor: None,
            test_activity: ActivityTimeline::default(),
        }
    }

    #[test]
    fn failed_close_save_hides_both_prompts_and_reports_unsaved_state() {
        let directory = tempfile::tempdir().unwrap();
        let mut r = runtime(directory.path());
        r.engine.settings.auto_lock = true;
        let token = r.engine.snapshot(true, true).prompt_token;
        r.engine.presented(token, 1000);
        assert_eq!(
            r.engine.snapshot(true, true).lock_remaining_ms,
            Some(15_000)
        );
        r.store = Store::unavailable("injected save failure".into());
        assert!(r.engine.snapshot(true, true).prompt_visible);
        assert!(r.fitness.snapshot().prompt_visible);
        assert_eq!(
            apply_standing_dismiss(&mut r, 1000, Some(1000)).unwrap(),
            vec![Effect::HidePrompt]
        );
        assert!(r.engine.snapshot(true, true).error.is_some());
        assert!(r.engine.snapshot(true, true).lock_remaining_ms.is_none());
        assert_eq!(
            apply_fitness_action(&mut r, fitness::Action::Collapse)
                .unwrap()
                .1,
            vec![fitness::Effect::HidePrompt]
        );
        assert!(r.fitness.snapshot().error.is_some());
        assert!(!r.engine.snapshot(true, true).prompt_visible);
        assert!(!r.fitness.snapshot().prompt_visible);
        assert!(r.store.finish().is_err());
    }

    #[test]
    fn close_applies_both_snoozes_and_serial_queue_persists_them() {
        let directory = tempfile::tempdir().unwrap();
        let mut r = runtime(directory.path());
        assert_eq!(
            apply_standing_dismiss(&mut r, 1000, Some(1000)).unwrap(),
            vec![Effect::HidePrompt]
        );
        assert_eq!(
            r.store.load().unwrap().unwrap().snooze_remaining_ms,
            Some(300_000)
        );
        let (_, effects) = apply_fitness_action(&mut r, fitness::Action::Collapse).unwrap();
        assert_eq!(effects, vec![fitness::Effect::HidePrompt]);
        assert_eq!(
            r.store.load_fitness().unwrap().unwrap(),
            r.fitness.checkpoint()
        );
        assert_eq!(
            r.fitness.checkpoint().history[0].outcome,
            fitness::Outcome::Later
        );
        assert!(!r.engine.snapshot(true, true).prompt_visible);
        assert!(!r.fitness.snapshot().prompt_visible);
    }

    #[test]
    fn read_only_fitness_close_hides_without_overwriting_stored_state() {
        let directory = tempfile::tempdir().unwrap();
        let mut r = runtime(directory.path());
        let before = r.fitness.checkpoint();
        r.store.save_fitness(&before).unwrap();
        r.fitness_writable = false;
        assert!(apply_fitness_action(&mut r, fitness::Action::Collapse).is_ok());
        assert_eq!(r.store.load_fitness().unwrap().unwrap(), before);
        assert!(!r.fitness.snapshot().prompt_visible);
    }

    #[test]
    fn busy_sqlite_cannot_block_start_close_or_reading_runtime() {
        let directory = tempfile::tempdir().unwrap();
        let mut runtime = runtime(directory.path());
        let external =
            rusqlite::Connection::open(directory.path().join("standing-reminder.sqlite")).unwrap();
        external.execute_batch("BEGIN IMMEDIATE").unwrap();
        let start = std::time::Instant::now();
        let id = runtime.fitness.checkpoint().pending.unwrap().id;
        apply_fitness_action(&mut runtime, fitness::Action::Start { reminder_id: id }).unwrap();
        assert!(runtime.fitness.checkpoint().pending.unwrap().started);
        apply_fitness_action(&mut runtime, fitness::Action::Collapse).unwrap();
        apply_standing_dismiss(&mut runtime, 1000, None).unwrap();
        assert!(!snapshot(&runtime).prompt_visible);
        assert!(!runtime.fitness.snapshot().prompt_visible);
        assert!(
            start.elapsed() < Duration::from_millis(250),
            "actions must only queue, not wait for SQLite"
        );
        external.execute_batch("ROLLBACK").unwrap();
        runtime.store.finish().unwrap();
        assert!(!runtime
            .store
            .load_fitness()
            .unwrap()
            .unwrap()
            .pending
            .unwrap()
            .snooze_active_remaining_ms
            .eq(&0));
    }

    #[test]
    fn failed_fitness_start_still_enters_progress_without_recording_completion() {
        let directory = tempfile::tempdir().unwrap();
        let mut runtime = runtime(directory.path());
        runtime.store = Store::unavailable("injected start failure".into());
        let before = runtime.fitness.checkpoint();
        let id = before.pending.unwrap().id;
        apply_fitness_action(&mut runtime, fitness::Action::Start { reminder_id: id }).unwrap();
        assert!(runtime.fitness.checkpoint().pending.unwrap().started);
        assert_eq!(runtime.fitness.checkpoint().history, before.history);
        assert!(runtime.fitness.snapshot().error.is_some());
        assert!(runtime.store.finish().is_err());
    }
}
