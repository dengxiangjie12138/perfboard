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

    def test_git_executes_askpass_for_both_credentials_without_shell_command_in_environment(self):
        helper_directory = self.root / "credential helper with spaces"
        helper_directory.mkdir()
        child = mirror.credential_environment(helper_directory, self.environment)
        self.assertEqual(child["GIT_ASKPASS"], str(helper_directory / "askpass"))
        # Exercise Git's actual askpass process launch, not a mocked subprocess
        # or direct Python invocation. credential.fill needs no network and the
        # empty credential.helper excludes all real OS credential stores.
        result = subprocess.run(["git", "-c", "credential.helper=", "-c", "credential.useHttpPath=true",
                                 "credential", "fill"], cwd=self.root, env=child,
                                input="protocol=https\nhost=fixture.invalid\npath=fixture.git\n\n",
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        credentials = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
        self.assertEqual(credentials["username"], "deng-xiangjie")
        self.assertEqual(credentials["password"], self.environment["GITEE_TOKEN"])
        for helper in helper_directory.iterdir():
            self.assertNotIn(self.environment["GITEE_TOKEN"], helper.read_text(encoding="utf-8"))
        if os.name != "nt":
            self.assertEqual((helper_directory / "askpass").stat().st_mode & 0o777, 0o700)
            self.assertEqual((helper_directory / "askpass.py").stat().st_mode & 0o777, 0o600)

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

    @contextlib.contextmanager
    def isolated_probe(self, callback):
        environment = dict(self.environment, EVENT_NAME="workflow_dispatch", GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="1")
        with patch.object(mirror, "REMOTE", str(self.remote)), patch.object(mirror, "PROBE_SOURCE_COMMIT", self.head), \
                patch.object(mirror.secrets, "token_hex", return_value="a" * 16), \
                patch.object(mirror, "invoke_upload_probe", side_effect=callback) as invoke:
            yield environment, invoke

    def acknowledge_probe(self, tag, commit, filename, _environment, verified=True):
        result = {"schemaVersion": 1, "tag": tag, "sourceCommit": commit, "sourceTag": "v0.1.2",
                  "releaseId": 123, "releaseMarker": mirror.probe_marker(tag, commit),
                  "releaseCleanupConfirmed": True, "uploadVerified": verified}
        filename.write_text(json.dumps(result), encoding="utf-8")

    def test_isolated_upload_probe_creates_and_cleans_only_owned_nonversion_tag(self):
        def helper(tag, commit, filename, environment):
            self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", "refs/tags/" + tag), commit)
            self.assertFalse(mirror.STABLE.fullmatch(tag))
            self.acknowledge_probe(tag, commit, filename, environment)
        with self.isolated_probe(helper) as (environment, invoke):
            mirror.verify_upload(self.source, environment)
        invoke.assert_called_once()
        self.assertEqual(self.git("--git-dir", str(self.remote), "for-each-ref", "--format=%(refname)"), "")
        self.assertIn("temporary Release and tag were removed", (self.root / "summary.md").read_text())

    def test_failed_probe_still_removes_owned_tag_only_after_release_cleanup_ack(self):
        def helper(tag, commit, filename, environment):
            self.acknowledge_probe(tag, commit, filename, environment, verified=False)
            raise subprocess.CalledProcessError(1, ["synthetic-node-probe"])
        with self.isolated_probe(helper) as (environment, _invoke):
            with self.assertRaises(subprocess.CalledProcessError):
                mirror.verify_upload(self.source, environment)
        self.assertEqual(self.git("--git-dir", str(self.remote), "for-each-ref", "--format=%(refname)"), "")

    def test_unknown_probe_cleanup_outcome_preserves_tag_and_reports_it(self):
        def helper(*_args):
            raise subprocess.CalledProcessError(1, ["synthetic-node-probe"])
        with self.isolated_probe(helper) as (environment, _invoke):
            with self.assertRaisesRegex(ValueError, "cleanup was not confirmed"):
                mirror.verify_upload(self.source, environment)
        tag = "mirror-upload-probe-123-1-" + "a" * 16
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", "refs/tags/" + tag), self.head)
        self.assertIn(tag, (self.root / "summary.md").read_text())

    def test_probe_cleanup_ack_rejects_other_tag_commit_marker_and_unconfirmed_absence(self):
        tag = "mirror-upload-probe-123-1-" + "a" * 16
        filename = self.root / "probe-result.json"
        for field, value in [("tag", "v0.1.2"), ("sourceCommit", "0" * 40), ("releaseMarker", "other"),
                             ("releaseCleanupConfirmed", False), ("uploadVerified", "true"), ("schemaVersion", True)]:
            self.acknowledge_probe(tag, self.head, filename, self.environment)
            result = json.loads(filename.read_text())
            result[field] = value
            filename.write_text(json.dumps(result))
            with self.subTest(field=field), self.assertRaises(ValueError):
                mirror.probe_result(filename, tag, self.head)
        with self.assertRaises(ValueError):
            mirror.probe_result(filename, "v0.1.2", self.head)

    def test_probe_cas_cleanup_preserves_a_concurrent_tag_change(self):
        changed = None
        def helper(tag, commit, filename, environment):
            nonlocal changed
            (self.source / "README.md").write_text("changed fixture\n")
            self.git("add", ".", cwd=self.source)
            self.git("commit", "--quiet", "-m", "concurrent fixture", cwd=self.source)
            changed = self.git("rev-parse", "HEAD", cwd=self.source)
            self.git("push", "--force", "--quiet", str(self.remote), changed + ":refs/tags/" + tag, cwd=self.source)
            self.acknowledge_probe(tag, commit, filename, environment)
        with self.isolated_probe(helper) as (environment, _invoke):
            with self.assertRaises(mirror.GitFailure):
                mirror.verify_upload(self.source, environment)
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", "refs/tags/mirror-upload-probe-123-1-" + "a" * 16), changed)

    def test_probe_cannot_claim_an_existing_identical_tag(self):
        tag = "mirror-upload-probe-123-1-" + "a" * 16
        self.git("push", "--quiet", str(self.remote), self.head + ":refs/tags/" + tag, cwd=self.source)
        with self.isolated_probe(self.acknowledge_probe) as (environment, invoke):
            with self.assertRaisesRegex(ValueError, "not newly created"):
                mirror.verify_upload(self.source, environment)
        invoke.assert_not_called()
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", "refs/tags/" + tag), self.head)

    def test_upload_probe_requires_manual_dispatch_and_fixed_source_before_any_write(self):
        with self.assertRaisesRegex(ValueError, "manual dispatch"):
            mirror.verify_upload(self.source, self.environment)
        for event in ("push", "release"):
            with self.assertRaises(ValueError):
                mirror.select_releases({"RUN_MODE": "verify_upload", "EVENT_NAME": event})
        self.assertEqual(mirror.select_releases({"RUN_MODE": "verify_upload", "EVENT_NAME": "workflow_dispatch"}), [])
        with self.isolated_probe(self.acknowledge_probe) as (environment, invoke):
            with patch.object(mirror, "PROBE_SOURCE_COMMIT", "0" * 40), self.assertRaisesRegex(ValueError, "source tag has changed"):
                mirror.verify_upload(self.source, environment)
        invoke.assert_not_called()
        self.assertEqual(self.git("--git-dir", str(self.remote), "for-each-ref", "--format=%(refname)"), "")

    def cleanup_environment(self):
        return dict(self.environment, EVENT_NAME="workflow_dispatch", REQUESTED_TAG="mirror-upload-probe-123-1-" + "a" * 16,
                    CLEANUP_RELEASE_ID="1254644")

    def acknowledge_cleanup(self, tag, release_id, commit, filename, environment):
        self.acknowledge_probe(tag, commit, filename, environment, verified=False)
        result = json.loads(filename.read_text())
        result["releaseId"] = release_id
        filename.write_text(json.dumps(result))

    def test_cleanup_only_recovers_owned_release_and_tag_without_starting_upload_or_creating_tags(self):
        environment = self.cleanup_environment()
        tag = environment["REQUESTED_TAG"]
        self.git("push", "--quiet", str(self.remote), self.head + ":refs/tags/" + tag, cwd=self.source)
        with self.isolated_probe(None) as (_unused, upload), patch.object(mirror, "invoke_upload_cleanup", side_effect=self.acknowledge_cleanup) as cleanup:
            mirror.cleanup_upload(self.source, environment)
        upload.assert_not_called()
        cleanup.assert_called_once()
        self.assertEqual(cleanup.call_args.args[:3], (tag, 1254644, self.head))
        self.assertEqual(self.git("--git-dir", str(self.remote), "for-each-ref", "--format=%(refname)"), "")
        self.assertIn("No installer was uploaded", (self.root / "summary.md").read_text())

    def test_cleanup_only_accepts_an_already_absent_tag_without_recreating_it(self):
        environment = self.cleanup_environment()
        def cleanup(*args):
            self.assertEqual(self.git("--git-dir", str(self.remote), "for-each-ref", "--format=%(refname)"), "")
            self.acknowledge_cleanup(*args)
        with self.isolated_probe(None) as (_unused, upload), patch.object(mirror, "invoke_upload_cleanup", side_effect=cleanup):
            mirror.cleanup_upload(self.source, environment)
        upload.assert_not_called()
        self.assertEqual(self.git("--git-dir", str(self.remote), "for-each-ref", "--format=%(refname)"), "")

    def test_cleanup_only_rejects_production_tags_invalid_ids_and_nonmanual_events_before_git(self):
        environment = self.cleanup_environment()
        for changed in [{"REQUESTED_TAG": "v0.1.2"}, {"REQUESTED_TAG": "mirror-upload-probe-123-1-invalid"},
                        {"CLEANUP_RELEASE_ID": "0"}, {"CLEANUP_RELEASE_ID": "1254644; extra"},
                        {"CLEANUP_RELEASE_ID": "9007199254740992"}, {"EVENT_NAME": "push"}, {"GITEE_TOKEN": ""}]:
            with self.subTest(changed=changed), patch.object(mirror, "Git") as git, self.assertRaises(ValueError):
                mirror.cleanup_upload(self.source, dict(environment, **changed))
            git.assert_not_called()
        for event in ("push", "release"):
            with self.assertRaises(ValueError):
                mirror.select_releases({"RUN_MODE": "cleanup_upload", "EVENT_NAME": event})
        self.assertEqual(mirror.select_releases({"RUN_MODE": "cleanup_upload", "EVENT_NAME": "workflow_dispatch"}), [])

    def test_cleanup_only_keeps_tag_without_an_ack_for_the_exact_known_release_id(self):
        environment = self.cleanup_environment()
        tag = environment["REQUESTED_TAG"]
        self.git("push", "--quiet", str(self.remote), self.head + ":refs/tags/" + tag, cwd=self.source)
        def wrong_id(tag, release_id, commit, filename, child):
            self.acknowledge_cleanup(tag, release_id + 1, commit, filename, child)
        for callback in [lambda *_args: None, wrong_id]:
            with self.isolated_probe(None), patch.object(mirror, "invoke_upload_cleanup", side_effect=callback), self.assertRaises(ValueError):
                mirror.cleanup_upload(self.source, environment)
            self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", "refs/tags/" + tag), self.head)

    def test_cleanup_only_preserves_tag_changes_before_and_during_release_cleanup(self):
        environment = self.cleanup_environment()
        tag = environment["REQUESTED_TAG"]
        self.git("push", "--quiet", str(self.remote), self.head + ":refs/tags/" + tag, cwd=self.source)
        (self.source / "README.md").write_text("concurrent cleanup fixture\n")
        self.git("add", ".", cwd=self.source)
        self.git("commit", "--quiet", "-m", "changed cleanup fixture", cwd=self.source)
        changed = self.git("rev-parse", "HEAD", cwd=self.source)
        def change_tag(*args):
            self.git("push", "--force", "--quiet", str(self.remote), changed + ":refs/tags/" + tag, cwd=self.source)
            self.acknowledge_cleanup(*args)
        with self.isolated_probe(None), patch.object(mirror, "invoke_upload_cleanup", side_effect=change_tag), self.assertRaisesRegex(ValueError, "changed during"):
            mirror.cleanup_upload(self.source, environment)
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", "refs/tags/" + tag), changed)
        with self.isolated_probe(None), patch.object(mirror, "invoke_upload_cleanup") as cleanup, self.assertRaisesRegex(ValueError, "commit changed"):
            mirror.cleanup_upload(self.source, environment)
        cleanup.assert_not_called()
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", "refs/tags/" + tag), changed)


if __name__ == "__main__":
    unittest.main()
