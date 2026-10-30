"""Coordinate the GitHub Actions Gitee mirror without embedding credentials in Git URLs."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import sys
import tempfile
from time import sleep as retry_sleep

ROOT = Path(__file__).resolve().parents[1]
REMOTE = "https://gitee.com/deng-xiangjie/perfboard.git"
INDEX_REF = "refs/heads/gitee-updates"
STABLE = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
PROBE_TAG = re.compile(r"mirror-upload-probe-[1-9][0-9]*-[1-9][0-9]*-[0-9a-f]{16}\Z")
PROBE_SOURCE_COMMIT = "82a1c0af8c1ff950604a8b293093e71abd7ae920"
TEMPORARY_EXIT_CODE = 75
SYNC_ATTEMPTS = 3
SYNC_RETRY_DELAYS = (30, 60)


def append_summary(environment: dict[str, str], text: str) -> None:
    path = environment.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as output:
            output.write(text + "\n")


def authorize(environment: dict[str, str]) -> bool:
    mode = environment.get("RUN_MODE", "sync")
    if mode not in ("sync", "validate", "dry_run", "verify_upload", "cleanup_upload"):
        raise ValueError("Unsupported mirror mode.")
    allowed = mode not in ("sync", "verify_upload", "cleanup_upload") or bool(environment.get("GITEE_TOKEN", "").strip())
    if environment.get("GITHUB_OUTPUT"):
        with open(environment["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write("mode=" + mode + "\nrun=" + str(allowed).lower() + "\n")
    if not allowed:
        message = "尚未配置 GITEE_TOKEN，未同步。请按 docs/GITEE-MIRROR.md 配置 Actions Secret 后再运行。"
        print(message)
        append_summary(environment, "### Gitee mirror skipped\n\n" + message)
    return allowed


def select_releases(environment: dict[str, str]) -> list[str]:
    if environment.get("RUN_MODE") in ("verify_upload", "cleanup_upload"):
        if environment.get("EVENT_NAME") != "workflow_dispatch":
            raise ValueError("Upload verification is available only through manual workflow dispatch.")
        return []
    tags: set[str] = set()
    if environment.get("EVENT_NAME") == "release":
        tags.add(environment.get("RELEASE_TAG", ""))
    if environment.get("EVENT_NAME") == "workflow_dispatch":
        requested = environment.get("REQUESTED_TAG", "").strip()
        if requested:
            tags.add(requested)
        if environment.get("SEED_HISTORY") == "true":
            tags.update(("v0.1.1", "v0.1.2"))
    if any(STABLE.fullmatch(tag) is None for tag in tags):
        raise ValueError("只支持 vX.Y.Z 正式版本标签，例如 v0.1.2；不接受预发布或无 v 标签。")
    result = sorted(tags, key=lambda tag: tuple(map(int, STABLE.fullmatch(tag).groups())))
    if environment.get("RUN_MODE") == "dry_run" and not result:
        raise ValueError("dry_run 需要填写 tag 或勾选 seed_history，不会执行同步。")
    return result


def redacted(text: str, environment: dict[str, str]) -> str:
    for key in ("GITEE_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
        value = environment.get(key)
        if value:
            text = text.replace(value, "[redacted]")
    return text[-3000:]


class GitFailure(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False, index_conflict: bool = False):
        super().__init__(message)
        self.retryable = retryable
        self.index_conflict = index_conflict


def temporary_git_failure(stdout: str, stderr: str) -> bool:
    # Use Git's C-locale diagnostics only for remote operations. History,
    # permission and certificate failures must never become retry loops.
    text = stdout + "\n" + stderr
    if re.search(r"\[(?:rejected|remote rejected)\]|authentication failed|access denied|permission denied|"
                 r"could not read (?:username|password)|certificate (?:problem|verification failed)|"
                 r"SSL certificate|requested URL returned error: (?:401|403)", text, re.IGNORECASE):
        return False
    return bool(re.search(
        r"could not resolve (?:host|proxy)|failed to connect to|connection (?:timed out|reset|refused|closed)|"
        r"operation timed out|remote end hung up unexpectedly|SSL_ERROR_SYSCALL|"
        r"(?:recv|send) failure|TLS connection was non-properly terminated|"
        r"requested URL returned error: (?:408|429|5[0-9]{2})\b|"
        r"RPC failed; curl (?:5|6|7|16|18|28|35|52|55|56|92|95|97)\b",
        text, re.IGNORECASE))


class Git:
    def __init__(self, environment: dict[str, str]):
        self.environment = environment

    def __call__(self, *arguments: str, cwd: Path, accepted: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess:
        command = ["git", "-c", "credential.helper=", "-c", "credential.useHttpPath=true",
                   "-c", "http.followRedirects=false", *arguments]
        remote_operation = arguments[0] in ("push", "fetch", "ls-remote")
        try:
            result = subprocess.run(command, cwd=cwd, env=self.environment, text=True,
                                    encoding="utf-8", errors="replace", capture_output=True, timeout=600)
        except subprocess.TimeoutExpired:
            if not remote_operation:
                raise
            raise GitFailure("Gitee Git 请求达到 600 秒期限；重试前会重新读取远端状态。", retryable=True) from None
        if result.returncode not in accepted:
            raise GitFailure("Gitee Git 同步失败；请检查权限或不同历史。main 和已有版本标签不会被强推。\n"
                             + redacted(result.stderr, self.environment),
                             retryable=result.returncode > 0 and remote_operation and temporary_git_failure(result.stdout, result.stderr),
                             index_conflict=result.returncode > 0 and any(line == "!\tHEAD:" + INDEX_REF + "\t[rejected] (stale info)"
                                                for line in result.stdout.splitlines()))
        return result


def index_name(name: str) -> bool:
    return name in ("latest.json", "versions.json") or (
        name.startswith("releases/") and name.endswith(".json")
        and STABLE.fullmatch(name[len("releases/"):-len(".json")]) is not None)


def prepare_index(git: Git, directory: Path, remote: str) -> str:
    git("init", "--quiet", "--initial-branch=gitee-updates", str(directory), cwd=directory.parent)
    existing = git("ls-remote", "--heads", remote, INDEX_REF, cwd=directory).stdout.strip()
    if not existing:
        return ""
    git("fetch", "--quiet", "--no-tags", "--depth=1", remote, INDEX_REF, cwd=directory)
    base = git("rev-parse", "FETCH_HEAD", cwd=directory).stdout.strip()
    for entry in filter(None, git("ls-tree", "-r", "-z", "FETCH_HEAD", cwd=directory).stdout.split("\0")):
        metadata, name = entry.split("\t", 1)
        mode, kind, _object = metadata.split(" ", 2)
        if mode != "100644" or kind != "blob" or not index_name(name):
            raise ValueError("Existing gitee-updates is not a JSON-only index; refusing to overwrite it.")
    git("checkout", "--quiet", "-B", "gitee-updates", "FETCH_HEAD", cwd=directory)
    return base


def publish_index(git: Git, directory: Path, remote: str, base: str, tags: list[str]) -> bool:
    files: list[str] = []
    for path in directory.rglob("*"):
        relative = path.relative_to(directory)
        if ".git" in relative.parts:
            continue
        if path.is_symlink():
            raise ValueError("Update index cannot contain symbolic links.")
        if path.is_file():
            if not index_name(relative.as_posix()):
                raise ValueError("Update index may contain only approved JSON paths.")
            json.loads(path.read_text(encoding="utf-8"))
            files.append(relative.as_posix())
    if not files:
        return False
    git("add", "--", *files, cwd=directory)
    if git("diff", "--cached", "--quiet", "--exit-code", cwd=directory, accepted=(0, 1)).returncode == 0:
        return False
    git("-c", "user.name=Perfboard mirror", "-c", "user.email=mirror@users.noreply.github.com",
        "commit", "--quiet", "-m", "Mirror verified release metadata: " + ", ".join(tags), cwd=directory)
    try:
        git("push", "--porcelain", "--force-with-lease=" + INDEX_REF + ":" + base,
            remote, "HEAD:" + INDEX_REF, cwd=directory)
    except GitFailure as error:
        if not error.index_conflict:
            raise
        raise GitFailure("Gitee 更新索引已被其它操作更新，将重新读取后重试。", retryable=True) from None
    return True


def mirror_release(tag: str, directory: Path, environment: dict[str, str], dry_run: bool = False) -> None:
    command = ["node", str(ROOT / "scripts/mirror-gitee-release.mjs"), "--tag", tag,
               "--updates-directory", str(directory)]
    if dry_run:
        command.append("--dry-run")
    subprocess.run(command, env=environment, check=True, cwd=ROOT)


def credential_environment(directory: Path, environment: dict[str, str]) -> dict[str, str]:
    helper = directory / "askpass.py"
    helper.write_text("import os, sys\n"
                      "prompt = sys.argv[1].lower()\n"
                      "key = 'GITEE_USERNAME' if 'username' in prompt else 'GITEE_TOKEN' if 'password' in prompt else None\n"
                      "if key is None: raise SystemExit(1)\n"
                      "sys.stdout.write(os.environ[key] + '\\n')\n", encoding="utf-8")
    helper.chmod(0o600)
    executable = directory / "askpass"
    # GIT_ASKPASS names an executable, not a shell command with arguments.
    # Keep both paths quoted inside the wrapper, including Python installations
    # or runner temporary directories containing spaces. No credential is saved.
    interpreter = Path(sys.executable).as_posix()
    executable.write_text("#!/bin/sh\nexec " + shlex.quote(interpreter) + " "
                          + shlex.quote(helper.as_posix()) + ' "$@"\n', encoding="utf-8", newline="\n")
    executable.chmod(0o700)
    child = environment.copy()
    child["GITEE_USERNAME"] = "deng-xiangjie"
    child["GIT_ASKPASS"] = str(executable)
    child["GIT_TERMINAL_PROMPT"] = "0"
    child["LC_ALL"] = "C"
    return child


def probe_marker(tag: str, commit: str) -> str:
    return "<!-- perfboard-upload-probe:v1 tag=" + tag + " source=dengxiangjie12138/perfboard commit=" + commit + " -->"


def probe_result(filename: Path, tag: str, commit: str) -> dict | None:
    if not filename.exists():
        return None
    if filename.is_symlink() or not filename.is_file() or filename.stat().st_size > 64 * 1024:
        raise ValueError("Upload probe cleanup acknowledgement is not a bounded regular file.")
    result = json.loads(filename.read_text(encoding="utf-8"))
    if not isinstance(result, dict):
        raise ValueError("Upload probe cleanup acknowledgement is invalid.")
    release_id = result.get("releaseId")
    if (not PROBE_TAG.fullmatch(tag) or type(result.get("schemaVersion")) is not int or result.get("schemaVersion") != 1
            or result.get("tag") != tag or result.get("sourceCommit") != commit
            or result.get("sourceTag") != "v0.1.2" or result.get("releaseMarker") != probe_marker(tag, commit)
            or result.get("releaseCleanupConfirmed") is not True
            or type(result.get("uploadVerified")) is not bool
            or (release_id is not None and (type(release_id) is not int or release_id <= 0))):
        raise ValueError("Upload probe cleanup ownership was not confirmed; preserving the temporary tag.")
    return result


def invoke_upload_probe(tag: str, commit: str, filename: Path, environment: dict[str, str]) -> None:
    subprocess.run(["node", str(ROOT / "scripts/probe-gitee-upload.mjs"), "--tag", tag,
                    "--source-commit", commit, "--result-file", str(filename)],
                   env=environment, check=True, cwd=ROOT)


def verify_upload(source: Path, environment: dict[str, str]) -> None:
    if environment.get("EVENT_NAME") != "workflow_dispatch" or not environment.get("GITEE_TOKEN", "").strip():
        raise ValueError("Upload verification requires a manual dispatch with GITEE_TOKEN.")
    run_id, attempt = environment.get("GITHUB_RUN_ID", ""), environment.get("GITHUB_RUN_ATTEMPT", "")
    if not all(re.fullmatch(r"[1-9][0-9]*", value) for value in (run_id, attempt)):
        raise ValueError("Upload verification requires trusted GitHub run identifiers.")
    tag = "mirror-upload-probe-" + run_id + "-" + attempt + "-" + secrets.token_hex(8)
    if not PROBE_TAG.fullmatch(tag) or STABLE.fullmatch(tag):
        raise ValueError("Upload verification cannot use a production version tag.")
    reference = "refs/tags/" + tag
    with tempfile.TemporaryDirectory(prefix="perfboard-gitee-probe-", dir=environment.get("RUNNER_TEMP")) as temporary:
        child = credential_environment(Path(temporary), environment)
        child["GIT_TRACE"] = child["GIT_TRACE_CURL"] = "0"
        child.pop("GIT_CURL_VERBOSE", None)
        git = Git(child)
        actual = git("rev-parse", "--verify", "refs/tags/v0.1.2^{commit}", cwd=source).stdout.strip()
        if actual != PROBE_SOURCE_COMMIT:
            raise ValueError("The fixed upload probe source tag has changed; no writes were started.")
        print("Creating isolated non-version upload probe tag " + tag, flush=True)
        try:
            pushed = git("push", "--porcelain", "--force-with-lease=" + reference + ":", REMOTE,
                         PROBE_SOURCE_COMMIT + ":" + reference, cwd=source)
            # Git can report an identical existing tag as up-to-date despite an
            # expected-absent lease. Only a confirmed new tag grants ownership.
            if not any(line.startswith("*\t") and line.split("\t")[1].endswith(":" + reference)
                       for line in pushed.stdout.splitlines() if "\t" in line):
                raise ValueError("The isolated probe tag was not newly created; no Release was touched.")
        except (GitFailure, ValueError, subprocess.SubprocessError):
            append_summary(environment, "### Gitee upload verification stopped\n\nTemporary tag creation was not confirmed: `" + tag + "`. No Release upload was started.")
            raise
        filename = Path(temporary) / "cleanup-result.json"
        try:
            invoke_upload_probe(tag, PROBE_SOURCE_COMMIT, filename, child)
        finally:
            result = probe_result(filename, tag, PROBE_SOURCE_COMMIT)
            if result is None:
                append_summary(environment, "### Gitee upload verification needs cleanup\n\nRelease absence was not confirmed. Temporary tag preserved: `" + tag + "`. Production releases and update indexes were not modified.")
                raise ValueError("Release cleanup was not confirmed; preserving isolated tag " + tag)
            try:
                git("push", "--porcelain", "--force-with-lease=" + reference + ":" + PROBE_SOURCE_COMMIT,
                    REMOTE, ":" + reference, cwd=source)
            except (GitFailure, subprocess.SubprocessError):
                append_summary(environment, "### Gitee upload verification needs cleanup\n\nThe owned Release is absent, but temporary tag deletion was not confirmed: `" + tag + "`. No different tag value was overwritten.")
                raise
            append_summary(environment, "### Gitee isolated upload verification\n\n"
                           + ("Signed installer upload verified. " if result["uploadVerified"] else "Installer upload did not pass verification. ")
                           + "Owned temporary Release and tag were removed. Production releases and update indexes were not modified.")
        if not result["uploadVerified"]:
            raise ValueError("The isolated installer upload did not pass verification; temporary resources were removed.")


def remote_probe_sha(git: Git, source: Path, reference: str) -> str | None:
    lines = git("ls-remote", "--refs", "--tags", REMOTE, reference, cwd=source).stdout.strip().splitlines()
    if not lines:
        return None
    if len(lines) != 1 or re.fullmatch(r"[0-9a-f]{40}\t" + re.escape(reference), lines[0]) is None:
        raise ValueError("The temporary tag state is ambiguous; cleanup stopped.")
    return lines[0].split("\t", 1)[0]


def invoke_upload_cleanup(tag: str, release_id: int, commit: str, filename: Path, environment: dict[str, str]) -> None:
    subprocess.run(["node", str(ROOT / "scripts/probe-gitee-upload.mjs"), "--cleanup-only", "--tag", tag,
                    "--release-id", str(release_id), "--source-commit", commit, "--result-file", str(filename)],
                   env=environment, check=True, cwd=ROOT)


def cleanup_upload(source: Path, environment: dict[str, str]) -> None:
    if environment.get("EVENT_NAME") != "workflow_dispatch" or not environment.get("GITEE_TOKEN", "").strip():
        raise ValueError("Upload cleanup requires a manual dispatch with GITEE_TOKEN.")
    tag, release_text = environment.get("REQUESTED_TAG", ""), environment.get("CLEANUP_RELEASE_ID", "")
    if (PROBE_TAG.fullmatch(tag) is None or re.fullmatch(r"[1-9][0-9]*", release_text) is None
            or len(release_text) > 16 or int(release_text) > 9007199254740991):
        raise ValueError("Cleanup requires an exact temporary probe tag and a positive safe release ID; production tags are forbidden.")
    release_id = int(release_text)
    reference = "refs/tags/" + tag
    with tempfile.TemporaryDirectory(prefix="perfboard-gitee-cleanup-", dir=environment.get("RUNNER_TEMP")) as temporary:
        child = credential_environment(Path(temporary), environment)
        child["GIT_TRACE"] = child["GIT_TRACE_CURL"] = "0"
        child.pop("GIT_CURL_VERBOSE", None)
        git = Git(child)
        actual = git("rev-parse", "--verify", "refs/tags/v0.1.2^{commit}", cwd=source).stdout.strip()
        if actual != PROBE_SOURCE_COMMIT:
            raise ValueError("The fixed cleanup source commit changed; no writes were started.")
        before = remote_probe_sha(git, source, reference)
        if before is not None and before != PROBE_SOURCE_COMMIT:
            raise ValueError("The temporary tag commit changed; refusing cleanup.")
        filename = Path(temporary) / "cleanup-result.json"
        print("Cleaning only isolated probe " + tag + " / Release " + str(release_id), flush=True)
        try:
            invoke_upload_cleanup(tag, release_id, PROBE_SOURCE_COMMIT, filename, child)
        finally:
            result = probe_result(filename, tag, PROBE_SOURCE_COMMIT)
            if result is None or result["releaseId"] != release_id:
                append_summary(environment, "### Gitee probe cleanup unconfirmed\n\nTemporary tag `" + tag
                               + "` and Release `" + str(release_id) + "` need inspection. No tag was deleted.")
                raise ValueError("Exact Release cleanup acknowledgement is missing; preserving temporary tag " + tag)
            after = remote_probe_sha(git, source, reference)
            if after is not None:
                if before is None or after != PROBE_SOURCE_COMMIT:
                    raise ValueError("The temporary tag changed during Release cleanup; preserving it.")
                git("push", "--porcelain", "--force-with-lease=" + reference + ":" + PROBE_SOURCE_COMMIT,
                    REMOTE, ":" + reference, cwd=source)
            append_summary(environment, "### Gitee isolated probe cleanup completed\n\n"
                           + "Owned Release `" + str(release_id) + "` and temporary tag `" + tag
                           + "` are absent. No installer was uploaded. Production releases and update indexes were not modified.")


def sync_once(tags: list[str], source: Path, environment: dict[str, str], remote: str) -> None:
    # A failed upload can have succeeded remotely. Every attempt gets a fresh
    # index and re-enters release/attachment discovery and hash verification.
    with tempfile.TemporaryDirectory(prefix="perfboard-gitee-", dir=environment.get("RUNNER_TEMP")) as temporary:
        root = Path(temporary)
        child = credential_environment(root, environment)
        child["GIT_TRACE"] = child["GIT_TRACE_CURL"] = "0"
        # Unlike GIT_TRACE_CURL, any nonempty GIT_CURL_VERBOSE value enables it.
        child.pop("GIT_CURL_VERBOSE", None)
        git = Git(child)
        git("rev-parse", "--verify", "refs/remotes/origin/main", cwd=source)
        names = git("for-each-ref", "--format=%(refname:strip=2)", "refs/tags", cwd=source).stdout.splitlines()
        version_tags = sorted((name for name in names if STABLE.fullmatch(name)),
                              key=lambda tag: tuple(map(int, STABLE.fullmatch(tag).groups())))
        refspecs = ["refs/remotes/origin/main:refs/heads/main"]
        refspecs.extend("refs/tags/" + tag + ":refs/tags/" + tag for tag in version_tags)
        print("Syncing main and %d stable version tags." % len(version_tags))
        print(redacted(git("push", "--porcelain", remote, *refspecs, cwd=source).stdout, child))
        if tags:
            index = root / "updates"
            base = prepare_index(git, index, remote)
            for tag in tags:
                print("Mirroring verified release " + tag, flush=True)
                mirror_release(tag, index, child)
            changed = publish_index(git, index, remote, base, tags)
            print("Verified JSON index published with CAS." if changed else "Update index already matches; no commit needed.")


def sync(tags: list[str], source: Path, environment: dict[str, str], remote: str = REMOTE) -> None:
    if not environment.get("GITEE_TOKEN", "").strip():
        raise ValueError("Mirror authorization is unavailable; no writes were started.")
    if any(STABLE.fullmatch(tag) is None for tag in tags):
        raise ValueError("Invalid release selection; no writes were started.")
    for attempt in range(1, SYNC_ATTEMPTS + 1):
        print("Gitee mirror attempt %d/%d." % (attempt, SYNC_ATTEMPTS), flush=True)
        try:
            sync_once(tags, source, environment, remote)
        except (GitFailure, subprocess.CalledProcessError) as error:
            retryable = (error.retryable if isinstance(error, GitFailure)
                         else error.returncode == TEMPORARY_EXIT_CODE)
            if not retryable or attempt == SYNC_ATTEMPTS:
                append_summary(environment, "### Gitee mirror failed\n\n"
                               + ("Temporary failures exhausted all 3 attempts. " if retryable else "A non-retryable error stopped synchronization. ")
                               + "Only verified files can enter the update index. See the failed step for the cause; rerun the same tag after resolving it.")
                raise
            delay = SYNC_RETRY_DELAYS[attempt - 1]
            message = ("Temporary Gitee mirror failure on attempt %d/%d. Retrying in %d seconds; "
                       "remote releases, attachments and the current index will be rechecked.") % (attempt, SYNC_ATTEMPTS, delay)
            print("::warning::" + message, flush=True)
            append_summary(environment, "- " + message)
            retry_sleep(delay)
        else:
            append_summary(environment, "### Gitee mirror completed\n\n"
                           + "- Attempts: %d/%d.\n" % (attempt, SYNC_ATTEMPTS)
                           + "- Source: GitHub main and stable version tags.\n"
                           + "- Releases requested: " + (", ".join(tags) or "none (code only)") + ".\n"
                           + "- Destination: https://gitee.com/deng-xiangjie/perfboard")
            return


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--authorize-only", action="store_true")
    group.add_argument("--select-releases", action="store_true")
    args = parser.parse_args(argv)
    environment = os.environ.copy()
    try:
        if args.select_releases:
            tags = select_releases(environment)
            with open(environment["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
                output.write("tags=" + json.dumps(tags, separators=(",", ":")) + "\n")
            return 0
        if not authorize(environment) or args.authorize_only:
            return 0
        mode = environment.get("RUN_MODE", "sync")
        tags = json.loads(environment.get("RELEASE_TAGS", "[]"))
        if not isinstance(tags, list) or any(not isinstance(tag, str) or STABLE.fullmatch(tag) is None for tag in tags):
            raise ValueError("Invalid release selection; no writes were started.")
        if mode == "validate":
            subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "scripts/tests", "-p", "test_gitee_mirror.py"], check=True, cwd=ROOT)
            subprocess.run(["node", "--test", "--test-isolation=none", "scripts/tests/mirror-gitee-release.node-test.mjs",
                            "scripts/tests/probe-gitee-upload.node-test.mjs"], check=True, cwd=ROOT)
            append_summary(environment, "### Gitee mirror validation passed\n\n仅运行隔离测试，未同步远程仓库或创建 Gitee 发布。")
        elif mode == "dry_run":
            if not tags:
                raise ValueError("dry_run requires a tag or seed_history.")
            child = environment.copy()
            child.pop("GITEE_TOKEN", None)
            with tempfile.TemporaryDirectory(prefix="perfboard-gitee-dry-run-", dir=environment.get("RUNNER_TEMP")) as temporary:
                for tag in tags:
                    mirror_release(tag, Path(temporary), child, dry_run=True)
            append_summary(environment, "### Gitee mirror dry run completed\n\n仅只读校验 GitHub 发布与签名，未同步 Git、上传附件或写入 Gitee 索引。")
        elif mode == "verify_upload":
            if tags:
                raise ValueError("Isolated upload verification cannot select production releases.")
            verify_upload(ROOT, environment)
        elif mode == "cleanup_upload":
            if tags:
                raise ValueError("Isolated cleanup cannot select production releases.")
            cleanup_upload(ROOT, environment)
        else:
            sync(tags, ROOT, environment)
        return 0
    except (OSError, ValueError, GitFailure, subprocess.SubprocessError) as error:
        print("::error::" + redacted(str(error), environment), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
