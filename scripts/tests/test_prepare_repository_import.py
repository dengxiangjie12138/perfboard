"""Focused offline classification and research-merge tests, no real data mutations."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
import uuid

MODULE = Path(__file__).resolve().parents[1] / 'prepare_repository_import.py'
spec = importlib.util.spec_from_file_location('prepare_repository_import', MODULE)
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)


def personal(row, name=None, **fields):
    value = {'source':'personal.xlsx','sheet':'总表','row':row,'name':name or 'Model' + str(row),
             'package_name':'','brand':'','category_major':'','category_minor':'','location':'盒',
             'description':'','lcsc_number':'','source_url':'','remark':''}
    value.update(fields)
    return value


def research(row, name=None, **fields):
    value = {'row':row,'model':name or 'Model' + str(row),'brand':'ResearchBrand','package':'SOT-23',
             'category':'模拟器件','summary':'confirmed generic function', 'supplier_code':'C12345',
             'product_url':'https://www.lcsc.com/product-detail/C12345.html',
             'sources':['https://vendor.example/datasheet.pdf'],'status':'verified','notes':''}
    value.update(fields)
    return value


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.personal = [personal(i) for i in range(1000,1166)]
        self.research = [research(i) for i in range(1000,1166)]
        self.personal.append(personal(2,'4.7uF/250V',package_name='1812',category_major='电容',category_minor='贴片电容 (MLCC)'))
        self.supplier = [{'source':'supplier.xlsx','row':2,'name':'BAT54C,215','package_name':'SOT-23',
                          'brand':'SourceBrand','description':'BAT54C,215','lcsc_number':'C10001'},
                         {'source':'supplier.xlsx','row':3,'name':'BAT54C,215','package_name':'SOT-23-3',
                          'brand':'OtherBrand','description':'BAT54C,215','lcsc_number':'C10002'}]
        rows = []
        for source in self.personal + self.supplier:
            ident = str(uuid.uuid5(uuid.NAMESPACE_URL, source['source'] + ':' + str(source['row'])))
            rows.append({'id':ident, 'source':'D:/input/' + source['source'],'sourceRow':source['row'],
                         'part':{}, 'enrichment_pending':source['source']=='personal.xlsx' and source['row']>=1000})
        self.draft = {'version':1,'repository':'D:/unopened-repo','expected_initial_parts':[{'original':True}],
                      'sources':[{'path':'D:/input/personal.xlsx','sha256':'untouched'}],
                      'enrichment_ready':True,'rows':rows}

    def prepared(self, records=True):
        return prep.prepare(self.draft,self.personal,self.supplier,self.research if records else None)

    def test_description_priority_and_chinese_adjacent_protection_words(self):
        cases = [('BZT52C5V1','稳压二极管 5.1V','稳压二极管'),
                 ('X','降压稳压器 2A','DC-DC电源'),
                 ('X','线性稳压器 LDO','LDO/线性稳压器'),
                 ('X','稳压器','稳压器（类型待核实）'),
                 ('AO3401A','单向ESD 5V 用于MOS管保护','ESD/静电保护二极管'),
                 ('AO3401A','双向TVS N沟道MOS保护','TVS/瞬态抑制二极管'),
                 ('X','MOSFET栅极驱动器','驱动器'),
                 ('X','LED驱动器','驱动器'),
                 ('X','光电晶体管','光耦/光电隔离器'),
                 ('STM8S003F3P6TR','8位MCU，8 KB Flash、16 MHz CPU和集成EEPROM','微控制器'),
                 ('STM32F103C8T6','ARM MCU，64 KB Flash、72 MHz CPU','微控制器'),
                 ('GZ2012D101TF','单路0805磁珠 阻抗100Ω@100MHz','磁珠'),
                 ('X','N沟道 30V 50mΩ','MOSFET'),
                 ('X','P-channel MOSFET 30V','MOSFET')]
        for model,desc,category in cases:
            with self.subTest(desc=desc):
                result,evidence = prep.classify_supplier({'name':model,'description':desc})
                self.assertEqual(result,category)
                self.assertEqual(evidence['method'],'source_description')

    def test_units_and_frequency_priority(self):
        for desc,category in [('4.7uF ±10% 50V','电容'),('47µF 25V','电容'),
                              ('220pF ±5%','电容'),('10kΩ ±5%','电阻'),('0.1mΩ','电阻'),
                              ('10uH ±10%','电感'),('16MHz 9pF ±10ppm','晶体/振荡器')]:
            self.assertEqual(prep.classify_supplier({'name':'X','description':desc})[0],category)

    def test_family_inference_has_evidence_and_does_not_fill_unknown_identity(self):
        category,evidence=prep.classify_supplier({'name':'SS8050','description':'SS8050'})
        self.assertEqual(category,'三极管（BJT）')
        self.assertEqual(evidence['confidence'],'medium')
        self.assertTrue(evidence['sources'])
        category,evidence=prep.classify_supplier({'name':'UNKNOWN123','description':'UNKNOWN123'})
        self.assertEqual(category,prep.UNKNOWN)
        self.assertEqual(evidence['confidence'],'none')

    def test_package_aliases_preserve_raw_original_and_allow_missing_verified_fields(self):
        source=personal(1000,package_name='SOT23')
        record=research(1000,package='SOT-23')
        part,audit=prep.merge_personal(source,record,{})
        self.assertEqual(part['package_name'],'SOT23')
        self.assertEqual(audit['conflicts'],[])
        self.assertEqual(part['brand'],'ResearchBrand')
        self.assertEqual(part['lcsc_number'],'C12345')
        self.assertEqual(part['url'],record['product_url'])

    def test_hard_conflict_preserves_original_and_holds_all_candidate_identity(self):
        source=personal(355,'FZT951QTA',package_name='SOT23')
        record=research(355,'FZT951QTA',package='SOT-223',supplier_code='C460221')
        part,audit=prep.merge_personal(source,record,{})
        self.assertEqual(part['package_name'],'SOT23')
        self.assertEqual(part['brand'],'')
        self.assertEqual(part['lcsc_number'],'')
        self.assertEqual(part['url'],'')
        self.assertEqual(audit['conflicts'][0]['field'],'package_name')
        self.assertTrue(audit['identity_held'])
        self.assertEqual(audit['research_original'],record)
        no_package=research(355,'FZT951QTA',package='',supplier_code='C460221')
        held_part,held_audit=prep.merge_personal(source,no_package,{})
        self.assertEqual(held_part['lcsc_number'],'')
        self.assertEqual(held_part['url'],'')
        self.assertTrue(held_audit['identity_held'])

    def test_final_qa_package_conflict_survives_removed_candidate_fields(self):
        source=personal(355,'FZT951QTA PNP',package_name='SOT-23')
        record=research(355,'FZT951QTA PNP',package='',brand='',supplier_code='',product_url='')
        original_record=copy.deepcopy(record)
        part,audit=prep.merge_personal(source,record,{})
        self.assertEqual(audit['conflicts'],[{'field':'package_name','source':'SOT-23',
                         'research':'SOT-223','reference':'C460221','basis':'explicit_final_qa'}])
        self.assertEqual(part['package_name'],'SOT-23')
        self.assertEqual(part['lcsc_number'],'')
        self.assertEqual(part['url'],'')
        self.assertTrue(audit['identity_held'])
        self.assertEqual(audit['research_original'],original_record)
        self.assertEqual(record,original_record)

    def test_missing_or_null_research_source_fields_preserve_full_original_source(self):
        source=personal(1000,brand='SourceBrand',package_name='SOT23',lcsc_number='C777',
                        source_url='https://source.example/original',category_minor='SourceCategory')
        for extras in ({}, {'source_brand':None,'source_package':None,'source_supplier_code':None,
                             'source_url':None,'source_category':None}):
            record=research(1000,brand='SourceBrand',package='SOT-23',**extras)
            part,audit=prep.merge_personal(source,record,{})
            self.assertEqual(part['brand'],'SourceBrand')
            self.assertEqual(part['package_name'],'SOT23')
            self.assertEqual(part['lcsc_number'],'C777')
            self.assertEqual(part['url'],'https://source.example/original')
            self.assertEqual(part['category'],'SourceCategory')
            self.assertEqual(audit['source_fields'],source)
            self.assertEqual(audit['research_original'],record)

    def test_partial_and_unresolved_never_promote_candidates(self):
        source=personal(1000,brand='SourceBrand',package_name='RawSourcePackage')
        for status in ('partial','unresolved'):
            part,audit=prep.merge_personal(source,research(1000,status=status),{})
            self.assertEqual(part['brand'],'SourceBrand')
            self.assertEqual(part['package_name'],'RawSourcePackage')
            self.assertEqual(part['lcsc_number'],'')
            self.assertEqual(part['url'],'')
            self.assertEqual(audit['status'],status)
            if status=='partial':self.assertTrue(part['brief'].startswith(prep.REFERENCE_PREFIX))
            else:
                self.assertEqual(part['category'],prep.UNKNOWN)
                self.assertIn('待核实',part['brief'])
                self.assertIn('1000',part['brief'])
                self.assertNotIn('confirmed',part['brief'])

    def test_verified_candidate_notes_hold_identity(self):
        for notes in ('候选制造商，实物品牌包装待核','多厂商通用型号','candidate part; actual identity unknown'):
            part,audit=prep.merge_personal(personal(1000),research(1000,notes=notes),{})
            self.assertTrue(audit['identity_held'])
            self.assertEqual(part['lcsc_number'],'')
            self.assertEqual(part['url'],'')
            self.assertEqual(part['brand'],'')

    def test_exact_research_coverage_rejects_missing_extra_and_duplicate(self):
        for records in (self.research[:-1],self.research+[research(9999)],self.research[:-1]+[self.research[0]]):
            with self.assertRaises(prep.PreparationError):
                prep.prepare(self.draft,self.personal,self.supplier,records)
        plan,audit=self.prepared()
        self.assertEqual(audit['counts']['research_records'],166)
        self.assertFalse(plan['enrichment_ready'])

    def test_duplicate_name_variants_retain_ids_c_numbers_brands_packages(self):
        before=copy.deepcopy((self.draft,self.personal,self.supplier,self.research))
        plan,audit=self.prepared()
        self.assertEqual((self.draft,self.personal,self.supplier,self.research),before)
        self.assertEqual([r['id'] for r in plan['rows']],[r['id'] for r in self.draft['rows']])
        supplier=plan['rows'][-2:]
        self.assertEqual(len({r['id'] for r in supplier}),2)
        self.assertEqual([r['part']['brand'] for r in supplier],['SourceBrand','OtherBrand'])
        self.assertEqual([r['part']['package_name'] for r in supplier],['SOT-23','SOT-23-3'])
        self.assertEqual(audit['counts']['supplier_unique_c'],2)
        self.assertTrue(all(r['part']['url']=='' for r in supplier))

    def test_passive_summary_original_category_no_invented_ratings(self):
        plan,audit=self.prepared(False)
        passive=next(r for r in plan['rows'] if r['sourceRow']==2 and r['source'].endswith('personal.xlsx'))
        self.assertEqual(passive['part']['name'],'4.7uF/250V')
        self.assertEqual(passive['part']['category'],'贴片电容 (MLCC)')
        self.assertEqual(passive['part']['brief'],'原表标称：4.7uF/250V；封装：1812')
        self.assertEqual(audit['counts']['statuses']['pending'],166)
        self.assertFalse(plan['enrichment_ready'])

    def test_supplier_dash_package_is_unknown_and_raw_placeholder_is_audited(self):
        for row,model in zip(self.supplier,('MMBD4448HTW','BAT54CWT')):
            row['name']=model
            row['description']=model
            row['package_name']='-'
        plan,audit=self.prepared(False)
        for part_row,audit_row in zip(plan['rows'][-2:],audit['rows'][-2:]):
            self.assertEqual(part_row['part']['package_name'],'')
            self.assertEqual(audit_row['source_fields']['package_name'],'-')
            self.assertEqual(audit_row['field_provenance']['package_name'],
                             'original_source_dash_placeholder_unknown')
        self.assertEqual(audit['counts']['supplier_unique_c'],2)

    def test_description_entities_and_whitespace_only_cleaned(self):
        self.supplier[0]['description']='  电容\n1uF&nbsp;±10% &amp; 原文  '
        plan,audit=self.prepared(False)
        part=plan['rows'][-2]['part']
        self.assertEqual(part['brief'],'电容 1uF ±10% & 原文')
        self.assertEqual(part['parameters'],'')
        self.assertEqual(part['location'],'立创仓库')
        self.assertEqual(part['stock_status'],'in_stock')
        self.assertIsNone(part['quantity'])

    def test_model_mismatch_invalid_code_and_url_mismatch_fail_conservatively(self):
        with self.assertRaisesRegex(prep.PreparationError,'model/source'):
            prep.merge_personal(personal(1000),research(1000,model='different'),{})
        part,audit=prep.merge_personal(personal(1000),research(1000,supplier_code='C12345 / C23456'),{})
        self.assertEqual(part['lcsc_number'],'')
        self.assertEqual(part['url'],'')
        self.assertTrue(audit['warnings'])
        part,audit=prep.merge_personal(personal(1000),research(1000,product_url='https://www.lcsc.com/product-detail/C999.html'),{})
        self.assertEqual(part['lcsc_number'],'C12345')
        self.assertEqual(part['url'],'')

    def test_final_qa_prefixes_sources_and_typical_values_are_idempotent(self):
        for row,vendor in ((279,'NXP'),(282,'TI')):
            record=research(row)
            once,_=prep.final_qa(record)
            twice,_=prep.final_qa(once)
            self.assertEqual(once,twice)
            self.assertEqual(once['status'],'partial')
            self.assertEqual(once['summary'].count(vendor+'参考规格'),1)
        record=research(286,summary='复位延时240ms，静态电流300nA')
        once,_=prep.final_qa(record);twice,_=prep.final_qa(once)
        self.assertEqual(once,twice)
        self.assertEqual(once['summary'].count('典型值'),2)
        for row,url in ((267,prep.OFFICIAL_ISOLATOR),(269,prep.OFFICIAL_ISOLATOR),(284,prep.OFFICIAL_FLASH)):
            once,_=prep.final_qa(research(row));twice,_=prep.final_qa(once)
            self.assertEqual(once,twice)
            self.assertIn(url,once['sources'])

    def test_research_transport_extra_fields_preserved_in_audit(self):
        self.research[0].update(status='partial',notes=['full note','another note'],source_brand='',extra={'keep':True})
        plan,audit=self.prepared()
        entry=audit['rows'][0]
        self.assertEqual(entry['research_original'],self.research[0])
        self.assertEqual(entry['research']['extra'],{'keep':True})
        self.assertEqual(entry['research']['notes'],['full note','another note'])
        self.assertTrue(plan['rows'][0]['part']['brief'].startswith(prep.REFERENCE_PREFIX))


if __name__=='__main__':
    unittest.main()
