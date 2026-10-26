"""Conservative offline preparation of an existing Perfboard import plan.

Retains source rows/UUID5s, classifies supplier use, merges exactly 166 personal
research records when supplied, and emits a private provenance/conflict audit.
Every emitted plan is enrichment_ready=False; final review happens separately.
No repository connection, network request, or application action is performed.
"""
from __future__ import annotations

import argparse
from collections import Counter
import copy
import html
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

PROJECT = Path(__file__).resolve().parents[1]
QUALITY = PROJECT / '.quality'
UNKNOWN = '待分类（用途未确认）'
REFERENCE_PREFIX = '参考系列资料（实物待核实）'
FIELD_NAMES = ('name','category','package_name','parameters','stock_status','quantity',
               'location','brief','url','lcsc_number','brand')
OFFICIAL_ISOLATOR = 'https://e.chipanalog.com/Public/Uploads/uploadfile/files/20250725/CAIS308xdatasheetVersion1.13en20250723.pdf'
OFFICIAL_FLASH = 'https://www.winbond.com/hq/product/code-storage-flash/qspi-nor/w25q-jv/?__locale=en&partNo=W25Q256JVEIQ'


class PreparationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise PreparationError(message)


def text(value):
    return '' if value is None else str(value).strip()


def clean_description(value):
    # Decode entities and normalize whitespace only. Never invent ratings/claims.
    return re.sub(r'\s+', ' ', html.unescape(text(value))).strip()


def package_family(value):
    """Audit aliases only; never rewrite the user's package label."""
    value = re.sub(r'[\s_\-]', '', text(value).upper())
    aliases = {'SOT233':'SOT23', 'SOT233L':'SOT23', 'SOT233P':'SOT23',
               'TO236AB':'SOT23', 'SOT2233':'SOT223', 'SOT2233L':'SOT223',
               'SOP8':'SO8', 'SOIC8':'SO8', 'SO8':'SO8'}
    return aliases.get(value, value)


def brand_family(value):
    return re.sub(r'[\s\W_]', '', text(value).casefold())


def source_key(source, row):
    # Windows paths must work when the pure library is tested on other platforms.
    return (str(source).replace('\\', '/').rsplit('/', 1)[-1], int(row))


# Rules are deliberately ordered: protection/Zener devices precede regulator ICs;
# optocouplers precede transistors, and drivers precede standalone MOSFETs/LEDs.
DESCRIPTION_RULES = (
    ('ESD/静电保护二极管', r'\bESD\b|静电保护|静电防护'),
    ('TVS/瞬态抑制二极管', r'\bTVS\b|瞬态抑制|瞬态电压抑制'),
    ('稳压二极管', r'稳压二极管|齐纳|\bZENER\b'),
    ('光耦/光电隔离器', r'光耦|光电晶体管|光电耦合|OPTOCOUPLER'),
    ('数字隔离器', r'数字隔离器|DIGITAL\s+ISOLATOR'),
    ('肖特基二极管', r'肖特基|SCHOTTKY'),
    ('整流桥', r'整流桥|桥式整流|BRIDGE\s+RECTIFIER'),
    ('整流二极管', r'整流二极管|快恢复|超快恢复|RECTIFIER'),
    ('开关二极管', r'开关二极管|SWITCHING\s+DIODE'),
    ('运算放大器', r'运算放大|运放|OPERATIONAL\s+AMPLIFIER'),
    ('比较器', r'比较器|COMPARATOR'),
    ('电压基准', r'电压基准|基准电压|VOLTAGE\s+REFERENCE'),
    ('驱动器', r'驱动|\bDRIVER\b'),
    ('MOSFET', r'MOSFET|\bMOS\b|[NP]\s*[-－]?\s*沟道|[NP]\s*[-－]?\s*CHANNEL|场效应'),
    ('三极管（BJT）', r'三极管|双极.*晶体管|\bNPN\b|\bPNP\b|\bBJT\b'),
    ('LDO/线性稳压器', r'\bLDO\b|低压差|线性稳压|线性调节|LINEAR\s+REGULATOR'),
    ('DC-DC电源', r'降压|升压|BUCK|BOOST|DC\s*[-/]?\s*DC|开关稳压'),
    ('稳压器（类型待核实）', r'稳压器'),
    ('电源管理', r'电源管理|充电管理|充电芯片|电池保护'),
    ('微控制器', r'微控制器|单片机|MICROCONTROLLER|\bMCU\b'),
    ('EEPROM', r'EEPROM'),
    ('存储器', r'FLASH|SRAM|DRAM|存储器'),
    ('接口/收发器', r'收发器|RS\s*[-]?\s*485|RS\s*[-]?\s*232|CAN\s*(?:接口|总线)|USB\s*(?:接口|控制器)'),
    ('逻辑/模拟开关', r'逻辑|多路复用|解复用|模拟开关|\bGATE\b'),
    ('磁珠', r'磁珠|FERRITE\s+BEAD'),
    ('晶体/振荡器', r'晶振|振荡器|石英|\bCRYSTAL\b|\bOSCILLATOR\b|\d\s*(?:MHZ|KHZ).*?(?:PPM|[pnuµμ]F)'),
    ('LED/发光二极管', r'发光二极管|\bLED\b|[红绿蓝白黄紫]灯'),
    ('电阻', r'电阻|\d\s*(?:[kKmM]?Ω|[kK]?OHM)(?![A-Z])'),
    ('电容', r'电容|\d(?:\.\d+)?\s*(?:[pnuµμm]F)(?![A-Za-z])'),
    ('电感', r'电感|\d(?:\.\d+)?\s*(?:[nuµμm]H)(?![A-Za-z])'),
    ('保险丝/保护器件', r'保险丝|熔断器|FUSE'),
    ('连接器', r'连接器|接插件|插座|CONNECTOR'),
)

# Narrow family-level inferences; these sources support use only, not the exact
# source brand/package, ratings, stock, or an interchangeable supplier identity.
FAMILY_RULES = (
    ('三极管（BJT）', r'SS(?:8050|8550)(?:[A-Z0-9,-]*)',
     ['https://www.onsemi.com/pdf/datasheet/ss8050-d.pdf',
      'https://www.onsemi.com/products/discrete-power-modules/general-purpose-and-low-vcesat-transistors/ss8550']),
    ('三极管（BJT）', r'MMBT390[46](?:[A-Z0-9,-]*)', ['https://www.nexperia.com/product/MMBT3904']),
    ('肖特基二极管', r'BAT54(?:[A-Z0-9,-]*)', ['https://www.nexperia.com/product/BAT54']),
    ('肖特基二极管', r'SS[1-5][1-9](?:0|00)?(?:[A-Z,-]*)',
     ['https://www.lcsc.com/product-detail/Schottky-Barrier-Diodes-SBD_Jiangsu-Yutai-Elec-SS54_C22452.html']),
    ('稳压二极管', r'BZT52[A-Z0-9,-]*', ['https://assets.nexperia.com/documents/data-sheet/BZT52_SER.pdf']),
    ('稳压二极管', r'BZX84[A-Z0-9,-]*', ['https://www.nexperia.com/product/BZX84-C18']),
    ('稳压二极管', r'MM1Z[A-Z0-9,-]*', ['https://www.lcsc.com/product-detail/Zener-Diodes_MM1Z10_C107591.html']),
    ('开关二极管', r'BAV99[A-Z0-9,-]*', ['https://www.nexperia.com/group/bav99-series']),
    ('开关二极管', r'BAS16[A-Z0-9,-]*', ['https://www.nexperia.com/product/BAS16']),
    ('整流二极管', r'US1[ABDGJKM][A-Z0-9,-]*', ['https://www.diodes.com/datasheet/download/US1A.pdf']),
    ('MOSFET', r'2N700[02][A-Z0-9,-]*', ['https://www.st.com/resource/en/datasheet/cd00005134.pdf']),
    ('MOSFET', r'AO3401A', ['https://www.aosmd.com/products/mosfets/p-channel-mosfets-8v-60v/ao3401a']),
)


def classify_supplier(row):
    description = clean_description(row.get('description'))
    matches = [(category, pattern) for category, pattern in DESCRIPTION_RULES
               if re.search(pattern, description, re.I | re.ASCII)]
    for category, pattern in matches:
            return category, {'method':'source_description', 'confidence':'high', 'rule':pattern,
                              'evidence':description, 'sources':[],
                              'matched_categories':[c for c, _ in matches],
                              'selection':'ordered primary-use keywords precede incidental units/features'}
    name = text(row.get('name')).upper()
    for category, pattern, sources in FAMILY_RULES:
        if re.fullmatch(pattern, name):
            return category, {'method':'model_family_inference', 'confidence':'medium',
                              'rule':pattern, 'evidence':name, 'sources':sources,
                              'limitation':'用途系列推断；不证明实物品牌、封装、额定值或供应商身份'}
    return UNKNOWN, {'method':'unresolved', 'confidence':'none', 'rule':'', 'evidence':description, 'sources':[]}


def load_research(value):
    if isinstance(value, dict):
        value = value.get('rows', value.get('research', value.get('entries')))
    require(isinstance(value, list), 'Research must be a list or an object containing rows/research/entries')
    return value


def valid_product_url(value):
    value = text(value)
    if not value:
        return False
    parsed = urlsplit(value)
    return parsed.scheme in {'https','http'} and bool(parsed.hostname) and not parsed.username and not parsed.password


def append_source(record, url):
    values = record.setdefault('sources', [])
    require(isinstance(values, list), 'Research sources must be a list')
    if url not in values:
        values.append(url)


def final_qa(record):
    """Explicit reviewed corrections; original transport record remains in the audit."""
    record = copy.deepcopy(record)
    row = int(record['row'])
    changes = []
    if row in {279,282}:
        record['status'] = 'partial'
        vendor = 'NXP' if row == 279 else 'TI'
        summary = text(record.get('summary'))
        record['summary'] = summary if summary.startswith(vendor + '参考规格') else vendor + '参考规格：' + summary
        changes.append('最终复核：品牌身份未确认，按参考系列资料处理，候选身份仅入审计')
    if row in {267,269}:
        append_source(record, OFFICIAL_ISOLATOR)
        changes.append('最终复核：补充官方隔离器资料')
    if row == 284:
        append_source(record, OFFICIAL_FLASH)
        changes.append('最终复核：补充官方闪存资料')
    if row == 286:
        summary = text(record.get('summary'))
        summary = re.sub(r'240\s*ms(?![（(]?典型)', '240ms（典型值）', summary, flags=re.I)
        summary = re.sub(r'300\s*nA(?![（(]?典型)', '300nA（典型值）', summary, flags=re.I)
        record['summary'] = summary
        changes.append('最终复核：240ms/300nA标注典型值')
    if row == 287 and text(record.get('supplier_code')) == 'C190802':
        record['product_url'] = 'https://www.lcsc.com/product-detail/C190802.html'
        changes.append('最终复核：清理供应商商品URL')
    if row == 355:
        record['qa_identity_hold'] = '最终复核：原表SOT23与C460221商品SOT223冲突，候选身份不填入计划'
        changes.append('最终复核：FZT951QTA保留原封装，SOT23与SOT223真实冲突时不填候选C号/URL')
    return record, changes


def identity_warning(record):
    notes = json.dumps(record.get('notes', ''), ensure_ascii=False)
    return bool(re.search(r'候选|多(?:个|家)?厂(?:商|家)|多制造商|MULTI[- ]?MANUFACTURER|CANDIDATE|'
                          r'实物.{0,16}(?:待核|未确认|未知)|(?:品牌|厂商|厂家|包装|封装).{0,8}(?:待核|未确认|未知|不详)', notes, re.I))


def merge_personal(source, research, provenance):
    original = {'brand':text(source.get('brand')), 'package_name':text(source.get('package_name')),
                'lcsc_number':text(source.get('lcsc_number')), 'url':text(source.get('source_url'))}
    part = dict(original)
    name = text(source.get('name'))
    source_category = text(source.get('category_minor')) or text(source.get('category_major'))
    part.update(name=name, category=source_category or UNKNOWN, parameters='', stock_status='in_stock',
                quantity=None, location=text(source.get('location')), brief='')
    audit = {'source_fields':copy.deepcopy(source), 'field_provenance':provenance, 'conflicts':[],
             'identity_held':False, 'warnings':[]}
    if research is None:
        part['brief'] = '待核实：' + name + '；原表行：' + str(source['row'])
        audit['status'] = 'pending'
        return part, audit
    audit['research_original'] = copy.deepcopy(research)
    record, corrections = final_qa(research)
    audit['research'] = record
    audit['qa_corrections'] = corrections
    status = text(record.get('status'))
    require(status in {'verified','partial','unresolved'}, 'Invalid research status at row ' + str(source['row']))
    require(text(record.get('model')) == name, 'Research model/source name mismatch at row ' + str(source['row']))
    require(isinstance(record.get('sources', []), list), 'Research sources must be a list')
    audit['status'] = status
    if status == 'verified':
        require(bool(record.get('sources')), 'Verified research requires supporting sources')
    candidates = {'brand':text(record.get('brand')), 'package_name':text(record.get('package')),
                  'lcsc_number':text(record.get('supplier_code')), 'url':text(record.get('product_url'))}
    for field in ('brand','package_name','lcsc_number'):
        compare = package_family if field == 'package_name' else brand_family if field == 'brand' else text
        if original[field] and candidates[field] and compare(original[field]) != compare(candidates[field]):
            audit['conflicts'].append({'field':field, 'source':original[field], 'research':candidates[field]})
    if int(source['row']) == 355 and name.upper().split()[0] == 'FZT951QTA' and package_family(original['package_name']) == 'SOT23':
        # Final QA verified the C460221 listing as SOT223 even when the final
        # transport deliberately removed candidate identity fields. Record that
        # evidence without changing the research original or user's package.
        conflict = next((item for item in audit['conflicts'] if item['field'] == 'package_name'), None)
        if conflict is None:
            conflict = {'field':'package_name', 'source':original['package_name'], 'research':'SOT-223'}
            audit['conflicts'].append(conflict)
        conflict.update(reference='C460221', basis='explicit_final_qa')
    held = bool(audit['conflicts']) or identity_warning(record) or bool(record.get('qa_identity_hold'))
    if record.get('qa_identity_hold'):
        audit['warnings'].append(record['qa_identity_hold'])
    audit['identity_held'] = held
    if identity_warning(record):
        audit['warnings'].append('研究备注含候选/多厂商/实物身份待核：候选C号和商品URL不填入计划')
    if status == 'unresolved':
        part['brief'] = '待核实：' + name + '；原表行：' + str(source['row'])
    else:
        summary = clean_description(record.get('summary'))
        prefix = REFERENCE_PREFIX + '；' if status == 'partial' and not summary.startswith(REFERENCE_PREFIX) else ''
        part['brief'] = prefix + (summary or '用途待核实')
        category = text(record.get('category'))
        if category and not source_category:
            part['category'] = category
            provenance['category'] = 'research_' + status + '_generic_use'
        provenance['brief'] = 'research_' + status
        if status == 'verified':
            for field in ('brand','package_name'):
                if not held and not original[field] and candidates[field]:
                    part[field] = candidates[field]
                    provenance[field] = 'research_verified'
            code = candidates['lcsc_number']
            if code and not re.fullmatch(r'C[1-9][0-9]*', code):
                audit['warnings'].append('候选供应商编号不符合精确C号格式，未填入计划')
                held = True
                audit['identity_held'] = True
            if not held and re.fullmatch(r'C[1-9][0-9]*', code or ''):
                if not original['lcsc_number']:
                    part['lcsc_number'] = code
                    provenance['lcsc_number'] = 'research_verified'
                url = candidates['url']
                if url and valid_product_url(url) and not original['url']:
                    # A C-number embedded in a candidate LCSC URL must match this identity.
                    url_codes = re.findall(r'\bC[0-9]+\b', url)
                    if not url_codes or set(url_codes) == {code}:
                        part['url'] = url
                        provenance['url'] = 'research_verified'
                    else:
                        audit['warnings'].append('商品URL的C号与候选编号不一致，未填入计划')
    provenance['name'] = 'original_source_trim_only'
    for field, value in original.items():
        if value:
            provenance[field] = 'original_source'
    return part, audit


def prepare(draft, personal, supplier, research=None):
    require(isinstance(draft, dict) and draft.get('version') == 1, 'Draft version 1 required')
    require(isinstance(personal, list) and isinstance(supplier, list), 'Normalized inputs must be lists')
    plan = copy.deepcopy(draft)
    plan['enrichment_ready'] = False
    normalized = {}
    for kind, records in (('personal',personal),('supplier',supplier)):
        for record in records:
            key = source_key(record['source'], record['row'])
            require(key not in normalized, 'Duplicate normalized source row')
            require(bool(text(record.get('name'))), 'Source name missing')
            normalized[key] = (kind, record)
    rows = plan.get('rows')
    require(isinstance(rows, list) and len(rows) == len(normalized), 'Draft/source row coverage mismatch')
    require(len({r['id'] for r in rows}) == len(rows), 'Distinct source rows must retain distinct IDs')
    draft_keys = [source_key(r['source'], r['sourceRow']) for r in rows]
    require(len(set(draft_keys)) == len(draft_keys) and set(draft_keys) == set(normalized), 'Draft/source rows differ')
    pending = {key[1] for key, row in zip(draft_keys, rows)
               if normalized[key][0] == 'personal' and row.get('enrichment_pending') is True}
    require(len(pending) == 166, 'Exactly 166 pending personal research rows required')
    research_by_row = {}
    if research is not None:
        research = load_research(research)
        for record in research:
            require(isinstance(record, dict) and type(record.get('row')) is int, 'Research row must be integer')
            require(record['row'] not in research_by_row, 'Duplicate research row')
            research_by_row[record['row']] = record
        require(set(research_by_row) == pending,
                'Research coverage must match all 166 rows exactly; missing=' + str(sorted(pending-set(research_by_row))) +
                '; extra=' + str(sorted(set(research_by_row)-pending)))
    audit = {'version':1, 'enrichment_ready':False, 'rows':[], 'inventory_policy':
             '用户明确指定两来源均in_stock、quantity=null；不代表供应商实时库存核验',
             'research_supplied':research is not None}
    for key, row in zip(draft_keys, rows):
        kind, source = normalized[key]
        provenance = {f:'unknown_blank' for f in FIELD_NAMES}
        for f in ('stock_status','quantity'):
            provenance[f] = 'explicit_user_inventory_policy'
        if kind == 'supplier':
            category, evidence = classify_supplier(source)
            part = {'name':text(source['name']), 'category':category,
                    'package_name':'' if text(source.get('package_name')) == '-' else text(source.get('package_name')),
                    'parameters':'', 'stock_status':'in_stock', 'quantity':None, 'location':'立创仓库',
                    'brief':clean_description(source.get('description')), 'url':'',
                    'lcsc_number':text(source.get('lcsc_number')), 'brand':text(source.get('brand'))}
            for f in ('name','package_name','lcsc_number','brand'):
                provenance[f] = 'original_source' if part[f] else 'unknown_blank'
            if text(source.get('package_name')) == '-':
                provenance['package_name'] = 'original_source_dash_placeholder_unknown'
            provenance.update(category=evidence['method'], brief='original_description_entities_whitespace_only',
                              location='explicit_user_supplier_location')
            detail = {'status':'source_only', 'classification':evidence, 'source_fields':copy.deepcopy(source),
                      'field_provenance':provenance, 'conflicts':[], 'identity_held':False, 'warnings':[]}
        elif key[1] in pending:
            part, detail = merge_personal(source, research_by_row.get(key[1]), provenance)
            row['enrichment_pending'] = research is None or detail['status'] == 'unresolved' or detail['identity_held']
        else:
            category = text(source.get('category_minor')) or text(source.get('category_major')) or UNKNOWN
            part = {'name':text(source['name']), 'category':category,
                    'package_name':text(source.get('package_name')), 'parameters':'',
                    'stock_status':'in_stock', 'quantity':None, 'location':text(source.get('location')),
                    'brief':'原表标称：' + text(source['name']) +
                            ('；封装：' + text(source['package_name']) if text(source.get('package_name')) else ''),
                    'url':text(source.get('source_url')), 'lcsc_number':text(source.get('lcsc_number')),
                    'brand':text(source.get('brand'))}
            for f in ('name','category','package_name','location','url','lcsc_number','brand'):
                provenance[f] = 'original_source' if part[f] else 'unknown_blank'
            provenance['brief'] = 'original_nominal_name_package_only'
            detail = {'status':'source_passive', 'source_fields':copy.deepcopy(source), 'field_provenance':provenance,
                      'conflicts':[], 'identity_held':False, 'warnings':[]}
        require(set(part) == set(FIELD_NAMES), 'Prepared part field mismatch')
        require(part['name'] == text(source['name']), 'Source name changed')
        if text(source.get('brand')):
            require(part['brand'] == text(source['brand']), 'Source brand was overwritten')
        if text(source.get('package_name')):
            if kind == 'supplier' and text(source['package_name']) == '-':
                require(part['package_name'] == '', 'Unknown dash package must remain blank')
            else:
                require(part['package_name'] == text(source['package_name']), 'Source package was overwritten')
        row['part'] = part
        detail.update(id=row['id'], kind=kind, source=row['source'], source_row=key[1], name=part['name'])
        audit['rows'].append(detail)
    categories = Counter(r['part']['category'] for r in rows)
    supplier_rows = [r for key,r in zip(draft_keys,rows) if normalized[key][0] == 'supplier']
    unclassified = [r for r in supplier_rows if r['part']['category'] == UNKNOWN]
    audit['counts'] = {'total':len(rows), 'personal':len(personal), 'supplier':len(supplier),
                       'research_expected':166, 'research_records':len(research_by_row),
                       'statuses':dict(Counter(r['status'] for r in audit['rows'])),
                       'categories':dict(sorted(categories.items())),
                       'supplier_categories':dict(sorted(Counter(r['part']['category'] for r in supplier_rows).items())),
                       'supplier_unique_c':len({text(r.get('lcsc_number')) for r in supplier if text(r.get('lcsc_number'))}),
                       'supplier_unclassified':len(unclassified),
                       'conflict_rows':sum(bool(r['conflicts']) for r in audit['rows']),
                       'identity_held_rows':sum(r['identity_held'] for r in audit['rows'])}
    audit['unclassified_samples'] = [{'row':r['sourceRow'], 'name':r['part']['name'],
                                      'brand':r['part']['brand'], 'package':r['part']['package_name'],
                                      'description':r['part']['brief']} for r in unclassified[:30]]
    plan['preparation'] = {'research_records':len(research_by_row), 'source_rows':len(rows),
                           'final_review_required':True, 'identity_held_rows':audit['counts']['identity_held_rows'],
                           'supplier_unclassified':len(unclassified)}
    plan['research_pending'] = sorted(pending-set(research_by_row))
    return plan, audit


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_private_json(path, value):
    # Reuse the audited artifact boundary; this module never opens a repository.
    from repository_import import atomic_json, artifact_path
    path = artifact_path(path)
    require(not path.exists(), 'Choose a new output path; existing private artifacts are not overwritten')
    atomic_json(path, value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('draft','personal','supplier','output','audit'):
        parser.add_argument('--' + option, required=True)
    parser.add_argument('--research')
    args = parser.parse_args()
    try:
        plan, audit = prepare(read_json(args.draft), read_json(args.personal), read_json(args.supplier),
                              read_json(args.research) if args.research else None)
        # Check both names before writing either; neither may alias an input file.
        from repository_import import artifact_path
        output, audit_path = artifact_path(args.output), artifact_path(args.audit)
        require(output != audit_path and not output.exists() and not audit_path.exists(), 'Output paths must be new and distinct')
        write_private_json(output, plan)
        write_private_json(audit_path, audit)
        print(json.dumps(audit['counts'], ensure_ascii=False, indent=2))
    except (PreparationError, OSError, ValueError, KeyError, TypeError) as exc:
        print('Preparation refused: ' + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
