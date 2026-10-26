use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub id: String,
    pub name: String,
    pub category: String,
    pub package_name: String,
    pub parameters: String,
    #[serde(default)]
    pub lcsc_number: String,
    #[serde(default)]
    pub brand: String,
    pub stock_status: String,
    pub quantity: Option<f64>,
    pub location: String,
    pub brief: String,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartInput {
    pub id: String,
    pub name: String,
    pub category: String,
    pub package_name: String,
    pub parameters: String,
    #[serde(default)]
    pub lcsc_number: String,
    #[serde(default)]
    pub brand: String,
    pub stock_status: String,
    pub quantity: Option<f64>,
    pub location: String,
    pub brief: String,
    pub url: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub category: String,
    pub search_text: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub revision: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub category: String,
    pub search_text: String,
    pub scene_json: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub revision: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub id: String,
    pub title: String,
    pub category: String,
    pub search_text: String,
    pub scene_json: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub part_id: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub relative_path: String,
    pub kind: String,
    pub url: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub parts: Vec<Part>,
    pub notes: Vec<NoteSummary>,
    pub attachments: Vec<Attachment>,
    pub settings: BTreeMap<String, String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub configured: bool,
    pub ready: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct RepositoryPointer {
    pub version: u32,
    pub path: String,
}
