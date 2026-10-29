"""No application/installer execution: validate the updater harness's safety plan and fixtures."""
import base64
import importlib.util
import json
from pathlib import Path
import shutil
import unittest
from unittest import mock
import uuid

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('validate_updater_native', ROOT / 'scripts/validate-updater-native.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class UpdaterNativePlanTests(unittest.TestCase):
    def setUp(self):
        self.parent = ROOT / '.quality' / 'updater-harness-tests'
        self.base = self.parent / uuid.uuid4().hex
        self.base.mkdir(parents=True)
        self.signature = self.base / 'update.exe.sig'
        self.signature.write_text(base64.b64encode(b'non-executable synthetic signature fixture').decode())
        for filename in ('initial.exe', 'update.exe'):
            (self.base / filename).write_bytes(b'MZ non-executable fixture only')
        self.plan = {
            'validationRoot': str(self.base),
            'productName': 'PerfboardUpdateValidation-' + uuid.uuid4().hex,
            'manufacturer': 'perfboard',
            'programDirectory': str(self.base / 'program'),
            'applicationConfigDirectory': str(self.base / 'config'),
            'repositoryDirectory': str(self.base / 'repository'),
            'initialInstaller': str(self.base / 'initial.exe'),
            'updateInstaller': str(self.base / 'update.exe'),
            'initialVersion': '0.1.1',
            'updateVersion': '0.1.2',
        }
        self.filename = self.base / 'plan.json'

    def tearDown(self):
        resolved = self.base.resolve()
        self.assertEqual(resolved.parent, self.parent.resolve())
        self.assertEqual(len(resolved.name), 32)
        shutil.rmtree(resolved)

    def read(self):
        self.filename.write_text(json.dumps(self.plan), encoding='utf-8')
        return native.read_plan(self.filename, self.signature)

    def rollback(self):
        self.plan.update(rollbackVersion='0.1.1', rollbackInstaller=str(self.base / 'initial.exe'))

    def test_upgrade_and_optional_explicit_rollback_are_parameterized(self):
        self.rollback()
        plan = self.read()
        self.assertEqual(plan['initialVersion'], '0.1.1')
        self.assertEqual(plan['updateVersion'], '0.1.2')
        self.assertEqual(plan['rollbackVersion'], '0.1.1')
        self.assertEqual(plan['rollbackSignature'], self.base / 'initial.exe.sig')

    def test_a_real_product_name_is_rejected_before_execution(self):
        self.plan['productName'] = 'Perfboard'
        with self.assertRaisesRegex(ValueError, 'test product'):
            self.read()

    def test_only_fixed_providers_are_accepted(self):
        self.plan['updateSource'] = 'gitee'
        self.assertEqual(self.read()['updateSource'], 'gitee')
        self.plan['updateSource'] = 'https://example.com'
        with self.assertRaisesRegex(ValueError, 'fixed public providers'):
            self.read()

    def test_rollback_to_unsigned_legacy_version_is_rejected(self):
        self.rollback()
        self.plan['rollbackVersion'] = '0.1.0'
        with self.assertRaisesRegex(ValueError, '0.1.1 onward'):
            self.read()

    def test_equal_or_older_upgrade_target_is_rejected(self):
        self.plan['updateVersion'] = '0.1.1'
        with self.assertRaisesRegex(ValueError, 'newer'):
            self.read()

    def test_an_external_rollback_installer_is_rejected(self):
        self.rollback()
        self.plan['rollbackInstaller'] = str(self.base.parent / 'external.exe')
        with self.assertRaisesRegex(ValueError, 'strictly inside'):
            self.read()

    def test_missing_rollback_installer_is_rejected(self):
        self.plan['rollbackVersion'] = '0.1.1'
        with self.assertRaisesRegex(ValueError, 'requires rollbackInstaller'):
            self.read()

    def test_signed_old_manifest_omits_schema_to_cover_published_011_compatibility(self):
        self.rollback()
        plan = self.read()
        with mock.patch.object(native.http.server, 'ThreadingHTTPServer') as server:
            server.return_value.server_port = 12345
            fixture = native.FixtureServer(plan, 'new-signature', 'old-signature')
        self.assertEqual(fixture.manifest('0.1.2')['repositorySchemaVersion'], 6)
        self.assertNotIn('repositorySchemaVersion', fixture.manifest('0.1.1'))
        self.assertEqual(fixture.manifest('0.1.1')['platforms']['windows-x86_64']['signature'], 'old-signature')
        catalog = fixture.catalog()
        self.assertEqual([item['tag_name'] for item in catalog], ['v0.1.2', 'v0.1.1', 'v0.1.0'])
        self.assertEqual(len(catalog[1]['assets']), 3)
        self.assertEqual(len(catalog[-1]['assets']), 1)
        self.assertNotIn('latest.json', [asset['name'] for asset in catalog[-1]['assets']])
        gitee = fixture.gitee_catalog()
        self.assertEqual([item['version'] for item in gitee], ['0.1.2', '0.1.1', '0.1.0'])
        self.assertTrue(gitee[0]['installable'])
        self.assertFalse(gitee[-1]['installable'])
        self.assertEqual(gitee[0]['tag'], 'v0.1.2')


if __name__ == '__main__':
    unittest.main()
