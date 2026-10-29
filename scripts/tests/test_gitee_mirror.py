"""Only temporary local Git repositories are written; no network services are used."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / "run-gitee-mirror.py"
SPEC = importlib.util.spec_from_file_location("run_gitee_mirror", SCRIPT)
mirror = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mirror)


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="perfboard-mirror-test-")
        self.root = Path(self.temporary.name).resolve()
        self.assertTrue(self.root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
        self.addCleanup(self.temporary.cleanup)
        self.source = self.root / "source"
        self.remote = self.root / "destination.git"
        self.git("init", "--quiet", "--initial-branch=main", str(self.source))
        self.git("init", "--quiet", "--bare", str(self.remote))
        (self.source / "README.md").write_text("fixture only\n", encoding="utf-8")
        self.git("add", ".", cwd=self.source)
        self.git("commit", "--quiet", "-m", "fixture", cwd=self.source)
        self.head = self.git("rev-parse", "HEAD", cwd=self.source)
        self.git("update-ref", "refs/remotes/origin/main", self.head, cwd=self.source)
        self.git("branch", "codex/old-backup", cwd=self.source)
        for tag in ("v0.1.1", "v0.1.2", "v0.2.0-rc.1", "0.1.3"):
            self.git("tag", tag, cwd=self.source)
        self.environment = dict(os.environ, GITEE_TOKEN="fixture-not-a-real-token", GITEE_USERNAME="deng-xiangjie",
                                RUNNER_TEMP=str(self.root), GITHUB_STEP_SUMMARY=str(self.root / "summary.md"))
        self.git_client = mirror.Git(self.environment)

    def git(self, *arguments, cwd=None):
        result = subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", *arguments],
                                cwd=cwd or self.root, capture_output=True, text=True, check=True)
        return result.stdout.strip()

    def index(self, name):
        directory = self.root / name
        base = mirror.prepare_index(self.git_client, directory, str(self.remote))
        return directory, base

    def write_index(self, directory, version):
        (directory / "releases").mkdir(exist_ok=True)
        data = {"version": version}
        for name in ("latest.json", "versions.json", "releases/v" + version + ".json"):
            (directory / name).write_text(json.dumps(data), encoding="utf-8")

    def test_precise_main_and_stable_tags_leave_backup_and_prerelease_refs_out(self):
        mirror.sync([], self.source, self.environment, str(self.remote))
        refs = self.git("--git-dir", str(self.remote), "for-each-ref", "--format=%(refname)").splitlines()
        self.assertEqual(refs, ["refs/heads/main", "refs/tags/v0.1.1", "refs/tags/v0.1.2"])
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", "main"), self.head)

    def test_divergent_destination_is_not_force_pushed(self):
        other = self.root / "other"
        self.git("init", "--quiet", "--initial-branch=main", str(other))
        (other / "LICENSE").write_text("independent fixture\n", encoding="utf-8")
        self.git("add", ".", cwd=other)
        self.git("commit", "--quiet", "-m", "different history", cwd=other)
        before = self.git("rev-parse", "HEAD", cwd=other)
        self.git("push", "--quiet", str(self.remote), "HEAD:refs/heads/main", cwd=other)
        with self.assertRaises(mirror.GitFailure):
            mirror.sync([], self.source, self.environment, str(self.remote))
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", "main"), before)

    def test_json_only_index_is_orphaned_from_source_and_repeated_publish_is_noop(self):
        mirror.sync([], self.source, self.environment, str(self.remote))
        directory, base = self.index("index")
        self.assertEqual(base, "")
        self.write_index(directory, "0.1.2")
        self.assertTrue(mirror.publish_index(self.git_client, directory, str(self.remote), base, ["v0.1.2"]))
        parents = self.git("--git-dir", str(self.remote), "rev-list", "--parents", "-n", "1", mirror.INDEX_REF).split()
        self.assertEqual(len(parents), 1)
        names = self.git("--git-dir", str(self.remote), "ls-tree", "-r", "--name-only", mirror.INDEX_REF).splitlines()
        self.assertEqual(names, ["latest.json", "releases/v0.1.2.json", "versions.json"])
        second, base2 = self.index("second-index")
        self.assertFalse(mirror.publish_index(self.git_client, second, str(self.remote), base2, ["v0.1.2"]))

    def test_index_cas_rejects_a_concurrent_publisher(self):
        first, base = self.index("first")
        self.write_index(first, "0.1.1")
        mirror.publish_index(self.git_client, first, str(self.remote), base, ["v0.1.1"])
        stale, stale_base = self.index("stale")
        concurrent, concurrent_base = self.index("concurrent")
        self.write_index(concurrent, "0.1.2")
        mirror.publish_index(self.git_client, concurrent, str(self.remote), concurrent_base, ["v0.1.2"])
        current = self.git("--git-dir", str(self.remote), "rev-parse", mirror.INDEX_REF)
        self.write_index(stale, "0.1.3")
        with self.assertRaises(mirror.GitFailure):
            mirror.publish_index(self.git_client, stale, str(self.remote), stale_base, ["v0.1.3"])
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", mirror.INDEX_REF), current)

    def test_existing_index_with_source_files_is_rejected_before_checkout(self):
        self.git("push", "--quiet", str(self.remote), "HEAD:" + mirror.INDEX_REF, cwd=self.source)
        with self.assertRaises(ValueError):
            self.index("invalid-index")
        self.assertFalse((self.root / "invalid-index/README.md").exists())

    def test_missing_secret_succeeds_with_explicit_skip_and_no_sync(self):
        environment = dict(self.environment, RUN_MODE="sync", GITEE_TOKEN="", GITHUB_OUTPUT=str(self.root / "output"))
        with patch.dict(os.environ, environment, clear=True), patch.object(mirror, "sync") as sync, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(mirror.main([]), 0)
        sync.assert_not_called()
        self.assertIn("未同步", (self.root / "summary.md").read_text(encoding="utf-8"))
        self.assertIn("run=false", (self.root / "output").read_text(encoding="utf-8"))

    def test_dry_run_strips_gitee_token_and_never_calls_git_sync(self):
        environment = dict(self.environment, RUN_MODE="dry_run", RELEASE_TAGS='["v0.1.2"]')
        with patch.dict(os.environ, environment, clear=True), patch.object(mirror, "mirror_release") as release, patch.object(mirror, "sync") as sync:
            self.assertEqual(mirror.main([]), 0)
        sync.assert_not_called()
        self.assertTrue(release.call_args.kwargs["dry_run"])
        self.assertNotIn("GITEE_TOKEN", release.call_args.args[2])

    def test_canonical_release_selection_and_seeding(self):
        selected = mirror.select_releases({"EVENT_NAME": "workflow_dispatch", "REQUESTED_TAG": "v0.1.2", "SEED_HISTORY": "true"})
        self.assertEqual(selected, ["v0.1.1", "v0.1.2"])
        for tag in ("0.1.2", "v0.1.2-rc.1", "v01.1.2", "../v0.1.2", "v0.1.2\nextra"):
            with self.assertRaises(ValueError):
                mirror.select_releases({"EVENT_NAME": "release", "RELEASE_TAG": tag})


if __name__ == "__main__":
    unittest.main()
