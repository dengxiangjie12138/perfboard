"""Focused importer verification. Requires xlrd==2.0.2; original XLS stays read-only."""
import importlib.util
import json
import pathlib
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('core_importer', pathlib.Path(__file__).with_name('import_core_list.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ImportCoreListTests(unittest.TestCase):
    def test_rejects_non_xls_without_conversion(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = pathlib.Path(temporary) / 'source.xls'
            source.write_bytes(b'PK-not-an-old-XLS')
            with self.assertRaisesRegex(ValueError, 'OLE XLS'):
                module.import_core_list(source)

    def test_real_source_is_reproducible_and_unchanged(self):
        source = pathlib.Path.home() / 'Desktop' / '副本CoreList.xls'
        if not source.exists():
            self.skipTest('Authorized reference source is not present')
        before = source.read_bytes()
        actual = module.import_core_list(source)
        bundled = pathlib.Path(__file__).parent.parent / 'src/features/core-library/core-data.json'
        self.assertEqual(actual, json.loads(bundled.read_text(encoding='utf-8')))
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(actual['audit']['recordCount'], 137)
        self.assertEqual(len(actual['sheet']['mergedCells']), 3)
        self.assertIsNone(actual['columns'][12]['unit'])
        self.assertEqual(len({record['id'] for record in actual['records']}), 137)

if __name__ == '__main__':
    unittest.main()

