import type { TransformerDesignDocument, ProductionSheet, SheetWinding, SheetElectrical } from './types';
import { diagram, construction, strandLabel } from './sheetDrawing';
import { newSheetWinding, newElectrical, INDUCTANCE_UNITS, wireLabel, sleeveLabel } from './sheet';
import { useEffect,useMemo,useRef,useState,type ReactNode } from 'react';
function RowMore({title,children}:{title:string;children:ReactNode}){
 const [open,setOpen]=useState(false);const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open)ref.current?.showModal();},[open]);
 return <><button type="button" className="small td-row-more" onClick={()=>setOpen(true)}>更多</button>{open&&<dialog ref={ref} className="td-native-dialog td-row-dialog" aria-label={title} onCancel={e=>{e.preventDefault();setOpen(false);}}><h3>{title}</h3><div>{children}</div><div className="td-actions"><button type="button" onClick={()=>setOpen(false)}>完成</button></div></dialog>}</>;
}
export function SheetEditor({document:d,onChange}:{document:TransformerDesignDocument;onChange:(patch:Partial<TransformerDesignDocument>)=>void}) {
 const s=d.productionSheet!;
 const change=(patch:Partial<ProductionSheet>)=>onChange({productionSheet:{...s,...patch}});
 const winding=(id:string,patch:Partial<SheetWinding>)=>change({windings:s.windings.map(w=>w.id===id?{...w,...patch}:w)});
 const electrical=(id:string,patch:Partial<SheetElectrical>)=>change({electrical:s.electrical.map(e=>e.id===id?{...e,...patch}:e)});
 const move=(i:number,delta:number)=>{const rows=[...s.windings];if(i+delta<0||i+delta>=rows.length)return;[rows[i],rows[i+delta]]=[rows[i+delta],rows[i]];change({windings:rows});};
 return <div className="td-sheet-editor">
  <section className="td-section"><h3>基本信息</h3><div className="td-grid">
   <label className="td-field"><span>制作单名称（导出文件名，可留空）</span><input data-sheet="name" value={d.title} onChange={e=>onChange({title:e.target.value})}/></label>
   <label className="td-field"><span>磁芯型号 *</span><input data-sheet="core" value={s.core} onChange={e=>change({core:e.target.value})}/></label>
   <label className="td-field"><span>磁芯材质（自由输入）</span><input data-sheet="material" value={s.material} onChange={e=>change({material:e.target.value})}/></label>
   <label className="td-field td-field-bobbin"><span>骨架描述（自由输入）</span><textarea data-sheet="bobbinDescription" rows={1} maxLength={4000} value={s.bobbinDescription ?? ''} onChange={e=>change({bobbinDescription:e.target.value})}/></label>
   <label className="td-field td-field-wide"><span>变压器描述（自由输入，可留空）</span><textarea data-sheet="transformerDescription" rows={3} maxLength={10000} placeholder="可记录用途、输入输出电压、功率及其他备注" value={s.transformerDescription ?? ''} onChange={e=>change({transformerDescription:e.target.value})}/></label>
  </div></section>
  <section className="td-section"><div className="td-section-heading"><h3>绕组记录</h3><button type="button" onClick={()=>change({windings:[...s.windings,newSheetWinding(s.windings.length+1)]})}>＋ 绕组</button></div>
   <p className="td-hint">从上到下为绕制顺序；胶带层数指该绕组完成后的包胶层数。</p>
   <div className="td-table-scroll td-sheet-windings-table"><table className="td-sheet-input-table"><thead><tr>{['序号','绕组','起脚 *','止脚 *','线径 mm *','股数','圈数 *','胶带层数','套管','图示分组','操作'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>
    {s.windings.map((w,i)=><tr key={w.id} data-sheet-row={w.id}><td><div className="td-sheet-sequence">{i+1}<button type="button" disabled={!i} aria-label={'上移绕组'+(i+1)} onClick={()=>move(i,-1)}>↑</button><button type="button" disabled={i===s.windings.length-1} aria-label={'下移绕组'+(i+1)} onClick={()=>move(i,1)}>↓</button></div></td>
     {(['label','start','end','diameter'] as const).map(k=><td key={k}><input data-winding-field={k} aria-label={'绕组'+(i+1)+' '+k} value={w[k]} onChange={e=>winding(w.id,{[k]:e.target.value})}/></td>)}
     <td><select data-winding-field="strands" aria-label={'绕组'+(i+1)+' 股数'} value={w.strands} onChange={e=>winding(w.id,{strands:e.target.value})}>{[...new Set(['',...Array.from({length:32},(_,j)=>String(j+1)),'40','48','64','100',w.strands])].map(v=><option key={v} value={v}>{v?strandLabel({...w,strands:v}):'未注明'}</option>)}</select></td>
     <td><input data-winding-field="turns" aria-label={'绕组'+(i+1)+' 圈数'} value={w.turns} onChange={e=>winding(w.id,{turns:e.target.value})}/></td>
     <td><input data-winding-field="tape" aria-label={'绕组'+(i+1)+' 胶带层数'} value={w.tape} onChange={e=>winding(w.id,{tape:e.target.value})}/></td>
     <td><div className="td-sheet-sleeves">{(['tubeStart','tubeEnd'] as const).map((k,j)=><label key={k}><input aria-label={'绕组'+(i+1)+(j?'止':'起')+'脚套管'} type="checkbox" checked={w[k]} onChange={e=>winding(w.id,{[k]:e.target.checked})}/>{j?'止':'起'}</label>)}</div></td>
     <td><select aria-label={'绕组'+(i+1)+' 图示分组'} value={w.group} onChange={e=>winding(w.id,{group:e.target.value as SheetWinding['group']})}><option value="unknown">未指定</option><option>PRI</option><option>SEC</option></select></td>
     <td><RowMore title={'绕组 '+(i+1)+' · 更多字段'}>{(['wireType','direction','diagramOrder','note'] as const).map((k,j)=><label className="td-field" key={k}><span>{['线型','绕向','图上排列','绕组备注'][j]}</span><input aria-label={'绕组'+(i+1)+' '+k} value={w[k]} onChange={e=>winding(w.id,{[k]:e.target.value})}/></label>)}</RowMore><button type="button" className="td-text-danger" onClick={()=>change({windings:s.windings.filter(v=>v.id!==w.id)})}>删除</button></td>
    </tr>)}</tbody></table></div>
   <p className="td-hint">胶带 0 表示不包胶，留空为未注明。PRI / SEC 由你指定，图上排列不改变绕制顺序。</p>
  </section>
  <section className="td-section"><div className="td-section-heading"><h3>电气性能参数</h3><button type="button" onClick={()=>change({electrical:[...s.electrical,newElectrical()]})}>＋ 参数</button></div>
   <p className="td-hint">可填写跨串联绕组的测量脚对。空表可保存，添加行后填写目标与测试频率。</p>
   <div className="td-table-scroll"><table className="td-sheet-electrical-input"><thead><tr>{['序号','测量起脚','测量止脚','目标电感','单位','测试频率 (kHz)','操作'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{s.electrical.map((e,i)=><tr key={e.id} data-electrical-row={e.id}>
    <td>{i+1}</td>{(['start','end','inductance'] as const).map(k=><td key={k}><input aria-label={'电感'+(i+1)+' '+k} data-electrical-field={k} value={e[k]} onChange={v=>electrical(e.id,{[k]:v.target.value})}/></td>)}
    <td><select aria-label={'电感'+(i+1)+' 单位'} value={e.unit} onChange={v=>electrical(e.id,{unit:v.target.value})}>{[...new Set([...Object.keys(INDUCTANCE_UNITS),e.unit])].map(v=><option key={v} value={v}>{INDUCTANCE_UNITS[v]||v||'未注明'}</option>)}</select></td>
    <td><input aria-label={'电感'+(i+1)+' 测试频率'} data-electrical-field="frequency" value={e.frequency} onChange={v=>electrical(e.id,{frequency:v.target.value})}/></td>
    <td><RowMore title={'电感目标 '+(i+1)+' · 备注'}><label className="td-field"><span>测试条件 / 备注（可留空）</span><textarea aria-label={'电感'+(i+1)+' 备注'} value={e.note} placeholder="按实际填写公差、电压、温度、仪器及其他绕组状态" onChange={v=>electrical(e.id,{note:v.target.value})}/></label></RowMore><button type="button" className="td-text-danger" onClick={()=>change({electrical:s.electrical.filter(v=>v.id!==e.id)})}>删除</button></td>
   </tr>)}</tbody></table></div>
   {!s.electrical.length&&<p className="td-empty">尚未添加电感目标。</p>}
  </section>
  <section className="td-section"><label className="td-field"><span>备注信息（可留空，打印在制作单底部）</span><textarea data-sheet="notes" rows={3} value={d.notes||''} onChange={e=>onChange({notes:e.target.value||null})}/></label></section>
 </div>;
}
export function SheetPreview({document:d}:{document:TransformerDesignDocument}) {
 const s=d.productionSheet!;
 const connection=useMemo(()=>diagram(s),[s]);const build=useMemo(()=>construction(s),[s]);
 return <article className="td-sheet-paper" data-production-preview>
  <h2>{d.title.trim()||'未命名制作单'}</h2><div className="td-sheet-meta">磁芯型号：<strong>{s.core||'未填'}</strong>{s.material&&<> 磁芯材质：{s.material}</>}</div>
  {s.bobbinDescription?.trim()&&<div className="td-sheet-meta td-sheet-bobbin">骨架描述：{s.bobbinDescription}</div>}
  {s.transformerDescription?.trim()&&<div className="td-sheet-meta td-sheet-description">变压器描述：{s.transformerDescription}</div>}
  {d.exampleFlag&&<p className="td-sheet-warning"><strong>仅示例 / 未审核 / 不可用于生产。</strong> 参数与分组仅供演示。</p>}
  <h3>绕组表（按绕制顺序）</h3><table className="td-sheet-table"><colgroup>{[6,7,11,24,7,7,8,30].map((v,i)=><col key={i} style={{width:v+'%'}}/>)}</colgroup><thead><tr>{['序号','绕组','起止脚','线径 / 股数','圈数','胶带','套管','分组 / 备注'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{s.windings.map((w,i)=><tr key={w.id}><td>{i+1}</td><td>{w.label||'绕组'}</td><td>{w.start||'未填'} → {w.end||'未填'}</td><td className="td-sheet-wire">{wireLabel(w)}</td><td>{w.turns||'未填'}</td><td>{w.tape||'—'}</td><td>{sleeveLabel(w)}</td><td>{[w.group==='unknown'?'未指定':w.group,w.wireType,w.direction,w.note].filter(Boolean).join('；')}</td></tr>)}</tbody></table>
  <p className="td-sheet-caption">胶带单位为层，0=不包胶，—=未注明；套管“起 / 止 / 起止”表示对应引出端，—=未勾选。</p>
  {!!s.electrical.length&&<><h3>电气性能目标</h3><table className="td-sheet-table td-sheet-electrical"><colgroup>{[19,23,22,36].map((v,i)=><col key={i} style={{width:v+'%'}}/>)}</colgroup><thead><tr>{['测量脚对','目标电感','测试频率','测试条件 / 备注'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{s.electrical.map(e=><tr key={e.id}><td>{e.start||'?'} → {e.end||'?'}</td><td>{e.inductance||'?'} {INDUCTANCE_UNITS[e.unit]||e.unit}</td><td>@{e.frequency||'?'} kHz</td><td>{e.note||'—'}</td></tr>)}</tbody></table></>}
  {s.showDiagram&&connection&&<section className="td-sheet-drawing"><h3>绕组连接示意图</h3><div dangerouslySetInnerHTML={{__html:connection}}/><p className="td-sheet-caption">共脚抽头连续排列；图上排列与绕制顺序分开。黑点表示起绕点，不作为电气同名端证明；矩形表示套管。</p></section>}
  {build&&<section className="td-sheet-drawing"><h3>绕制方式 COIL CONSTRUCTION</h3><div dangerouslySetInnerHTML={{__html:build}}/><p className="td-sheet-caption">从 BOBBIN 向上按表格顺序由内到外；等高非比例工艺示意，不表示真实厚度。</p></section>}
  {d.source?.warnings.length? <section className="td-sheet-preserved"><h3>历史导入说明</h3>{d.source.warnings.map((v,i)=><p key={i}>{v}</p>)}</section>:null}
  {d.coreSnapshot?.conflictNotes.length?<section className="td-sheet-preserved"><h3>保留的磁芯来源说明</h3>{d.coreSnapshot.conflictNotes.map((v,i)=><p key={i}>{v}</p>)}</section>:null}
  {d.notes?.trim()&&<section><h3>备注信息</h3><p className="td-sheet-notes">{d.notes}</p></section>}
  <footer>按录入参数制作；本单不计算或推断参数。</footer>
 </article>;
}
