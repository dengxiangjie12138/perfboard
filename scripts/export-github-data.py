"""Export the current Perfboard data, without modifying its source databases.

SQLite sources are opened with mode=ro. Each database is read in one transaction,
backed up through SQLite, and compared logically before publishing. Output files
are atomically replaced; manifest.json is replaced last. No old backup is kept.
"""

from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import struct
import uuid
from datetime import datetime, timezone


PROJECT = Path(__file__).resolve().parents[1]
FORMAT = "perfboard-current-data-snapshot"
SETTINGS_DATABASES = ("activity-log.sqlite", "standing-reminder.sqlite", "view-state.sqlite3")
TOOL_CONFIGS = ("external-tools.json", "external-tools-warehouse-import.json")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def digest_file(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def require_plain_path(path: Path) -> None:
    """Reject symlinks/junctions instead of copying redirected source data."""
    for current in (path, *path.parents):
        if not current.exists():
            continue
        status = current.lstat()
        require(not current.is_symlink() and not (getattr(status, "st_file_attributes", 0) & 0x400),
                "A source or output path contains a link/reparse point")


def relative_path(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    require(bool(value) and not path.is_absolute() and ".." not in path.parts
            and "\\" not in value and ":" not in value, "Unsafe snapshot relative path")
    return path


def readonly(path: Path) -> sqlite3.Connection:
    require(path.is_file(), "A required source database is missing")
    require_plain_path(path)
    connection = sqlite3.connect(path.absolute().as_uri() + "?mode=ro", uri=True, timeout=30)
    connection.execute("PRAGMA query_only=ON")
    return connection


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def encoded_value(value: object) -> bytes:
    if value is None:
        return b"N"
    if isinstance(value, int):
        return b"I" + str(value).encode("ascii")
    if isinstance(value, float):
        return b"F" + struct.pack(">d", value)
    if isinstance(value, str):
        return b"T" + value.encode("utf-8")
    if isinstance(value, bytes):
        return b"B" + len(value).to_bytes(8, "big") + hashlib.sha256(value).digest()
    raise RuntimeError("Unexpected SQLite storage type")


def logical_summary(connection: sqlite3.Connection) -> dict:
    schema = connection.execute(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name,tbl_name"
    ).fetchall()
    schema_bytes = json.dumps(schema, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    tables = {}
    for (name,) in connection.execute("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"):
        quoted = quote_identifier(name)
        columns = [row[1] for row in connection.execute(f"PRAGMA table_info({quoted})")]
        row_hashes = []
        blob_hashes = []
        blob_bytes = 0
        for row in connection.execute(f"SELECT * FROM {quoted}"):
            row_digest = hashlib.sha256()
            for value in row:
                encoded = encoded_value(value)
                row_digest.update(len(encoded).to_bytes(8, "big"))
                row_digest.update(encoded)
                if isinstance(value, bytes):
                    blob_bytes += len(value)
                    blob_hashes.append(hashlib.sha256(value).digest())
            row_hashes.append(row_digest.digest())
        table_digest = hashlib.sha256()
        table_digest.update(json.dumps(columns, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        for row_hash in sorted(row_hashes):
            table_digest.update(row_hash)
        tables[name] = {
            "rows": len(row_hashes),
            "logical_sha256": table_digest.hexdigest(),
            "blob_cells": len(blob_hashes),
            "blob_bytes": blob_bytes,
            "blob_sha256": hashlib.sha256(b"".join(sorted(blob_hashes))).hexdigest(),
        }
    return {
        "user_version": connection.execute("PRAGMA user_version").fetchone()[0],
        "application_id": connection.execute("PRAGMA application_id").fetchone()[0],
        "schema_sha256": hashlib.sha256(schema_bytes).hexdigest(),
        "tables": tables,
    }


def validate_resources(connection: sqlite3.Connection, tables: dict) -> dict | None:
    if "dev_log_resources" not in tables:
        return None
    rows = 0
    total_bytes = 0
    resource_hashes = []
    for size, expected_hash, data in connection.execute("SELECT size,sha256,data FROM dev_log_resources"):
        require(isinstance(data, bytes), "A log resource is not stored as a BLOB")
        actual_hash = hashlib.sha256(data).hexdigest()
        require(size == len(data) and isinstance(expected_hash, str) and expected_hash.lower() == actual_hash,
                "A log resource fails its stored size/SHA256 check")
        rows += 1
        total_bytes += len(data)
        resource_hashes.append(bytes.fromhex(actual_hash))
    return {"rows": rows, "bytes": total_bytes,
            "sha256": hashlib.sha256(b"".join(sorted(resource_hashes))).hexdigest()}


def inspect_database(path: Path) -> dict:
    with closing(readonly(path)) as connection:
        results = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        require(results == ["ok"], "An exported database fails integrity_check")
        summary = logical_summary(connection)
        resources = validate_resources(connection, summary["tables"])
        if resources is not None:
            summary["log_resources"] = resources
        summary["integrity_check"] = "ok"
        return summary


def source_hashes(path: Path) -> dict:
    result = {}
    for suffix in ("", "-wal"):
        candidate = Path(str(path) + suffix)
        result["database" if not suffix else "wal"] = digest_file(candidate) if candidate.is_file() else None
    return result


def export_database(source: Path, target: Path) -> dict:
    target.parent.mkdir(parents=True, exist_ok=True)
    before = source_hashes(source)
    source_connection = readonly(source)
    try:
        source_connection.execute("BEGIN")
        source_summary = logical_summary(source_connection)
        source_resources = validate_resources(source_connection, source_summary["tables"])
        if source_resources is not None:
            source_summary["log_resources"] = source_resources
        with closing(sqlite3.connect(target)) as destination:
            source_connection.backup(destination, pages=256, sleep=0.05)
            # Make the resulting snapshot self-contained, without WAL/SHM sidecars.
            destination.execute("PRAGMA journal_mode=DELETE")
        target_summary = inspect_database(target)
        comparison = {key: value for key, value in target_summary.items() if key != "integrity_check"}
        require(comparison == source_summary, "Source and exported database logical summaries differ")
        source_connection.rollback()
    finally:
        source_connection.close()
    after = source_hashes(source)
    return {
        "kind": "sqlite",
        "bytes": target.stat().st_size,
        "sha256": digest_file(target),
        "database": target_summary,
        "source_observation": {
            "opened_read_only": True,
            "consistent_read_transaction": True,
            "database_bytes_unchanged": before["database"] == after["database"],
            "wal_bytes_unchanged": before["wal"] == after["wal"],
        },
    }


def copy_verified(source: Path, target: Path, kind: str) -> dict:
    require_plain_path(source)
    before = digest_file(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    copied = digest_file(target)
    require(before == copied == digest_file(source), "A source file changed while it was being copied")
    return {"kind": kind, "bytes": target.stat().st_size, "sha256": copied}


def attachment_files(root: Path):
    if not root.exists():
        return
    require_plain_path(root)
    for directory, directories, filenames in os.walk(root, followlinks=False):
        for name in directories:
            require_plain_path(Path(directory) / name)
        for name in sorted(filenames):
            path = Path(directory) / name
            require_plain_path(path)
            require(path.is_file(), "Unexpected attachment entry")
            yield path


def validate_attachment_references(repository: Path) -> None:
    with closing(readonly(repository / "perfboard.sqlite3")) as connection:
        for stored_path, stored_size in connection.execute("SELECT relative_path,size FROM attachments"):
            if not stored_path:
                continue
            path = repository / str(relative_path(stored_path))
            require(path.is_file(), "An exported repository attachment is missing")
            require_plain_path(path)
            require(path.stat().st_size == stored_size, "An exported attachment has an unexpected size")


def load_manifest(root: Path) -> dict:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("format") == FORMAT and manifest.get("format_version") == 1,
            "Unexpected existing snapshot manifest")
    for name in manifest["files"]:
        relative_path(name)
    return manifest


def verify_export(root: Path) -> dict:
    require_plain_path(root)
    manifest = load_manifest(root)
    expected = set(manifest["files"]) | {"manifest.json"}
    actual = {path.relative_to(root).as_posix() for path in attachment_files(root)}
    require(actual == expected, "Snapshot file inventory differs from manifest")
    for name, entry in manifest["files"].items():
        path = root / str(relative_path(name))
        require(path.stat().st_size == entry["bytes"] and digest_file(path) == entry["sha256"],
                "Snapshot file size/SHA256 differs from manifest")
        if entry["kind"] == "sqlite":
            require(inspect_database(path) == entry["database"], "Snapshot table summaries differ from manifest")
    validate_attachment_references(root / "repository")
    return manifest


def publish(stage: Path, output: Path, manifest: dict) -> None:
    require_plain_path(output)
    output.mkdir(parents=True, exist_ok=True)
    previous_names = set()
    existing_names = {path.relative_to(output).as_posix() for path in attachment_files(output)}
    if existing_names:
        require("manifest.json" in existing_names, "Existing output is not a managed snapshot")
        previous = load_manifest(output)
        previous_names = set(previous["files"])
        require(existing_names <= previous_names | {"manifest.json"}, "Output contains unmanaged files")
    for name in manifest["files"]:
        target = output / str(relative_path(name))
        target.parent.mkdir(parents=True, exist_ok=True)
        require_plain_path(target.parent)
        os.replace(stage / name, target)
    for name in previous_names - set(manifest["files"]):
        old = output / str(relative_path(name))
        if old.exists():
            old.unlink()
    os.replace(stage / "manifest.json", output / "manifest.json")
    # Empty directories are harmless; the snapshot never contains historical copies.


@contextmanager
def staging_directory(parent: Path):
    # Python 3.13 tempfile uses a Windows owner-only ACL that can reject the
    # desktop sandbox's alternate token. Inherit the workspace ACL instead.
    stage = parent / (".current-export-" + uuid.uuid4().hex)
    stage.mkdir()
    try:
        yield stage
    finally:
        shutil.rmtree(stage)


def summary(root: Path, manifest: dict) -> dict:
    tables = manifest["files"]["repository/perfboard.sqlite3"]["database"]["tables"]
    return {
        "status": "verified",
        "files": len(manifest["files"]),
        "bytes_including_manifest": sum(path.stat().st_size for path in attachment_files(root)),
        "databases": sum(entry["kind"] == "sqlite" for entry in manifest["files"].values()),
        "repository_rows": {name: tables[name]["rows"] for name in (
            "parts", "notes", "dev_log_projects", "dev_log_pages", "dev_log_page_history", "dev_log_resources", "attachments"
        ) if name in tables},
        "source_files_changed_during_export": [name for name, entry in manifest["files"].items()
            if entry["kind"] == "sqlite" and not all(entry["source_observation"][key]
                for key in ("database_bytes_unchanged", "wal_bytes_unchanged"))],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, help="Current repository directory or perfboard.sqlite3")
    parser.add_argument("--settings-dir", type=Path,
                        default=Path(os.environ.get("APPDATA", "~/.config")).expanduser() / "com.perfboard.toolbox")
    parser.add_argument("--output", type=Path, default=PROJECT / "data" / "current")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    output = args.output.absolute()
    if args.verify_only:
        print(json.dumps(summary(output, verify_export(output)), ensure_ascii=False))
        return
    require(args.repository is not None, "Pass --repository with the current repository location")
    source = args.repository.absolute()
    repository = source.parent if source.is_file() else source
    database = source if source.is_file() else source / "perfboard.sqlite3"
    require(database.name == "perfboard.sqlite3", "Unexpected repository database filename")
    settings = args.settings_dir.absolute()
    require(not output.is_relative_to(repository) and not repository.is_relative_to(output),
            "Export output and production repository must be separate")
    require(not output.is_relative_to(settings) and not settings.is_relative_to(output),
            "Export output and production settings must be separate")
    require_plain_path(repository)
    require_plain_path(settings)
    require_plain_path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with staging_directory(output.parent) as stage:
        files = {"repository/perfboard.sqlite3": export_database(database, stage / "repository/perfboard.sqlite3")}
        (stage / "repository" / "attachments").mkdir()
        for attachment in attachment_files(repository / "attachments"):
            name = "repository/attachments/" + attachment.relative_to(repository / "attachments").as_posix()
            files[name] = copy_verified(attachment, stage / name, "attachment")
        validate_attachment_references(stage / "repository")
        for filename in SETTINGS_DATABASES:
            name = "settings/" + filename
            files[name] = export_database(settings / filename, stage / name)
        for filename in TOOL_CONFIGS:
            if (settings / filename).is_file():
                name = "settings/" + filename
                files[name] = copy_verified(settings / filename, stage / name, "tool_configuration")
        manifest = {
            "format": FORMAT,
            "format_version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "snapshot_consistency": "Each database is a complete read-only SQLite backup from one read transaction; separate databases are captured sequentially.",
            "logical_digest": "SHA256 of column names plus sorted, length-prefixed typed-row SHA256 digests; BLOBs contribute their byte length and SHA256. Duplicate rows are retained.",
            "excluded": ["repository/backups/", "historical import backups", "SQLite WAL/SHM sidecars", "repository.json"],
            "files": dict(sorted(files.items())),
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        verify_export(stage)
        publish(stage, output, manifest)
    print(json.dumps(summary(output, verify_export(output)), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (OSError, sqlite3.Error, RuntimeError, ValueError) as error:
        raise SystemExit(f"Export failed: {type(error).__name__}: {error}") from error
