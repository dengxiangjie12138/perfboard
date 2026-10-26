//! Development logs are independent of Excalidraw notes. Callers hold the repository mutex
//! and enforce the window-owned edit lease before invoking writes.
mod folders;
mod formatting;
mod trash;
pub use folders::{
    create as create_folder, create_schema as create_folder_schema, delete as delete_folder,
    move_item as move_tree_item, rename as rename_folder,
    validate_schema as validate_folder_schema, LogFolder, TreeMoveInput,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
pub use trash::{
    clear_trash, permanently_delete_page, permanently_delete_project, trash_snapshot,
    TrashClearInput, TrashDeleteResult, TrashPurgeInput, TrashSnapshot,
};
use uuid::Uuid;
pub type LogResult<T> = Result<T, String>;
pub const DOCUMENT_SCHEMA_VERSION: i64 = 1;
const EMPTY_DOCUMENT: &str = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
const PROJECT_COLUMNS: &str = "id,title,position,revision,created_at,updated_at,deleted_at";
const PAGE_COLUMNS: &str = "id,project_id,title,document_json,schema_version,position,revision,created_at,updated_at,deleted_at";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogProject {
    pub id: String,
    pub title: String,
    pub position: i64,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub document_json: String,
    pub schema_version: i64,
    pub position: i64,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSnapshot {
    pub projects: Vec<LogProject>,
    pub pages: Vec<LogPage>,
    pub folders: Vec<LogFolder>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogHistory {
    pub page_id: String,
    pub revision: i64,
    pub title: String,
    pub document_json: String,
    pub schema_version: i64,
    pub saved_at: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevisionInput {
    pub id: String,
    pub expected_revision: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameInput {
    pub id: String,
    pub expected_revision: i64,
    pub title: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageSaveInput {
    pub id: String,
    pub expected_revision: i64,
    pub title: String,
    pub document_json: String,
    pub schema_version: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryRestoreInput {
    pub id: String,
    pub expected_revision: i64,
    pub history_revision: i64,
}
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn title(value: &str) -> LogResult<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 200 {
        return Err("标题须为 1–200 个字符".into());
    }
    Ok(value.into())
}
fn check_revision(actual: i64, expected: i64) -> LogResult<()> {
    if expected != actual {
        Err("[revision-conflict] 页面或项目已在另一窗口更新，请刷新后重试；当前草稿仍保留".into())
    } else {
        Ok(())
    }
}
fn active(deleted_at: &Option<String>) -> LogResult<()> {
    if deleted_at.is_some() {
        Err("[deleted] 已删除的页面或项目不能编辑，请先从回收站恢复".into())
    } else {
        Ok(())
    }
}
pub fn create_schema(conn: &Connection) -> LogResult<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS dev_log_projects (
 id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,position INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,deletion_batch TEXT);
 CREATE TABLE IF NOT EXISTS dev_log_pages (
 id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL REFERENCES dev_log_projects(id),title TEXT NOT NULL,document_json TEXT NOT NULL,schema_version INTEGER NOT NULL CHECK(schema_version>0),position INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,deletion_batch TEXT);
 CREATE INDEX IF NOT EXISTS dev_log_project_order ON dev_log_projects(deleted_at,position,id);
 CREATE INDEX IF NOT EXISTS dev_log_page_order ON dev_log_pages(project_id,deleted_at,position,id);
 CREATE TABLE IF NOT EXISTS dev_log_page_history (
  page_id TEXT NOT NULL REFERENCES dev_log_pages(id),revision INTEGER NOT NULL,title TEXT NOT NULL,document_json TEXT NOT NULL,schema_version INTEGER NOT NULL,saved_at TEXT NOT NULL,PRIMARY KEY(page_id,revision));").map_err(err)?;
    crate::log_resources::create_schema(conn)?;
    folders::create_schema(conn)
}
fn project_row(row: &Row<'_>) -> rusqlite::Result<LogProject> {
    Ok(LogProject {
        id: row.get(0)?,
        title: row.get(1)?,
        position: row.get(2)?,
        revision: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        deleted_at: row.get(6)?,
    })
}
fn page_row(row: &Row<'_>) -> rusqlite::Result<LogPage> {
    Ok(LogPage {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        document_json: row.get(3)?,
        schema_version: row.get(4)?,
        position: row.get(5)?,
        revision: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        deleted_at: row.get(9)?,
    })
}
pub fn get_project(conn: &Connection, id: &str) -> LogResult<LogProject> {
    conn.query_row(
        &format!("SELECT {PROJECT_COLUMNS} FROM dev_log_projects WHERE id=?1"),
        [id],
        project_row,
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "项目不存在".into())
}
pub fn get_page(conn: &Connection, id: &str) -> LogResult<LogPage> {
    conn.query_row(
        &format!("SELECT {PAGE_COLUMNS} FROM dev_log_pages WHERE id=?1"),
        [id],
        page_row,
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "页面不存在".into())
}
pub fn snapshot(conn: &Connection) -> LogResult<LogSnapshot> {
    let projects = conn
        .prepare(&format!(
            "SELECT {PROJECT_COLUMNS} FROM dev_log_projects ORDER BY position,id"
        ))
        .map_err(err)?
        .query_map([], project_row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let pages = conn
        .prepare(&format!(
            "SELECT {PAGE_COLUMNS} FROM dev_log_pages ORDER BY project_id,position,id"
        ))
        .map_err(err)?
        .query_map([], page_row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(LogSnapshot {
        projects,
        pages,
        folders: folders::list(conn)?,
    })
}
fn record_history(conn: &Connection, page: &LogPage) -> LogResult<()> {
    conn.execute("INSERT INTO dev_log_page_history(page_id,revision,title,document_json,schema_version,saved_at) VALUES(?1,?2,?3,?4,?5,?6)",params![page.id,page.revision,page.title,page.document_json,page.schema_version,page.updated_at]).map_err(err)?;
    Ok(())
}
pub fn create_project(conn: &mut Connection, raw_title: &str) -> LogResult<LogProject> {
    let title = title(raw_title)?;
    let tx = conn.transaction().map_err(err)?;
    let id = Uuid::new_v4().to_string();
    let stamp = now();
    let position: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position),-1)+1 FROM dev_log_projects WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(err)?;
    tx.execute("INSERT INTO dev_log_projects(id,title,position,revision,created_at,updated_at) VALUES(?1,?2,?3,1,?4,?4)",params![id,title,position,stamp]).map_err(err)?;
    let result = get_project(&tx, &id)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn rename_project(conn: &mut Connection, input: RenameInput) -> LogResult<LogProject> {
    let title = title(&input.title)?;
    let tx = conn.transaction().map_err(err)?;
    let value = get_project(&tx, &input.id)?;
    active(&value.deleted_at)?;
    check_revision(value.revision, input.expected_revision)?;
    tx.execute(
        "UPDATE dev_log_projects SET title=?2,revision=revision+1,updated_at=?3 WHERE id=?1",
        params![input.id, title, now()],
    )
    .map_err(err)?;
    let result = get_project(&tx, &input.id)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn delete_project(conn: &mut Connection, input: RevisionInput) -> LogResult<LogProject> {
    let tx = conn.transaction().map_err(err)?;
    let value = get_project(&tx, &input.id)?;
    active(&value.deleted_at)?;
    check_revision(value.revision, input.expected_revision)?;
    let stamp = now();
    let batch = Uuid::new_v4().to_string();
    tx.execute("UPDATE dev_log_pages SET deleted_at=?2,deletion_batch=?3,updated_at=?2,revision=revision+1 WHERE project_id=?1 AND deleted_at IS NULL",params![input.id,stamp,batch]).map_err(err)?;
    tx.execute("UPDATE dev_log_projects SET deleted_at=?2,deletion_batch=?3,updated_at=?2,revision=revision+1 WHERE id=?1",params![input.id,stamp,batch]).map_err(err)?;
    let result = get_project(&tx, &input.id)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn restore_project(conn: &mut Connection, input: RevisionInput) -> LogResult<LogProject> {
    let tx = conn.transaction().map_err(err)?;
    let value = get_project(&tx, &input.id)?;
    check_revision(value.revision, input.expected_revision)?;
    if value.deleted_at.is_none() {
        return Err("项目已恢复".into());
    }
    let batch: String = tx
        .query_row(
            "SELECT deletion_batch FROM dev_log_projects WHERE id=?1",
            [&input.id],
            |row| row.get(0),
        )
        .map_err(err)?;
    let stamp = now();
    let position: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position),-1)+1 FROM dev_log_projects WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(err)?;
    tx.execute("UPDATE dev_log_projects SET deleted_at=NULL,deletion_batch=NULL,position=?2,updated_at=?3,revision=revision+1 WHERE id=?1",params![input.id,position,stamp]).map_err(err)?;
    tx.execute("UPDATE dev_log_pages SET deleted_at=NULL,deletion_batch=NULL,updated_at=?3,revision=revision+1 WHERE project_id=?1 AND deletion_batch=?2",params![input.id,batch,stamp]).map_err(err)?;
    let result = get_project(&tx, &input.id)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn create_page(conn: &mut Connection, project_id: &str, raw_title: &str) -> LogResult<LogPage> {
    let title = title(raw_title)?;
    let tx = conn.transaction().map_err(err)?;
    active(&get_project(&tx, project_id)?.deleted_at)?;
    let id = Uuid::new_v4().to_string();
    let stamp = now();
    let position:i64=tx.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM (SELECT position FROM dev_log_pages WHERE project_id=?1 AND deleted_at IS NULL UNION ALL SELECT position FROM dev_log_folders WHERE project_id=?1)",[project_id],|row|row.get(0)).map_err(err)?;
    tx.execute("INSERT INTO dev_log_pages(id,project_id,title,document_json,schema_version,position,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7,?7)",params![id,project_id,title,EMPTY_DOCUMENT,DOCUMENT_SCHEMA_VERSION,position,stamp]).map_err(err)?;
    let result = get_page(&tx, &id)?;
    record_history(&tx, &result)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn save_page(conn: &mut Connection, input: PageSaveInput) -> LogResult<LogPage> {
    let title = title(&input.title)?;
    let document_json = validate_document(&input.document_json, input.schema_version)?;
    let tx = conn.transaction().map_err(err)?;
    let value = get_page(&tx, &input.id)?;
    active(&value.deleted_at)?;
    active(&get_project(&tx, &value.project_id)?.deleted_at)?;
    check_revision(value.revision, input.expected_revision)?;
    crate::log_resources::validate_document_resources(&tx, &input.id, &document_json)?;
    tx.execute("UPDATE dev_log_pages SET title=?2,document_json=?3,schema_version=?4,revision=revision+1,updated_at=?5 WHERE id=?1",params![input.id,title,document_json,input.schema_version,now()]).map_err(err)?;
    let result = get_page(&tx, &input.id)?;
    record_history(&tx, &result)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn delete_page(conn: &mut Connection, input: RevisionInput) -> LogResult<LogPage> {
    let tx = conn.transaction().map_err(err)?;
    let value = get_page(&tx, &input.id)?;
    active(&value.deleted_at)?;
    active(&get_project(&tx, &value.project_id)?.deleted_at)?;
    check_revision(value.revision, input.expected_revision)?;
    tx.execute("UPDATE dev_log_pages SET deleted_at=?2,deletion_batch=NULL,updated_at=?2,revision=revision+1 WHERE id=?1",params![input.id,now()]).map_err(err)?;
    let result = get_page(&tx, &input.id)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn restore_page(conn: &mut Connection, input: RevisionInput) -> LogResult<LogPage> {
    let tx = conn.transaction().map_err(err)?;
    let value = get_page(&tx, &input.id)?;
    check_revision(value.revision, input.expected_revision)?;
    active(&get_project(&tx, &value.project_id)?.deleted_at)?;
    if value.deleted_at.is_none() {
        return Err("页面已恢复".into());
    }
    let position:i64=tx.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM dev_log_pages WHERE project_id=?1 AND deleted_at IS NULL",[&value.project_id],|row|row.get(0)).map_err(err)?;
    tx.execute("UPDATE dev_log_pages SET deleted_at=NULL,deletion_batch=NULL,position=?2,updated_at=?3,revision=revision+1 WHERE id=?1",params![input.id,position,now()]).map_err(err)?;
    let result = get_page(&tx, &input.id)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
fn check_order<T>(
    items: &[RevisionInput],
    values: &[T],
    identity: impl Fn(&T) -> (&str, i64),
) -> LogResult<()> {
    if items.len() != values.len() {
        return Err("[revision-conflict] 排序列表已变化，请刷新后重试".into());
    }
    let mut seen = HashSet::new();
    for item in items {
        if !seen.insert(item.id.as_str()) {
            return Err("排序列表含重复项目或页面".into());
        }
        let value = values
            .iter()
            .find(|value| identity(value).0 == item.id)
            .ok_or("排序列表含不存在或已删除项目或页面")?;
        check_revision(identity(value).1, item.expected_revision)?;
    }
    Ok(())
}
pub fn reorder_projects(
    conn: &mut Connection,
    items: Vec<RevisionInput>,
) -> LogResult<Vec<LogProject>> {
    let tx = conn.transaction().map_err(err)?;
    let values = snapshot(&tx)?
        .projects
        .into_iter()
        .filter(|value| value.deleted_at.is_none())
        .collect::<Vec<_>>();
    check_order(&items, &values, |value| (&value.id, value.revision))?;
    let stamp = now();
    for (position, item) in items.iter().enumerate() {
        tx.execute(
            "UPDATE dev_log_projects SET position=?2,revision=revision+1,updated_at=?3 WHERE id=?1",
            params![item.id, position as i64, stamp],
        )
        .map_err(err)?;
    }
    let result = items
        .iter()
        .map(|item| get_project(&tx, &item.id))
        .collect::<LogResult<Vec<_>>>()?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn reorder_pages(
    conn: &mut Connection,
    project_id: &str,
    items: Vec<RevisionInput>,
) -> LogResult<Vec<LogPage>> {
    let tx = conn.transaction().map_err(err)?;
    active(&get_project(&tx, project_id)?.deleted_at)?;
    let values = snapshot(&tx)?
        .pages
        .into_iter()
        .filter(|value| value.project_id == project_id && value.deleted_at.is_none())
        .collect::<Vec<_>>();
    check_order(&items, &values, |value| (&value.id, value.revision))?;
    let stamp = now();
    for (position, item) in items.iter().enumerate() {
        tx.execute(
            "UPDATE dev_log_pages SET position=?2,revision=revision+1,updated_at=?3 WHERE id=?1",
            params![item.id, position as i64, stamp],
        )
        .map_err(err)?;
    }
    let result = items
        .iter()
        .map(|item| get_page(&tx, &item.id))
        .collect::<LogResult<Vec<_>>>()?;
    tx.commit().map_err(err)?;
    Ok(result)
}
pub fn history(conn: &Connection, id: &str) -> LogResult<Vec<LogHistory>> {
    get_page(conn, id)?;
    let mut statement=conn.prepare("SELECT page_id,revision,title,document_json,schema_version,saved_at FROM dev_log_page_history WHERE page_id=?1 ORDER BY revision DESC LIMIT 200").map_err(err)?;
    let results = statement
        .query_map([id], |row| {
            Ok(LogHistory {
                page_id: row.get(0)?,
                revision: row.get(1)?,
                title: row.get(2)?,
                document_json: row.get(3)?,
                schema_version: row.get(4)?,
                saved_at: row.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(results)
}
pub fn restore_history(conn: &mut Connection, input: HistoryRestoreInput) -> LogResult<LogPage> {
    let (title,json,version):(String,String,i64)=conn.query_row("SELECT title,document_json,schema_version FROM dev_log_page_history WHERE page_id=?1 AND revision=?2",params![input.id,input.history_revision],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(err)?.ok_or("此历史版本不存在")?;
    save_page(
        conn,
        PageSaveInput {
            id: input.id,
            expected_revision: input.expected_revision,
            title,
            document_json: json,
            schema_version: version,
        },
    )
}
/// Validate the structured Tiptap document; display gutters and arbitrary node types
/// never enter storage. Unknown schema versions are deliberately not rewritten.
pub fn validate_document(raw: &str, version: i64) -> LogResult<String> {
    if version != DOCUMENT_SCHEMA_VERSION {
        return Err("不支持的日志文档版本；原始内容已保留".into());
    }
    if raw.len() > 8 * 1024 * 1024 {
        return Err("日志文档超过 8 MB 限制".into());
    }
    let mut value: Value = serde_json::from_str(raw).map_err(|_| "日志文档不是有效 JSON")?;
    if value.get("type").and_then(Value::as_str) != Some("doc") {
        return Err("日志文档根节点须为 doc".into());
    }
    formatting::normalize_formatting(&mut value, 0, &mut 0)?;
    let mut count = 0;
    validate_node(&value, 0, &mut count)?;
    serde_json::to_string(&value).map_err(err)
}
fn children(value: &Value) -> LogResult<&[Value]> {
    match value.get("content") {
        None => Ok(&[]),
        Some(Value::Array(values)) => Ok(values),
        _ => Err("节点 content 须为数组".into()),
    }
}
fn block(kind: &str) -> bool {
    matches!(
        kind,
        "paragraph"
            | "heading"
            | "codeBlock"
            | "blockquote"
            | "bulletList"
            | "orderedList"
            | "taskList"
            | "horizontalRule"
            | "image"
            | "fileAttachment"
    )
}
fn validate_node(value: &Value, depth: usize, count: &mut usize) -> LogResult<()> {
    *count += 1;
    if depth > 64 || *count > 100_000 {
        return Err("日志文档结构过大或嵌套过深".into());
    }
    let obj = value.as_object().ok_or("文档节点须为对象")?;
    if obj.keys().any(|key| {
        !matches!(
            key.as_str(),
            "type" | "content" | "text" | "marks" | "attrs"
        )
    }) {
        return Err("文档包含不支持的节点字段".into());
    }
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or("文档节点缺少类型")?;
    if !matches!(
        kind,
        "doc"
            | "paragraph"
            | "heading"
            | "text"
            | "hardBreak"
            | "codeBlock"
            | "blockquote"
            | "bulletList"
            | "orderedList"
            | "listItem"
            | "taskList"
            | "taskItem"
            | "horizontalRule"
            | "image"
            | "fileAttachment"
    ) {
        return Err(format!("不支持的日志节点类型：{kind}"));
    }
    if kind == "doc" && depth != 0 {
        return Err("doc 只能是根节点".into());
    }
    let content = children(value)?;
    if matches!(kind, "image" | "fileAttachment")
        && !value
            .get("attrs")
            .and_then(|attrs| attrs.get("resourceId"))
            .and_then(Value::as_str)
            .is_some_and(|id| Uuid::parse_str(id).is_ok())
    {
        return Err("图片或文件缺少有效资源标识".into());
    }
    let kinds = content
        .iter()
        .map(|child| child.get("type").and_then(Value::as_str).unwrap_or(""))
        .collect::<Vec<_>>();
    let valid = match kind {
        "doc" | "blockquote" => !content.is_empty() && kinds.iter().all(|kind| block(kind)),
        "paragraph" | "heading" => kinds
            .iter()
            .all(|kind| matches!(*kind, "text" | "hardBreak")),
        "codeBlock" => kinds.iter().all(|kind| *kind == "text"),
        "bulletList" | "orderedList" => {
            !content.is_empty() && kinds.iter().all(|kind| *kind == "listItem")
        }
        "taskList" => !content.is_empty() && kinds.iter().all(|kind| *kind == "taskItem"),
        "listItem" | "taskItem" => {
            kinds.first() == Some(&"paragraph") && kinds.iter().all(|kind| block(kind))
        }
        "text" => {
            content.is_empty()
                && value
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| !text.is_empty())
        }
        _ => content.is_empty(),
    };
    if !valid {
        return Err(format!("日志节点 {kind} 的内容结构无效"));
    }
    if kind != "text" && value.get("text").is_some() {
        return Err("非文本节点不能含 text 字段".into());
    }
    if let Some(attrs) = value.get("attrs") {
        let attrs = attrs.as_object().ok_or("节点 attrs 须为对象")?;
        for (key, val) in attrs {
            let valid = valid_node_attribute(kind, key, val);
            if !valid {
                return Err(format!("节点 {kind} 属性 {key} 无效"));
            }
        }
    }
    if let Some(marks) = value.get("marks") {
        if kind != "text" && kind != "hardBreak" {
            return Err("只有行内节点允许文本格式".into());
        }
        for mark in marks.as_array().ok_or("marks 须为数组")? {
            validate_mark(mark)?;
        }
    }
    for child in content {
        validate_node(child, depth + 1, count)?;
    }
    Ok(())
}
fn validate_mark(value: &Value) -> LogResult<()> {
    let obj = value.as_object().ok_or("文本格式须为对象")?;
    if obj
        .keys()
        .any(|key| !matches!(key.as_str(), "type" | "attrs"))
    {
        return Err("文本格式字段无效".into());
    }
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or("文本格式缺少类型")?;
    if !matches!(
        kind,
        "bold"
            | "italic"
            | "strike"
            | "code"
            | "underline"
            | "superscript"
            | "subscript"
            | "textStyle"
            | "highlight"
            | "link"
    ) {
        return Err("不支持的文本格式".into());
    }
    if kind == "link"
        && value
            .get("attrs")
            .and_then(|attrs| attrs.get("href"))
            .is_none()
    {
        return Err("链接须包含有效 href 属性".into());
    }
    if let Some(attrs) = value.get("attrs") {
        for (key, val) in attrs.as_object().ok_or("文本格式 attrs 须为对象")? {
            let valid = valid_mark_attribute(kind, key, val);
            if !valid {
                return Err("文本格式属性无效".into());
            }
        }
    }
    Ok(())
}

fn valid_node_attribute(kind: &str, key: &str, val: &Value) -> bool {
    match (kind, key) {
        ("image" | "fileAttachment", "resourceId") => {
            val.as_str().is_some_and(|id| Uuid::parse_str(id).is_ok())
        }
        ("image" | "fileAttachment", "name" | "mime" | "alt" | "title") => {
            valid_optional_link_text(val, 2048)
        }
        ("image" | "fileAttachment", "size") => {
            val.is_null()
                || val
                    .as_u64()
                    .is_some_and(|size| size <= crate::log_resources::MAX_RESOURCE_BYTES as u64)
        }
        // Presentation only: resource bytes and their immutable dimensions stay unchanged.
        ("image", "displayWidth") => {
            val.is_null()
                || val
                    .as_u64()
                    .is_some_and(|width| (64..=4096).contains(&width))
        }
        ("paragraph" | "heading", "textAlign") => {
            val.is_null()
                || val
                    .as_str()
                    .is_some_and(|value| matches!(value, "left" | "center" | "right" | "justify"))
        }
        ("heading", "level") => val.as_i64().is_some_and(|level| (1..=6).contains(&level)),
        ("orderedList", "start") => val
            .as_i64()
            .is_some_and(|start| (1..=1_000_000).contains(&start)),
        ("orderedList", "type") => {
            val.is_null()
                || val
                    .as_str()
                    .is_some_and(|value| matches!(value, "1" | "a" | "A" | "i" | "I"))
        }
        ("taskItem", "checked") => val.is_boolean(),
        ("codeBlock", "language") => {
            val.is_null() || val.as_str().is_some_and(|value| value.len() < 100)
        }
        _ => false,
    }
}
fn valid_mark_attribute(kind: &str, key: &str, val: &Value) -> bool {
    match (kind, key) {
        ("textStyle" | "highlight", "color") => {
            val.is_null() || val.as_str().is_some_and(valid_color)
        }
        ("link", "href") => val.as_str().is_some_and(|href| {
            url::Url::parse(href).is_ok_and(|url| {
                matches!(url.scheme(), "http" | "https")
                    && url.host_str().is_some()
                    && url.username().is_empty()
                    && url.password().is_none()
            })
        }),
        ("link", "target") => {
            val.is_null()
                || val
                    .as_str()
                    .is_some_and(|value| matches!(value, "_blank" | "_self"))
        }
        ("link", "rel") => valid_optional_link_text(val, 99),
        ("link", "class") => valid_optional_link_text(val, 512),
        // Tiptap 3.31 includes title (default null) in every link mark.
        ("link", "title") => valid_optional_link_text(val, 2048),
        _ => false,
    }
}
fn valid_optional_link_text(value: &Value, max_bytes: usize) -> bool {
    value.is_null()
        || value.as_str().is_some_and(|text| {
            text.len() <= max_bytes
                && !text
                    .chars()
                    .any(|ch| ch.is_control() && !matches!(ch, '\t' | '\n' | '\r'))
        })
}
#[cfg(test)]
mod link_tests;
fn valid_color(value: &str) -> bool {
    (value.len() == 7 || value.len() == 4)
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        create_schema(&conn).unwrap();
        conn
    }
    fn rev(page: &LogPage) -> RevisionInput {
        RevisionInput {
            id: page.id.clone(),
            expected_revision: page.revision,
        }
    }
    fn prev(project: &LogProject) -> RevisionInput {
        RevisionInput {
            id: project.id.clone(),
            expected_revision: project.revision,
        }
    }
    fn save(page: &LogPage, json: &str) -> PageSaveInput {
        PageSaveInput {
            id: page.id.clone(),
            expected_revision: page.revision,
            title: page.title.clone(),
            document_json: json.into(),
            schema_version: 1,
        }
    }
    #[test]
    fn json_validation_blocks_unknown_schema_and_gutter() {
        assert!(validate_document(EMPTY_DOCUMENT, 1).is_ok());
        assert!(validate_document(EMPTY_DOCUMENT, 2).is_err());
        assert!(validate_document(
            r#"{"type":"doc","lineNumbers":[1],"content":[{"type":"paragraph"}]}"#,
            1
        )
        .is_err());
        assert!(validate_document(r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"https://evil.test"}}]}]}"#,1).is_err());
        assert!(validate_document(
            r#"{"type":"doc","content":[{"type":"bulletList","content":[{"type":"paragraph"}]}]}"#,
            1
        )
        .is_err());
    }
    #[test]
    fn image_display_width_is_bounded_optional_presentation() {
        let resource_id = Uuid::new_v4().to_string();
        let document = |kind: &str, width: Option<Value>| {
            let mut attrs = serde_json::json!({ "resourceId": resource_id });
            if let Some(width) = width {
                attrs["displayWidth"] = width;
            }
            serde_json::json!({
                "type": "doc",
                "content": [{ "type": kind, "attrs": attrs }]
            })
        };
        let old = document("image", None);
        assert_eq!(
            serde_json::from_str::<Value>(&validate_document(&old.to_string(), 1).unwrap())
                .unwrap(),
            old
        );
        for width in [Value::Null, serde_json::json!(64), serde_json::json!(4096)] {
            let raw = document("image", Some(width.clone()));
            assert!(valid_node_attribute("image", "displayWidth", &width));
            assert_eq!(
                serde_json::from_str::<Value>(&validate_document(&raw.to_string(), 1).unwrap())
                    .unwrap(),
                raw
            );
        }
        for width in [
            serde_json::json!(-1),
            serde_json::json!(0),
            serde_json::json!(63),
            serde_json::json!(4097),
            serde_json::json!(123.5),
            serde_json::json!("240"),
            serde_json::json!(true),
        ] {
            assert!(!valid_node_attribute("image", "displayWidth", &width));
            let normalized =
                validate_document(&document("image", Some(width)).to_string(), 1).unwrap();
            let normalized: Value = serde_json::from_str(&normalized).unwrap();
            assert!(normalized["content"][0]["attrs"]
                .get("displayWidth")
                .is_none());
            assert_eq!(normalized["content"][0]["attrs"]["resourceId"], resource_id);
        }
        let width = serde_json::json!(240);
        assert!(!valid_node_attribute(
            "fileAttachment",
            "displayWidth",
            &width
        ));
        let normalized =
            validate_document(&document("fileAttachment", Some(width)).to_string(), 1).unwrap();
        assert!(!normalized.contains("displayWidth"));
    }
    #[test]
    fn revision_concurrency_and_history_preserve_documents() {
        let mut conn = db();
        let project = create_project(&mut conn, "Demo").unwrap();
        let page = create_page(&mut conn, &project.id, "Day 1").unwrap();
        let json = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"persisted"}]}]}"#;
        let saved = save_page(&mut conn, save(&page, json)).unwrap();
        assert_eq!(saved.revision, 2);
        assert!(save_page(&mut conn, save(&page, EMPTY_DOCUMENT))
            .unwrap_err()
            .contains("revision-conflict"));
        assert_eq!(
            serde_json::from_str::<Value>(&get_page(&conn, &page.id).unwrap().document_json)
                .unwrap(),
            serde_json::from_str::<Value>(json).unwrap()
        );
        let restored = restore_history(
            &mut conn,
            HistoryRestoreInput {
                id: page.id.clone(),
                expected_revision: saved.revision,
                history_revision: 1,
            },
        )
        .unwrap();
        assert_eq!(restored.revision, 3);
        assert_eq!(
            serde_json::from_str::<Value>(&restored.document_json).unwrap(),
            serde_json::from_str::<Value>(EMPTY_DOCUMENT).unwrap()
        );
        assert_eq!(history(&conn, &page.id).unwrap().len(), 3);
    }
    #[test]
    fn project_recovery_preserves_previously_deleted_page() {
        let mut conn = db();
        let project = create_project(&mut conn, "P").unwrap();
        let first = create_page(&mut conn, &project.id, "First").unwrap();
        let second = create_page(&mut conn, &project.id, "Second").unwrap();
        delete_page(&mut conn, rev(&first)).unwrap();
        let deleted = delete_project(&mut conn, prev(&project)).unwrap();
        assert!(save_page(&mut conn, save(&second, EMPTY_DOCUMENT))
            .unwrap_err()
            .contains("deleted"));
        let restored = restore_project(&mut conn, prev(&deleted)).unwrap();
        assert!(restored.deleted_at.is_none());
        assert!(get_page(&conn, &first.id).unwrap().deleted_at.is_some());
        assert!(get_page(&conn, &second.id).unwrap().deleted_at.is_none());
        let first_deleted = get_page(&conn, &first.id).unwrap();
        assert!(restore_page(&mut conn, rev(&first_deleted))
            .unwrap()
            .deleted_at
            .is_none());
    }
    #[test]
    fn reorder_is_complete_revision_checked_and_atomic() {
        let mut conn = db();
        let project = create_project(&mut conn, "P").unwrap();
        let a = create_page(&mut conn, &project.id, "A").unwrap();
        let b = create_page(&mut conn, &project.id, "B").unwrap();
        assert!(reorder_pages(&mut conn, &project.id, vec![rev(&a)]).is_err());
        assert_eq!(get_page(&conn, &a.id).unwrap().revision, 1);
        let result = reorder_pages(&mut conn, &project.id, vec![rev(&b), rev(&a)]).unwrap();
        assert_eq!(result[0].id, b.id);
        assert_eq!(result[0].position, 0);
        assert!(reorder_pages(&mut conn, &project.id, vec![rev(&a), rev(&b)]).is_err());
        assert_eq!(get_page(&conn, &b.id).unwrap().position, 0);
    }
    #[test]
    fn restore_requires_active_parent_and_stale_delete_is_rejected() {
        let mut conn = db();
        let project = create_project(&mut conn, "P").unwrap();
        let page = create_page(&mut conn, &project.id, "A").unwrap();
        let deleted = delete_page(&mut conn, rev(&page)).unwrap();
        assert!(delete_page(&mut conn, rev(&page)).is_err());
        let deleted_project = delete_project(&mut conn, prev(&project)).unwrap();
        assert!(restore_page(&mut conn, rev(&deleted)).is_err());
        restore_project(&mut conn, prev(&deleted_project)).unwrap();
        assert!(restore_page(&mut conn, rev(&deleted)).is_ok());
    }
}
