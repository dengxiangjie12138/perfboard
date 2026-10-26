//! Project-local folders. Membership is separate from page documents/history.
use super::{
    active, check_revision, err, get_page, get_project, now, title, LogResult, RenameInput,
    RevisionInput,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFolder {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub position: i64,
    pub revision: i64,
    pub page_ids: Vec<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TreeKind {
    Page,
    Folder,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TreeTarget {
    pub kind: TreeKind,
    pub id: String,
    pub expected_revision: i64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TreeMoveInput {
    pub kind: TreeKind,
    pub id: String,
    pub expected_revision: i64,
    pub project_id: String,
    pub folder_id: Option<String>,
    pub before: Option<TreeTarget>,
}
pub fn create_schema(conn: &Connection) -> LogResult<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS dev_log_folders (
      id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL REFERENCES dev_log_projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,position INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0));
      CREATE INDEX IF NOT EXISTS dev_log_folder_order ON dev_log_folders(project_id,position,id);
      CREATE TABLE IF NOT EXISTS dev_log_page_folders (
      page_id TEXT PRIMARY KEY NOT NULL REFERENCES dev_log_pages(id) ON DELETE CASCADE,
      folder_id TEXT NOT NULL REFERENCES dev_log_folders(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS dev_log_folder_pages ON dev_log_page_folders(folder_id,page_id);").map_err(err)
}
pub fn validate_schema(conn: &Connection) -> LogResult<()> {
    conn.prepare("SELECT id,project_id,title,position,revision FROM dev_log_folders LIMIT 0")
        .map_err(err)?;
    conn.prepare("SELECT page_id,folder_id FROM dev_log_page_folders LIMIT 0")
        .map_err(err)?;
    Ok(())
}
pub fn list(conn: &Connection) -> LogResult<Vec<LogFolder>> {
    let mut folders = conn.prepare("SELECT id,project_id,title,position,revision FROM dev_log_folders ORDER BY project_id,position,id").map_err(err)?
        .query_map([], |r| Ok(LogFolder { id:r.get(0)?,project_id:r.get(1)?,title:r.get(2)?,position:r.get(3)?,revision:r.get(4)?,page_ids:Vec::new() }))
        .map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
    let mut statement = conn
        .prepare("SELECT folder_id,page_id FROM dev_log_page_folders ORDER BY page_id")
        .map_err(err)?;
    let memberships = statement
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    for pair in memberships {
        let (folder_id, page_id) = pair.map_err(err)?;
        if let Some(folder) = folders.iter_mut().find(|f| f.id == folder_id) {
            folder.page_ids.push(page_id);
        }
    }
    Ok(folders)
}
fn get(conn: &Connection, id: &str) -> LogResult<LogFolder> {
    list(conn)?
        .into_iter()
        .find(|f| f.id == id)
        .ok_or_else(|| "文件夹不存在，请刷新后重试".into())
}
pub fn create(conn: &mut Connection, project_id: &str) -> LogResult<LogFolder> {
    let tx = conn.transaction().map_err(err)?;
    active(&get_project(&tx, project_id)?.deleted_at)?;
    let existing = list(&tx)?;
    let mut name = "新建文件夹".to_owned();
    let mut suffix = 2;
    while existing
        .iter()
        .any(|f| f.project_id == project_id && f.title == name)
    {
        name = format!("新建文件夹 {suffix}");
        suffix += 1;
    }
    let position: i64 = tx.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM (
      SELECT position FROM dev_log_folders WHERE project_id=?1 UNION ALL
      SELECT position FROM dev_log_pages WHERE project_id=?1 AND deleted_at IS NULL AND id NOT IN (SELECT page_id FROM dev_log_page_folders))", [project_id], |r|r.get(0)).map_err(err)?;
    let id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO dev_log_folders(id,project_id,title,position) VALUES(?1,?2,?3,?4)",
        params![id, project_id, name, position],
    )
    .map_err(err)?;
    let folder = get(&tx, &id)?;
    tx.commit().map_err(err)?;
    Ok(folder)
}
pub fn rename(conn: &mut Connection, input: RenameInput) -> LogResult<LogFolder> {
    let name = title(&input.title)?;
    let tx = conn.transaction().map_err(err)?;
    let folder = get(&tx, &input.id)?;
    active(&get_project(&tx, &folder.project_id)?.deleted_at)?;
    check_revision(folder.revision, input.expected_revision)?;
    tx.execute(
        "UPDATE dev_log_folders SET title=?2,revision=revision+1 WHERE id=?1",
        params![input.id, name],
    )
    .map_err(err)?;
    let folder = get(&tx, &input.id)?;
    tx.commit().map_err(err)?;
    Ok(folder)
}
pub fn page_folder(conn: &Connection, id: &str) -> LogResult<Option<String>> {
    conn.query_row(
        "SELECT folder_id FROM dev_log_page_folders WHERE page_id=?1",
        [id],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}
/// Remove the container while keeping pages, resources and history. Active
/// pages take the folder's place in the root order; trashed pages stay trashed.
pub fn delete(conn: &mut Connection, input: RevisionInput) -> LogResult<()> {
    let tx = conn.transaction().map_err(err)?;
    let folder = get(&tx, &input.id)?;
    active(&get_project(&tx, &folder.project_id)?.deleted_at)?;
    check_revision(folder.revision, input.expected_revision)?;
    let roots = siblings(&tx, &folder.project_id, None)?;
    let children = siblings(&tx, &folder.project_id, Some(&folder.id))?;
    let mut order = Vec::new();
    for item in roots {
        if item.kind == TreeKind::Folder && item.id == folder.id {
            order.extend(children.iter().map(|child| Item {
                kind: child.kind,
                id: child.id.clone(),
                position: child.position,
                revision: child.revision,
            }));
        } else {
            order.push(item);
        }
    }
    tx.execute(
        "DELETE FROM dev_log_page_folders WHERE folder_id=?1",
        [&folder.id],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM dev_log_folders WHERE id=?1", [&folder.id])
        .map_err(err)?;
    let stamp = now();
    for (position, item) in order.iter().enumerate() {
        let position = position as i64;
        let moved_out = children.iter().any(|child| child.id == item.id);
        if item.position == position && !moved_out {
            continue;
        }
        match item.kind {
            TreeKind::Folder => {
                tx.execute(
                    "UPDATE dev_log_folders SET position=?2,revision=revision+1 WHERE id=?1",
                    params![item.id, position],
                )
                .map_err(err)?;
            }
            TreeKind::Page => {
                tx.execute("UPDATE dev_log_pages SET position=?2,revision=revision+1,updated_at=?3 WHERE id=?1",
                    params![item.id, position, stamp]).map_err(err)?;
            }
        }
    }
    tx.commit().map_err(err)
}
struct Item {
    kind: TreeKind,
    id: String,
    position: i64,
    revision: i64,
}
fn siblings(conn: &Connection, project_id: &str, folder_id: Option<&str>) -> LogResult<Vec<Item>> {
    let all = super::snapshot(conn)?;
    let mut result = Vec::new();
    for page in all
        .pages
        .into_iter()
        .filter(|p| p.project_id == project_id && p.deleted_at.is_none())
    {
        if page_folder(conn, &page.id)?.as_deref() == folder_id {
            result.push(Item {
                kind: TreeKind::Page,
                id: page.id,
                position: page.position,
                revision: page.revision,
            });
        }
    }
    if folder_id.is_none() {
        for folder in all
            .folders
            .into_iter()
            .filter(|f| f.project_id == project_id)
        {
            result.push(Item {
                kind: TreeKind::Folder,
                id: folder.id,
                position: folder.position,
                revision: folder.revision,
            });
        }
    }
    result.sort_by(|a, b| a.position.cmp(&b.position).then(a.id.cmp(&b.id)));
    Ok(result)
}
/// One atomic membership + sibling-order change; no document/resource bytes are rewritten.
pub fn move_item(conn: &mut Connection, input: TreeMoveInput) -> LogResult<()> {
    let tx = conn.transaction().map_err(err)?;
    active(&get_project(&tx, &input.project_id)?.deleted_at)?;
    if let Some(id) = &input.folder_id {
        if get(&tx, id)?.project_id != input.project_id {
            return Err("文件夹不属于此项目".into());
        }
    }
    let (project_id, revision) = match input.kind {
        TreeKind::Page => {
            let page = get_page(&tx, &input.id)?;
            active(&page.deleted_at)?;
            (page.project_id, page.revision)
        }
        TreeKind::Folder => {
            if input.folder_id.is_some() {
                return Err("文件夹请在项目根层排序".into());
            }
            let folder = get(&tx, &input.id)?;
            (folder.project_id, folder.revision)
        }
    };
    if project_id != input.project_id {
        return Err("请在同一项目内移动页面或文件夹".into());
    }
    check_revision(revision, input.expected_revision)?;
    let mut values = siblings(&tx, &input.project_id, input.folder_id.as_deref())?;
    if let Some(target) = &input.before {
        if target.kind == input.kind && target.id == input.id {
            return Ok(());
        }
        let before = values
            .iter()
            .find(|v| v.kind == target.kind && v.id == target.id)
            .ok_or("目标位置已变化，请刷新后重试")?;
        check_revision(before.revision, target.expected_revision)?;
    }
    values.retain(|v| v.kind != input.kind || v.id != input.id);
    let index = input
        .before
        .as_ref()
        .and_then(|t| values.iter().position(|v| v.kind == t.kind && v.id == t.id))
        .unwrap_or(values.len());
    values.insert(
        index,
        Item {
            kind: input.kind,
            id: input.id.clone(),
            position: 0,
            revision,
        },
    );
    if input.kind == TreeKind::Page {
        tx.execute(
            "DELETE FROM dev_log_page_folders WHERE page_id=?1",
            [&input.id],
        )
        .map_err(err)?;
        if let Some(folder) = &input.folder_id {
            tx.execute(
                "INSERT INTO dev_log_page_folders(page_id,folder_id) VALUES(?1,?2)",
                params![input.id, folder],
            )
            .map_err(err)?;
        }
    }
    let stamp = now();
    for (position, item) in values.iter().enumerate() {
        match item.kind {
            TreeKind::Folder => {
                tx.execute(
                    "UPDATE dev_log_folders SET position=?2,revision=revision+1 WHERE id=?1",
                    params![item.id, position as i64],
                )
                .map_err(err)?;
            }
            TreeKind::Page => {
                tx.execute("UPDATE dev_log_pages SET position=?2,revision=revision+1,updated_at=?3 WHERE id=?1",params![item.id,position as i64,stamp]).map_err(err)?;
            }
        }
    }
    tx.commit().map_err(err)
}

#[cfg(test)]
mod tests;
