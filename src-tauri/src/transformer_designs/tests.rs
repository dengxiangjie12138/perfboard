use super::*;
use serde_json::json;

fn document() -> TransformerDesignDocument {
    serde_json::from_value(json!({
        "schemaVersion":1,"designNo":"TEST-36W","title":"记录测试","revLabel":"A","status":"draft","exampleFlag":false,
        "coreSnapshot":null,"bobbinSnapshot":null,"logicalWindings":[],"windingSteps":[],"materials":[],
        "assemblyNotes":null,"tests":[],"dimensions":[],"images":[],"notes":null,"source":null
    })).unwrap()
}
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    create_schema(&conn).unwrap();
    conn
}
fn create(conn: &mut Connection, document: TransformerDesignDocument) -> TransformerDesign {
    save(
        conn,
        DesignSaveInput {
            id: None,
            expected_revision: None,
            document,
        },
    )
    .unwrap()
}
#[test]
fn cas_conflict_keeps_record_and_history_and_releases_transaction() {
    let mut conn = database();
    let original = create(&mut conn, document());
    let mut edited = original.document.clone();
    edited.title = "修订记录".into();
    let saved = save(
        &mut conn,
        DesignSaveInput {
            id: Some(original.id.clone()),
            expected_revision: Some(1),
            document: edited.clone(),
        },
    )
    .unwrap();
    assert_eq!(saved.revision, 2);
    let stale = save(
        &mut conn,
        DesignSaveInput {
            id: Some(original.id.clone()),
            expected_revision: Some(1),
            document: original.document,
        },
    );
    assert!(stale.unwrap_err().starts_with("[revision-conflict]"));
    assert!(conn.is_autocommit());
    assert_eq!(get(&conn, &original.id).unwrap().document, edited);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM transformer_design_history", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert!(delete(
        &mut conn,
        DesignRevisionInput {
            id: original.id.clone(),
            expected_revision: 1
        }
    )
    .is_err());
    assert_eq!(list(&conn).unwrap().len(), 1);
    delete(
        &mut conn,
        DesignRevisionInput {
            id: original.id,
            expected_revision: 2,
        },
    )
    .unwrap();
    assert!(list(&conn).unwrap().is_empty());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM transformer_design_history", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn snapshot_is_not_rebuilt_and_split_winding_can_have_multiple_steps() {
    let mut conn = database();
    let mut doc = document();
    doc.core_snapshot = Some(
        json!({"schemaVersion":1,"libraryRevision":"frozen-20261007","coreId":"pq2020","model":"PQ2020","shape":"PQ","material":"PC40","parameters":{"aeMm2":61.2},"sources":[],"images":[],"rawParameters":[{"key":"ae","value":61.2,"unit":"mm²"}],"conflictNotes":["未确认气隙"]}),
    );
    doc.logical_windings.push(LogicalWinding {
        id: "primary".into(),
        name: "初级".into(),
        role: Some("primary".into()),
        polarity_note: None,
        terminal_notes: None,
    });
    for (order, turns) in [(1, 48.0), (3, 94.0)] {
        doc.winding_steps.push(WindingStep {
            id: format!("step-{order}"),
            order,
            kind: "winding".into(),
            logical_winding_id: Some("primary".into()),
            from_pin: None,
            to_pin: None,
            turns: Some(turns),
            wire_spec: None,
            parallel_count: None,
            direction: None,
            layer_notes: None,
            material: None,
            thickness: None,
            unit: None,
            notes: None,
        });
    }
    let record = create(&mut conn, doc.clone());
    assert_eq!(get(&conn, &record.id).unwrap().document, doc);
    assert_eq!(
        record.document.core_snapshot.as_ref().unwrap()["libraryRevision"],
        "frozen-20261007"
    );
    assert_eq!(record.document.winding_steps[0].from_pin, None);
    assert_eq!(
        record.document.winding_steps[1].logical_winding_id,
        Some("primary".into())
    );
}
#[test]
fn validation_rejects_unknown_winding_duplicate_order_and_fabricated_example_approval() {
    let mut doc = document();
    doc.example_flag = true;
    doc.status = "released".into();
    assert!(validate_document(&doc).is_err());
    doc.example_flag = false;
    doc.status = "draft".into();
    doc.winding_steps.push(WindingStep {
        id: "s1".into(),
        order: 1,
        kind: "winding".into(),
        logical_winding_id: Some("missing".into()),
        from_pin: None,
        to_pin: None,
        turns: Some(5.0),
        wire_spec: None,
        parallel_count: None,
        direction: None,
        layer_notes: None,
        material: None,
        thickness: None,
        unit: None,
        notes: None,
    });
    assert!(validate_document(&doc).is_err());
    doc.winding_steps[0].logical_winding_id = None;
    assert!(validate_document(&doc).is_ok());
    let mut duplicate = doc.winding_steps[0].clone();
    duplicate.id = "s2".into();
    doc.winding_steps.push(duplicate);
    assert!(validate_document(&doc).is_err());
}
#[test]
fn unknown_values_remain_null_and_unitless_thickness_is_not_assumed_mm() {
    let mut doc = document();
    doc.winding_steps.push(WindingStep {
        id: "tape".into(),
        order: 1,
        kind: "insulation".into(),
        logical_winding_id: None,
        from_pin: None,
        to_pin: None,
        turns: None,
        wire_spec: None,
        parallel_count: None,
        direction: None,
        layer_notes: None,
        material: Some("胶带".into()),
        thickness: Some(0.05),
        unit: None,
        notes: Some("源表未给单位".into()),
    });
    validate_document(&doc).unwrap();
    let value = serde_json::to_value(&doc).unwrap();
    assert!(value["windingSteps"][0]["unit"].is_null());
    assert!(value["windingSteps"][0]["turns"].is_null());
}
#[test]
fn json_preview_is_selection_only_and_does_not_trust_extra_fields() {
    let docs = vec![document(), document()];
    let bytes = serde_json::to_vec(&docs).unwrap();
    let (candidates, _) = import::parse_bytes("two.json", "json", &bytes).unwrap();
    assert_eq!(candidates.len(), 2);
    assert_ne!(candidates[0].candidate_id, candidates[1].candidate_id);
    assert_eq!(candidates[0].document.core_snapshot, None);
    let mut value = serde_json::to_value(document()).unwrap();
    value["sourcePath"] = json!("C:/secret");
    assert!(import::parse_bytes("bad.json", "json", &serde_json::to_vec(&value).unwrap()).is_err());
}
#[test]
fn xlsx_preflight_rejects_huge_coordinates_before_range_allocation() {
    assert!(import::validate_sheet_xml(
        "<worksheet><dimension ref=\"A1:XFD1048576\"/></worksheet>"
    )
    .is_err());
    assert!(import::validate_sheet_xml(
        "<worksheet><row r=\"1048576\"><c r=\"A1048576\"/></row></worksheet>"
    )
    .is_err());
    assert!(
        import::validate_sheet_xml("<!DOCTYPE worksheet [<!ENTITY x 'oops'>]><worksheet/>")
            .is_err()
    );
    assert!(import::validate_sheet_xml(
        "<worksheet><dimension ref=\"A1:N150\"/><row r=\"1\"><c r=\"A1\"/></row></worksheet>"
    )
    .is_ok());
}
#[test]
fn legacy_tables_split_repeated_headers_and_preserve_uncertain_fields() {
    fn row(cells: &[(&str, usize)]) -> Vec<String> {
        let mut row = vec![String::new(); 14];
        for (value, index) in cells {
            row[*index] = (*value).into();
        }
        row
    }
    fn block() -> Vec<Vec<String>> {
        vec![
            row(&[("36W 输出记录", 0)]),
            row(&[]),
            row(&[
                ("磁芯：", 0),
                ("PQ2020", 1),
                ("电感量：", 6),
                ("1-3脚   14uH", 7),
            ]),
            row(&[
                ("骨架：", 0),
                ("立式6+8", 1),
                ("磁芯材料：", 3),
                ("PC40", 4),
            ]),
            row(&[
                ("绕线顺序", 0),
                ("绕组", 1),
                ("线径*根数", 2),
                ("脚位", 3),
                ("圈数", 5),
                ("套管", 6),
                ("挡墙", 8),
                ("绝缘胶带", 10),
            ]),
            row(&[
                ("进脚", 3),
                ("出脚", 4),
                ("Ts", 5),
                ("进", 6),
                ("出", 7),
                ("顶", 8),
                ("底", 9),
                ("厚度", 10),
                ("圈数", 11),
            ]),
            row(&[
                ("1", 0),
                ("N1", 1),
                ("1mm*1", 2),
                ("1", 3),
                ("2", 4),
                ("5", 5),
                ("有", 6),
                ("有", 7),
                ("0", 8),
                ("0", 9),
                ("0.05", 10),
                ("2", 11),
            ]),
            row(&[
                ("2", 0),
                ("N2", 1),
                ("1mm*1", 2),
                ("11", 3),
                ("14", 4),
                ("16", 5),
            ]),
            row(&[
                ("3", 0),
                ("N3", 1),
                ("1mm*1", 2),
                ("2", 3),
                ("3", 4),
                ("5", 5),
            ]),
            row(&[
                ("4", 0),
                ("N4", 1),
                ("0.2mm*1", 2),
                ("9", 3),
                ("10", 4),
                ("8", 5),
            ]),
        ]
    }
    let mut rows = block();
    rows.extend(block());
    let candidates =
        legacy::candidates_from_sheet("source.xlsx", "36W", &rows, 3, &"a".repeat(64), false)
            .unwrap();
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].row_start, Some(4));
    assert_eq!(candidates[0].row_end, Some(13));
    assert_eq!(candidates[1].row_start, Some(14));
    let doc = &candidates[0].document;
    assert_eq!(
        doc.winding_steps
            .iter()
            .map(|s| s.turns)
            .collect::<Vec<_>>(),
        vec![Some(5.0), Some(16.0), Some(5.0), Some(8.0)]
    );
    assert_eq!(doc.winding_steps[0].from_pin, Some("1".into()));
    assert_eq!(doc.winding_steps[0].to_pin, Some("2".into()));
    assert!(doc
        .winding_steps
        .iter()
        .all(|s| s.logical_winding_id.is_none() && s.unit.is_none() && s.direction.is_none()));
    assert!(doc.logical_windings.is_empty());
    assert_eq!(doc.bobbin_snapshot.as_ref().unwrap().pin_count, Some(14));
    assert!(doc.bobbin_snapshot.as_ref().unwrap().view.is_none());
    assert_eq!(doc.tests[0].target, Some(14.0));
    assert_eq!(doc.tests[0].unit, Some("µH".into()));
    assert!(doc.tests[0].conditions.is_none());
    assert_eq!(doc.core_snapshot.as_ref().unwrap()["model"], "PQ2020");
    assert_eq!(doc.core_snapshot.as_ref().unwrap()["parameters"], json!({}));
    assert!(doc.winding_steps[0]
        .layer_notes
        .as_ref()
        .unwrap()
        .contains("0.05/2"));
    assert!(legacy::candidates_from_sheet(
        "source.xlsx",
        "自有磁芯骨架",
        &rows,
        0,
        &"a".repeat(64),
        false
    )
    .unwrap()
    .is_empty());
}
#[test]
#[ignore = "root may set PERFBOARD_TRANSFORMER_XLSX_FIXTURE to a read-only authorized source or cache copy"]
fn authorized_reference_xlsx_has_29_blocks_and_36w_values() {
    let path = std::env::var("PERFBOARD_TRANSFORMER_XLSX_FIXTURE")
        .expect("set the authorized local XLSX fixture path");
    let bytes = std::fs::read(path).unwrap();
    let (candidates, _) = import::parse_bytes("reference.xlsx", "xlsx", &bytes).unwrap();
    assert_eq!(candidates.len(), 29);
    assert!(!candidates
        .iter()
        .any(|c| c.sheet_name.as_deref() == Some("自有磁芯骨架")));
    let sample = candidates
        .iter()
        .find(|c| c.sheet_name.as_deref() == Some("反激16~28-36W 变压器"))
        .unwrap();
    assert_eq!(sample.row_start, Some(4));
    assert_eq!(
        sample
            .document
            .winding_steps
            .iter()
            .map(|s| s.turns)
            .collect::<Vec<_>>(),
        vec![Some(5.0), Some(16.0), Some(5.0), Some(8.0)]
    );
    assert_eq!(sample.document.tests[0].target, Some(14.0));
    assert!(sample
        .document
        .winding_steps
        .iter()
        .all(|s| s.logical_winding_id.is_none()));
}

// Real 2x2 PNG/JPEG fixtures generated offscreen; decoded originals are retained in the task cache.
const INLINE_PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAASSURBVBhXY5C29v8PwlCG/38ANaIGkXQafD0AAAAASUVORK5CYII=";
const INLINE_JPEG_BASE64: &str = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzOiiiu088/9k=";
fn image_document(urls: &[String]) -> TransformerDesignDocument {
    let mut doc = document();
    doc.images = urls
        .iter()
        .enumerate()
        .map(|(index, url)| DesignImage {
            id: format!("image-{index}"),
            title: format!("附图 {index}"),
            attachment_id: None,
            url: Some(url.clone()),
            notes: None,
        })
        .collect();
    doc
}
fn embedded_image_url(mime: &str, bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}
/// Add a valid ancillary PNG chunk so size-limit tests use genuine PNG containers.
fn png_fixture_with_size(size: usize) -> Vec<u8> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let png = STANDARD.decode(INLINE_PNG_BASE64).unwrap();
    let payload_length = size.checked_sub(png.len() + 12).unwrap();
    let mut result = png[..png.len() - 12].to_vec();
    result.extend_from_slice(&(payload_length as u32).to_be_bytes());
    let chunk_start = result.len();
    result.extend_from_slice(b"teSt");
    result.resize(result.len() + payload_length, b'A');
    let mut crc = !0u32;
    for byte in &result[chunk_start..] {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb88320
            } else {
                crc >> 1
            };
        }
    }
    result.extend_from_slice(&(!crc).to_be_bytes());
    result.extend_from_slice(&png[png.len() - 12..]);
    assert_eq!(result.len(), size);
    result
}
#[test]
fn embedded_png_jpeg_are_preserved_in_records_history_and_json_export() {
    let urls = vec![
        format!("data:image/png;base64,{INLINE_PNG_BASE64}"),
        format!("data:image/jpeg;base64,{INLINE_JPEG_BASE64}"),
        "https://example.invalid/reference.png".into(),
    ];
    let doc = image_document(&urls);
    let mut conn = database();
    let record = create(&mut conn, doc.clone());
    assert_eq!(get(&conn, &record.id).unwrap().document.images, doc.images);
    let mut updated = doc.clone();
    updated.notes = Some("保持已冻结的原始图片".into());
    save(
        &mut conn,
        DesignSaveInput {
            id: Some(record.id.clone()),
            expected_revision: Some(1),
            document: updated,
        },
    )
    .unwrap();
    let mut history = conn.prepare("SELECT document_json FROM transformer_design_history WHERE design_id=?1 ORDER BY revision").unwrap();
    let snapshots = history
        .query_map([&record.id], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(snapshots.len(), 2);
    for snapshot in snapshots {
        assert_eq!(
            serde_json::from_str::<TransformerDesignDocument>(&snapshot)
                .unwrap()
                .images,
            doc.images
        );
    }
    let exported = export_json(&conn, &record.id).unwrap();
    assert_eq!(
        serde_json::from_str::<TransformerDesignDocument>(&exported)
            .unwrap()
            .images,
        doc.images
    );
    let (preview, _) = import::parse_bytes("images.json", "json", exported.as_bytes()).unwrap();
    assert_eq!(preview[0].document.images, doc.images);
}
#[test]
fn embedded_images_accept_one_mib_and_reject_larger_decoded_payloads() {
    let maximum = embedded_image_url("image/png", &png_fixture_with_size(1024 * 1024));
    assert!(maximum.len() > 4000);
    assert!(validate_document(&image_document(&[maximum])).is_ok());
    let too_large = embedded_image_url("image/png", &png_fixture_with_size(1024 * 1024 + 1));
    assert!(validate_document(&image_document(&[too_large]))
        .unwrap_err()
        .contains("1 MiB"));
}
#[test]
fn embedded_images_reject_wrong_mime_invalid_base64_and_incomplete_signatures() {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let png = STANDARD.decode(INLINE_PNG_BASE64).unwrap();
    let jpeg = STANDARD.decode(INLINE_JPEG_BASE64).unwrap();
    let invalid = vec![
        format!("data:image/png;base64,{INLINE_JPEG_BASE64}"),
        format!("data:image/jpeg;base64,{INLINE_PNG_BASE64}"),
        embedded_image_url("image/gif", b"GIF89a"),
        embedded_image_url("image/svg+xml", b"<svg/>"),
        embedded_image_url("image/jpg", &jpeg),
        "data:image/png;base64,$invalid".into(),
        "data:image/png;base64,".into(),
        format!(
            "data:image/png;base64,{}",
            &INLINE_PNG_BASE64[..INLINE_PNG_BASE64.len() - 1]
        ),
        embedded_image_url("image/png", &png[..8]),
        embedded_image_url("image/png", &png[..png.len() - 12]),
        embedded_image_url("image/jpeg", &jpeg[..jpeg.len() - 2]),
        "file:///C:/private/image.png".into(),
    ];
    for url in invalid {
        assert!(
            validate_document(&image_document(&[url.clone()])).is_err(),
            "unexpectedly accepted {url}"
        );
    }
}
#[test]
fn total_document_size_still_limits_multiple_individually_valid_images() {
    let url = embedded_image_url("image/png", &png_fixture_with_size(800 * 1024));
    assert!(validate_document(&image_document(&[url.clone()])).is_ok());
    assert!(validate_document(&image_document(&[url.clone(), url]))
        .unwrap_err()
        .contains("安全大小"));
}

fn production_sheet_fixture() -> ProductionSheet {
    serde_json::from_value(json!({"schemaVersion":1,"core":"EE19","material":"","showDiagram":true,
 "windings":[{"id":"coil-1","label":"N1","start":"1","end":"2","diameter":"0.30","strands":"1","turns":"12","tape":"","tubeStart":false,"tubeEnd":true,"group":"PRI","diagramOrder":"","wireType":"","direction":"","note":""}],
 "electrical":[{"id":"target-1","start":"1","end":"3","inductance":"37.5","unit":"uH","frequency":"25","note":""}]})).unwrap()
}
#[test]
fn production_sheet_roundtrip_preserves_legacy_and_cas_without_schema_migration() {
    let mut conn = database();
    let mut d = document();
    d.production_sheet = Some(production_sheet_fixture());
    d.title = String::new();
    let original = d.clone();
    let saved = create(&mut conn, d);
    assert_eq!(get(&conn, &saved.id).unwrap().document, original);
    let mut edited = saved.document.clone();
    edited.production_sheet.as_mut().unwrap().electrical[0].note = "实际测试备注".into();
    let saved2 = save(
        &mut conn,
        DesignSaveInput {
            id: Some(saved.id.clone()),
            expected_revision: Some(1),
            document: edited.clone(),
        },
    )
    .unwrap();
    assert_eq!(saved2.document, edited);
    assert_eq!(saved2.document.design_no, original.design_no);
    assert!(save(
        &mut conn,
        DesignSaveInput {
            id: Some(saved.id),
            expected_revision: Some(1),
            document: original
        }
    )
    .is_err());
}
#[test]
fn production_sheet_empty_targets_valid_and_bad_rows_do_not_persist() {
    let mut conn = database();
    let mut d = document();
    let mut sheet = production_sheet_fixture();
    sheet.electrical.clear();
    d.production_sheet = Some(sheet);
    assert!(validate_document(&d).is_ok());
    let mut sheet = production_sheet_fixture();
    sheet.electrical[0].frequency = "0".into();
    d.production_sheet = Some(sheet);
    assert!(save(
        &mut conn,
        DesignSaveInput {
            id: None,
            expected_revision: None,
            document: d
        }
    )
    .is_err());
    assert!(list(&conn).unwrap().is_empty());
}
#[test]
fn old_documents_omit_optional_sheet_and_retain_original_json_shape() {
    let d = document();
    let value = serde_json::to_value(&d).unwrap();
    assert!(value.get("productionSheet").is_none());
    assert_eq!(
        serde_json::from_value::<TransformerDesignDocument>(value).unwrap(),
        d
    );
}

#[test]
fn production_sheet_bobbin_description_accepts_old_missing_null_and_roundtrips() {
    let old = production_sheet_fixture();
    assert_eq!(old.bobbin_description, None);
    let mut value = serde_json::to_value(&old).unwrap();
    value["bobbinDescription"] = serde_json::Value::Null;
    assert_eq!(
        serde_json::from_value::<ProductionSheet>(value).unwrap(),
        old
    );
    let mut d = document();
    let mut sheet = old;
    sheet.bobbin_description = Some("EE19 立式骨架；十脚，按已确认图纸制作。".into());
    d.production_sheet = Some(sheet);
    let mut conn = database();
    let saved = create(&mut conn, d.clone());
    assert_eq!(get(&conn, &saved.id).unwrap().document, d);
    d.production_sheet.as_mut().unwrap().bobbin_description = Some(String::new());
    assert!(validate_document(&d).is_ok());
    d.production_sheet.as_mut().unwrap().bobbin_description = Some("字".repeat(4001));
    assert!(validate_document(&d).unwrap_err().contains("骨架描述"));
}

#[test]
fn transformer_description_preserves_old_bobbin_and_roundtrips_save_history_export_import() {
    let mut old = production_sheet_fixture();
    old.bobbin_description = Some("立式6+8\n保留旧骨架备注".into());
    assert_eq!(old.transformer_description, None);
    let mut value = serde_json::to_value(&old).unwrap();
    assert!(value.get("transformerDescription").is_none());
    value["transformerDescription"] = serde_json::Value::Null;
    assert_eq!(
        serde_json::from_value::<ProductionSheet>(value).unwrap(),
        old
    );
    let mut d = document();
    d.production_sheet = Some(old.clone());
    let mut conn = database();
    let saved = create(&mut conn, d.clone());
    d.production_sheet.as_mut().unwrap().transformer_description =
        Some("用途：辅助电源\n输入16–28V，输出12V，功率36W。自由备注。".into());
    let saved2 = save(
        &mut conn,
        DesignSaveInput {
            id: Some(saved.id.clone()),
            expected_revision: Some(1),
            document: d.clone(),
        },
    )
    .unwrap();
    assert_eq!(saved2.revision, 2);
    assert_eq!(get(&conn, &saved.id).unwrap().document, d);
    assert_eq!(
        d.production_sheet.as_ref().unwrap().bobbin_description,
        old.bobbin_description
    );
    let first_snapshot: String = conn.query_row(
        "SELECT document_json FROM transformer_design_history WHERE design_id=?1 AND revision=1",
        [&saved.id], |row| row.get(0),
    ).unwrap();
    assert_eq!(
        serde_json::from_str::<TransformerDesignDocument>(&first_snapshot)
            .unwrap()
            .production_sheet,
        Some(old)
    );
    let exported = export_json(&conn, &saved.id).unwrap();
    assert_eq!(
        serde_json::from_str::<TransformerDesignDocument>(&exported).unwrap(),
        d
    );
    let (preview, _) =
        import::parse_bytes("descriptions.json", "json", exported.as_bytes()).unwrap();
    assert_eq!(preview[0].document.production_sheet, d.production_sheet);
}

#[test]
fn transformer_description_is_optional_and_rejects_oversized_text_without_a_partial_save() {
    let mut conn = database();
    let mut d = document();
    d.production_sheet = Some(production_sheet_fixture());
    for description in [None, Some(String::new()), Some("字".repeat(10000))] {
        d.production_sheet.as_mut().unwrap().transformer_description = description;
        assert!(validate_document(&d).is_ok());
    }
    d.production_sheet.as_mut().unwrap().transformer_description = Some("字".repeat(10001));
    assert!(save(
        &mut conn,
        DesignSaveInput {
            id: None,
            expected_revision: None,
            document: d
        }
    )
    .unwrap_err()
    .contains("变压器描述"));
    assert!(list(&conn).unwrap().is_empty());
}
