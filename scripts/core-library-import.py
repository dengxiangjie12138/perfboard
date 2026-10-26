"""Import the verified manual XLS inspection; keep all original cell values.

Run core-library-extract.py and core-library-render-metafiles.ps1 first.
Totals and series are matched per concrete model; only the five explicitly
verified PTS/P aliases are accepted. Series rows become provenance references,
not additional model records. Excel roundoff is audited using 8 machine eps.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import shutil
import sys
import unicodedata

EPS = sys.float_info.epsilon
KEYS = ['model', 'material', 'dimensionsMm', 'apCm4', 'aeMm2', 'awMm2',
        'alNhPerTurn2', 'leMm', 'veMm3', 'weightG', 'pclW', 'ptW',
        'bobbinWidth', 'bobbinPins', 'bobbinShape']
LABELS = {1: 'EE 型', 2: 'EFD/EM 型', 3: 'EI 型', 4: 'EP 型',
          5: 'EPC 型', 6: 'EER/ETD 型', 7: 'LP 型', 8: 'RM 型',
          9: 'P 型', 10: 'PQ 型', 11: 'UF 型'}
ASSET_LABELS = {1: 'ee', 2: 'efd-em', 3: 'ei', 4: 'ep', 5: 'epc',
                6: 'eer-etd', 7: 'lp', 8: 'rm', 9: 'p', 10: 'pq', 11: 'uf'}
PTS_ALIASES = {'P14/8': 'PTS14/8', 'P18/11': 'PTS18/11', 'P23/11': 'PTS23/11',
               'P23/18': 'PTS23/18', 'P30/19': 'PTS30/19'}


def model_key(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value)).strip().upper().split())


def equivalent(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b or abs(a - b) <= 8 * EPS * max(abs(a), abs(b), sys.float_info.min)
    return a == b


def column_letter(index):
    name = ''
    while index:
        index, tail = divmod(index - 1, 26)
        name = chr(65 + tail) + name
    return name


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run(args):
    inspection = load(args.inspection)
    legacy = load(args.legacy)
    renders = load(args.render_manifest)
    source = inspection['source']
    source_id = 'manual-xls:' + source['sha256'][:12]
    sheets = inspection['sheets']
    if len(sheets) != 15 or sheets[0]['name'] != 'Sheet1':
        raise ValueError('Expected audited total plus 14 series; review the workbook')
    expected_headers = [[column['rawHeader'] for column in legacy['columns']],
                        [column['rawSubheader'] for column in legacy['columns']]]
    for sheet in sheets:
        data_rows = {row['row']: row['values'] for row in sheet['data']}
        if sheet['columns'] != 15 or [data_rows.get(2), data_rows.get(3)] != expected_headers:
            raise ValueError('Unexpected header/units in ' + sheet['name'])
        if sheet['formulaCells']:
            raise ValueError('Unexpected formulas in ' + sheet['name'])
    total_records = []
    group = ''
    for row in sheets[0]['data']:
        if row['row'] <= 3:
            continue
        values = row['values']
        if str(values[0]).startswith('TYPE') and not any(values[1:]):
            group = values[0]
            continue
        if not values[0] or not values[1] or len(values) != 15:
            raise ValueError('Ambiguous total row ' + str(row['row']))
        shape = str(group).split()[1]
        total_records.append({'row': row['row'], 'values': values, 'shape': shape})
    if len(total_records) != 137:
        raise ValueError('Expected 137 concrete total records')
    totals_by_model = {model_key(record['values'][0]): record for record in total_records}
    if len(totals_by_model) != len(total_records):
        raise ValueError('Duplicate total models require manual variant review')
    series_by_model = {}
    aliases = []
    split_roundoff = []
    sheet_counts = [{'name': 'Sheet1', 'recordCount': len(total_records)}]
    for sheet in sheets[1:]:
        records = [row for row in sheet['data'] if row['row'] >= 4]
        sheet_counts.append({'name': sheet['name'], 'recordCount': len(records)})
        for row in records:
            original_model = model_key(row['values'][0])
            key = PTS_ALIASES.get(original_model, original_model) if sheet['name'] == 'PTS' else original_model
            total = totals_by_model.get(key)
            if total is None or key in series_by_model:
                raise ValueError('Unmatched or repeated series model ' + original_model)
            expected_sheet = 'EER' if total['shape'] == 'ER' else total['shape']
            if sheet['name'] != expected_sheet:
                raise ValueError('Series shape mismatch for ' + original_model)
            disagreements = [column for column in range(1, 15)
                             if not equivalent(total['values'][column], row['values'][column])]
            if disagreements:
                raise ValueError('Total/series parameter disagreement ' + original_model + ': ' + str(disagreements))
            for column in range(1, 15):
                if total['values'][column] != row['values'][column]:
                    split_roundoff.append({'model': key, 'column': column,
                                           'totalValue': total['values'][column],
                                           'seriesValue': row['values'][column]})
            series_by_model[key] = {'sheet': sheet, 'row': row}
            if key != original_model:
                aliases.append({'model': key, 'sourceModel': row['values'][0], 'sheet': sheet['name'],
                                'row': row['row'], 'reason': 'All remaining 14 cells agree after binary-roundoff comparison'})
    if len(series_by_model) != 137:
        raise ValueError('Series do not cover every concrete total specification')
    render_by_sha = {image['sourceSha256']: image for image in renders}
    images_by_bse = {image['bseIndex']: image for image in inspection['images']}
    assets = {}
    args.assets.mkdir(parents=True, exist_ok=True)
    for bse, image in images_by_bse.items():
        rendered = render_by_sha[image['sha256']]
        original_render = args.render_manifest.parent / rendered['assetFile']
        if hashlib.sha256(original_render.read_bytes()).hexdigest() != rendered['sha256']:
            raise ValueError('Rendered image checksum mismatch')
        asset_name = 'series-' + ASSET_LABELS[bse] + '-' + image['sha256'][:12] + '.png'
        target = args.assets / asset_name
        shutil.copyfile(original_render, target)
        assets[bse] = {'assetPath': '/core-library/' + asset_name, 'sha256': rendered['sha256'],
                       'sourceSha256': image['sha256'], 'sourceLabel': LABELS[bse],
                       'bytes': target.stat().st_size, 'width': rendered['width'], 'height': rendered['height']}
    old_by_model = {model_key(record['values'][0]): record for record in legacy['records']}
    source_roundoff = []
    missing_differences = []
    semantic_conflicts = []
    records = []
    for total in total_records:
        values = total['values']
        key = model_key(values[0])
        matching_series = series_by_model[key]
        sheet = matching_series['sheet']
        split = matching_series['row']
        record_id = source_id + ':Sheet1:' + str(total['row'])
        def reference(sheet_name, row, source_model):
            return {'sourceId': source_id, 'filename': source['filename'], 'sha256': source['sha256'],
                    'recordId': source_id + ':' + sheet_name + ':' + str(row), 'sheet': sheet_name,
                    'row': row, 'cellRange': 'A' + str(row) + ':O' + str(row), 'sourceModel': source_model}
        row_source = reference('Sheet1', total['row'], str(values[0]))
        split_source = reference(sheet['name'], split['row'], str(split['values'][0]))
        notes = ['Pt 保留原表 100kHz 条件条目；不作为普适额定功率。骨架 PIN、幅宽、V/H 为原表配套信息，未推断封装或气隙。']
        raw_parameters = [{'key': KEYS[column['index']], 'label': column['label'],
                           'value': values[column['index']], 'unit': column['unit'],
                           'rawHeader': ' / '.join(header for header in [column['rawHeader'], column['rawSubheader']] if header),
                           'cell': column_letter(column['index'] + 1) + str(total['row'])}
                          for column in legacy['columns']]
        bound_images = []
        for anchor in sheet['drawingAnchors']:
            if not anchor.get('bseIndex'):
                continue
            bse = anchor['bseIndex']
            location = anchor['anchor']
            image = assets[bse]
            bound_images.append({'id': source_id + ':bse-' + str(bse) + ':' + sheet['name'] + ':' + key,
                                 'assetPath': image['assetPath'], 'sha256': image['sha256'],
                                 'sourceSha256': image['sourceSha256'], 'sourceLabel': image['sourceLabel'],
                                 'sourceId': source_id, 'filename': source['filename'], 'sourceWorkbookSha256': source['sha256'],
                                 'alt': key + ' 所属 ' + sheet['name'] + ' 系列原表示意图（原图标签 ' + image['sourceLabel'] + '）',
                                 'sourceMedia': 'Workbook/OfficeArt/BSE#' + str(bse) + ' EMF preview',
                                 'sheet': sheet['name'],
                                 'anchor': column_letter(location['columnStart']) + str(location['rowStart']) + ':' + column_letter(location['columnEnd']) + str(location['rowEnd']),
                                 'binding': 'sheet-series', 'model': key})
        if total['shape'] == 'ER':
            notes.append('具体 TYPE 为 ER，原总表类别为 ER；分表名 EER、图标签 EER/ETD 按原样保留。')
        if key != model_key(split['values'][0]):
            notes.append('总表型号 ' + key + ' 对应分表原 TYPE ' + str(split['values'][0]) + '；其余 14 个字段逐格一致，已保留别名来源。')
        if sheet['name'] == 'UU':
            notes.append('原表 UU 分表使用 UF 型系列示意图；保留原图标签，不据此改名。')
        if sheet['name'] == 'EFD':
            notes.append('原系列图含 EFD/EM 两种示意；本库该分表参数为 EFD 具体型号。')
        if isinstance(values[10], str) and values[10]:
            notes.append('损耗原值含覆盖条件 ' + values[10] + '；未转换为统一 200mT / 100kHz 数值。')
        old = old_by_model.get(key)
        if old:
            for column, (old_value, new_value) in enumerate(zip(old['values'], values)):
                if old_value == new_value:
                    continue
                entry = {'model': key, 'key': KEYS[column], 'oldValue': old_value, 'newValue': new_value,
                         'oldRow': old['row'], 'newRow': total['row']}
                if equivalent(old_value, new_value):
                    source_roundoff.append(entry)
                elif old_value == '' or new_value == '':
                    missing_differences.append(entry)
                    notes.append('来源差异：旧库 ' + legacy['columns'][column]['label'] + ' 为 ' + ('未填写' if old_value == '' else str(old_value)) + '，本原表为 ' + ('未填写' if new_value == '' else str(new_value)) + '；两来源原值分别保留。')
                else:
                    semantic_conflicts.append(entry)
        records.append({'id': record_id, 'model': str(values[0]), 'shape': total['shape'], 'material': str(values[1]),
                        'source': row_source, 'sourceReferences': [split_source],
                        'rawParameters': raw_parameters, 'images': bound_images, 'notes': notes})
    audit = {
        'recordCount': len(records), 'sheets': sheet_counts,
        'totalSheetRecordCount': len(total_records), 'seriesSheetRecordCount': len(series_by_model),
        'seriesRowsImportedAsAdditionalRecords': 0, 'matchedTotalSeriesCount': len(series_by_model),
        'exactAliasMatches': aliases, 'totalSeriesBinaryRoundoff': split_roundoff,
        'legacyBinaryRoundoff': source_roundoff, 'legacyMissingDifferences': missing_differences,
        'legacyConflicts': semantic_conflicts, 'uniqueImageCount': len(assets),
        'imageAnchorCount': sum(len(sheet['drawingAnchors']) for sheet in sheets),
        'imageAssetBytes': sum(asset['bytes'] for asset in assets.values()),
        'imageBindings': [{'sheet': sheet['name'], 'bseIndices': [anchor.get('bseIndex') for anchor in sheet['drawingAnchors']]}
                          for sheet in sheets[1:]],
        'oldOnlyModels': sorted(set(old_by_model) - set(totals_by_model)),
        'newOnlyModels': sorted(set(totals_by_model) - set(old_by_model)),
        'notes': ['总表 137 条规格与分表逐型号逐字段核对；分表仅保留对应来源，不重复导为 274 条规格。',
                  '仅总表 PTS 与分表 P 的五个明确对应别名做匹配；未泛化删除斜线或前导零。',
                  '原始数字和空值分别保留；不超过 8 个机器 epsilon 的数值表示差异列入审计而非业务冲突。',
                  '系列图片按实际分表锚点继承，不表示具体型号照片；EC、EF 及总表无图。',
                  '所有参数保留原单位和损耗条件；骨架幅宽单位未注明，不推断 PIN 排布或气隙。']
    }
    write(args.output, {'sources': [{'id': source_id, **source}], 'records': records, 'audit': audit})
    write(args.audit_dir / 'merge-audit.json', {'source': source, 'legacySource': legacy['source'], 'audit': audit, 'assets': assets})
    print(json.dumps({'records': len(records), 'totalSeriesMatches': len(series_by_model),
                      'images': len(assets), 'imageAnchors': audit['imageAnchorCount'],
                      'assetBytes': audit['imageAssetBytes'], 'aliases': len(aliases),
                      'legacyRoundoff': len(source_roundoff), 'legacyMissingDifferences': len(missing_differences),
                      'legacyConflicts': len(semantic_conflicts)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inspection', type=pathlib.Path, required=True)
    parser.add_argument('--render-manifest', type=pathlib.Path, required=True)
    parser.add_argument('--legacy', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--assets', type=pathlib.Path, required=True)
    parser.add_argument('--audit-dir', type=pathlib.Path, required=True)
    run(parser.parse_args())