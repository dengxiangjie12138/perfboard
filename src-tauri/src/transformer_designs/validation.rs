use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::HashSet;

pub(crate) fn identifier(value: &str, label: &str) -> DesignResult<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
    {
        return Err(format!("{label}必须使用 1–128 个字母、数字或 -_:."));
    }
    Ok(())
}
fn text(value: &str, label: &str, maximum: usize, required: bool) -> DesignResult<()> {
    if (required && value.trim().is_empty())
        || value.chars().count() > maximum
        || value.contains('\0')
    {
        return Err(format!("{label}内容为空或超出 {maximum} 字符限制"));
    }
    Ok(())
}
fn optional_text(value: &Option<String>, label: &str, maximum: usize) -> DesignResult<()> {
    if let Some(value) = value {
        text(value, label, maximum, false)?;
    }
    Ok(())
}
fn nonnegative(value: Option<f64>, label: &str) -> DesignResult<()> {
    if value.is_some_and(|v| !v.is_finite() || v < 0.0 || v > 1e15) {
        return Err(format!("{label}必须为有限的非负数，未知值请留空"));
    }
    Ok(())
}
fn unique<'a>(items: impl Iterator<Item = &'a str>, label: &str) -> DesignResult<()> {
    let mut ids = HashSet::new();
    for id in items {
        identifier(id, label)?;
        if !ids.insert(id) {
            return Err(format!("{label}不能重复"));
        }
    }
    Ok(())
}
const MAX_INLINE_IMAGE_BYTES: usize = 1024 * 1024;
const MAX_INLINE_IMAGE_BASE64_BYTES: usize = ((MAX_INLINE_IMAGE_BYTES + 2) / 3) * 4;
fn checked_image_url(raw: &str) -> DesignResult<()> {
    let (encoded, png) = if let Some(payload) = raw.strip_prefix("data:image/png;base64,") {
        (payload, true)
    } else if let Some(payload) = raw.strip_prefix("data:image/jpeg;base64,") {
        (payload, false)
    } else {
        if raw.starts_with("data:") {
            return Err("附图仅支持 PNG/JPEG 的 base64 内嵌快照".into());
        }
        if raw.len() > 4000 {
            return Err("图片网址过长".into());
        }
        // Remote URLs are stored as metadata only; validation never opens or downloads them.
        return crate::repository::validate_url(raw).map(|_| ());
    };
    if encoded.is_empty() || encoded.len() > MAX_INLINE_IMAGE_BASE64_BYTES {
        return Err("单张附图解码后不能超过 1 MiB".into());
    }
    let decoded = STANDARD
        .decode(encoded)
        .map_err(|_| "附图 base64 编码无效，请重新选择 PNG/JPEG 图片")?;
    if decoded.len() > MAX_INLINE_IMAGE_BYTES {
        return Err("单张附图解码后不能超过 1 MiB".into());
    }
    let valid_signature = if png {
        decoded.len() >= 45
            && decoded.starts_with(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR")
            && decoded.ends_with(b"\0\0\0\0IEND\xaeB\x60\x82")
    } else {
        decoded.len() >= 12
            && decoded.starts_with(b"\xff\xd8\xff")
            && decoded.ends_with(b"\xff\xd9")
    };
    if !valid_signature {
        return Err("附图内容与声明的 PNG/JPEG 格式不符或文件不完整".into());
    }
    Ok(())
}
/// Bound nested JSON independently from serde's recursion limit. Core snapshots remain opaque facts.
fn bounded_json(value: &Value, depth: usize, nodes: &mut usize) -> DesignResult<()> {
    *nodes += 1;
    if depth > 24 || *nodes > 20000 {
        return Err("磁芯快照结构超出安全限制".into());
    }
    match value {
        Value::String(s) => text(s, "磁芯快照文字", 16000, false)?,
        Value::Array(items) => {
            if items.len() > 1000 {
                return Err("磁芯快照数组超出安全限制".into());
            }
            for item in items {
                bounded_json(item, depth + 1, nodes)?;
            }
        }
        Value::Object(items) => {
            if items.len() > 200 {
                return Err("磁芯快照字段超出安全限制".into());
            }
            for (key, item) in items {
                text(key, "磁芯快照字段", 128, true)?;
                bounded_json(item, depth + 1, nodes)?;
            }
        }
        _ => (),
    }
    Ok(())
}
fn core_snapshot(value: &Value) -> DesignResult<()> {
    let object = value.as_object().ok_or("磁芯快照必须为对象或空值")?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("不支持该磁芯快照版本".into());
    }
    for key in ["coreId", "model", "shape"] {
        text(
            object
                .get(key)
                .and_then(Value::as_str)
                .ok_or(format!("磁芯快照缺少 {key}"))?,
            key,
            200,
            true,
        )?;
    }
    if object.get("libraryRevision").is_none_or(Value::is_null) {
        return Err("磁芯快照缺少 libraryRevision".into());
    }
    let parameters = object
        .get("parameters")
        .and_then(Value::as_object)
        .ok_or("磁芯快照缺少 parameters 对象")?;
    for key in ["aeMm2", "awMm2", "alNhPerTurn2", "leMm", "veMm3", "apCm4"] {
        if let Some(value) = parameters.get(key).filter(|v| !v.is_null()) {
            let number = value
                .as_f64()
                .ok_or(format!("磁芯参数 {key}必须为数值或空值"))?;
            if !number.is_finite() || number <= 0.0 || number > 1e15 {
                return Err(format!("磁芯参数 {key}必须为有限正数"));
            }
        }
    }
    for key in ["sources", "images", "rawParameters", "conflictNotes"] {
        if !object.get(key).is_some_and(Value::is_array) {
            return Err(format!("磁芯快照缺少 {key} 数组"));
        }
    }
    bounded_json(value, 0, &mut 0)?;
    Ok(())
}
pub fn validate_document(document: &TransformerDesignDocument) -> DesignResult<()> {
    if document.schema_version != DOCUMENT_SCHEMA_VERSION {
        return Err("不支持的设计记录版本".into());
    }
    text(&document.design_no, "设计编号", 120, true)?;
    text(
        &document.title,
        "设计标题",
        200,
        document.production_sheet.is_none(),
    )?;
    if let Some(sheet) = &document.production_sheet {
        validate_sheet(sheet)?;
    }
    text(&document.rev_label, "工程 Rev", 80, false)?;
    if !matches!(document.status.as_str(), "draft" | "reviewed" | "released") {
        return Err("无效设计状态".into());
    }
    if document.example_flag && document.status != "draft" {
        return Err("记录演示必须保持草稿和未审核状态".into());
    }
    if let Some(snapshot) = &document.core_snapshot {
        core_snapshot(snapshot)?;
    }
    if let Some(bobbin) = &document.bobbin_snapshot {
        for (field, label) in [
            (&bobbin.part_number, "骨架型号"),
            (&bobbin.orientation, "骨架方向"),
            (&bobbin.view, "引脚视角"),
            (&bobbin.pin1_location, "1脚位置"),
            (&bobbin.pin_diagram_notes, "引脚图说明"),
        ] {
            optional_text(field, label, 4000)?;
        }
        if bobbin.pin_count.is_some_and(|v| v == 0 || v > 1024) {
            return Err("骨架引脚数必须为 1–1024，未知请留空".into());
        }
    }
    if document.logical_windings.len() > 128
        || document.winding_steps.len() > 512
        || document.materials.len() > 256
        || document.tests.len() > 128
        || document.dimensions.len() > 128
        || document.images.len() > 64
    {
        return Err("设计项目数量超出安全限制".into());
    }
    unique(
        document.logical_windings.iter().map(|v| v.id.as_str()),
        "逻辑绕组标识",
    )?;
    unique(
        document.winding_steps.iter().map(|v| v.id.as_str()),
        "工序标识",
    )?;
    unique(document.materials.iter().map(|v| v.id.as_str()), "材料标识")?;
    unique(document.tests.iter().map(|v| v.id.as_str()), "测试标识")?;
    unique(
        document.dimensions.iter().map(|v| v.id.as_str()),
        "尺寸标识",
    )?;
    unique(document.images.iter().map(|v| v.id.as_str()), "图片标识")?;
    let winding_ids: HashSet<&str> = document
        .logical_windings
        .iter()
        .map(|v| v.id.as_str())
        .collect();
    for winding in &document.logical_windings {
        text(&winding.name, "绕组名称", 200, true)?;
        for field in [
            &winding.role,
            &winding.polarity_note,
            &winding.terminal_notes,
        ] {
            optional_text(field, "绕组说明", 4000)?;
        }
    }
    let mut orders = HashSet::new();
    for step in &document.winding_steps {
        if step.order == 0 || step.order > 10000 || !orders.insert(step.order) {
            return Err("工序序号必须为不同的 1–10000 整数".into());
        }
        if !matches!(
            step.kind.as_str(),
            "winding" | "insulation" | "margin" | "assembly"
        ) {
            return Err("无效工序类型".into());
        }
        if let Some(id) = &step.logical_winding_id {
            if step.kind != "winding" || !winding_ids.contains(id.as_str()) {
                return Err("工序引用了不存在的逻辑绕组，或非绕线工序关联绕组".into());
            }
        }
        nonnegative(step.turns, "匝数")?;
        if step.turns == Some(0.0) {
            return Err("已知匝数必须大于零，未知请留空".into());
        }
        nonnegative(step.thickness, "厚度")?;
        if step.parallel_count.is_some_and(|v| v == 0 || v > 10000) {
            return Err("并线数必须为正整数，未知请留空".into());
        }
        for field in [
            &step.from_pin,
            &step.to_pin,
            &step.wire_spec,
            &step.direction,
            &step.layer_notes,
            &step.material,
            &step.unit,
            &step.notes,
        ] {
            optional_text(field, "工序说明", 8000)?;
        }
    }
    for material in &document.materials {
        text(&material.name, "材料名称", 200, true)?;
        nonnegative(material.quantity, "材料数量")?;
        for field in [&material.specification, &material.unit, &material.notes] {
            optional_text(field, "材料说明", 8000)?;
        }
    }
    for test in &document.tests {
        text(&test.kind, "测试名称", 200, true)?;
        nonnegative(test.target, "测试目标")?;
        for field in [&test.unit, &test.tolerance, &test.conditions, &test.notes] {
            optional_text(field, "测试说明", 8000)?;
        }
    }
    for dimension in &document.dimensions {
        text(&dimension.name, "尺寸名称", 200, true)?;
        nonnegative(dimension.value, "尺寸数值")?;
        for field in [&dimension.unit, &dimension.tolerance, &dimension.notes] {
            optional_text(field, "尺寸说明", 4000)?;
        }
    }
    for image in &document.images {
        text(&image.title, "图片标题", 200, true)?;
        if let Some(id) = &image.attachment_id {
            identifier(id, "附件标识")?;
        }
        if let Some(url) = &image.url {
            checked_image_url(url)?;
        }
        optional_text(&image.notes, "图片说明", 8000)?;
    }
    optional_text(&document.assembly_notes, "装配说明", 24000)?;
    optional_text(&document.notes, "设计备注", 24000)?;
    if let Some(source) = &document.source {
        if !matches!(source.kind.as_str(), "json" | "xlsx") {
            return Err("无效导入来源类型".into());
        }
        text(&source.file_name, "来源文件名称", 255, true)?;
        optional_text(&source.sheet_name, "工作表名称", 200)?;
        if source.raw_rows.len() > 5000 || source.warnings.len() > 128 {
            return Err("来源表格超出安全限制".into());
        }
        if source.row_start.is_some_and(|v| v == 0)
            || source.row_end.is_some_and(|v| v == 0)
            || matches!((source.row_start,source.row_end), (Some(start),Some(end)) if start>end)
        {
            return Err("无效来源行区间".into());
        }
        for row in &source.raw_rows {
            if row.len() > 128 {
                return Err("来源表格列数超出安全限制".into());
            }
            for cell in row {
                text(cell, "来源单元格", 4000, false)?;
            }
        }
        for warning in &source.warnings {
            text(warning, "导入提示", 4000, false)?;
        }
    }
    if serde_json::to_vec(document)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_DOCUMENT_BYTES
    {
        return Err("设计记录超过安全大小限制".into());
    }
    Ok(())
}

fn sheet_positive(raw: &str, label: &str) -> DesignResult<()> {
    let value: f64 = raw.trim().parse().map_err(|_| format!("{label}需为正数"))?;
    if !value.is_finite() || value <= 0.0 || value > 1e15 {
        return Err(format!("{label}需为有限正数"));
    }
    Ok(())
}
fn validate_sheet(s: &ProductionSheet) -> DesignResult<()> {
    if s.schema_version != 1 || s.windings.len() > 128 || s.electrical.len() > 128 {
        return Err("制作单版本或行数无效".into());
    }
    text(&s.core, "磁芯型号", 200, true)?;
    text(&s.material, "磁芯材质", 200, false)?;
    optional_text(&s.bobbin_description, "骨架描述", 4000)?;
    optional_text(&s.transformer_description, "变压器描述", 10000)?;
    unique(s.windings.iter().map(|w| w.id.as_str()), "制作单绕组标识")?;
    unique(s.electrical.iter().map(|e| e.id.as_str()), "制作单电感标识")?;
    for w in &s.windings {
        for v in [&w.start, &w.end, &w.diameter, &w.turns] {
            text(v, "绕组必填参数", 200, true)?;
        }
        text(&w.label, "绕组名称", 200, false)?;
        sheet_positive(&w.turns, "圈数")?;
        if !w.strands.is_empty()
            && w.strands
                .parse::<u32>()
                .map_or(true, |v| v == 0 || v > 10000)
        {
            return Err("股数需为正整数".into());
        }
        if !w.tape.is_empty() && w.tape.parse::<u32>().map_or(true, |v| v > 10000) {
            return Err("胶带层数需为非负整数".into());
        }
        if !matches!(w.group.as_str(), "PRI" | "SEC" | "unknown") {
            return Err("无效绕组分组".into());
        }
        for v in [&w.diagram_order, &w.wire_type, &w.direction] {
            text(v, "绕组选填参数", 200, false)?;
        }
        text(&w.note, "绕组备注", 10000, false)?;
    }
    for e in &s.electrical {
        text(&e.start, "测量起脚", 200, true)?;
        text(&e.end, "测量止脚", 200, true)?;
        sheet_positive(&e.inductance, "目标电感")?;
        sheet_positive(&e.frequency, "测试频率")?;
        if !matches!(e.unit.as_str(), "nH" | "uH" | "mH" | "H") {
            return Err("电感单位无效".into());
        }
        text(&e.note, "测试备注", 10000, false)?;
    }
    Ok(())
}
