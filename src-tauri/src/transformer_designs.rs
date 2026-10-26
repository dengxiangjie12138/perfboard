//! Design records store the submitted snapshot; no live core-library lookup or calculation occurs here.
//! IPC callers hold the repository mutex and enforce their window's edit lease.
mod import;
mod legacy;
#[cfg(test)]
mod tests;
mod validation;
pub use import::{
    confirm_import, preview_import, ImportCandidate, ImportConfirmInput, ImportPreview,
    ImportPreviews,
};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub use validation::validate_document;

pub type DesignResult<T> = Result<T, String>;
pub const DOCUMENT_SCHEMA_VERSION: u32 = 1;
pub const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
pub const SCHEMA_SQL: &str = "CREATE TABLE IF NOT EXISTS transformer_designs (
 id TEXT PRIMARY KEY NOT NULL,design_no TEXT NOT NULL,title TEXT NOT NULL,rev_label TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','reviewed','released')),example_flag INTEGER NOT NULL CHECK(example_flag IN (0,1)),
 document_json TEXT NOT NULL,schema_version INTEGER NOT NULL CHECK(schema_version=1),
 revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS transformer_designs_updated ON transformer_designs(updated_at DESC,id);
 CREATE INDEX IF NOT EXISTS transformer_designs_number ON transformer_designs(design_no,rev_label);
 CREATE TABLE IF NOT EXISTS transformer_design_history (
 design_id TEXT NOT NULL REFERENCES transformer_designs(id) ON DELETE CASCADE,revision INTEGER NOT NULL CHECK(revision>0),
 document_json TEXT NOT NULL,saved_at TEXT NOT NULL,PRIMARY KEY(design_id,revision));";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransformerDesignDocument {
    pub schema_version: u32,
    pub design_no: String,
    pub title: String,
    pub rev_label: String,
    pub status: String,
    pub example_flag: bool,
    pub core_snapshot: Option<Value>,
    pub bobbin_snapshot: Option<BobbinSnapshot>,
    pub logical_windings: Vec<LogicalWinding>,
    pub winding_steps: Vec<WindingStep>,
    pub materials: Vec<Material>,
    pub assembly_notes: Option<String>,
    pub tests: Vec<DesignTest>,
    pub dimensions: Vec<Dimension>,
    pub images: Vec<DesignImage>,
    pub notes: Option<String>,
    pub source: Option<ImportSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub production_sheet: Option<ProductionSheet>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductionSheet {
    pub schema_version: u32,
    pub core: String,
    pub material: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bobbin_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transformer_description: Option<String>,
    pub show_diagram: bool,
    pub windings: Vec<SheetWinding>,
    pub electrical: Vec<SheetElectrical>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SheetWinding {
    pub id: String,
    pub label: String,
    pub start: String,
    pub end: String,
    pub diameter: String,
    pub strands: String,
    pub turns: String,
    pub tape: String,
    pub tube_start: bool,
    pub tube_end: bool,
    pub group: String,
    pub diagram_order: String,
    pub wire_type: String,
    pub direction: String,
    pub note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SheetElectrical {
    pub id: String,
    pub start: String,
    pub end: String,
    pub inductance: String,
    pub unit: String,
    pub frequency: String,
    pub note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BobbinSnapshot {
    pub part_number: Option<String>,
    pub orientation: Option<String>,
    pub pin_count: Option<u32>,
    pub view: Option<String>,
    pub pin1_location: Option<String>,
    pub pin_diagram_notes: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogicalWinding {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    pub polarity_note: Option<String>,
    pub terminal_notes: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindingStep {
    pub id: String,
    pub order: u32,
    pub kind: String,
    pub logical_winding_id: Option<String>,
    pub from_pin: Option<String>,
    pub to_pin: Option<String>,
    pub turns: Option<f64>,
    pub wire_spec: Option<String>,
    pub parallel_count: Option<u32>,
    pub direction: Option<String>,
    pub layer_notes: Option<String>,
    pub material: Option<String>,
    pub thickness: Option<f64>,
    pub unit: Option<String>,
    pub notes: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material {
    pub id: String,
    pub name: String,
    pub specification: Option<String>,
    pub quantity: Option<f64>,
    pub unit: Option<String>,
    pub notes: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesignTest {
    pub id: String,
    pub kind: String,
    pub target: Option<f64>,
    pub unit: Option<String>,
    pub tolerance: Option<String>,
    pub conditions: Option<String>,
    pub notes: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dimension {
    pub id: String,
    pub name: String,
    pub value: Option<f64>,
    pub unit: Option<String>,
    pub tolerance: Option<String>,
    pub notes: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesignImage {
    pub id: String,
    pub title: String,
    /// Existing warehouse attachment identifier only. A submitted source path is never opened.
    pub attachment_id: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportSource {
    pub kind: String,
    pub file_name: String,
    pub sheet_name: Option<String>,
    pub row_start: Option<u32>,
    pub row_end: Option<u32>,
    pub raw_rows: Vec<Vec<String>>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransformerDesign {
    pub id: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub document: TransformerDesignDocument,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesignSaveInput {
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub document: TransformerDesignDocument,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesignRevisionInput {
    pub id: String,
    pub expected_revision: i64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformerDesignSummary {
    pub id: String,
    pub revision: i64,
    pub design_no: String,
    pub title: String,
    pub rev_label: String,
    pub status: String,
    pub example_flag: bool,
    pub created_at: String,
    pub updated_at: String,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn create_schema(conn: &Connection) -> DesignResult<()> {
    conn.execute_batch(SCHEMA_SQL).map_err(err)
}
pub fn validate_schema(conn: &Connection) -> DesignResult<()> {
    conn.prepare("SELECT id,design_no,title,rev_label,status,example_flag,document_json,schema_version,revision,created_at,updated_at FROM transformer_designs LIMIT 0").map_err(err)?;
    conn.prepare(
        "SELECT design_id,revision,document_json,saved_at FROM transformer_design_history LIMIT 0",
    )
    .map_err(err)?;
    Ok(())
}
fn record_row(row: &Row<'_>) -> rusqlite::Result<(String, i64, String, String, String)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
}
pub fn get(conn: &Connection, id: &str) -> DesignResult<TransformerDesign> {
    validation::identifier(id, "设计标识")?;
    let (id, revision, created_at, updated_at, json) = conn.query_row("SELECT id,revision,created_at,updated_at,document_json FROM transformer_designs WHERE id=?1", [id], record_row).optional().map_err(err)?.ok_or("设计记录不存在")?;
    if json.len() > MAX_DOCUMENT_BYTES {
        return Err("设计记录超过安全大小限制".into());
    }
    let document: TransformerDesignDocument =
        serde_json::from_str(&json).map_err(|e| format!("设计记录格式错误: {e}"))?;
    validate_document(&document)?;
    Ok(TransformerDesign {
        id,
        revision,
        created_at,
        updated_at,
        document,
    })
}
pub fn list(conn: &Connection) -> DesignResult<Vec<TransformerDesignSummary>> {
    let mut stmt = conn.prepare("SELECT id,revision,design_no,title,rev_label,status,example_flag,created_at,updated_at FROM transformer_designs ORDER BY updated_at DESC,id LIMIT 10000").map_err(err)?;
    let records = stmt
        .query_map([], |row| {
            Ok(TransformerDesignSummary {
                id: row.get(0)?,
                revision: row.get(1)?,
                design_no: row.get(2)?,
                title: row.get(3)?,
                rev_label: row.get(4)?,
                status: row.get(5)?,
                example_flag: row.get::<_, i64>(6)? != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(records)
}
pub fn save(conn: &mut Connection, input: DesignSaveInput) -> DesignResult<TransformerDesign> {
    validate_document(&input.document)?;
    let json = serde_json::to_string(&input.document).map_err(err)?;
    if json.len() > MAX_DOCUMENT_BYTES {
        return Err("设计记录超过安全大小限制".into());
    }
    let timestamp = now();
    // BEGIN IMMEDIATE and conditional UPDATE protect the CAS even across a second connection.
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let (id, revision, created_at) = if let Some(id) = input.id {
        validation::identifier(&id, "设计标识")?;
        let expected = input
            .expected_revision
            .ok_or("缺少预期设计版本，草稿未保存")?;
        if expected < 1 || expected == i64::MAX {
            return Err("无效设计版本".into());
        }
        let existing: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,created_at FROM transformer_designs WHERE id=?1",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        let (actual, created) = existing.ok_or("设计记录不存在，草稿仍保留")?;
        if actual != expected {
            return Err(
                "[revision-conflict] 设计已被另一窗口更新；当前草稿仍保留，请刷新后重试".into(),
            );
        }
        let changed = tx.execute("UPDATE transformer_designs SET design_no=?2,title=?3,rev_label=?4,status=?5,example_flag=?6,document_json=?7,schema_version=1,revision=revision+1,updated_at=?8 WHERE id=?1 AND revision=?9", params![id,input.document.design_no,input.document.title,input.document.rev_label,input.document.status,input.document.example_flag as i64,json,timestamp,expected]).map_err(err)?;
        if changed != 1 {
            return Err("[revision-conflict] 设计已更新，草稿仍保留".into());
        }
        (id, expected + 1, created)
    } else {
        if input.expected_revision.is_some() {
            return Err("新设计不能指定预期版本".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute("INSERT INTO transformer_designs(id,design_no,title,rev_label,status,example_flag,document_json,schema_version,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,1,1,?8,?8)",params![id,input.document.design_no,input.document.title,input.document.rev_label,input.document.status,input.document.example_flag as i64,json,timestamp]).map_err(err)?;
        (id, 1, timestamp.clone())
    };
    tx.execute("INSERT INTO transformer_design_history(design_id,revision,document_json,saved_at) VALUES(?1,?2,?3,?4)", params![id,revision,json,timestamp]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(TransformerDesign {
        id,
        revision,
        created_at,
        updated_at: timestamp,
        document: input.document,
    })
}
pub fn delete(conn: &mut Connection, input: DesignRevisionInput) -> DesignResult<()> {
    validation::identifier(&input.id, "设计标识")?;
    if input.expected_revision < 1 {
        return Err("无效设计版本".into());
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let changed = tx
        .execute(
            "DELETE FROM transformer_designs WHERE id=?1 AND revision=?2",
            params![input.id, input.expected_revision],
        )
        .map_err(err)?;
    if changed != 1 {
        return Err("[revision-conflict] 设计不存在或已被更新，请刷新后重试".into());
    }
    tx.commit().map_err(err)
}
/// The caller may export a read-only JSON document without changing the stored revision.
pub fn export_json(conn: &Connection, id: &str) -> DesignResult<String> {
    serde_json::to_string_pretty(&get(conn, id)?.document).map_err(err)
}
