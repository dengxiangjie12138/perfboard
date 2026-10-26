import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createSheetExample,newSheetWinding} from './sheet';
import {SheetEditor,SheetPreview} from './sheetView';

describe('production sheet description UI',()=>{
 it('keeps the original bobbin field after material and edits transformer notes independently',()=>{
  const d=createSheetExample();
  d.productionSheet!.bobbinDescription='立式6+8\n旧骨架文字';
  d.productionSheet!.transformerDescription='用途：电源\n输入16–28V / 输出12V / 功率36W';
  const editor=renderToStaticMarkup(<SheetEditor document={d} onChange={()=>{}}/>);
  expect(editor.indexOf('data-sheet="material"')).toBeLessThan(editor.indexOf('data-sheet="bobbinDescription"'));
  expect(editor.indexOf('data-sheet="bobbinDescription"')).toBeLessThan(editor.indexOf('data-sheet="transformerDescription"'));
  expect(editor).toContain('class="td-field td-field-bobbin"');
  expect(editor).toContain('data-sheet="bobbinDescription" rows="1"');
  expect(editor).toContain('data-sheet="transformerDescription" rows="3"');
  expect(editor).toContain(d.productionSheet!.bobbinDescription);
  expect(editor).toContain(d.productionSheet!.transformerDescription);
  const preview=renderToStaticMarkup(<SheetPreview document={d}/>);
  expect(preview).toContain('骨架描述：'+d.productionSheet!.bobbinDescription);
  expect(preview).toContain('变压器描述：'+d.productionSheet!.transformerDescription);
 });
 it('renders every winding row in the unrestricted table without a collapse control',()=>{
  const d=createSheetExample();
  d.productionSheet!.windings=Array.from({length:12},(_,i)=>newSheetWinding(i+1));
  const editor=renderToStaticMarkup(<SheetEditor document={d} onChange={()=>{}}/>);
  expect(editor).toContain('td-table-scroll td-sheet-windings-table');
  expect(editor.match(/data-sheet-row=/g)).toHaveLength(12);
  expect(editor).not.toContain('<details');
  expect(editor).not.toContain('<summary');
 });
});
