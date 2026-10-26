"""Repository importer safety tests; every repository is a marked .quality fixture."""
import contextlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock
import uuid

MODULE_PATH = Path(__file__).resolve().parents[1] / 'repository_import.py'
spec = importlib.util.spec_from_file_location('repository_import', MODULE_PATH)
ri = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ri)

SCHEMA = '''
PRAGMA application_id = 1346781764;
PRAGMA user_version = 2;
CREATE TABLE parts (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
 package_name TEXT NOT NULL, parameters TEXT NOT NULL,
 stock_status TEXT NOT NULL CHECK(stock_status IN ('in_stock','low','out_of_stock','unknown')),
 quantity REAL CHECK(quantity IS NULL OR quantity >= 0),
 location TEXT NOT NULL, brief TEXT NOT NULL, url TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 lcsc_number TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '');
CREATE TABLE notes (id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,
 search_text TEXT NOT NULL,scene_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE attachments (id TEXT PRIMARY KEY,part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
 name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>=0),relative_path TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('file','url')),url TEXT);
CREATE INDEX attachments_part ON attachments(part_id);
CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
'''


def fixture_part(ident, name):
    return dict(zip(ri.COLUMNS, [ident, name, 'resistor', '0805', '', 'in_stock', None,
                               'drawer', 'brief', '', '2020-01-01', '2020-01-01', '', '']))


@contextlib.contextmanager
def fixture_db(path):
    with contextlib.closing(sqlite3.connect(path)) as conn:
        with conn:
            yield conn


class ImportSafetyTests(unittest.TestCase):
    def setUp(self):
        ri.FIXTURES.mkdir(parents=True, exist_ok=True)
        # Keep fixtures/backups for review; test cleanup never removes repository files.
        self.base = Path(tempfile.mkdtemp(prefix='case-', dir=ri.FIXTURES))
        self.repo = self.base / 'repository'
        self.repo.mkdir()
        (self.repo / '.fixture-only').write_text('fixture-only', encoding='utf-8')
        (self.repo / 'attachments').mkdir()
        (self.repo / 'attachments' / 'retained.pdf').write_bytes(b'pdf bytes remain unchanged')
        (self.repo / 'backups').mkdir()
        (self.repo / 'backups' / 'old.sqlite3').write_bytes(b'old backup retained')
        (self.repo / 'backups' / ri.DB_NAME).write_bytes(b'nested database must also be copied')
        (self.repo / 'empty-directory').mkdir()
        self.originals = [fixture_part('original-1', 'test resistor'), fixture_part('original-2', 'test MCU')]
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            conn.executescript(SCHEMA.replace('1346781764', str(ri.APP_ID)))
            for row in self.originals:
                ri.insert_part(conn, row)
            conn.execute("INSERT INTO notes VALUES ('note-1','preserve','note','text','{}','old','old')")
            conn.execute("INSERT INTO settings VALUES ('theme','dark')")
        self.source = self.base / 'source.xlsx'
        self.source.write_bytes(b'hashed fixture source')
        self.plan = {'version': 1, 'repository': str(self.repo), 'enrichment_ready': True,
                     'expected_initial_parts': self.originals,
                     'sources': [{'path': str(self.source), 'sha256': ri.file_hash(self.source)}], 'rows': []}
        for index in range(3):
            part = fixture_part('unused', 'Imported ' + str(index))
            fields = {k: v for k, v in part.items() if k in ri.PART_FIELDS}
            self.plan['rows'].append({'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'fixture:row:' + str(index))),
                                      'source': str(self.source), 'sourceRow': index + 2, 'part': fields})
        self.plan_path = self.base / 'plan.json'
        self.work = self.base / 'operations'
        self.save_plan()

    def save_plan(self):
        self.plan_path.write_text(json.dumps(self.plan), encoding='utf-8')

    def apply(self, **kwargs):
        return ri.apply(self.plan_path, self.work, fixture_only=True, **kwargs)

    def snapshots(self):
        with contextlib.closing(ri.connect(self.repo)) as conn:
            return ri.database_snapshot(conn), ri.parts(conn), ri.tree_manifest(self.repo, True)

    def test_preview_does_not_write_and_backup_has_verified_complete_restore(self):
        before = self.snapshots()
        result = ri.preview(self.plan_path, fixture_only=True)
        self.assertTrue(result['initial_parts_match'])
        self.assertFalse(self.work.exists())
        self.assertEqual(self.snapshots(), before)
        proof = ri.backup(self.plan_path, self.work, fixture_only=True)
        manifest = ri.verify_backup(proof['backup'], proof['manifest_sha256'])
        self.assertTrue(proof['restore_verified'])
        self.assertEqual(manifest['database'], before[0])
        self.assertEqual(manifest['protected_files'], before[2])
        self.assertIn('backups/' + ri.DB_NAME, manifest['snapshot_files']['files'])
        self.assertIn('empty-directory', manifest['snapshot_files']['directories'])
        self.assertEqual(self.snapshots(), before)

    def test_failed_row_and_midtransaction_exception_restore_every_original(self):
        before = self.snapshots()
        def failing(index, conn):
            if index == 1:
                conn.execute("INSERT INTO parts (id,name) VALUES ('invalid','failed row')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.apply(_inject_failure=failing)
        self.assertEqual(self.snapshots(), before)
        ledger = json.loads(next(self.work.glob('ledger-*.json')).read_text(encoding='utf-8'))
        self.assertEqual(ledger['state'], 'prepared')
        ri.verify_backup(ledger['backup'], ledger['backup_manifest_sha256'])
        def crashing(index, conn):
            if index == 0:
                raise RuntimeError('simulated interruption before commit')
        with self.assertRaisesRegex(RuntimeError, 'simulated interruption'):
            self.apply(_inject_failure=crashing)
        self.assertEqual(self.snapshots(), before)
        self.assertEqual(self.apply()['inserted'], 3)

    def test_idempotent_replay_and_crash_after_commit_recovery(self):
        first = self.apply()
        before = self.snapshots()
        ledger_path = Path(first['ledger'])
        ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
        ledger['state'] = 'prepared'  # Simulate crash after DB commit, before ledger commit status.
        ri.atomic_json(ledger_path, ledger)
        self.assertEqual(self.apply()['status'], 'already_applied')
        self.assertEqual(self.snapshots(), before)
        self.assertEqual(len(before[1]), 3)
        self.assertEqual(json.loads(ledger_path.read_text(encoding='utf-8'))['state'], 'committed')

    def test_refuses_three_baseline_rows_or_changed_originals_before_backup(self):
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            ri.insert_part(conn, fixture_part('later', 'user part'))
        before = self.snapshots()
        with self.assertRaisesRegex(ri.ImportRefused, 'two original'):
            self.apply()
        self.assertEqual(self.snapshots(), before)
        self.assertFalse(self.work.exists())
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            conn.execute("DELETE FROM parts WHERE id='later'")
            conn.execute("UPDATE parts SET name='changed' WHERE id='original-1'")
        with self.assertRaisesRegex(ri.ImportRefused, 'two original'):
            self.apply()

    def test_notes_settings_and_attachment_bytes_preserved(self):
        before = self.snapshots()
        self.apply()
        after = self.snapshots()
        self.assertEqual(ri.protected(before[0]), ri.protected(after[0]))
        self.assertEqual(before[2], after[2])

    def test_targeted_rollback_preserves_later_note_and_unrelated_parts_files(self):
        result = self.apply()
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            ri.insert_part(conn, fixture_part('later', 'later user component'))
            conn.execute("INSERT INTO notes VALUES ('later-note','new','note','','{\"new\":true}','new','new')")
        (self.repo / 'attachments' / 'later.pdf').write_bytes(b'later user content')
        before = self.snapshots()
        restored = ri.rollback(result['ledger'], fixture_only=True)
        after = self.snapshots()
        self.assertEqual(restored['status'], 'rolled_back')
        self.assertEqual({r['id'] for r in after[1]}, {'original-1', 'original-2', 'later'})
        self.assertEqual(ri.protected(before[0]), ri.protected(after[0]))
        self.assertEqual(before[2], after[2])
        self.assertEqual([r for r in after[1] if r['id'].startswith('original')], self.originals)
        self.assertEqual(ri.rollback(result['ledger'], fixture_only=True)['status'], 'already_original')
        with self.assertRaisesRegex(ri.ImportRefused, 'rolled back'):
            self.apply()

    def test_refuses_edited_imported_row_rollback_and_partial_reapply(self):
        result = self.apply()
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            conn.execute('UPDATE parts SET brief=? WHERE id=?', ('user edit', self.plan['rows'][0]['id']))
        before = self.snapshots()
        with self.assertRaisesRegex(ri.ImportRefused, 'Affected rows'):
            ri.rollback(result['ledger'], fixture_only=True)
        with self.assertRaisesRegex(ri.ImportRefused, 'conflicting'):
            self.apply()
        self.assertEqual(self.snapshots(), before)

    def test_source_change_and_not_ready_and_bad_row_refused_without_write(self):
        before = self.snapshots()
        self.plan['enrichment_ready'] = False
        self.save_plan()
        with self.assertRaisesRegex(ri.ImportRefused, 'not ready'):
            self.apply()
        self.plan['enrichment_ready'] = True
        self.plan['rows'][1]['part']['quantity'] = -1
        self.save_plan()
        with self.assertRaisesRegex(ri.ImportRefused, 'quantity'):
            self.apply()
        self.plan['rows'][1]['part']['quantity'] = None
        self.save_plan()
        self.source.write_bytes(b'changed source')
        with self.assertRaisesRegex(ri.ImportRefused, 'Source hash mismatch'):
            self.apply()
        self.assertEqual(self.snapshots(), before)
        self.assertFalse(self.work.exists())

    def test_corrupted_backup_proof_blocks_apply_retry(self):
        result = self.apply()
        ledger = json.loads(Path(result['ledger']).read_text(encoding='utf-8'))
        (Path(ledger['backup']) / 'restored-copy' / 'attachments' / 'retained.pdf').write_bytes(b'corruption')
        before = self.snapshots()
        with self.assertRaisesRegex(ri.ImportRefused, 'changed'):
            self.apply()
        self.assertEqual(self.snapshots(), before)

    def test_original_or_later_imported_attachment_reference_refuses_cascade(self):
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            conn.execute("INSERT INTO attachments VALUES ('a','original-1','pdf','application/pdf',2,'attachments/retained.pdf','file',NULL)")
        before = self.snapshots()
        with self.assertRaisesRegex(ri.ImportRefused, 'have attachments'):
            self.apply()
        self.assertEqual(self.snapshots(), before)
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            conn.execute("DELETE FROM attachments WHERE id='a'")
        result = self.apply()
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            conn.execute("INSERT INTO attachments VALUES ('a',?,'pdf','application/pdf',2,'attachments/retained.pdf','file',NULL)",
                         (self.plan['rows'][0]['id'],))
        before = self.snapshots()
        with self.assertRaisesRegex(ri.ImportRefused, 'have attachments'):
            ri.rollback(result['ledger'], fixture_only=True)
        self.assertEqual(self.snapshots(), before)

    def test_closed_process_guard_and_fixture_override_are_explicit(self):
        fake = mock.Mock(stdout='"perfboard.exe","123","Console","1","1 K"\n')
        with mock.patch.object(ri.os, 'name', 'nt'), mock.patch.object(ri.subprocess, 'run', return_value=fake):
            with self.assertRaisesRegex(ri.ImportRefused, 'Save and quit'):
                ri.ensure_closed()
        with self.assertRaises(ri.ImportRefused):
            ri.ensure_closed(True, self.base)


    def test_repository_lock_rejects_concurrent_operation_and_releases(self):
        before = self.snapshots()
        with ri.operation_lock(self.repo):
            with self.assertRaisesRegex(ri.ImportRefused, 'repository lock'):
                self.apply()
        self.assertEqual(self.snapshots(), before)
        self.assertFalse(self.work.exists())
        self.assertEqual(self.apply()['status'], 'applied')

    def test_ledger_snapshot_edit_blocks_rollback_before_live_write(self):
        result = self.apply()
        ledger_path = Path(result['ledger'])
        ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
        ledger['originals'][0]['brief'] = 'accidentally changed ledger snapshot'
        ri.atomic_json(ledger_path, ledger)
        before = self.snapshots()
        with self.assertRaisesRegex(ri.ImportRefused, 'Ledger payload integrity'):
            ri.rollback(ledger_path, fixture_only=True)
        with self.assertRaisesRegex(ri.ImportRefused, 'Ledger payload integrity'):
            self.apply()
        self.assertEqual(self.snapshots(), before)

    def test_plan_changed_during_backup_blocks_transaction(self):
        before = self.snapshots()
        real_backup = ri._backup
        def changing_backup(*args, **kwargs):
            result = real_backup(*args, **kwargs)
            self.plan['rows'][0]['part']['brief'] = 'changed after preview'
            self.save_plan()
            return result
        with mock.patch.object(ri, '_backup', side_effect=changing_backup):
            with self.assertRaisesRegex(ri.ImportRefused, 'Plan changed'):
                self.apply()
        self.assertEqual(self.snapshots(), before)

    def test_rollback_refuses_original_id_conflict_and_preserves_new_attachment(self):
        result = self.apply()
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            ri.insert_part(conn, fixture_part('original-1', 'new user component with reused ID'))
        before = self.snapshots()
        with self.assertRaisesRegex(ri.ImportRefused, 'original IDs conflict'):
            ri.rollback(result['ledger'], fixture_only=True)
        self.assertEqual(self.snapshots(), before)
        with fixture_db(self.repo / ri.DB_NAME) as conn:
            conn.execute("DELETE FROM parts WHERE id='original-1'")
            ri.insert_part(conn, fixture_part('later', 'user component'))
            conn.execute("INSERT INTO attachments VALUES ('later-a','later','pdf','application/pdf',2,'attachments/retained.pdf','file',NULL)")
        before = self.snapshots()
        ri.rollback(result['ledger'], fixture_only=True)
        after = self.snapshots()
        self.assertEqual(ri.protected(before[0]), ri.protected(after[0]))
        self.assertEqual(before[2], after[2])


    def test_wal_committed_snapshot_is_backed_up_without_checkpointing(self):
        conn = sqlite3.connect(self.repo / ri.DB_NAME)
        try:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA wal_autocheckpoint=0')
            conn.execute("UPDATE notes SET scene_json='{\"committed\":true}' WHERE id='note-1'")
            conn.commit()
            wal = self.repo / (ri.DB_NAME + '-wal')
            self.assertTrue(wal.exists())
            wal_hash = ri.file_hash(wal)
            proof = ri.backup(self.plan_path, self.work, fixture_only=True)
            manifest = ri.verify_backup(proof['backup'], proof['manifest_sha256'])
            self.assertEqual(ri.file_hash(wal), wal_hash)
            self.assertIn('{"committed":true}', manifest['database']['tables']['notes'][0])
        finally:
            conn.close()


if __name__ == '__main__':
    unittest.main()
