//! Small warehouse-owned workflow storage helpers. All callers hold the repository lock.
use rusqlite::{params, Connection, OptionalExtension};

pub fn setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|error| error.to_string())
}

pub fn save_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value])
        .map(|_| ()).map_err(|error| error.to_string())
}

/// Identity moves with the SQLite file, including a backup restored on another machine.
pub fn warehouse_id(conn: &Connection) -> Result<String, String> {
    const KEY: &str = "workflow.warehouse_id";
    if setting(conn, KEY)?.is_none() {
        conn.execute(
            "INSERT OR IGNORE INTO settings(key,value) VALUES(?1,?2)",
            params![KEY, uuid::Uuid::new_v4().to_string()],
        )
        .map_err(|error| error.to_string())?;
    }
    let id = setting(conn, KEY)?.ok_or("Warehouse identity is unavailable")?;
    uuid::Uuid::parse_str(&id).map_err(|_| "Warehouse identity is invalid".to_string())?;
    Ok(id)
}
