use super::*;
use crate::dev_logs::{
    create_page, create_project, create_schema, get_page, history, save_page, validate_document,
    PageSaveInput,
};
use rusqlite::Connection;
use serde_json::json;

fn body(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(body).collect()),
        Value::Object(values) => Value::Object(
            values
                .iter()
                .filter(|(key, _)| !matches!(key.as_str(), "attrs" | "marks"))
                .map(|(key, value)| (key.clone(), body(value)))
                .collect(),
        ),
        _ => value.clone(),
    }
}
fn emphasis(value: &Value, result: &mut Vec<Value>) {
    if let Some(marks) = value.get("marks").and_then(Value::as_array) {
        for mark in marks {
            if matches!(
                mark.get("type").and_then(Value::as_str),
                Some("bold" | "code")
            ) {
                result.push(json!([value["text"], mark["type"]]));
            }
        }
    }
    if let Some(content) = value.get("content").and_then(Value::as_array) {
        for child in content {
            emphasis(child, result);
        }
    }
}
fn check_roundtrip(document: &Value) {
    let normalized: Value =
        serde_json::from_str(&validate_document(&document.to_string(), 1).unwrap()).unwrap();
    assert_eq!(body(&normalized), body(document));
    let (mut before, mut after) = (vec![], vec![]);
    emphasis(document, &mut before);
    emphasis(&normalized, &mut after);
    assert_eq!(before, after);
    assert!(!normalized.to_string().contains("var("));
    assert_eq!(
        validate_document(&normalized.to_string(), 1).unwrap(),
        normalized.to_string()
    );
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    create_schema(&conn).unwrap();
    let project = create_project(&mut conn, "Clipboard regression").unwrap();
    let page = create_page(&mut conn, &project.id, "Sample").unwrap();
    let saved = save_page(
        &mut conn,
        PageSaveInput {
            id: page.id.clone(),
            expected_revision: page.revision,
            title: page.title.clone(),
            document_json: document.to_string(),
            schema_version: 1,
        },
    )
    .unwrap();
    assert_eq!(saved.revision, 2);
    assert_eq!(
        serde_json::from_str::<Value>(&saved.document_json).unwrap(),
        normalized
    );
    assert_eq!(
        get_page(&conn, &page.id).unwrap().document_json,
        saved.document_json
    );
    let versions = history(&conn, &page.id).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0].document_json, saved.document_json);
    let mut malformed = document.clone();
    malformed["content"][0]["type"] = json!("unknownBodyNode");
    assert!(save_page(
        &mut conn,
        PageSaveInput {
            id: page.id.clone(),
            expected_revision: saved.revision,
            title: page.title,
            document_json: malformed.to_string(),
            schema_version: 1
        }
    )
    .is_err());
    assert_eq!(
        get_page(&conn, &page.id).unwrap().document_json,
        saved.document_json
    );
    assert_eq!(history(&conn, &page.id).unwrap().len(), 2);
}
#[test]
fn unsupported_pasted_formats_preserve_text_breaks_lists_and_supported_marks() {
    let document = json!({"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[
        {"type":"text","text":"first","marks":[{"type":"textStyle","attrs":{"color":"var(--color-fg-default)"}},{"type":"bold"}]},
        {"type":"hardBreak"},{"type":"text","text":"second","marks":[{"type":"code"}]}
    ]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"item"}]}]}]},{"type":"paragraph"}]});
    check_roundtrip(&document);
}
#[test]
fn unsupported_marks_and_unsafe_links_become_text_while_supported_metadata_survives() {
    let input = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"body","marks":[
        {"type":"textStyle","attrs":{"color":"rgb(18, 52, 86)","fontFamily":"external"}},
        {"type":"bold","attrs":{"external":true}}, {"type":"externalStyle"},
        {"type":"highlight","attrs":{"color":"var(--background)"}},
        {"type":"link","attrs":{"href":"javascript:alert(1)"}},
        {"type":"link","attrs":{"href":"https://example.com","title":"Reference","class":"docs","rel":null,"target":"_blank"}}
    ]}]}]});
    let output: Value =
        serde_json::from_str(&validate_document(&input.to_string(), 1).unwrap()).unwrap();
    assert_eq!(body(&output), body(&input));
    assert_eq!(
        output["content"][0]["content"][0]["marks"],
        json!([
            {"type":"textStyle","attrs":{"color":"#123456"}},{"type":"bold"},
            {"type":"link","attrs":{"href":"https://example.com","title":"Reference","class":"docs","rel":null,"target":"_blank"}}
        ])
    );
}
#[test]
fn opaque_browser_colors_are_canonicalized_and_unsupported_colors_dropped() {
    for (input, expected) in [
        ("#AbC", Some("#AbC")),
        ("#abcdef", Some("#abcdef")),
        ("rgba(12, 34, 56, 1.0)", Some("#0c2238")),
        ("rgb(300, 1, 2)", None),
        ("rgba(0,0,0,0.5)", None),
        ("var(--color-fg-default)", None),
    ] {
        assert_eq!(normalize_color(input).as_deref(), expected);
    }
}
#[test]
#[ignore = "Set PERFBOARD_PASTE_SAMPLE to the private supplied JSON; never commit that source text"]
fn external_pasted_document_regression() {
    let path = std::env::var("PERFBOARD_PASTE_SAMPLE").expect("PERFBOARD_PASTE_SAMPLE is required");
    let raw = std::fs::read_to_string(path).unwrap();
    let document: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(document["content"].as_array().unwrap().len(), 56);
    assert_eq!(raw.matches("var(--color-fg-default)").count(), 53);
    check_roundtrip(&document);
}
