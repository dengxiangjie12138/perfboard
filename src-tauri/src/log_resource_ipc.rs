//! Native-only resource transport. Bulk bytes never pass through document snapshots.
use crate::{
    log_resources::{self as resources, ResourceContext, ResourceMetadata},
    repository::{AppResult, Repository},
    tool_windows, AppState,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Manager,
};

fn with_resource<T>(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    context: &ResourceContext,
    writing: bool,
    operation: impl FnOnce(&Repository) -> AppResult<T>,
) -> AppResult<T> {
    tool_windows::require_main_or_page(window, "dev-logs")?;
    let state = app.state::<AppState>();
    // Lease -> repository is the same order used by the existing log writer and repo switch.
    let lease = if writing {
        Some(
            state
                .edit_leases
                .assert_can_write(&format!("log:{}", context.page_id), window.label())?,
        )
    } else {
        None
    };
    let mut manager = crate::lock(&state)?;
    let repo = manager.ready()?;
    resources::check_context(&repo.root, repo.connection(), context, writing)?;
    let result = operation(repo);
    drop(manager);
    drop(lease);
    result
}

fn worker_error(error: impl std::fmt::Display) -> String {
    format!("日志资源操作失败：{error}")
}

#[tauri::command]
pub async fn log_resource_import_path(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    context: ResourceContext,
    source_path: String,
) -> AppResult<ResourceMetadata> {
    tauri::async_runtime::spawn_blocking(move || {
        // Check before disk I/O, then check again after reading in case the user switched pages.
        with_resource(&app, &window, &context, true, |_| Ok(()))?;
        let (name, bytes) = resources::read_source(&source_path)?;
        with_resource(&app, &window, &context, true, |repo| {
            resources::import_bytes(repo.connection(), &context.page_id, &name, "", &bytes)
        })
    })
    .await
    .map_err(worker_error)?
}

fn decode_component(raw: &str) -> AppResult<String> {
    let source = raw.as_bytes();
    let mut bytes = Vec::with_capacity(source.len());
    let mut index = 0;
    while index < source.len() {
        if source[index] == b'%' {
            let pair = source.get(index + 1..index + 3).ok_or("资源请求编码无效")?;
            let high = (pair[0] as char).to_digit(16).ok_or("资源请求编码无效")?;
            let low = (pair[1] as char).to_digit(16).ok_or("资源请求编码无效")?;
            bytes.push((high * 16 + low) as u8);
            index += 3;
        } else {
            bytes.push(source[index]);
            index += 1;
        }
    }
    String::from_utf8(bytes).map_err(|_| "资源请求不是有效 UTF-8".into())
}

fn header(request: &Request<'_>, name: &str) -> AppResult<String> {
    let value = request
        .headers()
        .get(name)
        .ok_or("资源请求缺少必要信息")?
        .to_str()
        .map_err(|_| "资源请求信息无效")?;
    if value.len() > 16_384 {
        return Err("资源请求信息过长".into());
    }
    decode_component(value)
}

#[tauri::command]
pub async fn log_resource_import_bytes(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request<'_>,
) -> AppResult<ResourceMetadata> {
    let context: ResourceContext = serde_json::from_str(&header(&request, "x-log-context")?)
        .map_err(|_| "资源请求的日志上下文无效")?;
    let name = header(&request, "x-file-name")?;
    let mime = request
        .headers()
        .get("x-file-mime")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if mime.len() > 256 || mime.chars().any(char::is_control) {
        return Err("资源 MIME 信息无效".into());
    }
    let mime = mime.to_owned();
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) if bytes.len() <= resources::MAX_RESOURCE_BYTES => bytes.clone(),
        InvokeBody::Raw(_) => return Err("单个图片或文件不能超过 20 MiB".into()),
        _ => return Err("请以二进制方式导入图片或文件".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        with_resource(&app, &window, &context, true, |repo| {
            resources::import_bytes(repo.connection(), &context.page_id, &name, &mime, &bytes)
        })
    })
    .await
    .map_err(worker_error)?
}

#[tauri::command]
pub async fn log_resource_clone(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    context: ResourceContext,
    resource_id: String,
) -> AppResult<ResourceMetadata> {
    tauri::async_runtime::spawn_blocking(move || {
        with_resource(&app, &window, &context, true, |repo| {
            resources::clone_to_page(repo.connection(), &context.page_id, &resource_id)
        })
    })
    .await
    .map_err(worker_error)?
}

#[tauri::command]
pub async fn log_resource_metadata(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    context: ResourceContext,
    resource_ids: Vec<String>,
) -> AppResult<Vec<ResourceMetadata>> {
    if resource_ids.len() > 512 {
        return Err("一次最多读取 512 个资源信息".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_resource(&app, &window, &context, false, |repo| {
            resource_ids
                .iter()
                .map(|id| resources::owned_metadata(repo.connection(), &context.page_id, id))
                .collect()
        })
    })
    .await
    .map_err(worker_error)?
}

#[tauri::command]
pub async fn log_resource_read(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    context: ResourceContext,
    resource_id: String,
) -> AppResult<Response> {
    tauri::async_runtime::spawn_blocking(move || {
        with_resource(&app, &window, &context, false, |repo| {
            resources::read(repo.connection(), &context.page_id, &resource_id).map(Response::new)
        })
    })
    .await
    .map_err(worker_error)?
}

#[tauri::command]
pub async fn log_resource_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    context: ResourceContext,
    resource_id: String,
    destination: String,
) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, bytes) = with_resource(&app, &window, &context, false, |repo| {
            let bytes = resources::read(repo.connection(), &context.page_id, &resource_id)?;
            Ok((repo.root.clone(), bytes))
        })?;
        resources::export_bytes(&root, &destination, &bytes)
    })
    .await
    .map_err(worker_error)?
}

#[tauri::command]
pub async fn log_resource_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    context: ResourceContext,
    resource_id: String,
) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let cache = app.path().app_cache_dir().map_err(worker_error)?;
        let (root, item, bytes) = with_resource(&app, &window, &context, false, |repo| {
            let item =
                resources::owned_metadata(repo.connection(), &context.page_id, &resource_id)?;
            let bytes = resources::read(repo.connection(), &context.page_id, &resource_id)?;
            Ok((repo.root.clone(), item, bytes))
        })?;
        let target = resources::cache_for_open(&cache, &root, &item, &bytes)?;
        open::that_detached(target).map_err(|error| format!("无法打开资源，请尝试另存为：{error}"))
    })
    .await
    .map_err(worker_error)?
}

#[cfg(test)]
mod tests {
    #[test]
    fn raw_header_decoding_keeps_unicode_and_rejects_malformed_input() {
        assert_eq!(
            super::decode_component("%E6%97%A5%E5%BF%97%20a%2Bb").unwrap(),
            "日志 a+b"
        );
        assert!(super::decode_component("%x1").is_err());
        assert!(super::decode_component("%f").is_err());
        assert!(super::decode_component("%ff").is_err());
    }
}
