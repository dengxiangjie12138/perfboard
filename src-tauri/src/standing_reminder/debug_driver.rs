//! Debug-only, isolated native lifecycle reproduction. Never compiled into release builds.
//! No OS input is sampled or injected; the normal engines receive coherent synthetic samples.
use super::*;
use std::{
    io::Write,
    path::{Path, PathBuf},
    time::Instant,
};

const LIMIT: Duration = Duration::from_secs(120);
const STEP_MS: u64 = 1_000;
const POLL: Duration = Duration::from_millis(100);

fn isolated_directory(
    requested: bool,
    test_mode: bool,
    identifier: &str,
    directory: Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    if !requested {
        return Ok(None);
    }
    if !test_mode || !identifier.starts_with("com.perfboard.qa") {
        return Err(
            "Background reminder test requires test mode and a dedicated QA identifier".into(),
        );
    }
    let directory = directory
        .filter(|p| p.is_absolute())
        .ok_or("Background reminder test requires an absolute PERFBOARD_TEST_CONFIG_DIR")?;
    Ok(Some(directory))
}

fn directory(app: &tauri::AppHandle, test_mode: bool) -> Result<Option<PathBuf>, String> {
    isolated_directory(
        std::env::args_os().any(|arg| arg == "--reminder-background-test"),
        test_mode,
        &app.config().identifier,
        std::env::var_os("PERFBOARD_TEST_CONFIG_DIR").map(PathBuf::from),
    )
}

pub(super) fn start_attention_watchdog(
    app: &tauri::AppHandle,
    test_mode: bool,
) -> Result<(), String> {
    let requested = std::env::args_os().any(|arg| arg == "--reminder-attention-test-watchdog");
    if isolated_directory(
        requested,
        test_mode,
        &app.config().identifier,
        std::env::var_os("PERFBOARD_TEST_CONFIG_DIR").map(PathBuf::from),
    )?
    .is_none()
    {
        return Ok(());
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("perfboard-attention-test-watchdog".into())
        .spawn(move || {
            // One bounded wait on a dedicated debug thread, with no synthetic clock advance.
            std::thread::sleep(LIMIT);
            attention_runtime::test_shutdown(&app);
        })
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn trace(app: &tauri::AppHandle, label: &str, event: &str) {
    if label != FITNESS_PROMPT_LABEL && label != PROMPT_LABEL {
        return;
    }
    let test_mode = std::env::args_os().any(|arg| arg == "--standing-reminder-test");
    let Ok(Some(directory)) = directory(app, test_mode) else {
        return;
    };
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("reminder-native-events.jsonl"))
    {
        let row = serde_json::json!({
            "pid": std::process::id(), "label": label, "event": event,
            "wallMs": fitness_wall_ms(),
        });
        let _ = writeln!(file, "{row}");
    }
}

fn advance(runtime: &mut Runtime, wall_ms: u64) -> (Vec<Effect>, Vec<fitness::Effect>) {
    let current = runtime.engine.last_ms.saturating_add(STEP_MS);
    runtime.test_input = current;
    runtime.test_idle = 0;
    runtime.test_activity.record(current, false);
    let resume = ResumeSample {
        available: true,
        window: runtime.test_activity.window(),
    };
    let standing = runtime.engine.tick(current, Some((current, 0)), resume);
    let fitness = runtime.fitness.tick(
        fitness::Sample {
            now_ms: current,
            latest_input_ms: Some(current),
            available: true,
            blocked: runtime.engine.blocked(),
        },
        wall_ms,
        true,
        fitness_random_u32,
    );
    (standing, fitness)
}

fn write_state(
    directory: &Path,
    runtime: &Runtime,
    started: Instant,
    tick: u64,
    active: bool,
    error: Option<&str>,
) -> Result<(), String> {
    let value = serde_json::json!({
        "pid": std::process::id(),
        "tick": tick,
        "virtualNowMs": runtime.engine.last_ms,
        "elapsedRealMs": started.elapsed().as_millis(),
        "driverActive": active,
        "standing": snapshot(runtime),
        "fitness": runtime.fitness.snapshot(),
        "attention": { "active": runtime.attention.active(), "standing": runtime.attention.standing(), "fitness": runtime.attention.fitness(), "settings": runtime.attention.settings },
        "error": error,
    });
    let temporary = directory.join("reminder-background-test-state.tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(
        temporary,
        directory.join("reminder-background-test-state.json"),
    )
    .map_err(|e| e.to_string())
}

pub(super) fn start(app: &tauri::AppHandle, stop: Arc<AtomicBool>) -> Result<(), String> {
    let Some(directory) = directory(app, true)? else {
        return Ok(());
    };
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let thread_app = app.clone();
    let thread_stop = stop.clone();
    let handle = std::thread::Builder::new()
        .name("perfboard-reminder-background-test".into())
        .spawn(move || {
            let started = Instant::now();
            let wall_start = fitness_wall_ms();
            let app = thread_app;
            let service = app.state::<StandingReminderService>();
            let mono_start = match service.inner.lock() {
                Ok(runtime) => runtime.engine.last_ms,
                Err(_) => return,
            };
            let mut tick = 0;
            let mut failure = None;
            while !thread_stop.load(Ordering::SeqCst)
                && started.elapsed() < LIMIT
                && !directory.join("reminder-background-test.stop").exists()
            {
                std::thread::sleep(POLL);
                if started.elapsed() >= LIMIT || thread_stop.load(Ordering::SeqCst) {
                    break;
                }
                let pending = {
                    let Ok(mut runtime) = service.inner.lock() else {
                        break;
                    };
                    let wall = wall_start.saturating_add(
                        runtime
                            .engine
                            .last_ms
                            .saturating_add(STEP_MS)
                            .saturating_sub(mono_start),
                    );
                    let mut pending = advance(&mut runtime, wall);
                    collect_log(&mut runtime);
                    if runtime.log.needs_flush()
                        || runtime.engine.last_ms.saturating_sub(runtime.log_last_save) >= 30_000
                    {
                        flush_log(&app, &mut runtime);
                        runtime.log_last_save = runtime.engine.last_ms;
                    }
                    if runtime.fitness_writable
                        && (!pending.1.is_empty()
                            || runtime
                                .engine
                                .last_ms
                                .saturating_sub(runtime.fitness_last_save)
                                >= 30_000)
                    {
                        if let Err(error) =
                            runtime.store.save_fitness(&runtime.fitness.checkpoint())
                        {
                            runtime.fitness.storage_failed(error.clone());
                            runtime.fitness_writable = false;
                            pending.1 = vec![fitness::Effect::HidePrompt];
                            failure = Some(error);
                        } else {
                            runtime.fitness_last_save = runtime.engine.last_ms;
                        }
                    }
                    if !pending.0.is_empty()
                        || runtime.engine.last_ms.saturating_sub(runtime.last_save) >= 30_000
                    {
                        if let Err(error) = persist(&mut runtime) {
                            pending.0.retain(|effect| *effect != Effect::Lock);
                            failure = Some(error);
                        }
                    }
                    tick += 1;
                    if let Err(error) = write_state(
                        &directory,
                        &runtime,
                        started,
                        tick,
                        true,
                        failure.as_deref(),
                    ) {
                        failure = Some(error);
                    }
                    pending
                };
                // These are the same native effects used by the production worker.
                // test_mode makes every lock effect a counter instead of an OS operation.
                effects(&app, pending.0);
                fitness_effects(&app, pending.1);
                fitness_publish(&app);
                let _ = persist_runtime(&app);
            }
            if let Ok(mut runtime) = service.inner.lock() {
                let current = now(&runtime);
                runtime
                    .attention
                    .display_failed("隔离验证已结束，所有遮罩已解除。".into(), current);
                let _ = write_state(
                    &directory,
                    &runtime,
                    started,
                    tick,
                    false,
                    failure.as_deref(),
                );
            };
            attention_runtime::shutdown(&app);
        })
        .map_err(|e| e.to_string())?;
    *app.state::<StandingReminderService>()
        .worker
        .lock()
        .map_err(|_| "Reminder test worker unavailable")? = Some(Worker::new(stop, handle));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn driver_requires_explicit_debug_test_isolation() {
        let absolute = std::env::temp_dir().join("perfboard-debug-driver-test");
        assert_eq!(
            isolated_directory(false, false, "com.perfboard.toolbox", None).unwrap(),
            None
        );
        assert!(
            isolated_directory(true, false, "com.perfboard.qa.test", Some(absolute.clone()))
                .is_err()
        );
        assert!(
            isolated_directory(true, true, "com.perfboard.toolbox", Some(absolute.clone()))
                .is_err()
        );
        assert!(isolated_directory(true, true, "com.perfboard.qa.test", None).is_err());
        assert!(
            isolated_directory(true, true, "com.perfboard.qa.test", Some("relative".into()))
                .is_err()
        );
        assert_eq!(
            isolated_directory(true, true, "com.perfboard.qa.test", Some(absolute.clone()))
                .unwrap(),
            Some(absolute)
        );
        assert_eq!(LIMIT, Duration::from_secs(120));
    }

    #[test]
    fn synthetic_clock_credits_activity_and_snooze_without_completing_exercise() {
        let directory = tempfile::tempdir().unwrap();
        let mut r = super::super::prompt_close_transaction_tests::runtime(directory.path());
        let wall_start = fitness_wall_ms();
        let mono_start = r.engine.last_ms;
        let pending_id = r.fitness.checkpoint().pending.as_ref().unwrap().id;
        apply_fitness_action(&mut r, fitness::Action::Collapse).unwrap();
        let cycle_ms = r.fitness.checkpoint().active_ms;
        for tick in 1..=121 {
            advance(&mut r, wall_start + tick * STEP_MS);
        }
        assert_eq!(r.engine.last_ms, mono_start + 121 * STEP_MS);
        assert!(r.fitness.snapshot().prompt_visible);
        assert_eq!(r.fitness.checkpoint().active_ms, cycle_ms);
        assert_eq!(r.fitness.checkpoint().pending.unwrap().id, pending_id);
        assert!(r
            .fitness
            .checkpoint()
            .history
            .iter()
            .all(|entry| entry.outcome == fitness::Outcome::Later));
        assert_eq!(r.simulated_locks, 0);
    }
}
