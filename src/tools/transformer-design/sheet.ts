import type { ProductionSheet, SheetWinding, SheetElectrical, TransformerDesignDocument } from './types';
import { copyDocument, createBlankDesign, newId, sortedSteps } from './model';
import { strandLabel } from './sheetDrawing';
export const INDUCTANCE_UNITS: Record<string,string> = { nH:'nH', uH:'μH', mH:'mH', H:'H' };
export function newSheetWinding(n: number): SheetWinding {
 return {id:newId('coil'),label:'N'+n,start:'',end:'',diameter:'',strands:'1',turns:'',tape:'',tubeStart:false,tubeEnd:false,group:'unknown',diagramOrder:'',wireType:'',direction:'',note:''};
}
export function newElectrical(): SheetElectrical { return {id:newId('test'),start:'',end:'',inductance:'',unit:'uH',frequency:'',note:''}; }
export function blankSheet(): ProductionSheet { return {schemaVersion:1,core:'',material:'',bobbinDescription:'',transformerDescription:'',showDiagram:true,windings:[],electrical:[]}; }
/** A read-only projection never guesses grouping, insulation layers, sleeves or test conditions. */
export function projectSheet(d: TransformerDesignDocument): ProductionSheet {
 if(d.productionSheet) return JSON.parse(JSON.stringify(d.productionSheet)) as ProductionSheet;
 const sheet=blankSheet();sheet.core=d.coreSnapshot?.model||'';sheet.material=d.coreSnapshot?.material||'';
 sheet.windings=sortedSteps(d).filter(s=>s.kind==='winding').map((s,i)=>{
  const wire=s.wireSpec?.match(/^([\d.]+)\s*mm(?:\s*[*×]\s*\d+)?$/i);
  const logical=d.logicalWindings.find(w=>w.id===s.logicalWindingId);
  return {...newSheetWinding(i+1),id:s.id,label:logical?.name||'N'+(i+1),start:s.fromPin||'',end:s.toPin||'',diameter:wire?wire[1]:'',
   strands:s.parallelCount===null?'':String(s.parallelCount),turns:s.turns===null?'':String(s.turns),direction:s.direction||'',
   note:[s.notes,s.layerNotes,!wire&&s.wireSpec?'原线材：'+s.wireSpec:null,logical?.role?'原用途：'+logical.role:null,logical?.polarityNote?'同名端：'+logical.polarityNote:null].filter(Boolean).join('；')};
 });
 return sheet;
}
export function forSheetEditing(d: TransformerDesignDocument): TransformerDesignDocument {
 const next=copyDocument(d);next.productionSheet=projectSheet(next);return next;
}
export function createSheetDesign(): TransformerDesignDocument {
 const d=createBlankDesign();d.designNo=newId('sheet');d.productionSheet=blankSheet();return d;
}
export function createSheetExample(): TransformerDesignDocument {
 const d=createSheetDesign();d.title='虚构制作示例';d.exampleFlag=true;
 const s=d.productionSheet!;s.core='DEMO-CORE';s.material='DEMO-MATERIAL';
 s.windings=[['N1','1','2','0.30','12','PRI','1','2'],['N2','9','10','0.25','16','SEC','1','2'],['N3','2','3','0.30','6','PRI','3','2'],['N4','5','4','0.20','8','SEC','1','0'],['N5','6','7','0.20','10','SEC','1','2']].map((r,i)=>({...newSheetWinding(i+1),label:r[0],start:r[1],end:r[2],diameter:r[3],turns:r[4],group:r[5] as SheetWinding['group'],strands:r[6],tape:r[7]}));
 d.notes='参数与分组仅供界面演示，不是已确认生产方案。';return d;
}
export function sheetValidation(s: ProductionSheet): string[] {
 const errors:string[]=[];if(!s.core.trim())errors.push('请填写磁芯型号。');
 s.windings.forEach((w,i)=>{
  const name='绕组'+(i+1);
  if(!w.start.trim()||!w.end.trim()||!w.diameter.trim()||!w.turns.trim())errors.push(name+'请填写起止脚、线径和圈数。');
  if(w.turns.trim()&&(!Number.isFinite(Number(w.turns))||Number(w.turns)<=0))errors.push(name+'圈数需为正数。');
  if(w.strands.trim()&&(!/^\d+$/.test(w.strands)||Number(w.strands)<1||Number(w.strands)>10000))errors.push(name+'股数需为正整数。');
  if(w.tape.trim()&&(!/^\d+$/.test(w.tape)||Number(w.tape)>10000))errors.push(name+'胶带层数需为非负整数。');
 });
 s.electrical.forEach((e,i)=>{
  if(!e.start.trim()||!e.end.trim()||!Object.hasOwn(INDUCTANCE_UNITS,e.unit)||!e.inductance.trim()||!e.frequency.trim())errors.push('电感目标'+(i+1)+'请填写测量脚对、目标、单位和测试频率。');
  if(e.inductance.trim()&&(!Number.isFinite(Number(e.inductance))||Number(e.inductance)<=0))errors.push('电感目标需为正数。');
  if(e.frequency.trim()&&(!Number.isFinite(Number(e.frequency))||Number(e.frequency)<=0))errors.push('测试频率需为正数。');
 });
 return errors;
}
export function wireLabel(w: SheetWinding): string { return (w.diameter||'?')+'mm '+strandLabel(w); }
export function sleeveLabel(w: SheetWinding): string {return w.tubeStart&&w.tubeEnd?'起止':w.tubeStart?'起':w.tubeEnd?'止':'—';}
