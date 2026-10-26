//! Small, generic per-repository and per-window view selections.
//! This database lives in application configuration, never in a user's warehouse.
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::{fs, path::Path, time::Duration};

pub type ViewResult<T> = Result<T, String>;
const DATABASE_NAME: &str = "view-state.sqlite3";
const APPLICATION_ID: i64 = 0x50425653;
const SCHEMA_VERSION: i64 = 1;

/// Only opaque selection IDs enter this store; document bodies and drafts do not.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ViewSelection {
    pub container_id: Option<String>,
    pub item_id: Option<String>,
}

pub struct ViewStateStore {
    connection: Connection,
}

fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

fn nonempty_key(value: &str) -> ViewResult<()> {
    if value.is_empty() || value.len() > 131_072 || value.chars().any(char::is_control) {
        return Err("Invalid view selection scope".into());
    }
    Ok(())
}

impl ViewStateStore {
    pub fn open(config_dir: &Path) -> ViewResult<Self> {
        fs::create_dir_all(config_dir).map_err(error)?;
        let database = config_dir.join(DATABASE_NAME);
        let existing = database.exists();
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | if existing {
                OpenFlags::empty()
            } else {
                OpenFlags::SQLITE_OPEN_CREATE
            };
        let connection = Connection::open_with_flags(&database, flags).map_err(error)?;
        connection
            .busy_timeout(Duration::from_secs(2))
            .map_err(error)?;
        if !existing {
            connection
                .execute_batch(&format!(
                    "BEGIN IMMEDIATE;
                     PRAGMA application_id={APPLICATION_ID};
                     PRAGMA user_version={SCHEMA_VERSION};
                     CREATE TABLE view_selections (
                         repository_key TEXT NOT NULL,
                         view_key TEXT NOT NULL,
                         window_scope TEXT NOT NULL,
                         container_id TEXT,
                         item_id TEXT,
                         PRIMARY KEY(repository_key, view_key, window_scope)
                     );
                     COMMIT;"
                ))
                .map_err(error)?;
        }
        let application_id: i64 = connection
            .query_row("PRAGMA application_id", [], |row| row.get(0))
            .map_err(error)?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(error)?;
        if application_id != APPLICATION_ID || version != SCHEMA_VERSION {
            return Err(
                "Unsupported application view-state database; existing data was preserved".into(),
            );
        }
        // A recognizable but incomplete/corrupt store fails visibly rather than
        // being reset or silently replaced with an empty selection history.
        connection
            .prepare("SELECT repository_key,view_key,window_scope,container_id,item_id FROM view_selections LIMIT 0")
            .map_err(error)?;
        Ok(Self { connection })
    }

    pub fn load(
        &self,
        repository_key: &str,
        view_key: &str,
        window_scope: &str,
    ) -> ViewResult<Option<ViewSelection>> {
        for key in [repository_key, view_key, window_scope] {
            nonempty_key(key)?;
        }
        self.connection
            .query_row(
                "SELECT container_id,item_id FROM view_selections
                 WHERE repository_key=?1 AND view_key=?2 AND window_scope=?3",
                params![repository_key, view_key, window_scope],
                |row| {
                    Ok(ViewSelection {
                        container_id: row.get(0)?,
                        item_id: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(error)
    }

    pub fn save(
        &self,
        repository_key: &str,
        view_key: &str,
        window_scope: &str,
        selection: &ViewSelection,
    ) -> ViewResult<()> {
        for key in [repository_key, view_key, window_scope] {
            nonempty_key(key)?;
        }
        for id in [
            selection.container_id.as_deref(),
            selection.item_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if id.is_empty() || id.len() > 512 || id.chars().any(char::is_control) {
                return Err("Invalid view selection ID".into());
            }
        }
        self.connection
            .execute(
                "INSERT INTO view_selections
                 (repository_key,view_key,window_scope,container_id,item_id)
                 VALUES(?1,?2,?3,?4,?5)
                 ON CONFLICT(repository_key,view_key,window_scope)
                 DO UPDATE SET container_id=excluded.container_id,item_id=excluded.item_id",
                params![
                    repository_key,
                    view_key,
                    window_scope,
                    selection.container_id,
                    selection.item_id
                ],
            )
            .map_err(error)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selected() -> ViewSelection {
        ViewSelection {
            container_id: Some("same-project".into()),
            item_id: Some("same-page".into()),
        }
    }

    #[test]
    fn repositories_windows_and_views_have_independent_selections() {
        let config = tempfile::tempdir().unwrap();
        let store = ViewStateStore::open(config.path()).unwrap();
        store.save("A", "logs", "main", &selected()).unwrap();
        assert_eq!(store.load("B", "logs", "main").unwrap(), None);
        assert_eq!(store.load("A", "logs", "window-dev-logs").unwrap(), None);
        assert_eq!(store.load("A", "parts", "main").unwrap(), None);
        store
            .save("B", "logs", "main", &ViewSelection::default())
            .unwrap();
        store
            .save("A", "logs", "window-dev-logs", &ViewSelection::default())
            .unwrap();
        store
            .save("A", "logs", "window-dev-logs-2", &selected())
            .unwrap();
        assert_eq!(store.load("A", "logs", "main").unwrap(), Some(selected()));
        assert_eq!(
            store.load("A", "logs", "window-dev-logs").unwrap(),
            Some(ViewSelection::default())
        );
        assert_eq!(
            store.load("A", "logs", "window-dev-logs-2").unwrap(),
            Some(selected())
        );
        assert_eq!(
            store.load("B", "logs", "main").unwrap(),
            Some(ViewSelection::default())
        );
    }

    #[test]
    fn reopening_preserves_a_saved_selection_and_an_explicit_clear() {
        let config = tempfile::tempdir().unwrap();
        {
            let store = ViewStateStore::open(config.path()).unwrap();
            store.save("A", "logs", "main", &selected()).unwrap();
            store
                .save("A", "logs", "window-dev-logs", &ViewSelection::default())
                .unwrap();
        }
        let reopened = ViewStateStore::open(config.path()).unwrap();
        assert_eq!(
            reopened.load("A", "logs", "main").unwrap(),
            Some(selected())
        );
        assert_eq!(
            reopened.load("A", "logs", "window-dev-logs").unwrap(),
            Some(ViewSelection::default())
        );
        assert_eq!(
            reopened.load("A", "logs", "window-dev-logs-2").unwrap(),
            None
        );
    }

    #[test]
    fn an_existing_foreign_database_is_not_reinitialized() {
        let config = tempfile::tempdir().unwrap();
        let path = config.path().join(DATABASE_NAME);
        let foreign = Connection::open(&path).unwrap();
        foreign
            .execute_batch(
                "CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('keep');",
            )
            .unwrap();
        drop(foreign);
        assert!(ViewStateStore::open(config.path()).is_err());
        let retained = Connection::open(path).unwrap();
        assert_eq!(
            retained
                .query_row("SELECT value FROM sentinel", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "keep"
        );
        assert_eq!(
            retained
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn selection_storage_has_no_document_or_draft_column() {
        let config = tempfile::tempdir().unwrap();
        let store = ViewStateStore::open(config.path()).unwrap();
        let columns = store
            .connection
            .prepare("PRAGMA table_info(view_selections)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            columns,
            [
                "repository_key",
                "view_key",
                "window_scope",
                "container_id",
                "item_id"
            ]
        );
    }
}
