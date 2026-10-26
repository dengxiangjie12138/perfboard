//! Offline PDF rendering in an isolated, hidden WebView2. It has no IPC capabilities,
//! no scripts or network resources, and never mounts the application/editor.
use crate::{log_resources, repository::AppResult, tool_windows, transformer_ipc, AppState};
use std::{fs, path::Path};
use tauri::Manager;

const MAX_HTML_BYTES: usize = 128 * 1024 * 1024;
fn print_document(body: &str) -> AppResult<String> {
    if body.is_empty() || body.len() > MAX_HTML_BYTES {
        return Err("导出内容为空或超过 128 MiB，请将日志拆分后导出".into());
    }
    Ok(format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\
         <meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; form-action 'none'; base-uri 'none'\">\
         <title>开发日志</title><style>{}</style></head><body>{body}</body></html>",
        include_str!("../../src/features/dev-logs/pdf-export.css")
    ))
}

#[tauri::command]
pub async fn dev_log_export_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    repository_key: String,
    path: String,
    body: String,
) -> AppResult<()> {
    tool_windows::require_main_or_page(&window, "dev-logs")?;
    let repository = {
        let state = app.state::<AppState>();
        let mut manager = state.repository.lock().map_err(|_| "仓库暂不可用")?;
        let repo = manager.ready()?;
        repo.ensure_available()?;
        if log_resources::repository_key(&repo.root)? != repository_key {
            return Err("仓库已切换，请回到原日志后重试导出".into());
        }
        repo.root.clone()
    };
    let html = print_document(&body)?;
    tauri::async_runtime::spawn_blocking(move || {
        let temporary = tempfile::Builder::new()
            .prefix("perfboard-log-pdf-")
            .tempdir()
            .map_err(|e| format!("无法创建导出临时目录：{e}"))?;
        let source = temporary.path().join("document.html");
        let output = temporary.path().join("document.pdf");
        fs::write(&source, html).map_err(|e| format!("无法准备导出页面：{e}"))?;
        render_pdf(&app, &source, &output)?;
        let bytes = fs::read(output).map_err(|e| format!("无法读取生成的 PDF：{e}"))?;
        // Use the existing validated, atomic export writer. The chosen file is replaced
        // only after PDF generation succeeds; repository files remain protected.
        transformer_ipc::write_export(&repository, &path, "pdf", &bytes)
    })
    .await
    .map_err(|e| format!("导出 PDF 失败：{e}"))?
}

#[cfg(target_os = "windows")]
fn render_pdf(app: &tauri::AppHandle, source: &Path, output: &Path) -> AppResult<()> {
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;
    use tauri::{webview::PageLoadEvent, WebviewUrl, WebviewWindowBuilder};
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, PrintToPdfCompletedHandler};
    use windows::core::{Interface, HSTRING};

    type Completion = Arc<Mutex<Option<mpsc::Sender<AppResult<()>>>>>;
    fn complete(sender: &Completion, result: AppResult<()>) {
        if let Ok(mut sender) = sender.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.send(result);
            }
        }
    }
    let url = url::Url::from_file_path(source).map_err(|_| "导出临时路径无效")?;
    let navigation_url = url.clone();
    let loaded_url = url.clone();
    let output = output.to_owned();
    let (sender, receiver) = mpsc::channel();
    let completion: Completion = Arc::new(Mutex::new(Some(sender)));
    let window = WebviewWindowBuilder::new(
        app,
        format!("log-pdf-{}", uuid::Uuid::new_v4()),
        WebviewUrl::External(url),
    )
    .title("开发日志 PDF 导出")
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .inner_size(800.0, 1100.0)
    .on_navigation(move |url| url == &navigation_url)
    .on_page_load(move |window, payload| {
        if payload.event() != PageLoadEvent::Finished || payload.url() != &loaded_url {
            return;
        }
        // The load event waits for all embedded images. Only installed system fonts
        // are used, so there are no asynchronous web fonts or lazy resources.
        let callback_sender = completion.clone();
        let error_sender = completion.clone();
        let output = output.clone();
        let result = window.with_webview(move |webview| {
            let started = (|| -> windows::core::Result<()> {
                unsafe {
                    let environment = webview.environment().cast::<ICoreWebView2Environment6>()?;
                    let settings = environment.CreatePrintSettings()?;
                    settings.SetPageWidth(210.0 / 25.4)?;
                    settings.SetPageHeight(297.0 / 25.4)?;
                    // CSS @page supplies the margins.
                    settings.SetMarginTop(0.0)?;
                    settings.SetMarginBottom(0.0)?;
                    settings.SetMarginLeft(0.0)?;
                    settings.SetMarginRight(0.0)?;
                    settings.SetShouldPrintBackgrounds(true)?;
                    settings.SetShouldPrintHeaderAndFooter(false)?;
                    let webview = webview
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_7>()?;
                    let sender = callback_sender.clone();
                    let handler =
                        PrintToPdfCompletedHandler::create(Box::new(move |result, succeeded| {
                            complete(
                                &sender,
                                result
                                    .map_err(|e| format!("生成 PDF 失败：{e}"))
                                    .and_then(|_| {
                                        if succeeded {
                                            Ok(())
                                        } else {
                                            Err("生成 PDF 失败，请重试".into())
                                        }
                                    }),
                            );
                            Ok(())
                        }));
                    webview.PrintToPdf(&HSTRING::from(output.as_os_str()), &settings, &handler)?;
                    Ok(())
                }
            })();
            if let Err(error) = started {
                complete(
                    &callback_sender,
                    Err(format!("无法启动 PDF 导出，请检查 WebView2：{error}")),
                );
            }
        });
        if let Err(error) = result {
            complete(&error_sender, Err(error.to_string()));
        }
    })
    .build()
    .map_err(|e| format!("无法创建 PDF 导出视图：{e}"))?;
    let result = receiver
        .recv_timeout(Duration::from_secs(90))
        .map_err(|_| "PDF 导出超时，请检查图片大小后重试".to_owned())
        .and_then(|value| value);
    // destroy bypasses application close/save prompts for this private renderer.
    let destroyed = window
        .destroy()
        .map_err(|e| format!("无法关闭导出视图：{e}"));
    result.and(destroyed)
}

#[cfg(not(target_os = "windows"))]
fn render_pdf(_app: &tauri::AppHandle, _source: &Path, _output: &Path) -> AppResult<()> {
    Err("本地 PDF 导出目前支持 Windows 桌面版".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolated_print_document_blocks_scripts_and_network_and_uses_a4() {
        let html = print_document("<article>中文日志</article>").unwrap();
        assert!(html.contains("lang=\"zh-CN\""));
        assert!(html.contains("script-src 'none'"));
        assert!(html.contains("default-src 'none'; img-src data:"));
        assert!(html.contains("size: A4 portrait"));
        assert!(html.contains("中文日志"));
        assert!(print_document("").is_err());
    }
}
