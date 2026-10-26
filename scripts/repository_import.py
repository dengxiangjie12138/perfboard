"""Guarded, stdlib-only Perfboard v2 repository import.

Preview never writes the repository. Backup retains a byte-for-byte raw tree plus
an SQLite backup API snapshot and a verified restore copy. Apply/rollback require
Perfboard to be closed; there is deliberately no CLI bypass or process killing.
All operation artifacts belong in this project's .quality directory.
"""
from __future__ import annotations

import argparse
import contextlib
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import sys
import uuid

PROJECT = Path(__file__).resolve().parents[1]
QUALITY = PROJECT / '.quality'
FIXTURES = QUALITY / 'repository-import-tests'
AUTHORIZED_REPOSITORY = Path('D:/洞洞板/洞洞板仓库')
DB_NAME = 'perfboard.sqlite3'
APP_ID = 0x50464244
COLUMNS = ('id','name','category','package_name','parameters','stock_status','quantity',
           'location','brief','url','created_at','updated_at','lcsc_number','brand')
PART_FIELDS = set(COLUMNS) - {'id', 'created_at', 'updated_at'}


class ImportRefused(RuntimeError):
    """A failed safety precondition; no partial import is allowed."""


def require(ok, message):
    if not ok:
        raise ImportRefused(message)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                      allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def no_redirect(path):
    path = Path(os.path.abspath(path))
    for item in (path, *path.parents):
        if item.exists() or item.is_symlink():
            s = item.lstat()
            require(not stat.S_ISLNK(s.st_mode) and not
                    (getattr(s, 'st_file_attributes', 0) & 0x400),
                    f'Symlink/reparse point refused: {item}')
    return path


def within(path, root):
    return path == root or root in path.parents


def artifact_path(path):
    path = no_redirect(path)
    require(within(path, no_redirect(QUALITY)) and path != QUALITY,
            'Backup and ledger destinations must be inside project .quality')
    return path


def repository_path(value, fixture_only=False):
    path = no_redirect(value)
    require(path.is_dir() and (path / DB_NAME).is_file(), 'Repository/database missing')
    if fixture_only:
        require(within(path, FIXTURES) and (path / '.fixture-only').is_file(),
                'Process-check override is restricted to marked .quality test fixtures')
    else:
        require(path == no_redirect(AUTHORIZED_REPOSITORY), 'Repository is not the authorized exact path')
    tree_manifest(path)  # Includes every descendant; never follow junctions.
    return path


def ensure_closed(fixture_only=False, repository=None):
    if fixture_only:
        repository_path(repository, True)
        return
    require(os.name == 'nt', 'Live imports require Windows process verification')
    result = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True,
                            text=True, check=True, timeout=30)
    processes = [row[0] for row in csv.reader(io.StringIO(result.stdout)) if row]
    active = [name for name in processes if 'perfboard' in name.lower()]
    require(not active, 'Save and quit Perfboard before proceeding: ' + ', '.join(active))



@contextlib.contextmanager
def operation_lock(root):
    """One importer per repository, across all work directories; crash releases OS lock."""
    lock_path = artifact_path(QUALITY / 'import-safety-locks' / (digest(str(root)) + '.lock'))
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a+b') as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b'0')
            handle.flush()
        handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise ImportRefused('Another importer operation holds this repository lock') from None
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def ledger_payload_hash(ledger):
    return digest({k: v for k, v in ledger.items() if k not in {'state', 'payload_sha256'}})


def validate_ledger(ledger):
    require(ledger.get('version') == 1 and ledger.get('state') in
            {'prepared', 'committed', 'rolled_back'}, 'Invalid ledger version/state')
    require(ledger.get('payload_sha256') == ledger_payload_hash(ledger), 'Ledger payload integrity mismatch')
    require(isinstance(ledger.get('originals'), list) and len(ledger['originals']) == 2,
            'Ledger original snapshots missing')
    rows = ledger['originals'] + ledger['imported']
    require(bool(ledger['imported']) and all(set(r) == set(COLUMNS) for r in rows),
            'Ledger row snapshots invalid')
    require(len({r['id'] for r in rows}) == len(rows), 'Ledger IDs overlap')


def tree_manifest(root, exclude_database=False):
    root = no_redirect(root)
    result = {'files': {}, 'directories': []}
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs):
            p = no_redirect(Path(parent) / name)
            result['directories'].append(p.relative_to(root).as_posix())
        for name in sorted(files):
            p = no_redirect(Path(parent) / name)
            require(p.is_file(), f'Nonregular file refused: {p}')
            rel = p.relative_to(root).as_posix()
            if exclude_database and rel in {DB_NAME, DB_NAME+'-wal', DB_NAME+'-shm', DB_NAME+'-journal'}:
                continue
            result['files'][rel] = file_hash(p)
    result['directories'].sort()
    return result


def connect(root, writable=False):
    db = no_redirect(Path(root) / DB_NAME)
    require(db.is_file(), 'Database missing; importer never creates a repository')
    conn = sqlite3.connect(db.as_uri() + ('?mode=rw' if writable else '?mode=ro'),
                           uri=True, timeout=5, isolation_level=None)
    conn.row_factory = sqlite3.Row
    if writable:
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA synchronous=FULL')
    return conn


def json_cell(value):
    return {'__sqlite_blob__': value.hex()} if isinstance(value, bytes) else value


def database_snapshot(conn):
    require(conn.execute('PRAGMA application_id').fetchone()[0] == APP_ID,
            'Database is not Perfboard')
    require(conn.execute('PRAGMA user_version').fetchone()[0] == 2, 'Schema v2 required')
    require([r[0] for r in conn.execute('PRAGMA integrity_check')] == ['ok'],
            'SQLite integrity check failed')
    require([r['name'] for r in conn.execute('PRAGMA table_info(parts)')] == list(COLUMNS),
            'Unexpected parts columns')
    require(not list(conn.execute("SELECT 1 FROM sqlite_master WHERE type='trigger'")),
            'Unexpected triggers refused')
    schema = [list(r) for r in conn.execute(
        'SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name')]
    tables = {}
    for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        name = row[0]
        quoted = '"' + name.replace('"', '""') + '"'
        values = [[json_cell(v) for v in r] for r in conn.execute('SELECT * FROM ' + quoted)]
        tables[name] = sorted(values, key=lambda r: encoded(r))
    require({'parts','notes','attachments','settings'} <= set(tables), 'Required tables missing')
    return {'schema': schema, 'tables': tables, 'application_id': APP_ID, 'user_version': 2}


def parts(conn):
    return sorted([dict(r) for r in conn.execute('SELECT * FROM parts')], key=lambda r: r['id'])


def protected(snapshot):
    return {'schema': snapshot['schema'], 'tables':
            {k: v for k, v in snapshot['tables'].items() if k != 'parts'}}


def atomic_json(path, value):
    path = artifact_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + str(uuid.uuid4()) + '.tmp')
    with temporary.open('xb') as f:
        f.write(encoded(value) + b'\n')
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, path)


def load_plan(path, *, fixture_only=False, ready=False):
    plan_path = no_redirect(path)
    plan = json.loads(plan_path.read_text(encoding='utf-8-sig'))
    require(plan.get('version') == 1, 'Import plan version 1 required')
    root = repository_path(plan.get('repository', plan.get('repo', '')), fixture_only)
    require(not ready or plan.get('enrichment_ready') is True, 'Plan enrichment is not ready')
    originals = plan.get('expected_initial_parts')
    require(isinstance(originals, list) and len(originals) == 2 and
            all(isinstance(r, dict) and set(r) == set(COLUMNS) for r in originals),
            'Exactly two full original row snapshots are required')
    require(len({r['id'] for r in originals}) == 2, 'Duplicate original IDs')
    sources = plan.get('sources')
    require(isinstance(sources, list) and bool(sources), 'Source hash records required')
    source_paths = set()
    for source in sources:
        p = no_redirect(source['path'])
        require(p.is_file() and file_hash(p) == source['sha256'], f'Source hash mismatch: {p}')
        require(str(p) not in source_paths, 'Duplicate source path')
        source_paths.add(str(p))
    rows = plan.get('rows')
    require(isinstance(rows, list) and bool(rows), 'Nonempty import rows required')
    ids, references = set(), set()
    for row in rows:
        require(isinstance(row, dict) and {'id','source','sourceRow','part'} <= set(row),
                'Invalid source row')
        try:
            ident = uuid.UUID(row['id'])
        except (ValueError, TypeError, AttributeError):
            raise ImportRefused('Import row ID must be a UUID5') from None
        require(ident.version == 5 and str(ident) == row['id'], 'Import row ID must be canonical UUID5')
        require(row['id'] not in ids, 'Duplicate import ID')
        ids.add(row['id'])
        require(str(no_redirect(row['source'])) in source_paths, 'Row source is not a hashed source')
        require(isinstance(row['sourceRow'], (str, int)) and not isinstance(row['sourceRow'], bool)
                and bool(str(row['sourceRow']).strip()), 'Row source reference required')
        reference = (row['source'], str(row['sourceRow']))
        require(reference not in references, 'Duplicate source row reference')
        references.add(reference)
        part = row['part']
        require(isinstance(part, dict) and set(part) == PART_FIELDS, 'Every part field must be present')
        require(all(isinstance(v, str) for k, v in part.items() if k != 'quantity'),
                'Part text fields must be strings')
        require(bool(part['name'].strip()) and bool(part['category'].strip()), 'Name/category required')
        require(part['stock_status'] in {'in_stock','low','out_of_stock','unknown'}, 'Invalid stock status')
        q = part['quantity']
        require(q is None or (type(q) in {int, float} and math.isfinite(q) and q >= 0), 'Invalid quantity')
    require(not ids.intersection(r['id'] for r in originals), 'Import IDs overlap original IDs')
    return plan, root, digest(plan)


def baseline(conn, plan):
    require(parts(conn) == sorted(plan['expected_initial_parts'], key=lambda r: r['id']),
            'Current parts must exactly match the two original snapshots')
    original_ids = [r['id'] for r in plan['expected_initial_parts']]
    require(not list(conn.execute('SELECT id FROM attachments WHERE part_id IN (?,?)', original_ids)),
            'Original parts have attachments; replacement would delete them')


def preview(plan_path, *, fixture_only=False):
    plan, root, plan_hash = load_plan(plan_path, fixture_only=fixture_only)
    with contextlib.closing(connect(root)) as conn:
        conn.execute('BEGIN')
        snapshot = database_snapshot(conn)
        current = parts(conn)
        matches = current == sorted(plan['expected_initial_parts'], key=lambda r: r['id'])
        conn.rollback()
    return {'plan_sha256': plan_hash, 'repository': str(root), 'rows': len(plan['rows']),
            'initial_parts_match': matches, 'current_parts': len(current),
            'enrichment_ready': plan.get('enrichment_ready') is True,
            'protected_sha256': digest(protected(snapshot))}


def _backup(plan_path, work_dir, *, fixture_only=False):
    plan, root, plan_hash = load_plan(plan_path, fixture_only=fixture_only)
    ensure_closed(fixture_only, root)
    work_dir = artifact_path(work_dir)
    require(not within(work_dir, root), 'Backup destination must be outside repository')
    backup_dir = work_dir / ('backup-' + str(uuid.uuid4()))
    backup_dir.mkdir(parents=True)
    raw, consistent, restored = (backup_dir / n for n in ('raw', 'repository', 'restored-copy'))
    with contextlib.closing(connect(root)) as conn:
        conn.execute('BEGIN')
        before_db = database_snapshot(conn)
        before_files = tree_manifest(root)
        shutil.copytree(root, raw)
        require(tree_manifest(raw) == before_files, 'Raw backup file hash mismatch')
        shutil.copytree(root, consistent, ignore=lambda parent, names: (
            {DB_NAME, DB_NAME+'-wal', DB_NAME+'-shm', DB_NAME+'-journal'}
            if Path(parent) == root else set()))
        with contextlib.closing(sqlite3.connect(consistent / DB_NAME)) as destination:
            conn.backup(destination)
        require(tree_manifest(root, True) == tree_manifest(consistent, True), 'Backup omitted repository files')
        with contextlib.closing(connect(consistent)) as copied:
            require(database_snapshot(copied) == before_db, 'SQLite backup logical/schema mismatch')
        conn.rollback()
    shutil.copytree(consistent, restored)
    require(tree_manifest(restored) == tree_manifest(consistent), 'Restore-copy file hash mismatch')
    with contextlib.closing(connect(restored)) as copied:
        require(database_snapshot(copied) == before_db, 'Restore-copy logical/schema mismatch')
    with contextlib.closing(connect(root)) as live:
        require(database_snapshot(live) == before_db, 'Repository changed during backup')
    require(tree_manifest(root, True) == tree_manifest(consistent, True), 'Repository files changed during backup')
    manifest = {'version': 1, 'repository': str(root), 'plan_sha256': plan_hash,
                'database': before_db, 'raw_files': before_files,
                'snapshot_files': tree_manifest(consistent),
                'protected_files': tree_manifest(root, True), 'restore_verified': True}
    atomic_json(backup_dir / 'manifest.json', manifest)
    return {'backup': str(backup_dir), 'manifest_sha256': digest(manifest), 'restore_verified': True}


def verify_backup(backup_dir, expected_hash):
    backup_dir = artifact_path(backup_dir)
    manifest = json.loads((backup_dir / 'manifest.json').read_text(encoding='utf-8'))
    require(digest(manifest) == expected_hash and manifest.get('restore_verified') is True,
            'Backup manifest mismatch')
    require(tree_manifest(backup_dir / 'raw') == manifest['raw_files'], 'Raw backup changed')
    for name in ('repository', 'restored-copy'):
        target = backup_dir / name
        require(tree_manifest(target) == manifest['snapshot_files'], 'Backup/restore-copy changed')
        with contextlib.closing(connect(target)) as conn:
            require(database_snapshot(conn) == manifest['database'], 'Backup database changed')
    return manifest


def insert_part(conn, row):
    conn.execute('INSERT INTO parts (' + ','.join(COLUMNS) + ') VALUES (' +
                 ','.join('?' for _ in COLUMNS) + ')', [row[k] for k in COLUMNS])


def affected_state(conn, ledger):
    current = {r['id']: r for r in parts(conn)}
    imported, originals = ledger['imported'], ledger['originals']
    all_imported = all(current.get(r['id']) == r for r in imported)
    no_originals = all(r['id'] not in current for r in originals)
    original_state = all(current.get(r['id']) == r for r in originals)
    no_imported = all(r['id'] not in current for r in imported)
    if all_imported and no_originals:
        return 'committed'
    if original_state and no_imported:
        return 'original'
    return 'conflict'


def _apply(plan_path, work_dir, *, fixture_only=False, _inject_failure=None):
    plan, root, plan_hash = load_plan(plan_path, fixture_only=fixture_only, ready=True)
    ensure_closed(fixture_only, root)
    work_dir = artifact_path(work_dir)
    ledger_path = work_dir / ('ledger-' + plan_hash + '.json')
    if ledger_path.exists():
        ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
        validate_ledger(ledger)
        require(ledger['originals'] == plan['expected_initial_parts'] and
                [dict(r['part'], id=r['id']) for r in plan['rows']] ==
                [{k: v for k, v in r.items() if k not in {'created_at', 'updated_at'}}
                 for r in ledger['imported']], 'Ledger rows do not match plan')
        require(ledger['plan_sha256'] == plan_hash and ledger['repository'] == str(root), 'Ledger identity mismatch')
        verify_backup(ledger['backup'], ledger['backup_manifest_sha256'])
        with contextlib.closing(connect(root)) as conn:
            state = affected_state(conn, ledger)
        require(state != 'conflict', 'Partial, edited, or conflicting import rows refused')
        if state == 'committed':
            ledger['state'] = 'committed'
            atomic_json(ledger_path, ledger)
            return {'status': 'already_applied', 'ledger': str(ledger_path), 'inserted': 0}
        require(ledger['state'] == 'prepared', 'Previously rolled back/changed import cannot be reapplied')
    else:
        with contextlib.closing(connect(root)) as conn:
            baseline(conn, plan)
        proof = _backup(plan_path, work_dir, fixture_only=fixture_only)
        stamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        imported = [dict(row['part'], id=row['id'], created_at=stamp, updated_at=stamp) for row in plan['rows']]
        ledger = {'version': 1, 'state': 'prepared', 'repository': str(root), 'plan_sha256': plan_hash,
                  'backup': proof['backup'], 'backup_manifest_sha256': proof['manifest_sha256'],
                  'originals': plan['expected_initial_parts'], 'imported': imported}
        ledger['payload_sha256'] = ledger_payload_hash(ledger)
        atomic_json(ledger_path, ledger)  # Must precede any live write, survives crash after COMMIT.
    manifest = verify_backup(ledger['backup'], ledger['backup_manifest_sha256'])
    _, _, latest_plan_hash = load_plan(plan_path, fixture_only=fixture_only, ready=True)
    require(latest_plan_hash == plan_hash, 'Plan changed during import preparation')
    ensure_closed(fixture_only, root)
    with contextlib.closing(connect(root, True)) as conn:
        try:
            conn.execute('BEGIN IMMEDIATE')
            baseline(conn, plan)
            before_db = database_snapshot(conn)
            before_files = tree_manifest(root, True)
            require(before_db == manifest['database'] and before_files == manifest['protected_files'],
                    'Repository changed since the verified backup')
            for row in ledger['originals']:
                conn.execute('DELETE FROM parts WHERE id=?', (row['id'],))
            for index, row in enumerate(ledger['imported']):
                insert_part(conn, row)
                if _inject_failure:
                    require(fixture_only, 'Failure injection is fixture-only')
                    _inject_failure(index, conn)
            after_db = database_snapshot(conn)
            require(protected(after_db) == protected(before_db), 'Notes/settings/attachments/schema changed')
            require(parts(conn) == sorted(ledger['imported'], key=lambda r: r['id']), 'Inserted row mismatch')
            require(tree_manifest(root, True) == before_files, 'Repository files changed during apply')
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
    ledger['state'] = 'committed'
    atomic_json(ledger_path, ledger)
    return {'status': 'applied', 'ledger': str(ledger_path), 'inserted': len(ledger['imported']),
            'backup': ledger['backup']}


def _rollback(ledger_path, *, fixture_only=False):
    ledger_path = artifact_path(ledger_path)
    ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
    validate_ledger(ledger)
    root = repository_path(ledger['repository'], fixture_only)
    ensure_closed(fixture_only, root)
    verify_backup(ledger['backup'], ledger['backup_manifest_sha256'])
    with contextlib.closing(connect(root, True)) as conn:
        try:
            conn.execute('BEGIN IMMEDIATE')
            state = affected_state(conn, ledger)
            require(state != 'conflict', 'Affected rows were edited/missing or original IDs conflict; rollback refused')
            if state == 'original':
                conn.rollback()
                ledger['state'] = 'rolled_back'
                atomic_json(ledger_path, ledger)
                return {'status': 'already_original', 'ledger': str(ledger_path)}
            before_db, before_files = database_snapshot(conn), tree_manifest(root, True)
            imported_ids = [r['id'] for r in ledger['imported']]
            # Reject later attachments referencing imported rows, never cascade away user data.
            require(not any(r[1] in imported_ids for r in before_db['tables']['attachments']),
                    'Imported rows now have attachments; rollback refused')
            for row in ledger['imported']:
                conn.execute('DELETE FROM parts WHERE id=?', (row['id'],))
            for row in ledger['originals']:
                insert_part(conn, row)
            after_db = database_snapshot(conn)
            require(protected(after_db) == protected(before_db), 'Rollback changed protected tables')
            affected_ids = set(imported_ids) | {r['id'] for r in ledger['originals']}
            require([r for r in before_db['tables']['parts'] if r[0] not in affected_ids] ==
                    [r for r in after_db['tables']['parts'] if r[0] not in affected_ids], 'Unrelated parts changed')
            require(tree_manifest(root, True) == before_files, 'Files changed during rollback')
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
    ledger['state'] = 'rolled_back'
    atomic_json(ledger_path, ledger)
    return {'status': 'rolled_back', 'restored': len(ledger['originals']), 'removed': len(ledger['imported']),
            'ledger': str(ledger_path)}



def backup(plan_path, work_dir, *, fixture_only=False):
    _, root, _ = load_plan(plan_path, fixture_only=fixture_only)
    ensure_closed(fixture_only, root)
    with operation_lock(root):
        return _backup(plan_path, work_dir, fixture_only=fixture_only)


def apply(plan_path, work_dir, *, fixture_only=False, _inject_failure=None):
    _, root, _ = load_plan(plan_path, fixture_only=fixture_only, ready=True)
    ensure_closed(fixture_only, root)
    with operation_lock(root):
        return _apply(plan_path, work_dir, fixture_only=fixture_only, _inject_failure=_inject_failure)


def rollback(ledger_path, *, fixture_only=False):
    ledger_path = artifact_path(ledger_path)
    ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
    validate_ledger(ledger)
    root = repository_path(ledger['repository'], fixture_only)
    ensure_closed(fixture_only, root)
    with operation_lock(root):
        return _rollback(ledger_path, fixture_only=fixture_only)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preview','backup','apply','rollback'])
    parser.add_argument('input', help='Plan JSON, or rollback ledger JSON')
    parser.add_argument('--work-dir', default=str(QUALITY / 'import-safety'))
    args = parser.parse_args()
    try:
        if args.action == 'preview':
            result = preview(args.input)
        elif args.action == 'rollback':
            result = rollback(args.input)
        else:
            result = globals()[args.action](args.input, args.work_dir)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ImportRefused, sqlite3.Error, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        print('Import refused: ' + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
