//! Immutable, page-owned resources. Documents and history contain IDs, never file bytes.
use crate::{dev_logs, repository::AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use uuid::Uuid;

pub const MAX_RESOURCE_BYTES: usize = 20 * 1024 * 1024;
const COLUMNS: &str = "id,page_id,name,mime,size,sha256,is_image";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceContext {
    pub repository_key: String,
    pub page_id: String,
    pub expected_revision: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMetadata {
    pub id: String,
    pub page_id: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub sha256: String,
    pub is_image: bool,
}

pub fn create_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS dev_log_resources (
         id TEXT PRIMARY KEY NOT NULL,
         page_id TEXT NOT NULL REFERENCES dev_log_pages(id) ON DELETE CASCADE,
         name TEXT NOT NULL,mime TEXT NOT NULL,
         size INTEGER NOT NULL CHECK(size>=0 AND size<=20971520),
         sha256 TEXT NOT NULL,is_image INTEGER NOT NULL CHECK(is_image IN(0,1)),
         data BLOB NOT NULL CHECK(length(data)=size));
         CREATE INDEX IF NOT EXISTS dev_log_resources_page ON dev_log_resources(page_id);",
    )
    .map_err(|error| error.to_string())
}

pub fn validate_schema(conn: &Connection) -> AppResult<()> {
    conn.prepare(
        "SELECT id,page_id,name,mime,size,sha256,is_image,data FROM dev_log_resources LIMIT 0",
    )
    .map(|_| ())
    .map_err(|error| error.to_string())
}

pub fn repository_key(root: &Path) -> AppResult<String> {
    let value = root.to_str().ok_or("仓库路径不是有效 Unicode")?;
    #[cfg(windows)]
    let value = if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(value).to_owned()
    }
    .replace('\\', "/");
    #[cfg(not(windows))]
    let value = value.to_owned();
    Ok(value)
}

pub fn check_context(
    root: &Path,
    conn: &Connection,
    context: &ResourceContext,
    writing: bool,
) -> AppResult<()> {
    if repository_key(root)? != context.repository_key {
        return Err("仓库已切换，请回到原日志后重试".into());
    }
    let page = dev_logs::get_page(conn, &context.page_id)?;
    if writing {
        let project = dev_logs::get_project(conn, &page.project_id)?;
        if page.deleted_at.is_some() || project.deleted_at.is_some() {
            return Err("已删除的日志不能导入资源，请先恢复".into());
        }
        if page.revision != context.expected_revision {
            return Err("日志已更新，请保存或刷新后重新导入；原文件未修改".into());
        }
    }
    Ok(())
}

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResourceMetadata> {
    Ok(ResourceMetadata {
        id: row.get(0)?,
        page_id: row.get(1)?,
        name: row.get(2)?,
        mime: row.get(3)?,
        size: row.get::<_, i64>(4)? as u64,
        sha256: row.get(5)?,
        is_image: row.get(6)?,
    })
}

pub fn metadata(conn: &Connection, id: &str) -> AppResult<ResourceMetadata> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM dev_log_resources WHERE id=?1"),
        [id],
        row,
    )
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "日志资源不存在或已经永久删除".into())
}

pub fn owned_metadata(conn: &Connection, page_id: &str, id: &str) -> AppResult<ResourceMetadata> {
    let item = metadata(conn, id)?;
    if item.page_id != page_id {
        return Err("资源属于其他日志，请通过复制粘贴导入当前页面".into());
    }
    Ok(item)
}

pub fn read(conn: &Connection, page_id: &str, id: &str) -> AppResult<Vec<u8>> {
    let item = owned_metadata(conn, page_id, id)?;
    let bytes: Vec<u8> = conn
        .query_row(
            "SELECT data FROM dev_log_resources WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 != item.size || digest(&bytes) != item.sha256 {
        return Err("资源内容校验失败，请保留仓库并从完整备份恢复".into());
    }
    Ok(bytes)
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn checked_name(name: &str) -> AppResult<String> {
    let value = name.trim();
    if value.is_empty()
        || value.len() > 1024
        || value
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '/' | '\\'))
        || matches!(value, "." | "..")
    {
        return Err("文件名无效".into());
    }
    Ok(value.into())
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    let (mime, width, height) = if bytes.len() >= 24
        && bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        && &bytes[12..16] == b"IHDR"
    {
        (
            "image/png",
            u32::from_be_bytes(bytes[16..20].try_into().ok()?),
            u32::from_be_bytes(bytes[20..24].try_into().ok()?),
        )
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        let (width, height) = jpeg_dimensions(bytes)?;
        ("image/jpeg", width, height)
    } else if bytes.len() >= 10 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        (
            "image/gif",
            u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32,
            u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32,
        )
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        let (width, height) = webp_dimensions(bytes)?;
        ("image/webp", width, height)
    } else {
        return None;
    };
    // Bounds are checked before a WebView decoder allocates a full pixel buffer.
    (width > 0
        && height > 0
        && width <= 16_384
        && height <= 16_384
        && u64::from(width) * u64::from(height) <= 40_000_000)
        .then_some(mime)
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut cursor = 2;
    while cursor + 3 < bytes.len() {
        if bytes[cursor] != 0xff {
            return None;
        }
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        if matches!(marker, 0xd8 | 0x01 | 0xd0..=0xd7) {
            continue;
        }
        if matches!(marker, 0xd9 | 0xda) {
            return None;
        }
        let length = u16::from_be_bytes(bytes.get(cursor..cursor + 2)?.try_into().ok()?) as usize;
        if length < 2 || cursor.checked_add(length)? > bytes.len() {
            return None;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            if length < 7 {
                return None;
            }
            let height = u16::from_be_bytes(bytes[cursor + 3..cursor + 5].try_into().ok()?) as u32;
            let width = u16::from_be_bytes(bytes[cursor + 5..cursor + 7].try_into().ok()?) as u32;
            return Some((width, height));
        }
        cursor += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let tag = bytes.get(12..16)?;
    let u24 =
        |data: &[u8]| u32::from(data[0]) | (u32::from(data[1]) << 8) | (u32::from(data[2]) << 16);
    if tag == b"VP8X" {
        Some((u24(bytes.get(24..27)?) + 1, u24(bytes.get(27..30)?) + 1))
    } else if tag == b"VP8 " && bytes.get(23..26)? == b"\x9d\x01\x2a" {
        Some((
            u32::from(u16::from_le_bytes(bytes.get(26..28)?.try_into().ok()?) & 0x3fff),
            u32::from(u16::from_le_bytes(bytes.get(28..30)?.try_into().ok()?) & 0x3fff),
        ))
    } else if tag == b"VP8L" && *bytes.get(20)? == 0x2f {
        let bits = u32::from_le_bytes(bytes.get(21..25)?.try_into().ok()?);
        Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
    } else {
        None
    }
}

pub fn import_bytes(
    conn: &Connection,
    page_id: &str,
    name: &str,
    _claimed_mime: &str,
    bytes: &[u8],
) -> AppResult<ResourceMetadata> {
    if bytes.len() > MAX_RESOURCE_BYTES {
        return Err("单个图片或文件不能超过 20 MiB".into());
    }
    let name = checked_name(name)?;
    let image = image_mime(bytes);
    let mime = image.map(str::to_owned).unwrap_or_else(|| {
        let guessed = mime_guess::from_path(&name)
            .first_or_octet_stream()
            .to_string();
        // Unknown/active image formats are stored as ordinary attachments.
        if guessed.starts_with("image/") {
            "application/octet-stream".into()
        } else {
            guessed
        }
    });
    let item = ResourceMetadata {
        id: Uuid::new_v4().to_string(),
        page_id: page_id.into(),
        name,
        mime,
        size: bytes.len() as u64,
        sha256: digest(bytes),
        is_image: image.is_some(),
    };
    conn.execute(
        "INSERT INTO dev_log_resources(id,page_id,name,mime,size,sha256,is_image,data)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            item.id,
            item.page_id,
            item.name,
            item.mime,
            item.size as i64,
            item.sha256,
            item.is_image,
            bytes
        ],
    )
    .map_err(|error| format!("保存日志资源失败：{error}"))?;
    Ok(item)
}

pub fn read_source(source: &str) -> AppResult<(String, Vec<u8>)> {
    let path = Path::new(source);
    if !path.is_absolute() {
        return Err("请选择本机文件".into());
    }
    let mut file = fs::File::open(path).map_err(|error| format!("无法读取文件：{error}"))?;
    let info = file.metadata().map_err(|error| error.to_string())?;
    if !info.is_file() || info.len() > MAX_RESOURCE_BYTES as u64 {
        return Err("请选择不超过 20 MiB 的普通文件".into());
    }
    let name = checked_name(
        path.file_name()
            .and_then(|name| name.to_str())
            .ok_or("文件名无效")?,
    )?;
    let mut bytes = Vec::with_capacity(info.len() as usize);
    Read::by_ref(&mut file)
        .take(MAX_RESOURCE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取文件：{error}"))?;
    if bytes.len() > MAX_RESOURCE_BYTES {
        return Err("文件读取期间超过 20 MiB，未导入".into());
    }
    Ok((name, bytes))
}

pub fn clone_to_page(
    conn: &Connection,
    page_id: &str,
    resource_id: &str,
) -> AppResult<ResourceMetadata> {
    let original = metadata(conn, resource_id)?;
    if original.page_id == page_id {
        return Ok(original);
    }
    let bytes = read(conn, &original.page_id, resource_id)?;
    import_bytes(conn, page_id, &original.name, &original.mime, &bytes)
}

/// All resources are immutable. Keep old resources until the owning page is permanently purged.
pub fn validate_document_resources(conn: &Connection, page_id: &str, json: &str) -> AppResult<()> {
    fn visit(conn: &Connection, page_id: &str, node: &serde_json::Value) -> AppResult<()> {
        if let Some(kind @ ("image" | "fileAttachment")) = node.get("type").and_then(|v| v.as_str())
        {
            let id = node
                .get("attrs")
                .and_then(|v| v.get("resourceId"))
                .and_then(|v| v.as_str())
                .ok_or("图片或文件缺少资源标识")?;
            let item = owned_metadata(conn, page_id, id)?;
            if kind == "image" && !item.is_image {
                return Err("此文件不能作为图片显示，请以文件附件插入".into());
            }
        }
        if let Some(children) = node.get("content").and_then(|v| v.as_array()) {
            for child in children {
                visit(conn, page_id, child)?;
            }
        }
        Ok(())
    }
    let node = serde_json::from_str(json).map_err(|_| "日志文档不是有效 JSON")?;
    visit(conn, page_id, &node)
}

/// Save via a sibling temporary file, then replace. Never write inside the live warehouse.
pub fn export_bytes(root: &Path, destination: &str, bytes: &[u8]) -> AppResult<()> {
    let requested = Path::new(destination);
    if !requested.is_absolute() {
        return Err("请选择完整的导出路径".into());
    }
    let parent = requested
        .parent()
        .ok_or("导出目录无效")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = parent.join(requested.file_name().ok_or("导出文件名无效")?);
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if target.starts_with(&root)
        || (target.exists()
            && target
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(&root))
    {
        return Err("请导出到仓库之外，避免覆盖数据库或附件".into());
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
    atomic_write(&target, bytes)
}

fn atomic_write(target: &Path, bytes: &[u8]) -> AppResult<()> {
    let temporary = target
        .parent()
        .ok_or("目标目录无效")?
        .join(format!(".perfboard-resource-{}.tmp", Uuid::new_v4()));
    let result = (|| -> AppResult<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        replace_file(&temporary, target).map_err(|e| format!("导出文件失败：{e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(source: *const u16, target: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0x1 | 0x8) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

pub fn cache_for_open(
    cache_root: &Path,
    repository: &Path,
    item: &ResourceMetadata,
    bytes: &[u8],
) -> AppResult<PathBuf> {
    let ext = Path::new(&item.name)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        ext.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "gif"
            | "pdf"
            | "txt"
            | "md"
            | "csv"
            | "json"
            | "log"
            | "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "odt"
            | "ods"
            | "odp"
    ) {
        return Err("此类型请先另存为，再用合适的程序打开".into());
    }
    Uuid::parse_str(&item.id).map_err(|_| "资源标识无效")?;
    fs::create_dir_all(cache_root).map_err(|e| e.to_string())?;
    let canonical_cache = cache_root.canonicalize().map_err(|e| e.to_string())?;
    let namespace = digest(repository_key(repository)?.as_bytes());
    let managed = create_cache_directory(&canonical_cache, "log-resources")?;
    let namespace = create_cache_directory(&managed, &namespace)?;
    cleanup_old_cache(&namespace, SystemTime::now());
    let resource = create_cache_directory(&namespace, &item.id)?;
    // Every open gets its own extraction. Never replace an external editor's working copy.
    let directory = create_cache_directory(&resource, &Uuid::new_v4().to_string())?;
    // Generated names avoid Windows reserved names, alternate streams and traversal.
    let target = directory.join(format!("resource.{ext}"));
    if target.exists()
        && fs::symlink_metadata(&target)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("缓存文件已被重定向".into());
    }
    atomic_write(&target, bytes)?;
    Ok(target)
}

fn ordinary(path: &Path, directory: bool) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    #[cfg(windows)]
    let redirected = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let redirected = metadata.file_type().is_symlink();
    !redirected && metadata.is_dir() == directory && (directory || metadata.is_file())
}

fn create_cache_directory(parent: &Path, name: &str) -> AppResult<PathBuf> {
    if !ordinary(parent, true) {
        return Err("缓存目录被重定向，无法打开资源".into());
    }
    let path = parent.join(name);
    match fs::create_dir(&path) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error.to_string()),
    }
    if !ordinary(&path, true) {
        return Err("缓存目录被重定向，无法打开资源".into());
    }
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if canonical.parent() != Some(parent) {
        return Err("缓存目录被重定向".into());
    }
    Ok(canonical)
}

/// Best-effort, bounded cleanup of recognizable extraction files older than seven days.
/// Never recurse through redirects, delete foreign files, or remove occupied working copies.
fn cleanup_old_cache(namespace: &Path, now: SystemTime) {
    if !ordinary(namespace, true) {
        return;
    }
    let Ok(resources) = fs::read_dir(namespace) else {
        return;
    };
    for resource in resources.take(128).flatten() {
        let resource = resource.path();
        if !ordinary(&resource, true)
            || resource
                .file_name()
                .and_then(|v| v.to_str())
                .is_none_or(|id| Uuid::parse_str(id).is_err())
        {
            continue;
        }
        let Ok(sessions) = fs::read_dir(&resource) else {
            continue;
        };
        for session in sessions.take(128).flatten() {
            let session = session.path();
            if !ordinary(&session, true)
                || session
                    .file_name()
                    .and_then(|v| v.to_str())
                    .is_none_or(|id| Uuid::parse_str(id).is_err())
            {
                continue;
            }
            let Ok(files) = fs::read_dir(&session) else {
                continue;
            };
            let entries = files.take(2).collect::<Result<Vec<_>, _>>();
            let Ok(entries) = entries else {
                continue;
            };
            if entries.len() != 1 {
                continue;
            }
            let path = entries[0].path();
            let known_name = path.file_stem().is_some_and(|name| name == "resource")
                && path
                    .extension()
                    .and_then(|v| v.to_str())
                    .is_some_and(|ext| {
                        matches!(
                            ext,
                            "png"
                                | "jpg"
                                | "jpeg"
                                | "webp"
                                | "gif"
                                | "pdf"
                                | "txt"
                                | "md"
                                | "csv"
                                | "json"
                                | "log"
                                | "doc"
                                | "docx"
                                | "xls"
                                | "xlsx"
                                | "ppt"
                                | "pptx"
                                | "odt"
                                | "ods"
                                | "odp"
                        )
                    });
            if !known_name || !ordinary(&path, false) {
                continue;
            }
            let old = fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age > Duration::from_secs(7 * 24 * 60 * 60));
            if old && fs::remove_file(&path).is_ok() {
                let _ = fs::remove_dir(&session);
            }
        }
        let _ = fs::remove_dir(&resource); // only succeeds if completely empty
    }
}

#[cfg(test)]
#[path = "log_resources_tests.rs"]
mod tests;
