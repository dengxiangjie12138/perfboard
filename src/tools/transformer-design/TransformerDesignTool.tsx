import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import type {CoreSelectionApi,DesignSummary,ImportPreview,PdfExportOptions,TransformerDesignApi,TransformerDesignDocument,TransformerDesignRecord} from './types';
import {copyDocument} from './model';
import {createSheetDesign,createSheetExample,forSheetEditing} from './sheet';
import {SheetEditor,SheetPreview} from './sheetView';
import {exportTransformerDesignPdf} from './pdf';
import {TransformerSaveSession} from './saveSession';
import {SaveCancelledError,type FlushContext} from '../../services/saveRegistry';
import {readViewMemory,writeViewMemory} from '../../services/viewMemory';
import {restoreDesignView,type DesignViewMemory} from './viewMemory';
import './transformer-design.css';
export interface TransformerDesignToolProps {
 selectedId?:string;memoryScope?:string;api?:TransformerDesignApi;coreApi?:CoreSelectionApi;pdfOptions?:PdfExportOptions;
 registerFlush?:(flush:(context?:FlushContext)=>Promise<void>)=>(()=>void);
}
function message(e:unknown):string {return e instanceof Error?e.message:typeof e==='string'?e:JSON.stringify(e);}
function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} className="td-native-dialog" onCancel={e=>{e.preventDefault();onClose();}}><h3>{title}</h3>{children}</dialog>;
}
function summary(item:DesignSummary|TransformerDesignRecord):DesignSummary {
 return 'document'in item?{id:item.id,revision:item.revision,updatedAt:item.updatedAt,...item.document}:item;
}
export function TransformerDesignTool({selectedId,memoryScope,api,pdfOptions={},registerFlush}:TransformerDesignToolProps) {
 const [items,setItems]=useState<DesignSummary[]>([]),[record,setRecord]=useState<TransformerDesignRecord|null>(null);
 const [draft,setDraft]=useState<TransformerDesignDocument>(createSheetDesign),[active,setActive]=useState(false),[dirty,setDirty]=useState(false);
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [pending,setPending]=useState<null|{action:()=>void;cancel?:()=>void;discardDraft:boolean}>(null);
 const [preview,setPreview]=useState<ImportPreview|null>(null),[candidateId,setCandidateId]=useState('');
 const [history,setHistory]=useState<TransformerDesignRecord[]|null>(null);
 const [session]=useState(()=>new TransformerSaveSession());
 const draftRef=useRef(draft),recordRef=useRef(record),dirtyRef=useRef(dirty),busyRef=useRef(''),pendingRef=useRef(pending);
 const previewPanel=useRef<HTMLDivElement>(null);
 const baseline=useRef(copyDocument(draft));
 const memoryReady=useRef(false),activeRef=useRef(false);
 const remember=()=>{
  if(!memoryScope||!memoryReady.current)return;
  const value:DesignViewMemory=activeRef.current?{active:true,dirty:dirtyRef.current,document:draftRef.current,baseline:baseline.current,record:recordRef.current}:{active:false,dirty:false,document:null,baseline:null,record:null};
  if(!writeViewMemory('transformer-design',value,memoryScope))setError('编辑现场未能记住，请保存仓库记录后再退出。');
 };
 const mounted=useRef(true),request=useRef(0),flushRef=useRef<(context?:FlushContext)=>Promise<void>>(async()=>{});
 draftRef.current=draft;recordRef.current=record;dirtyRef.current=dirty;pendingRef.current=pending;
 const operation=(label:string)=>{busyRef.current=label;setBusy(label);};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;pendingRef.current?.cancel?.();};},[]);
 useEffect(()=>registerFlush?.(context=>flushRef.current(context)),[registerFlush]);
 const refresh=useCallback(async()=>{if(api){const result=await api.list();if(mounted.current)setItems(result.map(summary));}},[api]);
 useEffect(()=>{void refresh().catch(e=>setError(message(e)));},[refresh]);
 const run=async(label:string,action:()=>Promise<void>)=>{
  if(busyRef.current){setError('当前操作尚未完成，请稍后重试。');return;}
  operation(label);setError('');setNotice('');
  try{await action();}catch(e){const text=message(e);setError(/conflict|revision|modified|冲突/i.test(text)?'保存冲突：此记录已被修改。当前编辑仍保留，请核对其他窗口的记录后重新载入。'+text:text);}
  finally{if(mounted.current)operation('');}
 };
 const install=(d:TransformerDesignDocument,r:TransformerDesignRecord|null,edited:boolean)=>{
  request.current++;session.beginDocument();const next=forSheetEditing(d);
  baseline.current=copyDocument(next);draftRef.current=next;recordRef.current=r;dirtyRef.current=edited;activeRef.current=true;setDraft(next);setRecord(r);setDirty(edited);setActive(true);setNotice(r?'已载入仓库记录。':'尚未保存到仓库。');setError('');remember();
 };
 const openRecord=useCallback(async(id:string)=>{
  if(!api)return;const token=++request.current;operation('载入制作单');
  try{const r=await api.get(id);if(mounted.current&&token===request.current)install(r.document,r,false);}
  catch(e){setError(message(e));}finally{if(mounted.current)operation('');}
 },[api]);
 const navigate=(action:()=>void)=>{
  if(busyRef.current||pendingRef.current)return;
  if(dirtyRef.current){const p={action,discardDraft:true};pendingRef.current=p;setPending(p);}else action();
 };
 useEffect(()=>{if(busyRef.current||pendingRef.current)return;if(selectedId){if(dirtyRef.current){const p={action:()=>{void openRecord(selectedId);},discardDraft:true};pendingRef.current=p;setPending(p);}else void openRecord(selectedId);}},[selectedId,openRecord]);
 useEffect(()=>{
  if(!api||memoryReady.current)return;memoryReady.current=true;
  if(selectedId||!memoryScope)return;
  const saved=readViewMemory<DesignViewMemory|null>('transformer-design',null,memoryScope,restoreDesignView);
  if(!saved?.active)return;
  if(!saved.dirty&&saved.record){void openRecord(saved.record.id);return;}
  if(saved.document){install(saved.document,saved.record,saved.dirty);baseline.current=copyDocument(saved.baseline!);remember();setNotice(saved.dirty?'已恢复本窗口未保存的编辑现场，尚未写入仓库。':'已恢复上次编辑位置。');}
 },[api,memoryScope,selectedId,openRecord]);
 const update=(patch:Partial<TransformerDesignDocument>)=>{
  session.markEdited();draftRef.current={...draftRef.current,...patch};dirtyRef.current=true;setDraft(draftRef.current);setDirty(true);setNotice('');setError('');
  remember();
 };
 const persist=async()=>{
  if(!api)throw new Error('数据库接口尚未连接。');
  operation('保存制作单');
  try{
   const result=await session.save(api,{id:recordRef.current?.id??null,expectedRevision:recordRef.current?.revision??null,document:draftRef.current});
   if(result.isCurrentDocument){recordRef.current=result.record;setRecord(result.record);if(result.unchanged){draftRef.current=forSheetEditing(result.record.document);baseline.current=copyDocument(draftRef.current);dirtyRef.current=false;setDraft(draftRef.current);setDirty(false);}}
   remember();await refresh();setNotice(result.unchanged?'已保存到仓库。':'先前快照已保存，新增编辑仍待保存。');return result.unchanged;
  }finally{operation('');}
 };
 flushRef.current=async(context)=>{
  if(busyRef.current||session.isSaving)throw new Error('变压器制作单正在处理操作，请等待完成。');
  if(!dirtyRef.current)return;
  if(!context||context==='flush'){if(!await persist())throw new Error('保存期间出现新编辑。');return;}
  if(pendingRef.current)throw new Error('请先处理制作单的离开选择。');
  await new Promise<void>((resolve,reject)=>{const p={action:resolve,cancel:()=>reject(new SaveCancelledError()),discardDraft:context==='navigate'};pendingRef.current=p;setPending(p);});
 };
 const cancel=()=>{if(busyRef.current)return;const p=pendingRef.current;pendingRef.current=null;setPending(null);p?.cancel?.();setError('');};
 const leave=async(save:boolean)=>{
  const p=pendingRef.current;if(!p||busyRef.current)return;
  if(save){try{if(!await persist())throw new Error('新增编辑仍待保存，请继续编辑。');}catch(e){setError(message(e));return;}}
  if(pendingRef.current!==p)return;
  if(!save){draftRef.current=copyDocument(baseline.current);setDraft(draftRef.current);dirtyRef.current=false;setDirty(false);if(!recordRef.current){activeRef.current=false;setActive(false);}remember();}
  pendingRef.current=null;setPending(null);setError('');p.action();
 };
 const importDesign=()=>navigate(()=>void run('预览导入',async()=>{if(!api)throw new Error('原生接口尚未连接。');const p=await api.previewImport();if(p){setPreview(p);setCandidateId('');}}));
 const confirmImport=()=>void run('导入所选记录',async()=>{if(!api||!preview||!candidateId)return;const r=await api.confirmImport({token:preview.token,candidateId,confirmed:true});setPreview(null);install(r.document,r,false);await refresh();});
 const preserved=draft.windingSteps.length||draft.tests.length||draft.images.length||draft.source;
 return <div className="transformer-design-tool td-production-tool">
  <header className="td-topbar"><div><h2>变压器制作单</h2><p>填入已计算好的参数，整理绕制要求，导出交给厂家。</p></div><button type="button" disabled={!!busy} onClick={()=>navigate(()=>install(createSheetExample(),null,true))}>查看虚构示例</button></header>
  <div className="td-sheet-toolbar"><label>仓库记录 <select aria-label="选择已保存制作单" value={record?.id||''} disabled={!!busy} onChange={e=>{const id=e.target.value;if(id)navigate(()=>void openRecord(id));}}><option value="">选择已保存记录</option>{items.map(i=><option key={i.id} value={i.id}>{i.title||'未命名制作单'}{i.exampleFlag?' · 示例':''}</option>)}</select></label>
   <button type="button" disabled={!!busy} onClick={()=>navigate(()=>install(createSheetDesign(),null,true))}>新建</button>
   <button type="button" className="td-primary" disabled={!!busy||!active||!api} onClick={()=>void run('保存',async()=>{await persist();})}>保存记录</button>
   <span>{dirty?'未保存修改':record?'已保存':active?'未保存草稿':'未开始编辑'}</span>
   <button type="button" disabled={!!busy||!api} onClick={importDesign}>导入 JSON / Excel</button>
   {active&&<><button type="button" disabled={!!busy} onClick={()=>navigate(()=>{setActive(false);activeRef.current=false;dirtyRef.current=false;setDirty(false);remember();})}>结束编辑</button>
    <button type="button" disabled={!!busy||!pdfOptions.onSave} onClick={()=>void run('生成中文 PDF',async()=>{if(await exportTransformerDesignPdf(copyDocument(draftRef.current),pdfOptions))setNotice('中文 PDF 已保存。');})}>导出 PDF</button>
    <button type="button" disabled={!!busy} onClick={()=>previewPanel.current?.scrollIntoView({behavior:'smooth',block:'start'})}>预览</button></>}
  </div>
  {error&&<div className="td-banner td-error" role="alert">{error}</div>}{notice&&<div className="td-banner td-success" role="status">{notice}</div>}{busy&&<p role="status">{busy}…</p>}
  {!api&&<div className="td-banner td-warning">仓库接口尚未连接。可查看示例，保存需要打开仓库。</div>}
  {!active?<div className="td-welcome"><h3>制作单保存在当前仓库</h3><button type="button" onClick={()=>install(createSheetDesign(),null,true)}>新建制作单</button></div>:
   <div className="td-sheet-workspace"><fieldset disabled={!!busy} className="td-editor-fieldset"><SheetEditor document={draft} onChange={update}/>
    {!!preserved&&<details className="td-section"><summary>保留的旧记录与来源</summary><p className="td-hint">原工序、测试、附图和来源完整保留。复杂线材与未知工艺不会自动换成制作单参数。</p>
     {draft.source?.warnings.map((v,i)=><p className="td-warning" key={i}>{v}</p>)}
     <pre className="td-json-preview">{JSON.stringify({...draft,productionSheet:undefined},null,2)}</pre>
     <button type="button" onClick={()=>void run('生成完整旧记录 PDF',async()=>{await exportTransformerDesignPdf({...copyDocument(draftRef.current),productionSheet:undefined},pdfOptions);})}>导出完整旧记录 PDF</button>
    </details>}
    {record&&api?.history&&<button type="button" onClick={()=>void run('读取历史',async()=>setHistory(await api.history!(record.id)))}>历史快照</button>}
   </fieldset>
   <div ref={previewPanel} className="td-sheet-preview-panel" aria-label="制作单预览"><div className="td-section-heading"><h3>制作单预览</h3><label><input type="checkbox" disabled={!!busy} checked={draft.productionSheet!.showDiagram} onChange={e=>update({productionSheet:{...draft.productionSheet!,showDiagram:e.target.checked}})}/> 包含连接示意图</label></div><SheetPreview document={draft}/></div>
   </div>}
  {pending&&<Dialog title="当前有未保存修改" onClose={cancel}><p>保存并离开会检查必填项目；放弃修改只舍弃本次草稿，不会删除已保存记录。</p>{error&&<p className="td-error" role="alert">{error}</p>}<div className="td-actions"><button type="button" disabled={!!busy} onClick={cancel}>继续编辑</button><button type="button" disabled={!!busy} onClick={()=>void leave(false)}>放弃修改并离开</button><button type="button" disabled={!!busy||!api} onClick={()=>void leave(true)}>保存并离开</button></div></Dialog>}
  {preview&&<Dialog title="导入预览 · 只确认所选方案" onClose={()=>setPreview(null)}><p>{preview.fileName}</p>{preview.warnings.map((v,i)=><p key={i} className="td-warning">{v}</p>)}<select aria-label="选择导入方案" value={candidateId} onChange={e=>setCandidateId(e.target.value)}><option value="">请选择</option>{preview.candidates.map(c=><option key={c.candidateId} value={c.candidateId}>{c.title}</option>)}</select>{candidateId&&<pre className="td-json-preview">{JSON.stringify(preview.candidates.find(c=>c.candidateId===candidateId),null,2)}</pre>}<div className="td-actions"><button type="button" disabled={!!busy} onClick={()=>setPreview(null)}>取消</button><button type="button" disabled={!!busy||!candidateId} onClick={confirmImport}>确认导入所选方案</button></div></Dialog>}
  {history&&<Dialog title="历史快照（只读）" onClose={()=>setHistory(null)}>{history.map(r=><details key={r.revision}><summary>修订 {r.revision} · {r.updatedAt}</summary><pre className="td-json-preview">{JSON.stringify(r.document,null,2)}</pre><button type="button" onClick={()=>{setHistory(null);navigate(()=>install({...copyDocument(r.document),designNo:createSheetDesign().designNo,status:'draft'},null,true));}}>复制为新记录</button></details>)}</Dialog>}
 </div>;
}
export default TransformerDesignTool;
