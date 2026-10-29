"""Isolated Windows updater acceptance. Runs only an explicitly prepared GUID test product.

Requires websocket-client (used by cdp_client.py), debug test binaries with embedded
frontend assets, and two installers prepared by the project's NSIS test harness.
Never queries the ordinary Perfboard product or reads an updater private key.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid

WORKSPACE = Path(__file__).resolve().parents[1]
PRODUCT = re.compile(r"^PerfboardUpdateValidation-[0-9a-f]{32}$")
PATH_FIELDS = ("programDirectory", "applicationConfigDirectory", "repositoryDirectory", "initialInstaller", "updateInstaller")
VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def version_key(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise ValueError("Fixture versions must be stable semantic versions")
    return tuple(map(int, value.split(".")))


def under(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    if resolved == root or root not in resolved.parents:
        raise ValueError(f"Path must be strictly inside the validation root: {path}")
    for ancestor in (path, *path.parents):
        if ancestor.exists() and ancestor.is_junction():
            raise ValueError(f"Validation paths must not contain directory junctions: {ancestor}")
        if ancestor.is_symlink():
            raise ValueError(f"Validation paths must not contain symbolic links: {ancestor}")
    if any(character in str(path) for character in ('"', '\r', '\n')):
        raise ValueError("A validation path contains a command-line separator")
    return resolved


def read_plan(filename: Path, signature: Path, private_key: Path | None = None, rollback_signature: Path | None = None) -> dict:
    plan = json.loads(filename.read_text(encoding="utf-8-sig"))
    if not PRODUCT.fullmatch(plan.get("productName", "")) or plan.get("manufacturer") != "perfboard":
        raise ValueError("Only the prepared PerfboardUpdateValidation-<32hex> test product is accepted")
    root = Path(plan["validationRoot"])
    if not root.is_absolute() or root.resolve() in (WORKSPACE, Path(root.anchor)):
        raise ValueError("validationRoot must be a dedicated absolute test directory")
    root = root.resolve()
    # Accept a plan only inside its own isolated root and these known writable areas.
    artifact_base = Path(os.environ.get("USERPROFILE", "")) / ".codex" / "visualizations"
    if WORKSPACE not in root.parents and artifact_base.resolve() not in root.parents:
        raise ValueError("Unknown external validation root")
    under(filename, root)
    for name in PATH_FIELDS:
        source = Path(plan[name])
        if not source.is_absolute():
            raise ValueError(f"{name} must be absolute")
        plan[name] = under(source, root)
    plan["validationRoot"] = root
    plan["signature"] = under(signature, root)
    plan.setdefault("initialVersion", "0.1.0")
    plan.setdefault("updateVersion", plan.get("applicationVersion", "0.1.1"))
    if version_key(plan["initialVersion"]) >= version_key(plan["updateVersion"]):
        raise ValueError("The update fixture version must be newer than its initial version")
    if plan.get("rollbackInstaller"):
        plan.setdefault("rollbackVersion", plan["initialVersion"])
        if not (version_key("0.1.1") <= version_key(plan["rollbackVersion"]) < version_key(plan["updateVersion"])):
            raise ValueError("Rollback requires an explicitly signed stable version from 0.1.1 onward")
        source = Path(plan["rollbackInstaller"])
        if not source.is_absolute():
            raise ValueError("rollbackInstaller must be absolute")
        plan["rollbackInstaller"] = under(source, root)
        plan["rollbackSignature"] = under(rollback_signature or Path(str(source) + ".sig"), root)
        if plan["rollbackInstaller"] == plan["updateInstaller"]:
            raise ValueError("Rollback and update installers must be different files")
    elif plan.get("rollbackVersion") or rollback_signature:
        raise ValueError("Rollback metadata requires rollbackInstaller")
    for version in (plan["updateVersion"], plan.get("rollbackVersion")):
        if version is None:
            continue
        expected_temporary_installer = root / "temp" / f'{plan["productName"]}-{version}-updater-123456' / f'{plan["productName"]}-{version}-installer.exe'
        if len(str(expected_temporary_installer)) >= 260:
            raise ValueError("The GUID fixture would exceed ShellExecute's 260-character path limit; prepare a shorter validationRoot")
    if private_key is not None:
        # Production keys must never be handed to this acceptance script.
        plan["privateKey"] = under(private_key, root)
    if plan["initialInstaller"] == plan["updateInstaller"]:
        raise ValueError("Initial and update installers must be different files")
    for name in ("initialInstaller", "updateInstaller", *(('rollbackInstaller',) if plan.get('rollbackInstaller') else ())):
        with plan[name].open("rb") as file:
            if file.read(2) != b"MZ":
                raise ValueError(f"Not a Windows installer: {name}")
    return plan


def fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def wait_until(predicate, seconds=40, description="condition"):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            result = predicate()
            if result:
                return result
        except Exception as error:
            last = str(error)
        time.sleep(0.2)
    raise RuntimeError(f"Timed out waiting for {description}" + (f": {last}" if last else ""))


class FixtureServer:
    def __init__(self, plan, signature: str, rollback_signature: str | None = None):
        self.latest_version = plan["updateVersion"]
        self.releases = {self.latest_version: {"installer": plan["updateInstaller"], "signature": signature, "schema": plan.get("repositorySchemaVersion", 6)}}
        if plan.get("rollbackInstaller"):
            self.releases[plan["rollbackVersion"]] = {"installer": plan["rollbackInstaller"], "signature": rollback_signature, "schema": None if plan["rollbackVersion"] == "0.1.1" else plan.get("rollbackRepositorySchemaVersion", 6)}
        self.tamper = False
        self.checks = 0
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                route = urllib.parse.unquote(self.path.split("?")[0])
                if route == "/latest.json":
                    owner.checks += 1
                    body = json.dumps(owner.manifest(owner.latest_version)).encode()
                    content_type = "application/json"
                elif route == "/releases":
                    body = json.dumps(owner.catalog()).encode()
                    content_type = "application/json"
                elif route.startswith("/releases/tags/"):
                    tag = route.rsplit("/", 1)[-1]
                    release = next((release for release in owner.catalog() if release["tag_name"] == tag), None)
                    if release is None:
                        self.send_error(404)
                        return
                    body = json.dumps(release).encode()
                    content_type = "application/json"
                elif route.endswith("/latest.json") and route.split("/")[1].removeprefix("v") in owner.releases:
                    body = json.dumps(owner.manifest(route.split("/")[1].removeprefix("v"))).encode()
                    content_type = "application/json"
                elif route.endswith(".exe.sig") and route.split("/")[1].removeprefix("v") in owner.releases:
                    body = owner.releases[route.split("/")[1].removeprefix("v")]["signature"].encode()
                    content_type = "text/plain"
                elif route == "/setup.exe" or (route.endswith(".exe") and route.split("/")[1].removeprefix("v") in owner.releases):
                    version = owner.latest_version if route == "/setup.exe" else route.split("/")[1].removeprefix("v")
                    body = owner.releases[version]["installer"].read_bytes()
                    if owner.tamper:
                        body += b"\nINTENTIONALLY_TAMPERED_TEST_PACKAGE\n"
                    content_type = "application/octet-stream"
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def manifest(self, version):
        release = self.releases[version]
        filename = f"Perfboard_{version}_x64-setup.exe"
        manifest = {"version": version, "notes": "Isolated native updater acceptance fixture", "pub_date": "2026-10-29T00:00:00Z", "platforms": {"windows-x86_64": {"url": f"{self.url}/v{version}/{filename}", "signature": release["signature"]}}}
        if release["schema"] is not None:
            manifest["repositorySchemaVersion"] = release["schema"]
        return manifest

    def catalog(self):
        releases = []
        for index, version in enumerate(sorted(self.releases, key=version_key, reverse=True), start=1):
            filename = f"Perfboard_{version}_x64-setup.exe"
            base = f"{self.url}/v{version}"
            releases.append({"id": index, "tag_name": "v" + version, "name": "Perfboard " + version, "body": "Isolated native release " + version, "draft": False, "prerelease": False, "published_at": "2026-10-29T00:00:00Z", "html_url": f"{self.url}/releases/tag/v{version}", "assets": [{"name": name, "browser_download_url": base + "/" + name, "state": "uploaded"} for name in (filename, filename + ".sig", "latest.json")]})
        releases.append({"id": 1000, "tag_name": "v0.1.0", "name": "Unsigned legacy fixture", "body": "No signed update manifest", "draft": False, "prerelease": False, "published_at": "2026-10-27T00:00:00Z", "html_url": f"{self.url}/releases/tag/v0.1.0", "assets": [{"name": "Perfboard_0.1.0_x64-setup.exe", "browser_download_url": self.url + "/unsigned-not-executable.exe", "state": "uploaded"}]})
        return releases

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.httpd.shutdown()
        self.httpd.server_close()


def connect_page(port: int, child=False):
    # Reuse the repository's CDP transport while choosing the intended WebView.
    import cdp_client
    pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2))
    def matches(page):
        url = page.get("url", "")
        independent = "#window=" in url or "#tool=" in url
        return page.get("type") == "page" and "webSocketDebuggerUrl" in page and independent == child and not any(marker in url for marker in ("#reminder-attention", "#fitness-prompt", "#standing-reminder-prompt"))
    page = next(page for page in pages if matches(page))
    client = cdp_client.CDP.__new__(cdp_client.CDP)
    client.port, client.seq, client.events = port, 0, []
    client.ws = cdp_client.websocket.create_connection(page["webSocketDebuggerUrl"], timeout=45, suppress_origin=True)
    client.call("Runtime.enable")
    client.call("Page.enable")
    return client


def invoke(client, command, arguments=None):
    return client.evaluate("window.__TAURI_INTERNALS__.invoke(" + json.dumps(command) + "," + json.dumps(arguments or {}) + ")")


def registry_values(product: str):
    import winreg
    prefix = f"Software\\perfboard\\{product}"
    uninstall = f"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{product}"
    result = {}
    for path, fields in ((prefix, ("", "RepositoryPath")), (uninstall, ("InstallLocation", "DisplayVersion", "Publisher", "DisplayName", "MainBinaryName"))):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
                for field in fields:
                    try:
                        result[field or "ProgramDirectory"] = winreg.QueryValueEx(key, field)[0]
                    except FileNotFoundError:
                        pass
        except FileNotFoundError:
            pass
    return result


def stop_test_processes(program: Path, terminate=True):
    """Hold handles and verify complete image paths; optionally stop only that fixture."""
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    class ProcessEntry(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG), ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot in (None, ctypes.c_void_p(-1).value):
        raise RuntimeError("Could not enumerate fixture processes for cleanup")
    matches = []
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        present = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        while present:
            if entry.szExeFile.casefold() == program.name.casefold():
                handle = kernel.OpenProcess(0x1000 | 0x0001, False, entry.th32ProcessID)
                if handle:
                    try:
                        size = wintypes.DWORD(32768)
                        filename = ctypes.create_unicode_buffer(size.value)
                        if kernel.QueryFullProcessImageNameW(handle, 0, filename, ctypes.byref(size)) and Path(filename.value).resolve() == program.resolve():
                            matches.append(entry.th32ProcessID)
                            if terminate and not kernel.TerminateProcess(handle, 0):
                                raise RuntimeError("Could not stop an isolated fixture process")
                    finally:
                        kernel.CloseHandle(handle)
            present = kernel.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    return matches


def install_and_restart(client, program, product, port, target_version, allow_rollback=False):
    """Run the actual native install command, then require a different restarted process."""
    previous_pids = set(stop_test_processes(program, terminate=False))
    if not previous_pids:
        raise RuntimeError("The fixture application is not running before installation")
    arguments = json.dumps({"allowRollback": allow_rollback})
    client.evaluate("delete window.__updaterTestInstallResult;delete window.__updaterTestInstallError;void window.__TAURI_INTERNALS__.invoke('update_install'," + arguments + ").then(status=>window.__updaterTestInstallResult=status).catch(error=>window.__updaterTestInstallError=String(error))")
    deadline = time.monotonic() + 60
    while previous_pids.intersection(stop_test_processes(program, terminate=False)) and time.monotonic() < deadline:
        try:
            result = client.evaluate("({status:window.__updaterTestInstallResult,error:window.__updaterTestInstallError})")
        except Exception:
            result = {}
        if result.get("error") or (result.get("status") or {}).get("error"):
            raise RuntimeError("Native install was canceled before exit: " + str(result))
        time.sleep(0.2)
    if previous_pids.intersection(stop_test_processes(program, terminate=False)):
        raise RuntimeError("The fixture application did not exit for installation")
    client.close()
    wait_until(lambda: registry_values(product).get("DisplayVersion") == target_version, seconds=180, description="NSIS update/rollback registration")
    restarted = wait_until(lambda: connect_page(port), seconds=90, description="automatic restart after NSIS update/rollback")
    restarted.wait("Boolean(document.querySelector('.app-shell'))", 40)
    restarted.wait("window.__TAURI_INTERNALS__.invoke('update_status').then(s=>s.currentVersion===" + json.dumps(target_version) + " && s.phase==='idle')", 45)
    return restarted


def rejected(client, command, arguments):
    try:
        result = invoke(client, command, arguments)
    except RuntimeError:
        return True
    return bool(result and result.get("error"))


def cleanup_product(plan, environment):
    import winreg
    program = under(plan["programDirectory"] / "perfboard.exe", plan["validationRoot"])
    stop_test_processes(program)
    uninstaller = under(plan["programDirectory"] / "uninstall.exe", plan["validationRoot"])
    registered = registry_values(plan["productName"])
    if uninstaller.exists() and registered.get("DisplayName") == plan["productName"]:
        target = Path(registered.get("ProgramDirectory", "").strip('"')).resolve()
        if target != plan["programDirectory"]:
            raise RuntimeError("Refusing to uninstall a GUID fixture with a different registered directory")
        completed = subprocess.run([str(uninstaller), "/S", "/NS"], cwd=plan["validationRoot"], env=environment, timeout=120, creationflags=subprocess.CREATE_NO_WINDOW)
        if completed.returncode:
            raise RuntimeError(f"Isolated uninstaller failed: {completed.returncode}")
        wait_until(lambda: not program.exists(), seconds=45, description="isolated uninstaller file cleanup")
    # Normal uninstall intentionally retains repository registration. Delete only
    # the two exact GUID product keys created by this acceptance run.
    assert PRODUCT.fullmatch(plan["productName"])
    for key_path in (f'Software\\perfboard\\{plan["productName"]}', f'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{plan["productName"]}'):
        try:
            winreg.DeleteKeyEx(winreg.HKEY_CURRENT_USER, key_path, winreg.KEY_WOW64_64KEY, 0)
        except FileNotFoundError:
            pass
    if registry_values(plan["productName"]):
        raise RuntimeError("Isolated product registration remains after cleanup")


def core_snapshot(repository: Path):
    database = repository / "perfboard.sqlite3"
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=15) as connection:
        tables = {}
        for table in ("parts", "notes", "attachments"):
            rows = connection.execute(f'SELECT * FROM "{table}" ORDER BY id').fetchall()
            tables[table] = [[value.hex() if isinstance(value, bytes) else value for value in row] for row in rows]
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    attachments = repository / "attachments"
    return {"tables": tables, "files": {str(file.relative_to(attachments)): fingerprint(file) for file in attachments.rglob("*") if file.is_file()}}


def run(plan, port):
    if sys.platform != "win32":
        raise RuntimeError("This harness only runs on Windows")
    import cdp_client  # Fail before installation if websocket-client is unavailable.
    del cdp_client
    root = plan["validationRoot"]
    marker = root / "native-updater-fixture.json"
    if registry_values(plan["productName"]):
        raise RuntimeError("The GUID test product is already installed; prepare a fresh isolated plan rather than overwriting it")
    if marker.exists():
        previous = json.loads(marker.read_text(encoding="utf-8"))
        if previous.get("productName") != plan["productName"] or previous.get("validationRoot") != str(root):
            raise RuntimeError("Previous fixture marker does not match this exact test plan")
        archive = root / "previous-attempts" / (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8])
        archive.mkdir(parents=True)
        for source, name in ((plan["repositoryDirectory"], "repository"), (plan["applicationConfigDirectory"], "config"), (root / "native-updater-results.json", "results.json"), (root / "native-updater-failure.txt", "failure.txt"), (root / "failure.png", "failure.png")):
            if source.exists():
                under(source, root).rename(under(archive / name, root))
    # The app's WebView remote-debugging port must not belong to another process.
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", port))
    if "privateKey" in plan:
        completed = subprocess.run(["node", str(WORKSPACE / "node_modules/@tauri-apps/cli/tauri.js"), "signer", "sign", "--private-key-path", str(plan["privateKey"]), "--app-version", plan["updateVersion"], str(plan["updateInstaller"])], cwd=WORKSPACE, capture_output=True, text=True, timeout=60)
        if completed.returncode:
            raise RuntimeError("Fixture signing failed; inspect the local CLI environment without printing key material")
    signature = plan["signature"].read_text(encoding="utf-8").strip()
    base64.b64decode(signature, validate=True)
    rollback_signature = plan["rollbackSignature"].read_text(encoding="utf-8").strip() if plan.get("rollbackInstaller") else None
    if rollback_signature:
        base64.b64decode(rollback_signature, validate=True)
    marker.write_text(json.dumps({"productName": plan["productName"], "validationRoot": str(root), "purpose": "synthetic updater installation acceptance only"}, indent=2), encoding="utf-8")
    results = []
    report = root / "native-updater-results.json"
    def check(name, condition, detail=None):
        results.append({"name": name, "passed": bool(condition), "detail": detail})
        report.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        if not condition:
            raise AssertionError(name)
    main = child = process = None
    program = plan["programDirectory"] / "perfboard.exe"
    initial_version, update_version = plan["initialVersion"], plan["updateVersion"]
    config, repository = plan["applicationConfigDirectory"], plan["repositoryDirectory"]
    environment = os.environ.copy()
    for name, directory in (("APPDATA", root / "appdata"), ("LOCALAPPDATA", root / "localappdata"), ("TEMP", root / "temp"), ("TMP", root / "temp"), ("WEBVIEW2_USER_DATA_FOLDER", root / "webview")):
        directory.mkdir(parents=True, exist_ok=True)
        environment[name] = str(directory)
    environment["PERFBOARD_TEST_CONFIG_DIR"] = str(config)
    environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={port} --remote-allow-origins=*"
    try:
        with FixtureServer(plan, signature, rollback_signature) as server:
            environment["PERFBOARD_TEST_UPDATE_ENDPOINT"] = server.url + "/latest.json"
            environment["PERFBOARD_TEST_RELEASES_ENDPOINT"] = server.url + "/releases"
            # /D is an NSIS-specific final unquoted argument, including any spaces.
            command = f'"{plan["initialInstaller"]}" /S /NS /REPOSITORY="{repository}" /D={plan["programDirectory"]}'
            installed = subprocess.run(command, cwd=root, env=environment, timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
            check("fresh isolated installer succeeds", installed.returncode == 0 and program.is_file())
            check("only the GUID product is registered", registry_values(plan["productName"]).get("DisplayName") == plan["productName"])
            process = subprocess.Popen([str(program), "--autostart"], cwd=root, env=environment, creationflags=subprocess.CREATE_NO_WINDOW)
            main = wait_until(lambda: connect_page(port), description="initial hidden main WebView")
            main.wait("Boolean(window.__TAURI_INTERNALS__ && document.querySelector('.app-shell'))", 40)
            status = invoke(main, "update_status")
            check("native updater recognizes the registered old installation", status["currentVersion"] == initial_version and status["installation"] == "installed", status)
            if plan.get("previousApplicationSha256"):
                check("installed old executable matches the prepared test binary", fingerprint(program).lower() == plan["previousApplicationSha256"].lower())
            check("first installation created the synthetic repository", invoke(main, "repo_status")["ready"])
            part = invoke(main, "part_save", {"part": {"id": "", "name": "UPDATER_SYNTHETIC_PART", "category": "resistor", "packageName": "0805", "parameters": "1 kΩ", "stockStatus": "in_stock", "quantity": 7, "location": "TEST", "brief": "Synthetic data only", "url": "", "lcscNumber": "", "brand": "fixture"}})
            note_id = str(uuid.uuid4())
            invoke(main, "edit_lease_acquire", {"resource": "note:" + note_id})
            note = invoke(main, "note_save", {"note": {"id": note_id, "title": "UPDATER_SYNTHETIC_NOTE", "category": "随笔", "searchText": "Fixture survives update", "sceneJson": None, "expectedRevision": 0}})
            invoke(main, "edit_lease_release", {"resource": "note:" + note_id})
            image = root / "synthetic-attachment.png"
            image.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII="))
            invoke(main, "attachment_import", {"partId": part["id"], "sourcePath": str(image)})
            before = core_snapshot(repository)
            pointer = config / "repository.json"
            pointer_bytes = pointer.read_bytes()
            registry_before = registry_values(plan["productName"])
            old_hash = fingerprint(program)
            status = invoke(main, "update_check")
            check("manual native check sees the signed next release", status["available"]["version"] == update_version)
            main.evaluate("[...document.querySelectorAll('.sidebar button')].find(button=>button.textContent.includes('版本与说明')).click()")
            main.wait("Boolean(document.querySelector('[data-testid=update-check]') && document.querySelector('.nav-update-badge'))")
            check("version page and sidebar show the available update", main.evaluate("document.querySelector('.nav-update-badge').getAttribute('aria-label').includes(" + json.dumps(update_version) + ")"))
            invoke(main, "update_set_auto_check", {"enabled": True})
            main.wait("window.__TAURI_INTERNALS__.invoke('update_status').then(s=>s.autoCheckEnabled && s.phase==='idle')")
            stored = json.loads((config / "updater-settings.json").read_text(encoding="utf-8"))
            check("automatic check preference persists outside the repository", stored["autoCheckEnabled"] is True)
            invoke(main, "app_close_request", {"action": "quit"})
            process.wait(timeout=40)
            main.close()
            main = None
            count_before = server.checks
            process = subprocess.Popen([str(program), "--autostart"], cwd=root, env=environment, creationflags=subprocess.CREATE_NO_WINDOW)
            main = wait_until(lambda: connect_page(port), description="restarted hidden main WebView")
            main.wait("Boolean(document.querySelector('.app-shell'))", 40)
            wait_until(lambda: server.checks > count_before, description="automatic startup check while hidden to tray")
            main.wait("window.__TAURI_INTERNALS__.invoke('update_status').then(s=>s.autoCheckEnabled && s.phase==='idle')")
            check("hidden startup performs the enabled automatic check", server.checks > count_before)
            server.tamper = True
            status = invoke(main, "update_download")
            check("tampered download fails signature verification without installing", status["phase"] == "idle" and bool(status["error"]) and fingerprint(program) == old_hash, status)
            server.tamper = False
            status = invoke(main, "update_download")
            check("valid download is verified and retained by native updater", status["phase"] == "ready" and status["installerPath"] is None, status)
            main.evaluate("[...document.querySelectorAll('.sidebar button')].find(button=>button.textContent.includes('版本与说明')).click()")
            main.wait("Boolean(document.querySelector('[data-testid=update-install]'))")
            check("installed ready package exposes the in-app install button", main.evaluate("!document.querySelector('[data-testid=update-install]').disabled"))
            child_label = invoke(main, "window_open", {"route": {"kind": "notes", "category": "随笔", "noteId": note["id"]}})
            child = wait_until(lambda: connect_page(port, child=True), description="independent notes WebView")
            child.wait("Boolean(window.__TAURI_INTERNALS__ && document.getElementById('root')?.children.length)", 40)
            check("independent notes editor participates in the native save barrier", invoke(child, "window_context")["label"] == child_label)
            # Tauri's invoke is non-writable. Its documented debugging callback Map
            # is mutable: intercept this independent window's real flush event,
            # replace its ACK with saved=false, and do not call the normal ACK.
            child.evaluate("""(()=>{const internals=window.__TAURI_INTERNALS__;window.__updaterTestCallbacks=[...internals.callbacks.entries()];window.__updaterTestRejected=false;for(const [id,original] of window.__updaterTestCallbacks){internals.callbacks.set(id,data=>{if(data?.event==='perfboard:close-request'&&data.payload?.action==='flush'){window.__updaterTestRejected=true;void internals.invoke('close_response',{action:'flush',requestId:data.payload.requestId,saved:false});return}return original(data)})}})()""")
            status = invoke(main, "update_install")
            check("a rejected independent-window save cancels native installation", status["phase"] == "ready" and bool(status["error"]) and child.evaluate("window.__updaterTestRejected") and process.poll() is None and fingerprint(program) == old_hash and registry_values(plan["productName"])["DisplayVersion"] == initial_version, status)
            child.evaluate("for(const [id,original] of window.__updaterTestCallbacks){if(window.__TAURI_INTERNALS__.callbacks.has(id))window.__TAURI_INTERNALS__.callbacks.set(id,original)}")
            main.wait("!document.getElementById('root').inert")
            main.screenshot(root / "before-upgrade.png")
            main = install_and_restart(main, program, plan["productName"], port, update_version)
            child.close()
            child = None
            after_status = invoke(main, "update_status")
            check("installed updater exits, upgrades and automatically restarts at " + update_version, after_status["currentVersion"] == update_version and after_status["installation"] == "installed" and fingerprint(program) != old_hash, after_status)
            if plan.get("applicationSha256"):
                check("upgraded executable matches the prepared new test binary", fingerprint(program).lower() == plan["applicationSha256"].lower())
            check("current-version manifest clears the update badge", after_status["available"] is None and main.evaluate("!document.querySelector('.nav-update-badge')"))
            check("repository pointer bytes are unchanged by the updater", pointer.read_bytes() == pointer_bytes)
            check("registry repository pointer is unchanged by the updater", registry_values(plan["productName"]).get("RepositoryPath") == registry_before.get("RepositoryPath"))
            check("synthetic core rows and attachment bytes survive the actual upgrade", core_snapshot(repository) == before)
            main.evaluate("[...document.querySelectorAll('.sidebar button')].find(button=>button.textContent.includes('版本与说明')).click()")
            main.wait("Boolean(document.querySelector('[data-testid=update-check]'))")
            main.screenshot(root / "after-upgrade.png")
            if plan.get("rollbackInstaller"):
                rollback_version = plan["rollbackVersion"]
                versions = invoke(main, "update_list_versions")
                check("historical catalog offers the signed rollback version", any(item["version"] == rollback_version and item["installable"] for item in versions), versions)
                check("unsigned legacy release remains non-executable", any(item["version"] == "0.1.0" and not item["installable"] for item in versions) and rejected(main, "update_download_version", {"tag": "v0.1.0"}))
                schema = server.releases[rollback_version]["schema"]
                server.releases[rollback_version]["schema"] = 5
                blocked = rejected(main, "update_download_version", {"tag": "v" + rollback_version})
                if not blocked:
                    blocked = rejected(main, "update_install", {"allowRollback": True})
                check("incompatible historical database schema prevents installation", blocked and invoke(main, "update_status")["currentVersion"] == update_version and core_snapshot(repository) == before)
                server.releases[rollback_version]["schema"] = schema
                status = invoke(main, "update_download_version", {"tag": "v" + rollback_version})
                check("selected old release downloads and verifies without becoming a latest-version badge", status["phase"] == "ready" and (status.get("target") or {}).get("version") == rollback_version and status["available"] is None, status)
                check("native rollback requires explicit user confirmation", rejected(main, "update_install", {"allowRollback": False}) and registry_values(plan["productName"])["DisplayVersion"] == update_version)
                main.screenshot(root / "before-rollback.png")
                main = install_and_restart(main, program, plan["productName"], port, rollback_version, allow_rollback=True)
                rolled_back = invoke(main, "update_status")
                check("explicit rollback installs and automatically restarts at " + rollback_version, rolled_back["currentVersion"] == rollback_version and rolled_back["installation"] == "installed", rolled_back)
                if rollback_version == initial_version:
                    check("rollback executable matches the prepared original binary", fingerprint(program) == old_hash)
                check("old version still reads its original updater preference schema", rolled_back["autoCheckEnabled"] is True and rolled_back["error"] is None)
                check("rollback preserves synthetic records attachments and repository pointers", core_snapshot(repository) == before and pointer.read_bytes() == pointer_bytes and registry_values(plan["productName"]).get("RepositoryPath") == registry_before.get("RepositoryPath"))
                check("automatic check after rollback only offers the newer version", rolled_back["available"] is not None and rolled_back["available"]["version"] == update_version)
                main.evaluate("[...document.querySelectorAll('.sidebar button')].find(button=>button.textContent.includes('版本与说明')).click()")
                main.wait("Boolean(document.querySelector('[data-testid=update-check]'))")
                main.screenshot(root / "after-rollback.png")
    except Exception as error:
        if main:
            try:
                main.screenshot(root / "failure.png")
            except Exception:
                pass
        (root / "native-updater-failure.txt").write_text(str(error), encoding="utf-8")
        raise
    finally:
        if child:
            child.close()
        if main:
            try:
                invoke(main, "app_close_request", {"action": "quit"})
            except Exception:
                pass
            main.close()
        if process and process.poll() is None:
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                # This handle belongs only to the GUID test program launched above.
                process.terminate()
                process.wait(timeout=15)
        cleanup_product(plan, environment)
        check("isolated GUID product and its processes are cleaned up; synthetic data retained", not registry_values(plan["productName"]) and repository.is_dir())
    print(json.dumps({"passed": len(results), "report": str(report), "productName": plan["productName"], "validationRoot": str(root)}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--signature", required=True, type=Path)
    parser.add_argument("--private-key", type=Path, help="Optional fixture key inside validationRoot, passed to Tauri CLI by path only")
    parser.add_argument("--rollback-signature", type=Path, help="Signature for the optional explicit rollback installer inside validationRoot")
    parser.add_argument("--port", type=int, default=9345)
    parser.add_argument("--inspect-plan", action="store_true", help="Validate path constraints without launching any executable")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("--port must be an unprivileged TCP port")
    plan = read_plan(args.plan, args.signature, args.private_key, args.rollback_signature)
    if args.inspect_plan:
        print(json.dumps({"accepted": True, "productName": plan["productName"], "validationRoot": str(plan["validationRoot"]), "constraints": "GUID test product, paths contained in validationRoot, no symlinks/junctions, local HTTP only; no installers executed"}, ensure_ascii=False))
    else:
        run(plan, args.port)


if __name__ == "__main__":
    main()
