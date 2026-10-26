//! Conservative conversion of the actual legacy winding-table format. Data without a unit stays unitless.
use super::{import::ImportCandidate, *};
use sha2::{Digest, Sha256};
fn normalized(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, ':' | '：'))
        .collect::<String>()
        .to_ascii_lowercase()
}
fn nonempty(value: &str) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value.trim().into())
    }
}
fn cell(row: &[String], index: Option<usize>) -> Option<String> {
    index.and_then(|i| row.get(i)).and_then(|s| nonempty(s))
}
fn number(value: Option<String>) -> Option<f64> {
    value
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
}
fn column(row: &[String], name: &str) -> Option<usize> {
    row.iter().position(|s| normalized(s) == name)
}
fn label_value(rows: &[Vec<String>], label: &str) -> Option<String> {
    for row in rows {
        if let Some(index) = column(row, label) {
            for value in row.iter().skip(index + 1).take(3) {
                if value.trim().is_empty() {
                    continue;
                }
                if matches!(
                    normalized(value).as_str(),
                    "磁芯" | "骨架" | "备注" | "电感量" | "磁芯材料"
                ) {
                    break;
                }
                return nonempty(value);
            }
        }
    }
    None
}
fn shape(model: &str) -> &'static str {
    let upper = model.to_ascii_uppercase();
    for prefix in [
        "TOROID",
        "UNCLASSIFIED",
        "EFD",
        "EER",
        "EPC",
        "ETD",
        "POT",
        "PTS",
        "PQ",
        "EC",
        "EE",
        "EF",
        "EI",
        "EP",
        "ER",
        "LP",
        "RM",
        "UU",
        "UI",
        "U",
    ] {
        if upper.starts_with(prefix) {
            return prefix;
        }
    }
    "UNCLASSIFIED"
}
fn bobbin(raw: &str) -> BobbinSnapshot {
    let compact: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    let orientation = if compact.contains("立式") {
        Some("立式".into())
    } else if compact.contains("卧式") {
        Some("卧式".into())
    } else {
        None
    };
    let after = compact
        .strip_prefix("立式")
        .or_else(|| compact.strip_prefix("卧式"))
        .unwrap_or(&compact);
    let pin_count = after
        .split_once('+')
        .and_then(|(left, right)| {
            Some(
                left.parse::<u32>()
                    .ok()?
                    .checked_add(right.parse::<u32>().ok()?)?,
            )
        })
        .filter(|n| *n > 0 && *n <= 1024);
    BobbinSnapshot {
        part_number: None,
        orientation,
        pin_count,
        view: None,
        pin1_location: None,
        pin_diagram_notes: Some(format!(
            "源表骨架：{raw}。引脚视角、1脚位置、实际脚位图待确认；分组数字不决定脚位方向。"
        )),
    }
}
fn inductance(raw: &str) -> DesignTest {
    let compact: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    let split = compact.find('脚').map(|n| n + '脚'.len_utf8());
    let measurement = split.and_then(|n| compact.get(n..)).unwrap_or("");
    let (value, unit) = if let Some(n) = measurement
        .strip_suffix("uH")
        .or_else(|| measurement.strip_suffix("μH"))
        .or_else(|| measurement.strip_suffix("µH"))
    {
        (n.parse::<f64>().ok(), Some("µH".into()))
    } else if let Some(n) = measurement.strip_suffix("mH") {
        (n.parse::<f64>().ok(), Some("mH".into()))
    } else {
        (None, None)
    };
    let target = value.filter(|n| n.is_finite() && *n >= 0.0);
    DesignTest {
        id: "legacy-inductance".into(),
        kind: "inductance".into(),
        target,
        unit,
        tolerance: None,
        conditions: None,
        notes: Some(format!(
            "源表电感量：{raw}。测试频率、幅值和公差未给出，待确认。"
        )),
    }
}
pub(crate) fn candidates_from_sheet(
    file_name: &str,
    sheet_name: &str,
    rows: &[Vec<String>],
    base_row: usize,
    sha: &str,
    formulas: bool,
) -> DesignResult<Vec<ImportCandidate>> {
    // The reference's core page contains an empty example table; it is not a design record.
    if normalized(sheet_name) == "自有磁芯骨架"
        || rows.iter().any(|row| {
            row.iter().any(|cell| normalized(cell) == "type")
                && row.iter().any(|cell| normalized(cell) == "ae")
        })
    {
        return Ok(Vec::new());
    }
    let headers: Vec<usize> = rows
        .iter()
        .enumerate()
        .filter_map(|(i, row)| {
            if column(row, "绕线顺序").is_some()
                && column(row, "绕组").is_some()
                && column(row, "圈数").is_some()
            {
                Some(i)
            } else {
                None
            }
        })
        .collect();
    let starts: Vec<usize> = headers.iter().map(|h| h.saturating_sub(4)).collect();
    let mut result = Vec::new();
    for (block_index, header_index) in headers.iter().copied().enumerate() {
        let start = starts[block_index];
        let end = starts.get(block_index + 1).copied().unwrap_or(rows.len());
        if end <= header_index + 1 {
            return Err("重复设计块结构不完整，未导入任何记录".into());
        }
        let metadata = &rows[start..header_index];
        let description = rows[start].iter().find_map(|s| nonempty(s));
        let title = format!("{sheet_name} · 设计块 {}", block_index + 1);
        let candidate_id = format!(
            "xlsx-{}-{}-{}",
            &sha[..8],
            format!("{:x}", Sha256::digest(sheet_name.as_bytes()))[..8].to_owned(),
            block_index + 1
        );
        let row_start = (base_row + start + 1) as u32;
        let row_end = (base_row + end) as u32;
        let warnings = vec![
            "导入为未审核草稿；原表未给出的测试条件、公差、脚位图方向和同名端均待确认。".into(),
            "源表 N1/N2 等是工序标签；逻辑绕组归属保持为空，不能据此判断分段初级或极性。".into(),
            "胶带厚度及挡墙顶/底的单位未标，不自动补为 mm；图片未自动绑定。".into(),
        ];
        let mut document = TransformerDesignDocument {
            production_sheet: None,
            schema_version: 1,
            design_no: format!("导入-{candidate_id}"),
            title: title.clone(),
            rev_label: String::new(),
            status: "draft".into(),
            example_flag: false,
            core_snapshot: None,
            bobbin_snapshot: None,
            logical_windings: Vec::new(),
            winding_steps: Vec::new(),
            materials: Vec::new(),
            assembly_notes: label_value(metadata, "备注"),
            tests: Vec::new(),
            dimensions: Vec::new(),
            images: Vec::new(),
            notes: description,
            source: None,
        };
        if let Some(model) = label_value(metadata, "磁芯") {
            let material = label_value(metadata, "磁芯材料");
            let mut snapshot = serde_json::json!({"schemaVersion":1,"libraryRevision":format!("legacy-source:{sha}"),"coreId":format!("legacy:{candidate_id}"),"model":model,"shape":shape(&model),"parameters":{},"sources":[{"sourceId":sha,"filename":file_name,"sha256":sha,"recordId":candidate_id,"sheet":sheet_name,"row":row_start}],"images":[],"rawParameters":[],"conflictNotes":["来自旧设计明确标签，未与当前磁芯库匹配；原表未提供的有效参数保持缺失。"]});
            if let Some(material) = material {
                snapshot["material"] = Value::String(material);
            }
            document.core_snapshot = Some(snapshot);
        }
        document.bobbin_snapshot = label_value(metadata, "骨架").map(|value| bobbin(&value));
        if let Some(value) = label_value(metadata, "电感量") {
            document.tests.push(inductance(&value));
        }
        let header = &rows[header_index];
        let detail = &rows[header_index + 1];
        let order_column = column(header, "绕线顺序");
        let label_column = column(header, "绕组");
        let role_column = column(header, "功能");
        let wire_column = column(header, "线径*根数");
        let turns_column = column(header, "圈数");
        let from_column = column(detail, "进脚");
        let to_column = column(detail, "出脚");
        let tube_column = column(header, "套管");
        let margin_column = column(header, "挡墙");
        let tape_column = column(header, "绝缘胶带");
        for (offset, row) in rows.iter().enumerate().take(end).skip(header_index + 2) {
            let Some(source_order) =
                cell(row, order_column).and_then(|value| value.parse::<u32>().ok())
            else {
                continue;
            };
            if source_order == 0 {
                continue;
            }
            let label = cell(row, label_column);
            let role = cell(row, role_column);
            let wire = cell(row, wire_column);
            let raw_turns = cell(row, turns_column);
            let turns = number(raw_turns.clone()).filter(|n| *n > 0.0);
            let from = cell(row, from_column);
            let to = cell(row, to_column);
            // Empty numbered template rows remain visible in rawRows, and do not become manufactured windings.
            if wire.is_none()
                && raw_turns.is_none()
                && from.is_none()
                && to.is_none()
                && role.is_none()
            {
                continue;
            }
            let parallel_count = wire
                .as_ref()
                .and_then(|spec| spec.rsplit_once('*').or_else(|| spec.rsplit_once('×')))
                .and_then(|(_, count)| count.trim().parse::<u32>().ok())
                .filter(|n| *n > 0 && *n <= 10000);
            let mut notes = vec![format!(
                "源表工序 {source_order}；源绕组标签 {}；逻辑绕组归属和同名端待确认。",
                label.as_deref().unwrap_or("待确认")
            )];
            if let Some(role) = role {
                notes.push(format!("源表功能：{role}"));
            }
            if raw_turns.is_some() && turns.is_none() {
                notes.push(format!(
                    "源表匝数原文：{}，数值待确认。",
                    raw_turns.as_deref().unwrap_or("")
                ));
            }
            let mut layer_notes = Vec::new();
            if let Some(column) = tube_column {
                layer_notes.push(format!(
                    "套管进/出：{}/{}",
                    cell(row, Some(column)).as_deref().unwrap_or("待确认"),
                    cell(row, Some(column + 1)).as_deref().unwrap_or("待确认")
                ));
            }
            if let Some(column) = margin_column {
                layer_notes.push(format!(
                    "挡墙顶/底：{}/{}（源表未标单位）",
                    cell(row, Some(column)).as_deref().unwrap_or("待确认"),
                    cell(row, Some(column + 1)).as_deref().unwrap_or("待确认")
                ));
            }
            if let Some(column) = tape_column {
                layer_notes.push(format!(
                    "胶带厚度/圈数：{}/{}（源表厚度单位未标；独立绝缘工序顺序待确认）",
                    cell(row, Some(column)).as_deref().unwrap_or("待确认"),
                    cell(row, Some(column + 1)).as_deref().unwrap_or("待确认")
                ));
            }
            document.winding_steps.push(WindingStep {
                id: format!("legacy-row-{}", base_row + offset + 1),
                order: document.winding_steps.len() as u32 + 1,
                kind: "winding".into(),
                logical_winding_id: None,
                from_pin: from,
                to_pin: to,
                turns,
                wire_spec: wire,
                parallel_count,
                direction: None,
                layer_notes: if layer_notes.is_empty() {
                    None
                } else {
                    Some(layer_notes.join("；"))
                },
                material: None,
                thickness: None,
                unit: None,
                notes: Some(notes.join("；")),
            });
        }
        let mut block_warnings = warnings;
        if formulas {
            block_warnings.push("工作簿包含公式；只读取缓存值，未执行公式。".into());
        }
        if document.winding_steps.is_empty() {
            block_warnings.push("该块未识别到有实值的绕线工序，原始表格仍保留。".into());
        }
        document.source = Some(ImportSource {
            kind: "xlsx".into(),
            file_name: file_name.into(),
            sheet_name: Some(sheet_name.into()),
            row_start: Some(row_start),
            row_end: Some(row_end),
            raw_rows: rows[start..end].to_vec(),
            warnings: block_warnings.clone(),
        });
        validate_document(&document)?;
        result.push(ImportCandidate {
            candidate_id,
            sheet_name: Some(sheet_name.into()),
            row_start: Some(row_start),
            row_end: Some(row_end),
            title,
            document,
            warnings: block_warnings,
        });
    }
    Ok(result)
}
