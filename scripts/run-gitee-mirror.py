"""Coordinate the GitHub Actions Gitee mirror without embedding credentials in Git URLs."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REMOTE = "https://gitee.com/deng-xiangjie/perfboard.git"
INDEX_REF = "refs/heads/gitee-updates"
STABLE = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")


def append_summary(environment: dict[str, str], text: str) -> None:
    path = environment.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as output:
            output.write(text + "\n")


def authorize(environment: dict[str, str]) -> bool:
    mode = environment.get("RUN_MODE", "sync")
    if mode not in ("sync", "validate", "dry_run"):
        raise ValueError("Unsupported mirror mode.")
    allowed = mode != "sync" or bool(environment.get("GITEE_TOKEN", "").strip())
    if environment.get("GITHUB_OUTPUT"):
        with open(environment["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write("mode=" + mode + "\nrun=" + str(allowed).lower() + "\n")
    if not allowed:
        message = "尚未配置 GITEE_TOKEN，未同步。请按 docs/GITEE-MIRROR.md 配置 Actions Secret 后再运行。"
        print(message)
        append_summary(environment, "### Gitee mirror skipped\n\n" + message)
    return allowed


def select_releases(environment: dict[str, str]) -> list[str]:
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
    pass


class Git:
    def __init__(self, environment: dict[str, str]):
        self.environment = environment

    def __call__(self, *arguments: str, cwd: Path, accepted: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess:
        command = ["git", "-c", "credential.helper=", "-c", "credential.useHttpPath=true",
                   "-c", "http.followRedirects=false", *arguments]
        result = subprocess.run(command, cwd=cwd, env=self.environment, text=True,
                                encoding="utf-8", errors="replace", capture_output=True, timeout=600)
        if result.returncode not in accepted:
            raise GitFailure("Gitee Git 同步失败；请检查权限或不同历史。main 和已有版本标签不会被强推。\n"
                             + redacted(result.stderr, self.environment))
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
    git("push", "--porcelain", "--force-with-lease=" + INDEX_REF + ":" + base,
        remote, "HEAD:" + INDEX_REF, cwd=directory)
    return True


def mirror_release(tag: str, directory: Path, environment: dict[str, str], dry_run: bool = False) -> None:
    command = ["node", str(ROOT / "scripts/mirror-gitee-release.mjs"), "--tag", tag,
               "--updates-directory", str(directory)]
    if dry_run:
        command.append("--dry-run")
    subprocess.run(command, env=environment, check=True, cwd=ROOT)


def sync(tags: list[str], source: Path, environment: dict[str, str], remote: str = REMOTE) -> None:
    if not environment.get("GITEE_TOKEN", "").strip():
        raise ValueError("Mirror authorization is unavailable; no writes were started.")
    if any(STABLE.fullmatch(tag) is None for tag in tags):
        raise ValueError("Invalid release selection; no writes were started.")
    with tempfile.TemporaryDirectory(prefix="perfboard-gitee-", dir=environment.get("RUNNER_TEMP")) as temporary:
        root = Path(temporary)
        helper = root / "askpass.py"
        helper.write_text("import os, sys\n"
                          "prompt = sys.argv[1].lower()\n"
                          "key = 'GITEE_USERNAME' if 'username' in prompt else 'GITEE_TOKEN' if 'password' in prompt else None\n"
                          "if key is None: raise SystemExit(1)\n"
                          "sys.stdout.write(os.environ[key] + '\\n')\n", encoding="utf-8")
        helper.chmod(0o600)
        child = environment.copy()
        child["GITEE_USERNAME"] = "deng-xiangjie"
        child["GIT_ASKPASS"] = shlex.quote(sys.executable) + " " + shlex.quote(str(helper))
        child["GIT_TERMINAL_PROMPT"] = "0"
        child["GIT_TRACE"] = child["GIT_TRACE_CURL"] = child["GIT_CURL_VERBOSE"] = "0"
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
        append_summary(environment, "### Gitee mirror completed\n\n"
                       "- Source: GitHub main and %d stable version tags.\n" % len(version_tags)
                       + "- Releases requested: " + (", ".join(tags) or "none (code only)") + ".\n"
                       + "- Destination: https://gitee.com/deng-xiangjie/perfboard")


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
            subprocess.run(["node", "--test", "--test-isolation=none", "scripts/tests/mirror-gitee-release.node-test.mjs"], check=True, cwd=ROOT)
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
        else:
            sync(tags, ROOT, environment)
        return 0
    except (OSError, ValueError, GitFailure, subprocess.SubprocessError) as error:
        print("::error::" + redacted(str(error), environment), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
