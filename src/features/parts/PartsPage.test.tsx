import {afterEach,expect,it,vi} from 'vitest';
import {writeShowLcscWarehousePreference} from './warehouseVisibility';
import {renderToStaticMarkup} from 'react-dom/server';
import {PartsPage} from './PartsPage';
import type {Part} from '../../types';
afterEach(()=>vi.unstubAllGlobals());
function warehousePreference(show:boolean){const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});writeShowLcscWarehousePreference(show)}
const fixture=vi.hoisted(():{parts:Part[];attachments:[]}=>({parts:[{id:'zero',name:'0Ω',category:'电阻',packageName:'0805',parameters:'legacy distinctive',lcscNumber:'00C123A',brand:'ST',stockStatus:'unknown',quantity:null,location:'0805电阻盒',brief:'第一行\n第二行',url:'',createdAt:'old',updatedAt:'old'},{id:'mcu',name:'STM32F103C8T6',category:'MCU',packageName:'LQFP48',parameters:'',stockStatus:'unknown',quantity:null,location:'A1',brief:'',url:'',createdAt:'old',updatedAt:'old'}],attachments:[]}));
vi.mock('../../state/DataContext',()=>({useData:()=>({data:fixture,refresh:vi.fn(),notify:vi.fn(),setError:vi.fn()})}));
vi.mock('../../services/api',()=>({api:{},errorMessage:String,pickAttachment:vi.fn()}));
it('renders independent model and package columns without a duplicate parameters column',()=>{
 const html=renderToStaticMarkup(<PartsPage/>);
 expect(html).toContain('<th>型号</th><th>封装</th>');
 expect(html).toContain('0Ω');
 expect(html).toContain('STM32F103C8T6');
 expect(html).toContain('<td class="part-package">0805</td>');
 expect(html).not.toContain('legacy distinctive');
});
it('shows supplier number as exact text in part details',()=>{
 const html=renderToStaticMarkup(<PartsPage initialPartId="zero"/>);
 expect(html).toContain('立创商城编号');
 expect(html).toContain('<dd>00C123A</dd>');
 expect(html).toContain('<dd>ST</dd>');
 expect(html).toContain('第一行\n第二行');
});

it('places the existing supplier number after stock and shows an empty placeholder',()=>{
 const html=renderToStaticMarkup(<PartsPage/>);
 expect(html).toContain('<th>库存</th><th>嘉立创编号</th><th>操作</th>');
 expect(html).toContain('<td class="part-lcsc mono" title="00C123A">00C123A</td>');
 expect(html).toContain('<td class="part-lcsc mono">—</td>');
});

it('keeps titled location tags stable when rows are reordered, filtered, or other locations are added',()=>{
 const original=[...fixture.parts];
 const tones=(html:string)=>new Map([...html.matchAll(/<span class="location-tag" data-tone="(\d+)" title="([^"]+)">/g)].map(match=>[match[2],match[1]]));
 try{
  const before=tones(renderToStaticMarkup(<PartsPage/>));
  expect(before.get('0805电阻盒')).toBeDefined();
  expect(before.get('A1')).toBeDefined();
  const longLocation='新增位置：很长的元器件储存盒标签，需要完整保留';
  fixture.parts.reverse();
  fixture.parts.push({...original[0],id:'later',location:longLocation},{...original[0],id:'empty',location:''});
  const markup=renderToStaticMarkup(<PartsPage/>);
  const after=tones(markup);
  expect(after.get('0805电阻盒')).toBe(before.get('0805电阻盒'));
  expect(after.get('A1')).toBe(before.get('A1'));
  expect(markup).toContain(`title="${longLocation}">${longLocation}</span>`);
  expect(after.size).toBe(3);
  fixture.parts.splice(0,fixture.parts.length,original[1]);
  expect(tones(renderToStaticMarkup(<PartsPage/>)).get('A1')).toBe(before.get('A1'));
 }finally{fixture.parts.splice(0,fixture.parts.length,...original)}
});

it('gives the ten common locations distinct tag tones and leaves whitespace-only locations uncoloured',()=>{
 warehousePreference(true);
 const original=[...fixture.parts];
 const locations=['0805电阻盒','0603电阻盒','其它电阻盒','电容盒','电源IC盒','其它芯片盒','芯片盒','主控盒','晶体管盒','立创仓库'];
 try{
  fixture.parts.splice(0,fixture.parts.length,...locations.map((location,index)=>({...original[0],id:`location-${index}`,location})),{...original[0],id:'blank',location:'  '});
  const markup=renderToStaticMarkup(<PartsPage/>);
  const tones=[...markup.matchAll(/class="location-tag" data-tone="(\d+)"/g)].map(match=>match[1]);
  expect(tones).toHaveLength(10);
  expect(new Set(tones).size).toBe(10);
  expect(markup).not.toContain('title="  "');
  expect(markup.match(/<th>/g)).toHaveLength(7);
 }finally{fixture.parts.splice(0,fixture.parts.length,...original)}
});

it('keeps inventory heading/search outside the focusable list scroll region and the count after it',()=>{
 const html=renderToStaticMarkup(<PartsPage/>);
 expect(html).not.toContain('PARTS INVENTORY');
 expect(html).not.toContain('查找参数与库存；点击一行展开手写简介。');
 expect(html).toContain('<h1>物料仓库</h1>');
 expect(html).toContain('placeholder="搜索型号、封装、位置；支持拼音和空格分词…"');
 expect(html).toContain('class="inventory-filters"');
 const list=html.indexOf('class="table-scroll" tabindex="0" role="region" aria-label="物料列表"');
 expect(list).toBeGreaterThan(html.indexOf('class="inventory-toolbar"'));
 expect(html).toContain('</tbody></table></div><div class="table-footer">');
});

it('shows an explicit separate suggestion for a protocol typo without adding it to exact table rows',()=>{
 const original=[...fixture.parts];
 try{
  fixture.parts.splice(0,fixture.parts.length,{...original[0],id:'protocol',name:'Modbus interface',packageName:'0603'});
  const html=renderToStaticMarkup(<PartsPage initialQuery="mdobus 0603"/>);
  expect(html).not.toContain('data-part-id="protocol"');
  expect(html).toContain('aria-label="近似物料建议"');
  expect(html).toContain('data-part-suggestion-id="protocol"');
  expect(html).toContain('mdobus → modbus');
  expect(renderToStaticMarkup(<PartsPage initialQuery="mdobus 0604"/>)).not.toContain('data-part-suggestion-id=');
 }finally{fixture.parts.splice(0,fixture.parts.length,...original)}
});

it('keeps empty metadata placeholders textual while retaining zero quantities and exact packages',()=>{
 const original=[...fixture.parts];
 try{
  fixture.parts.splice(0,fixture.parts.length,{...original[0],id:'empty',packageName:'',category:'',location:'   ',lcscNumber:'',quantity:0});
  const html=renderToStaticMarkup(<PartsPage/>);
  expect(html).toContain('<td class="part-package">—</td><td>—</td><td class="part-location">—</td>');
  expect(html).toContain('<td class="part-lcsc mono">—</td>');
  expect(html).toContain('<small>0 个</small>');
 }finally{fixture.parts.splice(0,fixture.parts.length,...original)}
});

it('defaults to hiding the exact warehouse location, including whitespace, while keeping similar location names',()=>{
 const original=[...fixture.parts];
 try{
  fixture.parts.splice(0,fixture.parts.length,...['立创仓库',' 立创仓库 \t','立创仓库备用','我的立创仓库','A1'].map((location,index)=>({...original[0],id:`warehouse-${index}`,name:`WarehousePart${index}`,location})));
  const html=renderToStaticMarkup(<PartsPage/>);
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('显示立创仓库');
  expect(html.indexOf('显示立创仓库')).toBeGreaterThan(html.indexOf('全部状态'));
  expect(html).not.toContain('data-part-id="warehouse-0"');
  expect(html).not.toContain('data-part-id="warehouse-1"');
  for(const id of [2,3,4])expect(html).toContain(`data-part-id="warehouse-${id}"`);
  expect(fixture.parts).toHaveLength(5);
 }finally{fixture.parts.splice(0,fixture.parts.length,...original)}
});

it('applies the warehouse choice before both local search matches and suggestions, and remembers an enabled choice',()=>{
 const original=[...fixture.parts];
 try{
  fixture.parts.splice(0,fixture.parts.length,{...original[0],id:'warehouse',name:'Modbus interface',packageName:'0603',location:'立创仓库'});
  expect(renderToStaticMarkup(<PartsPage initialQuery="Modbus 0603"/>)).not.toContain('data-part-id="warehouse"');
  expect(renderToStaticMarkup(<PartsPage initialQuery="mdobus 0603"/>)).not.toContain('data-part-suggestion-id="warehouse"');
  warehousePreference(true);
  const visible=renderToStaticMarkup(<PartsPage initialQuery="Modbus 0603"/>);
  expect(visible).toContain('checked=""');
  expect(visible).toContain('data-part-id="warehouse"');
  expect(renderToStaticMarkup(<PartsPage initialQuery="mdobus 0603"/>)).toContain('data-part-suggestion-id="warehouse"');
  writeShowLcscWarehousePreference(false);
  expect(renderToStaticMarkup(<PartsPage initialQuery="Modbus 0603"/>)).not.toContain('data-part-id="warehouse"');
 }finally{fixture.parts.splice(0,fixture.parts.length,...original)}
});
