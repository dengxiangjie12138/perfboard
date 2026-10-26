//! Named fitness checkpoint stored in the existing independent reminder configuration DB.
use super::fitness::Checkpoint;
use rusqlite::{Connection, OptionalExtension};
fn prepare(connection: &Connection) -> Result<(), String> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS fitness_state(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)").map_err(|e| format!("无法建立工作与健身配置表：{e}"))
}
pub fn load(connection: &Connection) -> Result<Option<Checkpoint>, String> {
    prepare(connection)?;
    let json: Option<String> = connection
        .query_row("SELECT json FROM fitness_state WHERE id=1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| format!("无法读取工作与健身配置：{e}"))?;
    json.map(|json| {
        let checkpoint: Checkpoint = serde_json::from_str(&json)
            .map_err(|e| format!("工作与健身配置损坏，已停用且原文保留：{e}"))?;
        checkpoint.validate()?;
        Ok(checkpoint)
    })
    .transpose()
}
pub fn save(connection: &Connection, checkpoint: &Checkpoint) -> Result<(), String> {
    checkpoint.validate()?;
    prepare(connection)?;
    let json = serde_json::to_string(checkpoint).map_err(|e| e.to_string())?;
    connection.execute("INSERT INTO fitness_state(id,json) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET json=excluded.json", [json]).map_err(|e| format!("无法保存工作与健身状态；当前动作未提交：{e}"))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn separate_table_roundtrip_preserves_reminder_and_corrupt_json() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE reminder_state(id INTEGER PRIMARY KEY,json TEXT);INSERT INTO reminder_state VALUES(1,'sentinel')").unwrap();
        let checkpoint = Checkpoint::default();
        save(&connection, &checkpoint).unwrap();
        assert_eq!(load(&connection).unwrap(), Some(checkpoint));
        let original: String = connection
            .query_row("SELECT json FROM reminder_state WHERE id=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(original, "sentinel");
        connection
            .execute("UPDATE fitness_state SET json='bad-json'", [])
            .unwrap();
        assert!(load(&connection).is_err());
        let original: String = connection
            .query_row("SELECT json FROM fitness_state WHERE id=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(original, "bad-json");
    }
}

#[cfg(test)]
mod daily_tests {
    use super::*;
    use crate::standing_reminder::activity_log::FixedCalendar;
    use crate::standing_reminder::fitness::{Checkpoint, FitnessEngine};
    #[test]
    fn legacy_daily_migration_roundtrip_keeps_lifetime_and_reminder_row() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE reminder_state(id INTEGER PRIMARY KEY,json TEXT); INSERT INTO reminder_state VALUES(1,'sentinel')").unwrap();
        let mut original = Checkpoint::default();
        original.active_ms = 333;
        original.total_active_ms = 900_000;
        let mut json = serde_json::to_value(&original).unwrap();
        json.as_object_mut().unwrap().remove("dailyActiveMs");
        json.as_object_mut().unwrap().remove("dailyActiveDay");
        prepare(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO fitness_state(id,json) VALUES(1,?1)",
                [json.to_string()],
            )
            .unwrap();
        let mut engine = FitnessEngine::restore(load(&connection).unwrap().unwrap()).unwrap();
        let wall = chrono::DateTime::parse_from_rfc3339("2026-10-09T12:00:00+08:00")
            .unwrap()
            .timestamp_millis() as u64;
        let calendar = FixedCalendar(chrono::FixedOffset::east_opt(8 * 3600).unwrap());
        assert!(engine.normalize_daily(wall, &calendar).unwrap());
        original.daily_active_day = Some("2026-10-09".into());
        save(&connection, &engine.checkpoint()).unwrap();
        assert_eq!(load(&connection).unwrap().unwrap(), original);
        let sentinel: String = connection
            .query_row("SELECT json FROM reminder_state WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(sentinel, "sentinel");
        assert!(engine
            .normalize_daily(wall + 86_400_000, &calendar)
            .unwrap());
        save(&connection, &engine.checkpoint()).unwrap();
        let restored = load(&connection).unwrap().unwrap();
        assert_eq!(restored.daily_active_day.as_deref(), Some("2026-10-10"));
        assert_eq!(restored.daily_active_ms, 0);
        assert_eq!(restored.total_active_ms, 900_000);
        assert_eq!(restored.active_ms, 333);
    }
    #[test]
    fn failed_daily_save_and_corrupt_daily_json_leave_original_row_untouched() {
        let connection = Connection::open_in_memory().unwrap();
        let mut original = Checkpoint::default();
        original.total_active_ms = 1000;
        original.daily_active_ms = 1000;
        original.daily_active_day = Some("2026-10-08".into());
        save(&connection, &original).unwrap();
        connection.execute_batch("CREATE TRIGGER reject_fitness_update BEFORE UPDATE ON fitness_state BEGIN SELECT RAISE(ABORT,'fixture write failure'); END").unwrap();
        let mut tomorrow = original.clone();
        tomorrow.daily_active_day = Some("2026-10-09".into());
        tomorrow.daily_active_ms = 0;
        assert!(save(&connection, &tomorrow).is_err());
        assert_eq!(load(&connection).unwrap().unwrap(), original);
        connection
            .execute_batch("DROP TRIGGER reject_fitness_update")
            .unwrap();
        let mut corrupt = serde_json::to_value(&original).unwrap();
        corrupt["dailyActiveDay"] = serde_json::json!("2026-02-30");
        let text = corrupt.to_string();
        connection
            .execute("UPDATE fitness_state SET json=?1 WHERE id=1", [&text])
            .unwrap();
        assert!(load(&connection).is_err());
        let unchanged: String = connection
            .query_row("SELECT json FROM fitness_state WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(unchanged, text);
    }
}
