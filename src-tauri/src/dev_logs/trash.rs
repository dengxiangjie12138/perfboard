//! Permanent trash removal is a confirmed database-only operation.
//! Callers must hold the host's lease guard and repository mutex through these calls.
use super::{
    check_revision, err, get_page, get_project, page_row, project_row, LogPage, LogProject,
    LogResult, PAGE_COLUMNS, PROJECT_COLUMNS,
};
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SNAPSHOT_CONFLICT: &str =
    "[trash-snapshot-conflict] 回收站或当前仓库已变化，请刷新后重新确认；没有永久删除任何记录";
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashSnapshot {
    pub projects: Vec<LogProject>,
    pub pages: Vec<LogPage>,
    pub snapshot_token: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrashPurgeInput {
    pub id: String,
    pub expected_revision: i64,
    pub snapshot_token: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrashClearInput {
    pub snapshot_token: String,
}
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashDeleteResult {
    pub deleted_projects: u64,
    pub deleted_pages: u64,
    pub deleted_history: u64,
}
#[derive(Serialize)]
struct ProjectSignature {
    value: LogProject,
    deletion_batch: Option<String>,
}
#[derive(Serialize)]
struct PageSignature {
    value: LogPage,
    deletion_batch: Option<String>,
}
#[derive(Serialize)]
struct HistorySignature {
    page_id: String,
    revision: i64,
    title: String,
    document_json: String,
    schema_version: i64,
    saved_at: String,
}
struct Contents {
    projects: Vec<ProjectSignature>,
    pages: Vec<PageSignature>,
    token: String,
}
fn hash_record(hash: &mut Sha256, tag: &[u8], record: &impl Serialize) -> LogResult<()> {
    let bytes = serde_json::to_vec(record).map_err(err)?;
    hash.update((tag.len() as u64).to_le_bytes());
    hash.update(tag);
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(bytes);
    Ok(())
}
/// Sorted, complete identities/revisions and related-page/history signatures.
/// This is called in a coherent read transaction or the final immediate write transaction.
fn contents(conn: &Connection) -> LogResult<Contents> {
    let projects = conn.prepare(&format!("SELECT {PROJECT_COLUMNS},deletion_batch FROM dev_log_projects WHERE deleted_at IS NOT NULL ORDER BY id"))
        .map_err(err)?.query_map([],|row|Ok(ProjectSignature { value: project_row(row)?, deletion_batch: row.get(7)? }))
        .map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
    let pages = conn.prepare(&format!("SELECT {PAGE_COLUMNS},deletion_batch FROM dev_log_pages
        WHERE deleted_at IS NOT NULL OR project_id IN (SELECT id FROM dev_log_projects WHERE deleted_at IS NOT NULL) ORDER BY id"))
        .map_err(err)?.query_map([],|row|Ok(PageSignature { value: page_row(row)?, deletion_batch: row.get(10)? }))
        .map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
    let scope: String = conn
        .query_row(
            "SELECT file FROM pragma_database_list WHERE name='main'",
            [],
            |row| row.get(0),
        )
        .map_err(err)?;
    let mut hash = Sha256::new();
    hash.update(b"perfboard:dev-log-trash:v1\0");
    hash_record(&mut hash, b"warehouse", &scope)?;
    for project in &projects {
        hash_record(&mut hash, b"project", project)?;
    }
    for page in &pages {
        hash_record(&mut hash, b"page", page)?;
    }
    // Stream history one row at a time instead of keeping every saved document in memory.
    let mut statement = conn
        .prepare(
            "SELECT h.page_id,h.revision,h.title,h.document_json,h.schema_version,h.saved_at
        FROM dev_log_page_history h JOIN dev_log_pages p ON p.id=h.page_id
        LEFT JOIN dev_log_projects j ON j.id=p.project_id
        WHERE p.deleted_at IS NOT NULL OR j.deleted_at IS NOT NULL ORDER BY h.page_id,h.revision",
        )
        .map_err(err)?;
    let histories = statement
        .query_map([], |row| {
            Ok(HistorySignature {
                page_id: row.get(0)?,
                revision: row.get(1)?,
                title: row.get(2)?,
                document_json: row.get(3)?,
                schema_version: row.get(4)?,
                saved_at: row.get(5)?,
            })
        })
        .map_err(err)?;
    for history in histories {
        hash_record(&mut hash, b"history", &history.map_err(err)?)?;
    }
    let token = format!("trash-v1:{:x}", hash.finalize());
    Ok(Contents {
        projects,
        pages,
        token,
    })
}
fn verify_token(actual: &str, expected: &str) -> LogResult<()> {
    if actual != expected {
        Err(SNAPSHOT_CONFLICT.into())
    } else {
        Ok(())
    }
}
fn require_deleted(deleted_at: &Option<String>) -> LogResult<()> {
    if deleted_at.is_none() {
        Err("[not-deleted] 活动项目或页面不能永久删除，请刷新回收站".into())
    } else {
        Ok(())
    }
}
fn delete_page_records(conn: &Connection, page: &LogPage) -> LogResult<TrashDeleteResult> {
    require_deleted(&page.deleted_at)?;
    // Explicit deletion also works for test connections without foreign_keys enabled.
    conn.execute(
        "DELETE FROM dev_log_page_folders WHERE page_id=?1",
        [&page.id],
    )
    .map_err(err)?;
    conn.execute("DELETE FROM dev_log_resources WHERE page_id=?1", [&page.id])
        .map_err(err)?;
    let history = conn
        .execute(
            "DELETE FROM dev_log_page_history WHERE page_id=?1",
            [&page.id],
        )
        .map_err(err)?;
    let removed = conn
        .execute(
            "DELETE FROM dev_log_pages WHERE id=?1 AND revision=?2 AND deleted_at IS NOT NULL",
            params![page.id, page.revision],
        )
        .map_err(err)?;
    if removed != 1 {
        return Err(SNAPSHOT_CONFLICT.into());
    }
    Ok(TrashDeleteResult {
        deleted_projects: 0,
        deleted_pages: 1,
        deleted_history: history as u64,
    })
}
fn delete_project_record(conn: &Connection, project: &LogProject) -> LogResult<()> {
    require_deleted(&project.deleted_at)?;
    conn.execute(
        "DELETE FROM dev_log_folders WHERE project_id=?1",
        [&project.id],
    )
    .map_err(err)?;
    let removed = conn
        .execute(
            "DELETE FROM dev_log_projects WHERE id=?1 AND revision=?2 AND deleted_at IS NOT NULL",
            params![project.id, project.revision],
        )
        .map_err(err)?;
    if removed != 1 {
        return Err(SNAPSHOT_CONFLICT.into());
    }
    Ok(())
}
/// Confirmation is warehouse-bound. No connection state is modified after commit.
pub fn trash_snapshot(conn: &Connection) -> LogResult<TrashSnapshot> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let value = contents(&tx)?;
    let result = TrashSnapshot {
        projects: value.projects.into_iter().map(|row| row.value).collect(),
        pages: value
            .pages
            .into_iter()
            .filter(|row| row.value.deleted_at.is_some())
            .map(|row| row.value)
            .collect(),
        snapshot_token: value.token,
    };
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn permanently_delete_page(
    conn: &mut Connection,
    input: TrashPurgeInput,
) -> LogResult<TrashDeleteResult> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let current = contents(&tx)?;
    verify_token(&current.token, &input.snapshot_token)?;
    let page = get_page(&tx, &input.id)?;
    require_deleted(&page.deleted_at)?;
    check_revision(page.revision, input.expected_revision)?;
    let result = delete_page_records(&tx, &page)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn permanently_delete_project(
    conn: &mut Connection,
    input: TrashPurgeInput,
) -> LogResult<TrashDeleteResult> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let current = contents(&tx)?;
    verify_token(&current.token, &input.snapshot_token)?;
    let project = get_project(&tx, &input.id)?;
    require_deleted(&project.deleted_at)?;
    check_revision(project.revision, input.expected_revision)?;
    let pages = current
        .pages
        .iter()
        .filter(|page| page.value.project_id == project.id)
        .collect::<Vec<_>>();
    // Reject a malformed or unexpectedly active child before deleting any history.
    for page in &pages {
        require_deleted(&page.value.deleted_at)?;
    }
    let mut result = TrashDeleteResult::default();
    for page in pages {
        let count = delete_page_records(&tx, &page.value)?;
        result.deleted_pages += count.deleted_pages;
        result.deleted_history += count.deleted_history;
    }
    delete_project_record(&tx, &project)?;
    result.deleted_projects = 1;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn clear_trash(conn: &mut Connection, input: TrashClearInput) -> LogResult<TrashDeleteResult> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let current = contents(&tx)?;
    verify_token(&current.token, &input.snapshot_token)?;
    for project in &current.projects {
        require_deleted(&project.value.deleted_at)?;
    }
    for page in &current.pages {
        require_deleted(&page.value.deleted_at)?;
    }
    let mut result = TrashDeleteResult::default();
    for page in &current.pages {
        let count = delete_page_records(&tx, &page.value)?;
        result.deleted_pages += count.deleted_pages;
        result.deleted_history += count.deleted_history;
    }
    for project in &current.projects {
        delete_project_record(&tx, &project.value)?;
        result.deleted_projects += 1;
    }
    tx.commit().map_err(err)?;
    Ok(result)
}
#[cfg(test)]
#[path = "trash_tests.rs"]
mod tests;
