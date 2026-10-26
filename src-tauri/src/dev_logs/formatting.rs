//! Clipboard/imported presentation must never make otherwise valid body text unsavable.
use super::{valid_mark_attribute, valid_node_attribute, validate_mark, LogResult};
use serde_json::{Map, Value};

pub(super) fn normalize_formatting(
    value: &mut Value,
    depth: usize,
    count: &mut usize,
) -> LogResult<()> {
    *count += 1;
    if depth > 64 || *count > 100_000 {
        return Err("日志文档结构过大或嵌套过深".into());
    }
    let Some(node) = value.as_object_mut() else {
        return Ok(());
    };
    let kind = node
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    if let Some(attrs) = node.get_mut("attrs") {
        if let Some(attrs) = attrs.as_object_mut() {
            attrs.retain(|key, value| valid_node_attribute(&kind, key, value));
        } else {
            *attrs = Value::Object(Map::new());
        }
    }
    if let Some(marks) = node.get_mut("marks").and_then(Value::as_array_mut) {
        *marks = marks.iter().filter_map(normalize_mark).collect();
    }
    if let Some(content) = node.get_mut("content").and_then(Value::as_array_mut) {
        for child in content {
            normalize_formatting(child, depth + 1, count)?;
        }
    }
    Ok(())
}

fn normalize_mark(value: &Value) -> Option<Value> {
    let source = value.as_object()?;
    let kind = source.get("type")?.as_str()?;
    let mut attrs = source
        .get("attrs")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if matches!(kind, "textStyle" | "highlight") {
        if let Some(color) = attrs.get_mut("color") {
            if !color.is_null() {
                *color = Value::String(normalize_color(color.as_str()?)?);
            }
        }
        if kind == "textStyle" && attrs.get("color").is_none_or(Value::is_null) {
            return None;
        }
    }
    attrs.retain(|key, value| valid_mark_attribute(kind, key, value));
    let mut mark = Map::new();
    mark.insert("type".into(), Value::String(kind.into()));
    if !attrs.is_empty() {
        mark.insert("attrs".into(), Value::Object(attrs));
    }
    let mark = Value::Object(mark);
    validate_mark(&mark).ok()?;
    Some(mark)
}

fn normalize_color(value: &str) -> Option<String> {
    if super::valid_color(value) {
        return Some(value.into());
    }
    let lower = value.to_ascii_lowercase();
    let (body, alpha) = if let Some(body) = lower.strip_prefix("rgba(") {
        (body.strip_suffix(')')?, true)
    } else {
        (lower.strip_prefix("rgb(")?.strip_suffix(')')?, false)
    };
    let channels = body.split(',').map(str::trim).collect::<Vec<_>>();
    if channels.len() != if alpha { 4 } else { 3 } {
        return None;
    }
    if alpha {
        let alpha = channels[3];
        if alpha != "1"
            && !(alpha.starts_with("1.")
                && alpha.len() > 2
                && alpha[2..].bytes().all(|byte| byte == b'0'))
        {
            return None;
        }
    }
    let channel = |raw: &str| -> Option<u8> {
        if raw.is_empty() || !raw.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        raw.parse::<u8>().ok()
    };
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channel(channels[0])?,
        channel(channels[1])?,
        channel(channels[2])?
    ))
}

#[cfg(test)]
mod tests;
