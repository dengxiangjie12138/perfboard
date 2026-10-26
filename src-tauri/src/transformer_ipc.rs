use crate::{repository::AppResult, tool_windows, transformer_designs as designs, AppState};
use std::{fs, io::Write, path::Path};
use tauri::{Emitter, State};

fn changed(app: &tauri::AppHandle, ok: bool) {
    if ok {
        let _ = app.emit("perfboard:data-changed", "transformer-designs");
    }
}
#[tauri::command]
pub fn transformer_design_list(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<designs::TransformerDesignSummary>> {
    tool_windows::require_main_or_tool(&window, "transformer-design")?;
    let mut manager = crate::lock(&state)?;
    let repo = manager.ready()?;
    repo.ensure_available()?;
    designs::list(repo.connection())
}
#[tauri::command]
pub fn transformer_design_get(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<designs::TransformerDesign> {
    tool_windows::require_main_or_tool(&window, "transformer-design")?;
    let mut manager = crate::lock(&state)?;
    let repo = manager.ready()?;
    repo.ensure_available()?;
    designs::get(repo.connection(), &id)
}
#[tauri::command]
pub fn transformer_design_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: designs::DesignSaveInput,
) -> AppResult<designs::TransformerDesign> {
    tool_windows::require_main_or_tool(&window, "transformer-design")?;
    let result = {
        let mut manager = crate::lock(&state)?;
        let repo = manager.ready()?;
        repo.ensure_available()?;
        designs::save(repo.connection_mut(), input)
    };
    changed(&app, result.is_ok());
    result
}
#[tauri::command]
pub fn transformer_design_delete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: designs::DesignRevisionInput,
) -> AppResult<()> {
    tool_windows::require_main_or_tool(&window, "transformer-design")?;
    let result = {
        let mut manager = crate::lock(&state)?;
        let repo = manager.ready()?;
        repo.ensure_available()?;
        designs::delete(repo.connection_mut(), input)
    };
    changed(&app, result.is_ok());
    result
}
#[tauri::command]
pub fn transformer_design_import_preview(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    source_path: String,
) -> AppResult<designs::ImportPreview> {
    tool_windows::require_main_or_tool(&window, "transformer-design")?;
    let mut manager = crate::lock(&state)?;
    let repo = manager.ready()?;
    repo.ensure_available()?;
    let mut previews = state
        .transformer_imports
        .lock()
        .map_err(|_| "导入预览暂不可用")?;
    designs::preview_import(&mut previews, &repo.root.to_string_lossy(), &source_path)
}
#[tauri::command]
pub fn transformer_design_import_confirm(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: designs::ImportConfirmInput,
) -> AppResult<designs::TransformerDesign> {
    tool_windows::require_main_or_tool(&window, "transformer-design")?;
    let result = {
        let mut manager = crate::lock(&state)?;
        let repo = manager.ready()?;
        repo.ensure_available()?;
        let root = repo.root.to_string_lossy().into_owned();
        let mut previews = state
            .transformer_imports
            .lock()
            .map_err(|_| "导入预览暂不可用")?;
        designs::confirm_import(repo.connection_mut(), &mut previews, &root, input)
    };
    changed(&app, result.is_ok());
    result
}
#[tauri::command]
pub fn transformer_design_export_json(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<String> {
    tool_windows::require_main_or_tool(&window, "transformer-design")?;
    let mut manager = crate::lock(&state)?;
    let repo = manager.ready()?;
    repo.ensure_available()?;
    designs::export_json(repo.connection(), &id)
}
pub(crate) fn write_export(
    repository: &Path,
    path: &str,
    kind: &str,
    bytes: &[u8],
) -> AppResult<()> {
    if !matches!(kind, "pdf" | "json" | "svg") || bytes.is_empty() || bytes.len() > 24 * 1024 * 1024
    {
        return Err("导出类型或大小无效".into());
    }
    if kind == "pdf" && !bytes.starts_with(b"%PDF-") {
        return Err("PDF 内容无效".into());
    }
    if kind == "svg" {
        let svg = std::str::from_utf8(bytes)
            .map_err(|_| "SVG编码无效")?
            .trim();
        let lower = svg.to_ascii_lowercase();
        if !svg.starts_with("<svg ")
            || !svg.ends_with("</svg>")
            || [
                "<script",
                "<foreignobject",
                " href=",
                " xlink:href=",
                " onload=",
                " onclick=",
                "<image",
                "url(",
            ]
            .iter()
            .any(|v| lower.contains(v))
        {
            return Err("SVG内容无效或包含外部资源".into());
        }
    }
    if kind == "json" {
        let document: designs::TransformerDesignDocument =
            serde_json::from_slice(bytes).map_err(|_| "设计 JSON 格式无效")?;
        designs::validate_document(&document)?;
    }
    let requested = Path::new(path);
    if !requested.is_absolute()
        || requested
            .extension()
            .and_then(|v| v.to_str())
            .is_none_or(|v| !v.eq_ignore_ascii_case(kind))
    {
        return Err("请选择相应扩展名的本机导出文件".into());
    }
    let parent = requested
        .parent()
        .ok_or("导出目录无效")?
        .canonicalize()
        .map_err(|e| format!("导出目录不可用: {e}"))?;
    let name = requested.file_name().ok_or("导出文件名无效")?;
    let target = parent.join(name);
    let repository = repository.canonicalize().map_err(|e| e.to_string())?;
    if target.starts_with(&repository)
        || (target.exists()
            && target
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(&repository))
    {
        return Err("请导出到资料仓库之外，保护数据库与附件".into());
    }
    if target.exists()
        && (!target.is_file()
            || fs::symlink_metadata(&target)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink())
    {
        return Err("导出目标必须是普通文件".into());
    }
    let temporary = parent.join(format!(".perfboard-export-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> AppResult<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        replace_export(&temporary, &target).map_err(|e| format!("无法保存导出文件: {e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
#[cfg(target_os = "windows")]
fn replace_export(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0x1 | 0x8) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(target_os = "windows"))]
fn replace_export(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}
#[tauri::command]
pub fn transformer_export_write(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    path: String,
    kind: String,
    bytes: Vec<u8>,
) -> AppResult<()> {
    tool_windows::require_main_or_tool(&window, "transformer-design")?;
    let mut manager = crate::lock(&state)?;
    let repo = manager.ready()?;
    repo.ensure_available()?;
    write_export(&repo.root, &path, &kind, &bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_keep_repository_and_failed_target_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repository");
        fs::create_dir(&repo).unwrap();
        let inside = repo.join("original.pdf");
        fs::write(&inside, b"original").unwrap();
        assert!(write_export(&repo, inside.to_str().unwrap(), "pdf", b"%PDF-valid").is_err());
        assert_eq!(fs::read(&inside).unwrap(), b"original");
        let outside = temp.path().join("drawing.pdf");
        fs::write(&outside, b"old").unwrap();
        assert!(write_export(&repo, outside.to_str().unwrap(), "pdf", b"bad").is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"old");
        write_export(&repo, outside.to_str().unwrap(), "pdf", b"%PDF-export").unwrap();
        assert_eq!(fs::read(&outside).unwrap(), b"%PDF-export");
    }
}

#[cfg(test)]
mod sheet_export_tests {
    use super::*;
    #[test]
    fn svg_export_uses_normal_user_selected_file_and_rejects_active_content() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).unwrap();
        let path = temp.path().join("drawing.svg");
        write_export(
            &repo,
            path.to_str().unwrap(),
            "svg",
            br#"<svg xmlns="http://www.w3.org/2000/svg"><text>BOBBIN</text></svg>"#,
        )
        .unwrap();
        let before = fs::read(&path).unwrap();
        assert!(write_export(
            &repo,
            path.to_str().unwrap(),
            "svg",
            br#"<svg xmlns="http://www.w3.org/2000/svg"><script>bad</script></svg>"#
        )
        .is_err());
        assert_eq!(fs::read(path).unwrap(), before);
    }
}
