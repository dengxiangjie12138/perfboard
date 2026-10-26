//! Read filesystem metadata for the current, canonical repository only.
//! No SQLite connection, checkpoint, file writes, or arbitrary caller path.
use crate::repository::{AppResult, Repository};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    fs::{self, Metadata},
    io::ErrorKind,
    path::Path,
};

const DATABASE_FILE: &str = "perfboard.sqlite3";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryStatistics {
    pub database_bytes: u64,
    pub wal_bytes: u64,
    pub attachments_bytes: u64,
    pub attachment_files: u64,
    pub measured_at: String,
}

pub fn statistics(repository: &Repository) -> AppResult<RepositoryStatistics> {
    measure_root(&repository.root)
}

fn is_redirect(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        // Reject all reparse points, including junctions and dangling redirects.
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(target_os = "windows"))]
    false
}

fn guarded_metadata(path: &Path, boundary: &Path) -> AppResult<Metadata> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if is_redirect(&metadata) {
        return Err("Repository statistics cannot follow redirected files or directories".into());
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if canonical != path || !canonical.starts_with(boundary) {
        return Err("Repository statistics path escaped or changed its canonical location".into());
    }
    Ok(metadata)
}

fn file_bytes(root: &Path, name: &str, optional: bool) -> AppResult<u64> {
    let path = root.join(name);
    match fs::symlink_metadata(&path) {
        Err(error) if optional && error.kind() == ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.to_string()),
        Ok(_) => {}
    }
    let metadata = guarded_metadata(&path, root)?;
    if !metadata.is_file() {
        return Err(format!("Repository {name} is not a regular file"));
    }
    Ok(metadata.len())
}

fn attachment_size(root: &Path) -> AppResult<(u64, u64)> {
    let attachment_root = root.join("attachments");
    match fs::symlink_metadata(&attachment_root) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok((0, 0)),
        Err(error) => return Err(error.to_string()),
        Ok(_) => {}
    }
    if !guarded_metadata(&attachment_root, root)?.is_dir() {
        return Err("Repository attachments is not a directory".into());
    }
    let mut directories = vec![attachment_root.clone()];
    let mut visited = BTreeSet::new();
    let (mut bytes, mut files) = (0u64, 0u64);
    while let Some(directory) = directories.pop() {
        if !guarded_metadata(&directory, &attachment_root)?.is_dir()
            || !visited.insert(directory.clone())
        {
            return Err("Repository attachment directory changed during statistics".into());
        }
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            let metadata = guarded_metadata(&path, &attachment_root)?;
            if metadata.is_dir() {
                directories.push(path);
            } else if metadata.is_file() {
                bytes = bytes
                    .checked_add(metadata.len())
                    .ok_or("Attachment size overflow")?;
                files = files
                    .checked_add(1)
                    .ok_or("Attachment file count overflow")?;
            } else {
                return Err("Repository attachment is not a regular file or directory".into());
            }
        }
    }
    // Recheck the root after traversal so a replaced junction is never accepted.
    guarded_metadata(&attachment_root, root)?;
    Ok((bytes, files))
}

fn measure_root(root: &Path) -> AppResult<RepositoryStatistics> {
    if !root.is_absolute() {
        return Err("Repository statistics requires an absolute canonical root".into());
    }
    if !guarded_metadata(root, root)?.is_dir() {
        return Err("Repository directory is unavailable".into());
    }
    let database_bytes = file_bytes(root, DATABASE_FILE, false)?;
    let wal_bytes = file_bytes(root, "perfboard.sqlite3-wal", true)?;
    let (attachments_bytes, attachment_files) = attachment_size(root)?;
    guarded_metadata(root, root)?;
    Ok(RepositoryStatistics {
        database_bytes,
        wal_bytes,
        attachments_bytes,
        attachment_files,
        measured_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture() -> tempfile::TempDir {
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let base = project.join(".quality/workflow-update-20261003/settings/isolated-stats");
        fs::create_dir_all(&base).unwrap();
        tempfile::Builder::new()
            .prefix("stats-")
            .tempdir_in(base)
            .unwrap()
    }

    fn initialize(root: &Path) {
        fs::write(root.join(DATABASE_FILE), [0u8; 31]).unwrap();
        fs::create_dir(root.join("attachments")).unwrap();
    }

    #[test]
    fn reports_exact_separate_bytes_without_modifying_files() {
        let fixture = fixture();
        let root = fixture.path().canonicalize().unwrap();
        initialize(&root);
        fs::write(root.join("perfboard.sqlite3-wal"), [1u8; 17]).unwrap();
        fs::write(root.join("perfboard.sqlite3-shm"), [2u8; 19]).unwrap();
        fs::write(root.join("attachments/image.png"), [3u8; 11]).unwrap();
        fs::create_dir(root.join("attachments/nested")).unwrap();
        fs::write(root.join("attachments/nested/manual.pdf"), [4u8; 13]).unwrap();
        fs::create_dir(root.join("manual-backup")).unwrap();
        fs::write(root.join("manual-backup/archive"), [5u8; 29]).unwrap();
        let before = fs::read(root.join(DATABASE_FILE)).unwrap();
        let stats = measure_root(&root).unwrap();
        assert_eq!(stats.database_bytes, 31);
        assert_eq!(stats.wal_bytes, 17);
        assert_eq!(stats.attachments_bytes, 24);
        assert_eq!(stats.attachment_files, 2);
        assert!(chrono::DateTime::parse_from_rfc3339(&stats.measured_at).is_ok());
        assert_eq!(fs::read(root.join(DATABASE_FILE)).unwrap(), before);
    }

    #[test]
    fn absent_wal_and_attachments_are_zero_without_creating_them() {
        let fixture = fixture();
        let root = fixture.path().canonicalize().unwrap();
        fs::write(root.join(DATABASE_FILE), []).unwrap();
        let stats = measure_root(&root).unwrap();
        assert_eq!(stats.database_bytes, 0);
        assert_eq!(stats.wal_bytes, 0);
        assert_eq!(stats.attachments_bytes, 0);
        assert_eq!(stats.attachment_files, 0);
        assert!(!root.join("attachments").exists());
        assert!(!root.join("perfboard.sqlite3-wal").exists());
    }

    #[test]
    fn missing_database_is_an_error_instead_of_zero() {
        let fixture = fixture();
        let root = fixture.path().canonicalize().unwrap();
        assert!(measure_root(&root).is_err());
        assert!(!root.join(DATABASE_FILE).exists());
    }

    #[test]
    fn rejects_untrusted_or_non_file_paths() {
        let fixture = fixture();
        let root = fixture.path().canonicalize().unwrap();
        assert!(measure_root(Path::new("relative-repository")).is_err());
        fs::create_dir(root.join(DATABASE_FILE)).unwrap();
        assert!(measure_root(&root).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rejects_attachment_junction_with_an_isolated_target() {
        let fixture = fixture();
        let root = fixture.path().join("repo");
        let outside = fixture.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(root.join(DATABASE_FILE), [0u8; 3]).unwrap();
        fs::write(outside.join("must-not-count.pdf"), [0u8; 101]).unwrap();
        use std::os::windows::process::CommandExt;
        // Joining a slash-delimited evidence directory can retain mixed separators.
        // cmd's mklink parser treats forward slashes as switches, so normalize only
        // these trusted, project-local fixture paths for this subprocess.
        let command_path = |path: &Path| {
            let native: PathBuf = path.components().collect();
            let text = native.to_string_lossy();
            text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
        };
        let output = std::process::Command::new("cmd")
            .creation_flags(0x08000000)
            .args(["/d", "/c", "mklink", "/J"])
            .arg(command_path(&root.join("attachments")))
            .arg(command_path(&outside))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(measure_root(&root.canonicalize().unwrap()).is_err());
        assert_eq!(
            fs::metadata(outside.join("must-not-count.pdf"))
                .unwrap()
                .len(),
            101
        );
        // Remove only the fixture junction; never recurse through its target.
        fs::remove_dir(root.join("attachments")).unwrap();
        assert!(outside.join("must-not-count.pdf").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_database_and_attachment_symlinks() {
        use std::os::unix::fs::symlink;
        let fixture = fixture();
        let root = fixture.path().canonicalize().unwrap();
        let outside = root.join("outside");
        fs::write(&outside, [0u8; 7]).unwrap();
        symlink(&outside, root.join(DATABASE_FILE)).unwrap();
        assert!(measure_root(&root).is_err());
        fs::remove_file(root.join(DATABASE_FILE)).unwrap();
        fs::write(root.join(DATABASE_FILE), []).unwrap();
        fs::create_dir(root.join("attachments")).unwrap();
        symlink(&outside, root.join("attachments/linked.pdf")).unwrap();
        assert!(measure_root(&root).is_err());
    }
}
