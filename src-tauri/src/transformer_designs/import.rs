use super::*;
use calamine::{Reader, Xlsx};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{Cursor, Read},
    path::Path,
    time::{Duration, Instant},
};

const MAX_FILE_BYTES: u64 = 12 * 1024 * 1024;
const MAX_ZIP_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES: u64 = 12 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 1024;
const MAX_ROWS: usize = 5000;
const MAX_COLUMNS: usize = 128;
const MAX_CELLS: u64 = 500000;
const MAX_CANDIDATES: usize = 64;
const MAX_PREVIEW_BYTES: usize = 16 * 1024 * 1024;
const PREVIEW_LIFETIME: Duration = Duration::from_secs(20 * 60);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub candidate_id: String,
    pub sheet_name: Option<String>,
    pub row_start: Option<u32>,
    pub row_end: Option<u32>,
    pub title: String,
    pub document: TransformerDesignDocument,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub token: String,
    pub file_name: String,
    pub candidates: Vec<ImportCandidate>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportConfirmInput {
    pub token: String,
    pub candidate_id: String,
    pub confirmed: bool,
}
struct HeldPreview {
    repository_root: String,
    created: Instant,
    candidates: Vec<ImportCandidate>,
}
/// Ephemeral previews: reading a source never writes to the warehouse or copies source files.
#[derive(Default)]
pub struct ImportPreviews {
    previews: HashMap<String, HeldPreview>,
}
impl ImportPreviews {
    pub fn clear(&mut self) {
        self.previews.clear();
    }
    fn remove_expired(&mut self) {
        self.previews
            .retain(|_, p| p.created.elapsed() < PREVIEW_LIFETIME);
    }
}
fn local_source(raw: &str) -> DesignResult<std::path::PathBuf> {
    let path = Path::new(raw);
    if !path.is_absolute()
        || raw.contains('\0')
        || raw.contains(['\r', '\n'])
        || raw.starts_with("\\\\")
        || raw.starts_with("//")
    {
        return Err("请选择本机绝对路径的 JSON 或 XLSX 文件".into());
    }
    #[cfg(windows)]
    if raw.get(2..).is_some_and(|suffix| suffix.contains(':')) {
        return Err("导入文件路径不能包含备用数据流".into());
    }
    let canonical = path.canonicalize().map_err(err)?;
    #[cfg(windows)]
    if canonical.to_string_lossy().starts_with("\\\\?\\UNC\\") {
        return Err("不支持网络导入路径".into());
    }
    if !canonical.is_file() {
        return Err("导入来源不是文件".into());
    }
    Ok(canonical)
}
fn read_source(raw: &str) -> DesignResult<(String, String, Vec<u8>)> {
    let path = local_source(raw)?;
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "json" | "xlsx") {
        return Err("仅支持 JSON 和 XLSX；旧 XLS 或启用宏的工作簿请另存为 XLSX".into());
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无效来源文件名称")?
        .to_owned();
    let mut file = File::open(&path).map_err(err)?;
    if file.metadata().map_err(err)?.len() > MAX_FILE_BYTES {
        return Err("导入文件超过 12 MiB 限制".into());
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("读取时导入文件超出大小限制".into());
    }
    Ok((file_name, extension, bytes))
}
pub fn preview_import(
    store: &mut ImportPreviews,
    repository_root: &str,
    source_path: &str,
) -> DesignResult<ImportPreview> {
    let (file_name, extension, bytes) = read_source(source_path)?;
    let (candidates, warnings) = parse_bytes(&file_name, &extension, &bytes)?;
    if serde_json::to_vec(&candidates).map_err(err)?.len() > MAX_PREVIEW_BYTES {
        return Err("整份导入预览超过 16 MiB 限制，请拆分来源文件".into());
    }
    if candidates.is_empty() {
        return Err("未识别到设计块；请检查源文件。未保存任何记录。".into());
    }
    store.remove_expired();
    if store.previews.len() >= 4 {
        return Err("同时存在的导入预览过多，请完成或关闭现有预览".into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    store.previews.insert(
        token.clone(),
        HeldPreview {
            repository_root: repository_root.to_owned(),
            created: Instant::now(),
            candidates: candidates.clone(),
        },
    );
    Ok(ImportPreview {
        token,
        file_name,
        candidates,
        warnings,
    })
}
pub fn confirm_import(
    conn: &mut Connection,
    store: &mut ImportPreviews,
    repository_root: &str,
    input: ImportConfirmInput,
) -> DesignResult<TransformerDesign> {
    if !input.confirmed {
        return Err("请明确确认一个设计块后再导入".into());
    }
    store.remove_expired();
    let preview = store
        .previews
        .get(&input.token)
        .ok_or("导入预览已过期或已使用，请重新选择文件")?;
    if preview.repository_root != repository_root {
        return Err("仓库已切换，请在当前仓库重新预览导入".into());
    }
    let candidate = preview
        .candidates
        .iter()
        .find(|c| c.candidate_id == input.candidate_id)
        .ok_or("请选择该预览中的一个设计块")?;
    // Only this one reviewed candidate is persisted; no payload from the confirmation call is trusted.
    let record = save(
        conn,
        DesignSaveInput {
            id: None,
            expected_revision: None,
            document: candidate.document.clone(),
        },
    )?;
    store.previews.remove(&input.token);
    Ok(record)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JsonEnvelope {
    format: String,
    schema_version: u32,
    designs: Vec<TransformerDesignDocument>,
}
pub(crate) fn parse_bytes(
    file_name: &str,
    extension: &str,
    bytes: &[u8],
) -> DesignResult<(Vec<ImportCandidate>, Vec<String>)> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("导入文件超过大小限制".into());
    }
    match extension {
        "json" => parse_json(file_name, bytes),
        "xlsx" => parse_xlsx(file_name, bytes),
        _ => Err("不支持的导入类型".into()),
    }
}
fn parse_json(file_name: &str, bytes: &[u8]) -> DesignResult<(Vec<ImportCandidate>, Vec<String>)> {
    let value: Value = serde_json::from_slice(bytes).map_err(|e| format!("JSON 格式错误: {e}"))?;
    let mut documents: Vec<TransformerDesignDocument> = if value.is_array() {
        serde_json::from_value(value).map_err(|e| format!("设计 JSON 字段错误: {e}"))?
    } else if value.get("designs").is_some() {
        let envelope: JsonEnvelope =
            serde_json::from_value(value).map_err(|e| format!("设计导出格式错误: {e}"))?;
        if envelope.format != "perfboard-transformer-designs" || envelope.schema_version != 1 {
            return Err("不支持的设计导出格式".into());
        }
        envelope.designs
    } else {
        vec![serde_json::from_value(value).map_err(|e| format!("设计 JSON 字段错误: {e}"))?]
    };
    if documents.is_empty() || documents.len() > MAX_CANDIDATES {
        return Err("JSON 必须包含 1–64 个可选择设计块".into());
    }
    let mut candidates = Vec::new();
    for (index, mut document) in documents.drain(..).enumerate() {
        validate_document(&document)?;
        let warnings = vec![
            "导入记录保留原始字段；需核对工程数据、单位和制造信息。审核状态不随导入自动确认。"
                .into(),
        ];
        document.status = "draft".into();
        if let Some(source) = document.source.as_mut() {
            source.warnings.push(format!(
                "通过 JSON {file_name} 再次预览导入；保留原始来源。"
            ));
        } else {
            document.source = Some(ImportSource {
                kind: "json".into(),
                file_name: file_name.into(),
                sheet_name: None,
                row_start: None,
                row_end: None,
                raw_rows: Vec::new(),
                warnings: warnings.clone(),
            });
        }
        validate_document(&document)?;
        candidates.push(ImportCandidate {
            candidate_id: format!("json-{}", index + 1),
            sheet_name: None,
            row_start: None,
            row_end: None,
            title: document.title.clone(),
            document,
            warnings,
        });
    }
    Ok((
        candidates,
        vec!["选择并确认一个设计块才会保存；本次预览尚未写入仓库。".into()],
    ))
}
/// No ZIP contents are extracted to disk. Size and worksheet coordinates are checked before calamine allocation.
fn preflight_xlsx(bytes: &[u8]) -> DesignResult<bool> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("无效 XLSX 容器: {e}"))?;
    if archive.len() == 0 || archive.len() > MAX_ZIP_ENTRIES {
        return Err("XLSX 压缩条目数量超出安全限制".into());
    }
    let mut total = 0u64;
    let mut actual_total = 0u64;
    let mut formulas = false;
    let mut has_workbook = false;
    let mut sheet_xml = Vec::new();
    let mut shared_xml = None;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(err)?;
        let name = entry.name().to_owned();
        if name.starts_with('/')
            || name.contains('\\')
            || name.split('/').any(|p| p == "..")
            || name.to_ascii_lowercase().ends_with("vbaproject.bin")
        {
            return Err("XLSX 包含非法路径或宏，不支持导入".into());
        }
        total = total.checked_add(entry.size()).ok_or("XLSX 解压大小溢出")?;
        if total > MAX_ZIP_BYTES
            || entry.size() > MAX_ZIP_ENTRY_BYTES
            || (entry.size() > 1024 * 1024
                && entry.size() > entry.compressed_size().max(1).saturating_mul(200))
        {
            return Err("XLSX 解压大小或压缩比例超出安全限制".into());
        }
        if name == "xl/workbook.xml" {
            has_workbook = true;
        }
        let expected_size = entry.size();
        let actual_size = if (name.starts_with("xl/worksheets/") && name.ends_with(".xml"))
            || name == "xl/sharedStrings.xml"
        {
            let mut xml = String::new();
            (&mut entry)
                .take(MAX_ZIP_ENTRY_BYTES + 1)
                .read_to_string(&mut xml)
                .map_err(|_| "XLSX 工作表 XML 不是有效 UTF-8")?;
            if xml.len() as u64 > MAX_ZIP_ENTRY_BYTES {
                return Err("XLSX 工作表解压超出限制".into());
            }
            let size = xml.len() as u64;
            if name == "xl/sharedStrings.xml" {
                shared_xml = Some(xml);
            } else {
                validate_sheet_xml(&xml)?;
                formulas |= xml.contains("<f>") || xml.contains("<f ");
                sheet_xml.push(xml);
            }
            size
        } else {
            // Verify actual decompression as well as ZIP metadata, including shared strings and binary entries.
            let mut reader = (&mut entry).take(MAX_ZIP_ENTRY_BYTES + 1);
            let mut buffer = [0u8; 65536];
            let mut count = 0u64;
            loop {
                let length = reader.read(&mut buffer).map_err(err)?;
                if length == 0 {
                    break;
                }
                count += length as u64;
            }
            count
        };
        actual_total = actual_total
            .checked_add(actual_size)
            .ok_or("XLSX 实际解压大小溢出")?;
        if actual_size != expected_size
            || actual_size > MAX_ZIP_ENTRY_BYTES
            || actual_total > MAX_ZIP_BYTES
        {
            return Err("XLSX 实际解压大小与元数据不符或超出安全限制".into());
        }
    }
    if !has_workbook {
        return Err("文件不是有效 XLSX 工作簿".into());
    }
    validate_decoded_cells(&sheet_xml, shared_xml.as_deref())?;
    Ok(formulas)
}
fn attribute<'a>(tag: &'a str, attribute: &str) -> Option<&'a str> {
    let bytes = tag.as_bytes();
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        while cursor < bytes.len() && (bytes[cursor].is_ascii_whitespace() || bytes[cursor] == b'/')
        {
            cursor += 1;
        }
        let start = cursor;
        while cursor < bytes.len()
            && !bytes[cursor].is_ascii_whitespace()
            && !matches!(bytes[cursor], b'=' | b'/')
        {
            cursor += 1;
        }
        if start == cursor {
            cursor += 1;
            continue;
        }
        let name = &tag[start..cursor];
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || !matches!(bytes[cursor], b'"' | b'\'') {
            continue;
        }
        let quote = bytes[cursor];
        cursor += 1;
        let value_start = cursor;
        while cursor < bytes.len() && bytes[cursor] != quote {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return None;
        }
        let value = &tag[value_start..cursor];
        cursor += 1;
        if name == attribute {
            return Some(value);
        }
    }
    None
}
/// XML start-tag scanning respects quotes so an unrelated attribute cannot hide a large cell reference.
fn xml_tags(xml: &str) -> DesignResult<Vec<&str>> {
    let bytes = xml.as_bytes();
    let mut cursor = 0usize;
    let mut tags = Vec::new();
    while cursor < bytes.len() {
        if bytes[cursor] != b'<' {
            cursor += 1;
            continue;
        }
        let start = cursor + 1;
        cursor = start;
        let mut quote = None;
        while cursor < bytes.len() {
            match (quote, bytes[cursor]) {
                (None, b'"' | b'\'') => quote = Some(bytes[cursor]),
                (Some(expected), actual) if expected == actual => quote = None,
                (None, b'>') => break,
                _ => (),
            }
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return Err("不完整的工作表 XML 标签".into());
        }
        tags.push(&xml[start..cursor]);
        cursor += 1;
    }
    Ok(tags)
}
struct XmlElement<'a> {
    tag: &'a str,
    content: &'a str,
}
fn elements<'a>(xml: &'a str, name: &str) -> DesignResult<Vec<XmlElement<'a>>> {
    let mut result = Vec::new();
    let mut open: Option<(&str, usize)> = None;
    for tag in xml_tags(xml)? {
        let raw_name = tag
            .split_ascii_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches('/');
        let closing = raw_name.starts_with('/');
        let local_name = raw_name
            .trim_start_matches('/')
            .rsplit(':')
            .next()
            .unwrap_or(raw_name);
        if local_name != name {
            continue;
        }
        let tag_position = tag.as_ptr() as usize - xml.as_ptr() as usize;
        if closing {
            let (start_tag, start) = open.take().ok_or("不完整的 XLSX XML 元素")?;
            result.push(XmlElement {
                tag: start_tag,
                content: &xml[start..tag_position - 1],
            });
        } else if tag.trim_end().ends_with('/') {
            result.push(XmlElement { tag, content: "" });
        } else {
            if open.is_some() {
                return Err("无效的嵌套 XLSX XML 元素".into());
            }
            open = Some((tag, tag_position + tag.len() + 1));
        }
        if result.len() > MAX_CELLS as usize {
            return Err("XLSX 元素数量超出安全限制".into());
        }
    }
    if open.is_some() {
        return Err("不完整的 XLSX XML 元素".into());
    }
    Ok(result)
}
/// A small shared string referenced many times can expand far beyond the ZIP's uncompressed size.
fn validate_decoded_cells(sheets: &[String], shared: Option<&str>) -> DesignResult<()> {
    let mut sizes = Vec::new();
    if let Some(xml) = shared {
        if xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
            return Err("不支持含 DTD 或实体声明的共享字符串".into());
        }
        sizes = elements(xml, "si")?
            .iter()
            .map(|element| element.content.len())
            .collect();
    }
    let mut total = 0usize;
    for xml in sheets {
        for cell in elements(xml, "c")? {
            let size = if attribute(cell.tag, "t") == Some("s") {
                let values = elements(cell.content, "v")?;
                let raw = values.first().ok_or("共享字符串索引缺失")?.content.trim();
                let index: usize = raw.parse().map_err(|_| "无效的共享字符串索引")?;
                *sizes.get(index).ok_or("共享字符串索引越界")?
            } else {
                cell.content.len()
            };
            total = total
                .checked_add(size.saturating_add(64))
                .ok_or("XLSX 单元格展开大小溢出")?;
            if total > MAX_PREVIEW_BYTES {
                return Err("XLSX 重复字符串和单元格展开超过 16 MiB 安全限制".into());
            }
        }
    }
    Ok(())
}
fn coordinate(raw: &str) -> DesignResult<(u64, u64)> {
    if raw.contains('&') {
        return Err("XLSX 坐标不支持实体编码".into());
    }
    let raw = raw.trim_matches('$');
    let mut column = 0u64;
    let mut split = 0usize;
    for (index, byte) in raw.bytes().enumerate() {
        if byte.is_ascii_alphabetic() {
            column = column
                .checked_mul(26)
                .and_then(|n| n.checked_add((byte.to_ascii_uppercase() - b'A' + 1) as u64))
                .ok_or("XLSX 列索引超出限制")?;
            split = index + 1;
        } else {
            break;
        }
    }
    let row: u64 = raw
        .get(split..)
        .ok_or("无效 XLSX 坐标")?
        .trim_start_matches('$')
        .parse()
        .map_err(|_| "无效 XLSX 坐标")?;
    if row == 0 || column == 0 || row > MAX_ROWS as u64 || column > MAX_COLUMNS as u64 {
        return Err("XLSX 工作表坐标超出 5000 行 / 128 列安全限制".into());
    }
    Ok((row, column))
}
pub(crate) fn validate_sheet_xml(xml: &str) -> DesignResult<()> {
    if xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
        return Err("不支持含 DTD 或实体声明的工作表".into());
    }
    let mut cells = 0u64;
    for tag in xml_tags(xml)? {
        let tag_name = tag
            .split_ascii_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches('/');
        let tag_name = tag_name.rsplit(':').next().unwrap_or(tag_name);
        match tag_name {
            "dimension" | "mergeCell" => {
                if let Some(reference) = attribute(tag, "ref") {
                    for endpoint in reference.split(':') {
                        let (row, column) = coordinate(endpoint)?;
                        if row.saturating_mul(column) > MAX_CELLS {
                            return Err("XLSX 工作表范围超出安全限制".into());
                        }
                    }
                }
            }
            "row" => {
                if let Some(row) = attribute(tag, "r") {
                    let row: u64 = row.parse().map_err(|_| "无效 XLSX 行索引")?;
                    if row == 0 || row > MAX_ROWS as u64 {
                        return Err("XLSX 行数超出安全限制".into());
                    }
                }
            }
            "c" => {
                cells += 1;
                if cells > MAX_CELLS {
                    return Err("XLSX 单元格数量超出安全限制".into());
                }
                if let Some(reference) = attribute(tag, "r") {
                    coordinate(reference)?;
                }
            }
            _ => (),
        }
    }
    Ok(())
}
fn parse_xlsx(file_name: &str, bytes: &[u8]) -> DesignResult<(Vec<ImportCandidate>, Vec<String>)> {
    let formulas = preflight_xlsx(bytes)?;
    let mut workbook: Xlsx<_> = calamine::open_workbook_from_rs(Cursor::new(bytes.to_vec()))
        .map_err(|e| format!("无法解析 XLSX: {e}"))?;
    let names = workbook.sheet_names().to_vec();
    if names.len() > 64 {
        return Err("XLSX 工作表数量超出 64 限制".into());
    }
    let mut candidates = Vec::new();
    let mut ignored = 0usize;
    for sheet_name in names {
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|e| format!("工作表 {sheet_name} 无法解析: {e}"))?;
        if range.height() > MAX_ROWS
            || range.width() > MAX_COLUMNS
            || (range.height() as u64).saturating_mul(range.width() as u64) > MAX_CELLS
        {
            return Err("工作表范围超出安全限制".into());
        }
        let base_row = range.start().map(|(r, _)| r as usize).unwrap_or(0);
        let rows: Vec<Vec<String>> = range
            .rows()
            .map(|row| row.iter().map(|cell| cell.to_string()).collect())
            .collect();
        if rows
            .iter()
            .flatten()
            .any(|cell| cell.chars().count() > 4000)
        {
            return Err("XLSX 单元格文字超出 4000 字符限制".into());
        }
        let digest = format!("{:x}", Sha256::digest(bytes));
        let blocks = super::legacy::candidates_from_sheet(
            file_name,
            &sheet_name,
            &rows,
            base_row,
            &digest,
            formulas,
        )?;
        if blocks.is_empty() {
            ignored += 1;
        }
        candidates.extend(blocks);
        if candidates.len() > MAX_CANDIDATES {
            return Err("工作簿设计块数量超出 64 限制".into());
        }
    }
    let warnings = vec![format!("只读预览：识别 {} 个重复设计块；忽略 {ignored} 个无设计标题的工作表（包括磁芯参数页）。请选择一个块后明确确认，尚未写入仓库。",candidates.len())];
    Ok((candidates, warnings))
}

#[cfg(test)]
mod preview_tests {
    use super::*;
    fn document(title: &str) -> TransformerDesignDocument {
        serde_json::from_value(serde_json::json!({"schemaVersion":1,"designNo":title,"title":title,"revLabel":"","status":"draft","exampleFlag":false,"coreSnapshot":null,"bobbinSnapshot":null,"logicalWindings":[],"windingSteps":[],"materials":[],"assemblyNotes":null,"tests":[],"dimensions":[],"images":[],"notes":null,"source":null})).unwrap()
    }
    fn store() -> ImportPreviews {
        let candidates = ["first", "second"]
            .iter()
            .map(|name| ImportCandidate {
                candidate_id: (*name).into(),
                sheet_name: None,
                row_start: None,
                row_end: None,
                title: (*name).into(),
                document: document(name),
                warnings: vec![],
            })
            .collect();
        let mut store = ImportPreviews::default();
        store.previews.insert(
            "token".into(),
            HeldPreview {
                repository_root: "warehouse-a".into(),
                created: Instant::now(),
                candidates,
            },
        );
        store
    }
    fn input(candidate: &str, confirmed: bool) -> ImportConfirmInput {
        ImportConfirmInput {
            token: "token".into(),
            candidate_id: candidate.into(),
            confirmed,
        }
    }
    #[test]
    fn confirm_requires_one_candidate_and_preserves_preview_on_failed_save() {
        let mut store = store();
        let mut conn = Connection::open_in_memory().unwrap();
        assert!(
            confirm_import(&mut conn, &mut store, "warehouse-a", input("first", false)).is_err()
        );
        assert!(
            confirm_import(&mut conn, &mut store, "warehouse-b", input("first", true)).is_err()
        );
        assert!(confirm_import(&mut conn, &mut store, "warehouse-a", input("all", true)).is_err());
        assert!(
            confirm_import(&mut conn, &mut store, "warehouse-a", input("second", true)).is_err()
        );
        assert_eq!(store.previews.len(), 1);
        create_schema(&conn).unwrap();
        let imported =
            confirm_import(&mut conn, &mut store, "warehouse-a", input("second", true)).unwrap();
        assert_eq!(imported.document.title, "second");
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert!(store.previews.is_empty());
        assert!(
            confirm_import(&mut conn, &mut store, "warehouse-a", input("first", true)).is_err()
        );
        assert_eq!(list(&conn).unwrap().len(), 1);
    }
    #[test]
    fn expired_preview_is_not_persisted() {
        let mut store = store();
        store.previews.get_mut("token").unwrap().created = Instant::now() - PREVIEW_LIFETIME;
        let mut conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        assert!(
            confirm_import(&mut conn, &mut store, "warehouse-a", input("first", true)).is_err()
        );
        assert!(list(&conn).unwrap().is_empty());
    }
    #[test]
    fn whitespace_attributes_and_namespaced_cells_cannot_bypass_coordinate_limits() {
        assert!(
            validate_sheet_xml("<worksheet><c other=\"a>b\" r = 'A1048576'/></worksheet>").is_err()
        );
        assert!(validate_sheet_xml(
            "<worksheet><s:dimension ref = \"A1:XFD1048576\"/></worksheet>"
        )
        .is_err());
        assert!(validate_sheet_xml("<worksheet><c r=\"A&#49;048576\"/></worksheet>").is_err());
    }
}

#[cfg(test)]
mod decoded_size_tests {
    use super::*;
    #[test]
    fn repeated_shared_strings_are_bounded_before_workbook_allocation() {
        let shared = format!("<sst><si><t>{}</t></si></sst>", "A".repeat(4000));
        let sheet = format!(
            "<worksheet><sheetData><row>{}</row></sheetData></worksheet>",
            "<c t=\"s\"><v>0</v></c>".repeat(5000)
        );
        assert!(validate_decoded_cells(&[sheet], Some(&shared)).is_err());
        let safe =
            "<worksheet><sheetData><row><c t=\"s\"><v>0</v></c></row></sheetData></worksheet>"
                .to_owned();
        assert!(validate_decoded_cells(&[safe], Some(&shared)).is_ok());
    }
}
