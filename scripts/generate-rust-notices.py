"""Collect locked Windows Rust notices using only installed crate sources (Python 3.11+).

No downloads, SPDX template substitution, or license guessing are performed. The
previous notice document is preserved verbatim before a replaceable generated
section. Missing upstream text is an error; --write-incomplete can save the
explicitly marked collection for review, but still returns a failing exit code.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib
import uuid


ROOT = Path(__file__).resolve().parents[1]
BEGIN = b"\n===== BEGIN GENERATED LOCKED RUST NOTICES =====\n"
END = "===== END GENERATED LOCKED RUST NOTICES =====\n"
NOTICE_NAME = re.compile(r"^(?:licen[cs]e|copying|notice|copyright)", re.I)
LICENSE_NAME = re.compile(r"^(?:licen[cs]e|copying)", re.I)
CRATE_LINE = re.compile(r"^([A-Za-z0-9_-]+) v([^\s]+)", re.M)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "src-tauri/Cargo.toml")
    parser.add_argument("--lock", type=Path, default=ROOT / "src-tauri/Cargo.lock")
    parser.add_argument("--output", type=Path, default=ROOT / "public/third-party-rust-notices.txt")
    parser.add_argument("--target", default="x86_64-pc-windows-msvc")
    parser.add_argument("--cargo", type=Path)
    parser.add_argument("--registry-root", type=Path, action="append",
                        help="Registry source directory containing name-version subdirectories; repeatable")
    parser.add_argument("--check", action="store_true", help="Compare the generated result without writing")
    parser.add_argument("--write-incomplete", action="store_true",
                        help="Write clearly marked incomplete notices while still exiting with an error")
    return parser.parse_args()


def cargo_executable(explicit: Path | None) -> str:
    if explicit:
        return str(explicit)
    found = shutil.which("cargo")
    if found:
        return found
    cargo_home = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
    fallback = cargo_home / "bin" / ("cargo.exe" if os.name == "nt" else "cargo")
    if not fallback.is_file():
        raise ValueError("Cargo was not found; supply --cargo. No network installation will be attempted.")
    return str(fallback)


def selected_packages(args: argparse.Namespace) -> set[tuple[str, str]]:
    command = [cargo_executable(args.cargo), "tree", "--offline", "--locked",
               "--manifest-path", str(args.manifest.resolve()), "--target", args.target,
               "--edges", "normal,build", "--prefix", "none", "--format", "{p}"]
    result = subprocess.run(command, capture_output=True, encoding="utf-8", check=False)
    if result.returncode:
        raise ValueError("Offline locked Cargo dependency selection failed:\n" + result.stderr.strip())
    selected = set(CRATE_LINE.findall(result.stdout))
    if not selected:
        raise ValueError("Cargo produced no dependency packages; refusing an empty notice collection.")
    return selected


def registry_roots(args: argparse.Namespace) -> list[Path]:
    if args.registry_root:
        return [value.resolve() for value in args.registry_root]
    cargo_home = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
    source = cargo_home / "registry/src"
    return sorted((value.resolve() for value in source.iterdir() if value.is_dir()), key=str)


def previous_entries(legacy: bytes) -> dict[str, str]:
    parts = re.split(r"(?m)^=== ([^\r\n]+) ===\r?\n", legacy.decode("utf-8-sig"))
    return dict(zip(parts[1::2], parts[2::2]))


def previous_full_text(text: str) -> bool:
    # Reuse only actual full text already shipped, never a license name or URL.
    signatures = [
        ("Permission is hereby granted", "THE SOFTWARE IS PROVIDED"),
        ("Apache License", "TERMS AND CONDITIONS FOR USE"),
        ("Redistribution and use", "THIS SOFTWARE IS PROVIDED"),
        ("Mozilla Public License Version 2.0", "Exhibit A"),
    ]
    return any(all(phrase.casefold() in text.casefold() for phrase in pair) for pair in signatures)


def safe_file(crate: Path, path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(crate.resolve()):
        raise ValueError("Upstream license path escapes its installed crate: " + str(path.name))
    return resolved


def license_files(crate: Path, manifest: dict) -> list[Path]:
    files: set[Path] = set()
    explicit = manifest.get("license-file")
    if explicit:
        path = safe_file(crate, crate / explicit)
        if not path.is_file():
            raise ValueError("Declared license-file is missing: " + str(explicit))
        files.add(path)
    for path in crate.rglob("*"):
        if path.is_file() and NOTICE_NAME.match(path.name):
            files.add(safe_file(crate, path))
    return sorted(files, key=lambda path: path.relative_to(crate.resolve()).as_posix().casefold())


def usable_license(path: Path, text: str, explicit: str | None) -> bool:
    return (bool(LICENSE_NAME.match(path.name)) or path.name == Path(explicit or "").name) \
        and path.suffix.casefold() != ".spdx" and len(text.strip()) >= 100


def collect(args: argparse.Namespace) -> tuple[bytes, dict]:
    original = args.output.read_bytes() if args.output.exists() else b"Perfboard Rust dependency notices\n"
    legacy = original.split(BEGIN, 1)[0]
    old = previous_entries(legacy)
    lock = tomllib.loads(args.lock.read_text(encoding="utf-8"))
    wanted = selected_packages(args)
    roots = registry_roots(args)
    packages = sorted((package for package in lock["package"]
                       if (package["name"], package["version"]) in wanted and package.get("source")),
                      key=lambda package: (package["name"], package["version"]))
    sections: list[str] = []
    errors: list[str] = []
    complete = 0
    local = 0
    file_count = 0
    appended_files = 0
    reused = 0
    inherited = 0
    for package in packages:
        name, version = package["name"], package["version"]
        key = name + "@" + version
        lines = ["=== " + key + " ===", "Locked source: " + package["source"]]
        if not package["source"].startswith("registry+"):
            errors.append(key + ": non-registry dependency requires an explicit local license source")
            sections.append("\n".join(lines + ["ERROR: no validated installed license source."]))
            continue
        matches = [path / (name + "-" + version) for path in roots]
        matches = [path.resolve() for path in matches if (path / "Cargo.toml").is_file()]
        if len(matches) != 1:
            errors.append(key + ": installed crate source is missing or ambiguous; use --registry-root")
            sections.append("\n".join(lines + ["ERROR: installed crate source is missing or ambiguous."]))
            continue
        local += 1
        crate = matches[0]
        reuse_entry = False
        try:
            metadata = tomllib.loads((crate / "Cargo.toml").read_text(encoding="utf-8"))["package"]
            if metadata.get("name") != name or metadata.get("version") != version:
                raise ValueError("Installed Cargo.toml identity does not match Cargo.lock")
            lines += ["License: " + str(metadata.get("license") or "see license-file"),
                      "Upstream: " + str(metadata.get("repository") or metadata.get("homepage") or "not declared")]
            if metadata.get("license-file"):
                lines.append("Declared license-file: " + metadata["license-file"])
            full = False
            legacy_full = previous_full_text(old.get(key, ""))
            normalized_old = " ".join(old.get(key, "").split())
            added = 0
            for path in license_files(crate, metadata):
                text = path.read_text(encoding="utf-8-sig")
                if not text.strip():
                    raise ValueError("Empty upstream notice: " + path.relative_to(crate).as_posix())
                relative = path.relative_to(crate).as_posix()
                # Keep all license wording; normalize only line endings and trailing whitespace.
                normalized = "\n".join(line.rstrip() for line in text.splitlines()).rstrip("\n")
                already_present = " ".join(text.split()) in normalized_old
                if not already_present:
                    lines += ["", "--- Upstream file: " + relative + " ---", normalized]
                    added += 1
                    appended_files += 1
                usable = usable_license(path, text, metadata.get("license-file"))
                full |= usable
                legacy_full |= already_present and usable
                file_count += 1
            if not full and legacy_full:
                full = True
                inherited += 1
                lines += ["", "Full license text is retained in the original notice entry above."]
            if full:
                complete += 1
                if legacy_full:
                    reused += 1
                    reuse_entry = added == 0
            else:
                error = key + ": installed crate omits full license text; retained metadata is not a substitute"
                errors.append(error)
                lines += ["", "ERROR: FULL LICENSE TEXT MISSING FROM INSTALLED CRATE."]
        except (OSError, UnicodeError, ValueError, tomllib.TOMLDecodeError) as error:
            errors.append(key + ": " + str(error))
            lines += ["", "ERROR: " + str(error)]
        if not reuse_entry:
            sections.append("\n".join(lines))
    summary = {"target": args.target, "edges": "normal,build", "lockedSelectedCrates": len(packages),
               "localCrates": local, "fullTextCrates": complete, "retainedFullTextCrates": inherited,
               "reusedOriginalFullTextCrates": reused, "appendedCrateEntries": len(sections),
               "collectedLicenseAndNoticeFiles": file_count, "appendedLicenseAndNoticeFiles": appended_files,
               "missingCount": len(errors), "errors": errors}
    header = ["Target: " + args.target + "; normal and build dependencies selected by locked offline cargo tree.",
              "Original notices above are preserved, including notices for earlier dependency versions.",
              "Complete matching notices are reused above; only missing texts and versions are appended below.",
              "Selected crates: %d; full text available: %d; missing: %d." % (len(packages), complete, len(errors))]
    if errors:
        header += ["INCOMPLETE COLLECTION: missing upstream license text must be reviewed before distribution.",
                   *["ERROR: " + error for error in errors]]
    generated = "\n".join(header) + "\n\n" + "\n\n".join(sections) + "\n\n" + END
    return legacy + BEGIN + generated.encode("utf-8"), summary


def main() -> int:
    args = arguments()
    try:
        data, summary = collect(args)
        summary["output"] = str(args.output)
        if args.check:
            summary["matches"] = args.output.exists() and args.output.read_bytes() == data
        elif not summary["errors"] or args.write_incomplete:
            temporary = args.output.with_name(args.output.name + "." + uuid.uuid4().hex + ".tmp")
            try:
                temporary.write_bytes(data)
                os.replace(temporary, args.output)
            finally:
                temporary.unlink(missing_ok=True)
            summary["writtenBytes"] = len(data)
        else:
            summary["written"] = False
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        for error in summary["errors"]:
            print("ERROR: " + error, file=sys.stderr)
        return 1 if summary["errors"] or (args.check and not summary["matches"]) else 0
    except (OSError, ValueError, tomllib.TOMLDecodeError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
