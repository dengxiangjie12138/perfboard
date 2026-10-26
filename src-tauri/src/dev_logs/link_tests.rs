use super::*;
use serde_json::json;

fn linked_document(attrs: Value) -> Value {
    json!({"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"specification","marks":[{"type":"link","attrs":attrs}]}
    ]}]})
}
fn tiptap_attrs() -> Value {
    // Actual installed StarterKit link mark serialization, including title:null.
    json!({"href":"https://example.com/spec.pdf","target":"_blank",
        "rel":"noopener noreferrer nofollow","class":null,"title":null})
}
fn validate_attrs(attrs: Value) -> LogResult<String> {
    let document = linked_document(attrs);
    validate_mark(&document["content"][0]["content"][0]["marks"][0])?;
    serde_json::to_string(&document).map_err(err)
}

#[test]
fn accepts_tiptap_link_defaults_and_safe_pasted_metadata_without_removing_them() {
    let document = linked_document(tiptap_attrs());
    let validated = validate_document(&document.to_string(), 1).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&validated).unwrap(), document);
    for target in [json!(null), json!("_self"), json!("_blank")] {
        let mut attrs = tiptap_attrs();
        attrs["target"] = target;
        attrs["class"] = json!("reference imported-link");
        attrs["title"] = json!("Datasheet \"quoted\" — preserved");
        let document = linked_document(attrs);
        let validated = validate_document(&document.to_string(), 1).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&validated).unwrap(), document);
    }
    let mut attrs = tiptap_attrs();
    attrs["rel"] = Value::Null;
    attrs["class"] = json!("");
    attrs["title"] = json!("First line\nSecond line");
    assert!(validate_attrs(attrs).is_ok());
}

#[test]
fn keeps_existing_href_only_documents_compatible() {
    let document = linked_document(json!({"href":"http://example.com/legacy"}));
    let validated = validate_document(&document.to_string(), 1).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&validated).unwrap(), document);
    assert!(validate_document(EMPTY_DOCUMENT, 1).is_ok());
}

#[test]
fn rejects_unsafe_or_missing_link_destinations() {
    for href in [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,evil",
        "file:///C:/private.txt",
        "mailto:user@example.com",
        "//example.com/path",
        "https://user:password@example.com",
        "https://user@example.com",
        "",
    ] {
        let mut attrs = tiptap_attrs();
        attrs["href"] = json!(href);
        assert!(validate_attrs(attrs).is_err(), "accepted {href}");
    }
    for href in [
        Value::Null,
        json!(123),
        json!({"url":"https://example.com"}),
    ] {
        let mut attrs = tiptap_attrs();
        attrs["href"] = href;
        assert!(validate_attrs(attrs).is_err());
    }
    let mut attrs = tiptap_attrs();
    attrs.as_object_mut().unwrap().remove("href");
    assert!(validate_attrs(attrs).is_err());
    let document = json!({"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"bad","marks":[{"type":"link"}]}
    ]}]});
    assert!(validate_mark(&document["content"][0]["content"][0]["marks"][0]).is_err());
}

#[test]
fn rejects_unknown_metadata_bad_types_and_unbounded_strings() {
    for key in ["target", "rel", "class", "title"] {
        for value in [
            json!(true),
            json!(123),
            json!(["safe"]),
            json!({"text":"safe"}),
        ] {
            let mut attrs = tiptap_attrs();
            attrs[key] = value;
            assert!(validate_attrs(attrs).is_err(), "accepted invalid {key}");
        }
    }
    for (key, length) in [("rel", 100), ("class", 513), ("title", 2049)] {
        let mut attrs = tiptap_attrs();
        attrs[key] = json!("a".repeat(length));
        assert!(validate_attrs(attrs).is_err(), "accepted oversized {key}");
    }
    for key in ["onclick", "style", "download", "unknown"] {
        let mut attrs = tiptap_attrs();
        attrs[key] = json!("injected");
        assert!(validate_attrs(attrs).is_err(), "accepted unknown {key}");
    }
    for target in ["popup", "javascript:alert(1)"] {
        let mut attrs = tiptap_attrs();
        attrs["target"] = json!(target);
        assert!(validate_attrs(attrs).is_err());
    }
    let mut attrs = tiptap_attrs();
    attrs["class"] = json!("bad\u{0000}class");
    assert!(validate_attrs(attrs).is_err());
}

#[test]
fn saving_links_preserves_history_and_rejected_saves_leave_stored_document_unchanged() {
    // A fresh in-memory database is the only repository used by this test.
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    create_schema(&conn).unwrap();
    let project = create_project(&mut conn, "Link test").unwrap();
    let page = create_page(&mut conn, &project.id, "Reference").unwrap();
    let mut attrs = tiptap_attrs();
    attrs["class"] = json!("docs-reference");
    attrs["title"] = json!("Component datasheet");
    let document = linked_document(attrs);
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
    assert_eq!(saved.revision, page.revision + 1);
    assert_eq!(
        serde_json::from_str::<Value>(&get_page(&conn, &page.id).unwrap().document_json).unwrap(),
        document
    );
    assert_eq!(history(&conn, &page.id).unwrap().len(), 2);
    let mut bad = tiptap_attrs();
    bad["href"] = json!("javascript:alert(1)");
    let mut malformed = linked_document(bad);
    malformed["content"][0]["content"][0]["type"] = json!("unknownBodyNode");
    assert!(save_page(
        &mut conn,
        PageSaveInput {
            id: saved.id.clone(),
            expected_revision: saved.revision,
            title: saved.title.clone(),
            document_json: malformed.to_string(),
            schema_version: 1,
        }
    )
    .is_err());
    let unchanged = get_page(&conn, &page.id).unwrap();
    assert_eq!(unchanged.revision, saved.revision);
    assert_eq!(unchanged.document_json, saved.document_json);
    assert_eq!(history(&conn, &page.id).unwrap().len(), 2);
}
