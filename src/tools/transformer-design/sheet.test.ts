import {describe,it,expect} from 'vitest';
import {createExampleDesign,copyDocument,saveValidation,exportFileName} from './model';
import {createSheetDesign,createSheetExample,forSheetEditing,newElectrical,projectSheet,wireLabel} from './sheet';
import {diagram,construction} from './sheetDrawing';
describe('repository-backed production sheets',()=>{
 it('projects exact legacy rows without mutating old fields or guessing grouping, sleeves and tape',()=>{
  const old=createExampleDesign(),before=copyDocument(old),next=forSheetEditing(old);
  expect(old).toEqual(before);expect({...next,productionSheet:undefined}).toEqual({...before,productionSheet:undefined});
  expect(next.productionSheet!.windings).toHaveLength(4);
  expect(next.productionSheet!.windings[0]).toMatchObject({diameter:'1',turns:'5',group:'unknown',tape:'',tubeStart:false,tubeEnd:false});
  expect(next.productionSheet!.electrical).toEqual([]);
 });
 it('preserves complex wire facts in note without interpreting them as diameter',()=>{
  const d=createExampleDesign();d.windingSteps[0].wireSpec='Litz proprietary 0.05×40';d.windingSteps[0].parallelCount=null;
  expect(projectSheet(d).windings[0]).toMatchObject({diameter:'',strands:''});expect(projectSheet(d).windings[0].note).toContain('Litz proprietary');
 });
 it('uses title filename and a stable hidden native identity without requiring a title',()=>{
  const d=createSheetDesign();d.productionSheet!.core='EE19';expect(saveValidation(d)).toEqual([]);
  expect(exportFileName(d,'pdf')).toBe('未命名制作单.pdf');d.title='厂单:A';expect(exportFileName(d,'json')).toBe('厂单_A.json');
 });
 it('keeps an optional empty target table and permits arbitrary cross-series measurement pins',()=>{
  const d=createSheetExample();expect(saveValidation(d)).toEqual([]);
  d.productionSheet!.electrical.push({...newElectrical(),start:'1',end:'3',inductance:'37.5',frequency:'25'});
  d.productionSheet!.electrical.push({...newElectrical(),start:'99',end:'100',inductance:'1.25',unit:'mH',frequency:'12.5'});
  expect(saveValidation(d)).toEqual([]);d.productionSheet!.electrical[0].frequency='0';expect(saveValidation(d).join('')).toContain('正数');
 });
 it('renders one-line canonical wire labels and shared pin/SEC mirror geometry',()=>{
  const d=createSheetExample(),s=d.productionSheet!;
  expect(wireLabel(s.windings[0])).toBe('0.30mm 单股并绕');expect(wireLabel(s.windings[2])).toBe('0.30mm 3股并绕');
  const svg=diagram(s);expect(svg.match(/data-terminal="2"/g)).toHaveLength(1);expect(svg).toContain('data-group="SEC"');
  expect(construction(s)).toContain('BOBBIN');expect(construction(s)).toContain('单股并绕');
 });
});

describe('optional bobbin text compatibility',()=>{
 it('keeps older sheet descriptions empty and preserves newly saved arbitrary text',()=>{
  const old=createSheetExample();delete old.productionSheet!.bobbinDescription;
  expect(forSheetEditing(old).productionSheet!.bobbinDescription??'').toBe('');
  const edited=forSheetEditing(old);edited.productionSheet!.bobbinDescription='自由输入：立式骨架 / 10脚 / 特殊绝缘要求';
  const reopened=forSheetEditing(JSON.parse(JSON.stringify(edited)));
  expect(reopened.productionSheet!.bobbinDescription).toBe(edited.productionSheet!.bobbinDescription);
  expect(old.productionSheet!.bobbinDescription).toBeUndefined();
 });
});

describe('optional transformer description compatibility',()=>{
 it('does not reinterpret the existing bobbin description when opening an old record',()=>{
  const old=createSheetExample();delete old.productionSheet!.transformerDescription;
  old.productionSheet!.bobbinDescription='立式6+8\n保留旧骨架备注';
  const before=copyDocument(old),edited=forSheetEditing(old);
  expect(edited.productionSheet!.transformerDescription??'').toBe('');
  expect(edited.productionSheet!.bobbinDescription).toBe(old.productionSheet!.bobbinDescription);
  edited.productionSheet!.transformerDescription='用途：辅助电源\n输入16–28V，输出12V，功率36W';
  const reopened=forSheetEditing(JSON.parse(JSON.stringify(edited)));
  expect(reopened.productionSheet!.transformerDescription).toBe(edited.productionSheet!.transformerDescription);
  expect(reopened.productionSheet!.bobbinDescription).toBe(before.productionSheet!.bobbinDescription);
  expect(old).toEqual(before);
  expect(saveValidation(reopened)).toEqual([]);
 });
 it('allows old missing, explicit null and empty descriptions without new required parameters',()=>{
  for(const value of [undefined,null,'']){
   const d=createSheetExample();d.productionSheet!.transformerDescription=value;
   expect(saveValidation(d)).toEqual([]);
   expect(forSheetEditing(d).productionSheet!.transformerDescription??'').toBe('');
  }
 });
});
