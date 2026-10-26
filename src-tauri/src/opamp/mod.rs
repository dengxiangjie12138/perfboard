use crate::repository::AppResult;

fn reference_url(raw: &str) -> AppResult<url::Url> {
    let parsed = url::Url::parse(raw).map_err(|_| "Invalid reference URL")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("www.ti.com.cn")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Only TI Chinese circuit references are supported".into());
    }
    let path = parsed.path();
    let document = path.strip_prefix("/cn/lit/pdf/").is_some_and(|id| {
        id.starts_with("ZH") && id.len() <= 24 && id.bytes().all(|c| c.is_ascii_alphanumeric())
    });
    let circuit = path.strip_prefix("/tool/cn/CIRCUIT").is_some_and(|id| {
        !id.is_empty() && id.len() <= 12 && id.bytes().all(|c| c.is_ascii_digit())
    });
    if !document && !circuit && path != "/zh-cn/design-development/analog-circuits.html" {
        return Err("Unsupported TI circuit reference path".into());
    }
    Ok(parsed)
}

#[tauri::command]
pub fn opamp_reference_open(window: tauri::WebviewWindow, url: String) -> AppResult<()> {
    crate::tool_windows::require_main_or_tool(&window, "opamp")?;
    open::that_detached(reference_url(&url)?.as_str())
        .map_err(|e| format!("Could not open circuit reference: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_chinese_documents_design_pages_and_library() {
        for raw in [
            "https://www.ti.com.cn/cn/lit/pdf/ZHCA755",
            "https://www.ti.com.cn/cn/lit/pdf/ZHCA759",
            "https://www.ti.com.cn/cn/lit/pdf/ZHDA138",
            "https://www.ti.com.cn/tool/cn/CIRCUIT060076",
            "https://www.ti.com.cn/zh-cn/design-development/analog-circuits.html",
        ] {
            assert!(reference_url(raw).is_ok(), "{raw}");
        }
    }

    #[test]
    fn refuses_other_hosts_protocols_and_non_reference_paths() {
        for raw in [
            "http://www.ti.com.cn/cn/lit/pdf/ZHCA755",
            "https://www.ti.com/cn/lit/pdf/ZHCA755",
            "https://www.ti.com.cn.evil.test/cn/lit/pdf/ZHCA755",
            "https://www.ti.com.cn/account",
            "file:///D:/secret.txt",
            "https://www.ti.com.cn/tool/cn/CIRCUITbad",
            "https://www.ti.com.cn/cn/lit/pdf/../account",
        ] {
            assert!(reference_url(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn refuses_url_credentials_ports_queries_and_fragments() {
        for raw in [
            "https://user:password@www.ti.com.cn/cn/lit/pdf/ZHCA755",
            "https://www.ti.com.cn:444/cn/lit/pdf/ZHCA755",
            "https://www.ti.com.cn/cn/lit/pdf/ZHCA755?token=private",
            "https://www.ti.com.cn/cn/lit/pdf/ZHCA755#other",
        ] {
            assert!(reference_url(raw).is_err(), "{raw}");
        }
    }
}
