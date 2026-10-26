use crate::repository::AppResult;

const PWM_PARTS: &[&str] = &[
    "UCC28C40", "UCC28C41", "UCC28C42", "UCC28C43", "UCC28C44", "UCC28C45", "UCC38C40", "UCC38C41",
    "UCC38C42", "UCC38C43", "UCC38C44", "UCC38C45", "UC3841", "UC3842", "UC3843", "UC3844",
    "UC3845",
];

fn reference_url(tool_id: &str, raw: &str) -> AppResult<url::Url> {
    let parsed = url::Url::parse(raw).map_err(|_| "Invalid reference URL")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("www.ti.com.cn")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Only official TI reference links are supported".into());
    }
    let path = parsed.path();
    let allowed = match tool_id {
        "tl431" => matches!(path, "/cn/lit/gpn/TL431" | "/product/cn/TL431"),
        "uc28-38xx" => PWM_PARTS.iter().any(|part| {
            path == format!("/cn/lit/gpn/{part}") || path == format!("/product/cn/{part}")
        }),
        "pmos-switch" => path == "/cn/lit/pdf/ZHCAEO9",
        _ => false,
    };
    if !allowed {
        return Err("Unsupported reference for this calculator".into());
    }
    Ok(parsed)
}

#[tauri::command]
pub fn hardware_reference_open(
    window: tauri::WebviewWindow,
    tool_id: String,
    url: String,
) -> AppResult<()> {
    let target = reference_url(&tool_id, &url)?;
    crate::tool_windows::require_main_or_tool(&window, &tool_id)?;
    open::that_detached(target.as_str()).map_err(|e| format!("Could not open TI reference: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supports_every_selected_controller_and_its_chinese_product_page() {
        for part in PWM_PARTS {
            for path in [format!("/cn/lit/gpn/{part}"), format!("/product/cn/{part}")] {
                assert!(
                    reference_url("uc28-38xx", &format!("https://www.ti.com.cn{path}")).is_ok()
                );
            }
        }
        assert!(reference_url("tl431", "https://www.ti.com.cn/cn/lit/gpn/TL431").is_ok());
        assert!(reference_url("pmos-switch", "https://www.ti.com.cn/cn/lit/pdf/ZHCAEO9").is_ok());
    }
    #[test]
    fn rejects_cross_tool_links_and_unknown_parts() {
        for (tool, url) in [
            ("tl431", "https://www.ti.com.cn/cn/lit/gpn/UC3842"),
            ("uc28-38xx", "https://www.ti.com.cn/cn/lit/gpn/UC3846"),
            ("pullup-divider", "https://www.ti.com.cn/cn/lit/gpn/TL431"),
        ] {
            assert!(reference_url(tool, url).is_err());
        }
    }
    #[test]
    fn rejects_non_reference_urls_and_injected_url_components() {
        for url in [
            "http://www.ti.com.cn/cn/lit/gpn/TL431",
            "https://www.ti.com.cn.evil.test/cn/lit/gpn/TL431",
            "https://user:pass@www.ti.com.cn/cn/lit/gpn/TL431",
            "https://www.ti.com.cn:444/cn/lit/gpn/TL431",
            "https://www.ti.com.cn/cn/lit/gpn/TL431?token=secret",
            "https://www.ti.com.cn/cn/lit/gpn/TL431#other",
            "https://www.ti.com.cn/account",
            "file:///D:/private.txt",
        ] {
            assert!(reference_url("tl431", url).is_err());
        }
    }
}
