use super::engine::Checkpoint;
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
type Write = Box<dyn FnOnce(&Connection) -> Result<(), String> + Send>;
enum Request {
    Write(&'static str, Write),
    Read(Box<dyn FnOnce(&Connection) + Send>),
}
#[derive(Clone)]
pub struct Store {
    sender: Option<mpsc::Sender<Request>>,
    failure: Option<String>,
    errors: Arc<Mutex<std::collections::BTreeMap<&'static str, String>>>,
}
impl Store {
    pub fn open(directory: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(directory).map_err(|e| format!("无法建立久坐提醒配置目录：{e}"))?;
        let path = directory.join("standing-reminder.sqlite");
        if path.is_symlink() {
            return Err("久坐提醒配置数据库不能是重定向链接".into());
        }
        let connection =
            Connection::open(path).map_err(|e| format!("无法打开久坐提醒配置：{e}"))?;
        connection
            .busy_timeout(std::time::Duration::from_secs(3))
            .map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS reminder_state(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);")
            .map_err(|e| format!("无法建立久坐提醒配置表：{e}"))?;
        let (sender, receiver) = mpsc::channel();
        let errors = Arc::new(Mutex::new(std::collections::BTreeMap::new()));
        let worker_errors = errors.clone();
        std::thread::Builder::new()
            .name("perfboard-reminder-storage".into())
            .spawn(move || {
                while let Ok(request) = receiver.recv() {
                    match request {
                        Request::Write(kind, write) => {
                            let result = write(&connection);
                            if let Ok(mut errors) = worker_errors.lock() {
                                match result {
                                    Err(error) => {
                                        errors.insert(kind, error);
                                    }
                                    Ok(()) => {
                                        errors.remove(kind);
                                    }
                                }
                            }
                        }
                        Request::Read(read) => read(&connection),
                    }
                }
            })
            .map_err(|e| format!("无法启动提醒存储线程：{e}"))?;
        Ok(Self {
            sender: Some(sender),
            failure: None,
            errors,
        })
    }
    pub fn unavailable(error: String) -> Self {
        Self {
            sender: None,
            failure: Some(error),
            errors: Arc::new(Mutex::new(std::collections::BTreeMap::new())),
        }
    }
    fn sender(&self) -> Result<&mpsc::Sender<Request>, String> {
        self.sender.as_ref().ok_or_else(|| {
            self.failure
                .clone()
                .unwrap_or_else(|| "Reminder storage unavailable".into())
        })
    }
    fn read<T: Send + 'static>(
        &self,
        read: impl FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (sender, receiver) = mpsc::channel();
        self.sender()?
            .send(Request::Read(Box::new(move |connection| {
                let _ = sender.send(read(connection));
            })))
            .map_err(|_| "提醒存储线程不可用".to_string())?;
        receiver
            .recv()
            .map_err(|_| "提醒存储线程已停止".to_string())?
    }
    fn write(
        &self,
        kind: &'static str,
        write: impl FnOnce(&Connection) -> Result<(), String> + Send + 'static,
    ) -> Result<(), String> {
        self.sender()?
            .send(Request::Write(kind, Box::new(write)))
            .map_err(|_| "提醒存储线程不可用".into())
    }
    /// Wait only after releasing Runtime. All earlier writes run in FIFO order.
    pub fn finish(&self) -> Result<(), String> {
        let errors = self.errors.clone();
        self.read(move |_| {
            let errors = errors.lock().map_err(|_| "提醒存储错误状态不可用")?;
            if errors.is_empty() {
                Ok(())
            } else {
                Err(errors.values().cloned().collect::<Vec<_>>().join("；"))
            }
        })
    }
    pub fn load_fitness(&self) -> Result<Option<super::fitness::Checkpoint>, String> {
        self.read(super::fitness_store::load)
    }
    pub fn save_fitness(&self, value: &super::fitness::Checkpoint) -> Result<(), String> {
        let value = value.clone();
        self.write("fitness", move |connection| {
            super::fitness_store::save(connection, &value)
        })
    }
    pub fn load_attention(&self) -> Result<super::attention::Settings, String> {
        self.read(|connection| {
        connection.execute_batch("CREATE TABLE IF NOT EXISTS reminder_attention_settings(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)")
            .map_err(|e| e.to_string())?;
        let json: Option<String> = connection
            .query_row(
                "SELECT json FROM reminder_attention_settings WHERE id=1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let settings: super::attention::Settings = json
            .map(|json| {
                serde_json::from_str(&json).map_err(|e| format!("提醒升级设置无法读取：{e}"))
            })
            .transpose()?
            .unwrap_or_default();
        settings.validate()?;
        Ok(settings)
        })
    }
    pub fn save_attention(&self, settings: &super::attention::Settings) -> Result<(), String> {
        settings.validate()?;
        let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
        self.write("attention", move |connection| {
        connection.execute_batch("CREATE TABLE IF NOT EXISTS reminder_attention_settings(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)")
            .map_err(|e| e.to_string())?;
        connection.execute("INSERT INTO reminder_attention_settings(id,json) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET json=excluded.json", [json])
            .map_err(|e| format!("提醒升级设置保存失败：{e}"))?;
        Ok(())
        })
    }
    pub fn load(&self) -> Result<Option<Checkpoint>, String> {
        self.read(|connection| {
            let json: Option<String> = connection
                .query_row("SELECT json FROM reminder_state WHERE id=1", [], |row| {
                    row.get(0)
                })
                .optional()
                .map_err(|e| format!("无法读取久坐提醒配置：{e}"))?;
            json.map(|s| {
                serde_json::from_str(&s).map_err(|e| format!("久坐提醒配置损坏，功能已停用：{e}"))
            })
            .transpose()
        })
    }
    pub fn save(&self, value: &Checkpoint) -> Result<(), String> {
        let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
        self.write("standing", move |connection| {
            connection
                .execute(
                    "INSERT INTO reminder_state(id,json) VALUES(1,?1)
            ON CONFLICT(id) DO UPDATE SET json=excluded.json",
                    [json],
                )
                .map_err(|e| format!("无法保存久坐提醒状态，已取消自动锁屏：{e}"))?;
            Ok(())
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::standing_reminder::engine::{Engine, Settings};
    #[test]
    fn sqlite_round_trip_is_independent_and_restart_never_backfills() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let mut engine = Engine::new(0);
        engine
            .configure(
                Settings {
                    enabled: true,
                    work_seconds: 1,
                    ..Settings::default()
                },
                0,
            )
            .unwrap();
        engine.tick(
            1000,
            Some((1000, 0)),
            super::super::activity::ResumeSample::default(),
        );
        store.save(&engine.checkpoint()).unwrap();
        let restored = Engine::restore(store.load().unwrap().unwrap(), 86_400_000);
        let s = restored.snapshot(true, true);
        assert_eq!(s.work_ms, 1000);
        assert!(!s.prompt_visible);
        assert!(s.lock_remaining_ms.is_none());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn failed_writes_remain_visible_to_every_waiter_until_same_state_saves() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let external = Connection::open(dir.path().join("standing-reminder.sqlite")).unwrap();
        external.execute_batch("DROP TABLE reminder_state").unwrap();
        let checkpoint = Engine::new(0).checkpoint();
        store.save(&checkpoint).unwrap();
        assert!(store.finish().is_err());
        assert!(
            store.clone().finish().is_err(),
            "another waiter cannot consume the failure"
        );
        store
            .save_attention(&super::super::attention::Settings::default())
            .unwrap();
        assert!(
            store.finish().is_err(),
            "unrelated settings success cannot clear a lost checkpoint"
        );
        external.execute_batch("CREATE TABLE reminder_state(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)").unwrap();
        store.save(&checkpoint).unwrap();
        store.finish().unwrap();
        assert!(store.load().unwrap().is_some());
    }
}
