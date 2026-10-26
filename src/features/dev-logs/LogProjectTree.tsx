import { useEffect, useRef, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, FilePlus2, FileText, Folder, FolderPlus, MoreHorizontal } from 'lucide-react';
import { InlineRenameInput } from '../../components/InlineRenameInput';
import type { LogPage, LogProject, LogSnapshot } from './contracts';
import { logTreeEntries, type LogTreeKind, type LogDragItem } from './tree';
export type { LogDragItem } from './tree';
export interface LogRenameTarget { kind: LogTreeKind; id: string; where: 'header' | 'tree' }
interface Props {
 projects: LogProject[]; snapshot: LogSnapshot; current: LogPage | null; selectedProject: string; collapsed: Set<string>; busy: boolean; draggingId: string; dropTarget: string;
 rename: LogRenameTarget | null;
 onToggleProject: (id: string) => void; onOpenPage: (id: string) => void; onCreatePage: (id: string, folderId?: string) => void; onCreateFolder: (id: string) => void;
 onBeginRename: (kind: LogTreeKind, id: string) => void; onCommitRename: (name: string) => Promise<void>; onCancelRename: () => void;
 onContext: (event: { preventDefault: () => void; clientX: number; clientY: number }, kind: LogTreeKind, id: string) => void;
 onDragStart: (event: DragEvent, item: LogDragItem) => void; onDragEnd: () => void;
 onDragOver: (event: DragEvent, item: LogDragItem) => void; onDrop: (event: DragEvent, item: LogDragItem) => void;
}
export function LogProjectTree(props: Props) {
 const { projects, snapshot, current, selectedProject, collapsed, busy, draggingId, dropTarget, rename } = props;
 const firstClick = useRef<{ id: string; wasCollapsed: boolean } | null>(null);
 const cancelClick = () => { firstClick.current = null; };
 useEffect(() => { if (busy || rename) cancelClick(); }, [busy, rename]);
 const editing = (kind: LogTreeKind, id: string) => rename?.where === 'tree' && rename.kind === kind && rename.id === id;
 const rowClick = (event: MouseEvent, id: string) => {
  if (busy || rename || (event.target as HTMLElement).closest('.log-row-action, .inline-rename, .log-project-collapse')) return;
  if (event.detail <= 1) {
   firstClick.current = { id, wasCollapsed: collapsed.has(id) };
   props.onToggleProject(id);
  } else if (event.detail === 2) {
   // Respond to the first click immediately; a double-click restores its original
   // expansion state before opening rename, without delaying ordinary clicks.
   const first = firstClick.current;
   cancelClick();
   if (first?.id === id && collapsed.has(id) !== first.wasCollapsed) props.onToggleProject(id);
  }
 };
 const doubleClick = (event: MouseEvent, kind: LogTreeKind, id: string) => {
  event.stopPropagation(); cancelClick();
  if (!busy && !(event.target as HTMLElement).closest('.log-row-action, .inline-rename, .log-project-collapse')) props.onBeginRename(kind, id);
 };
 const start = (event: DragEvent, item: LogDragItem) => { event.stopPropagation(); cancelClick(); props.onDragStart(event, item); };
 const menu = (event: MouseEvent, kind: LogTreeKind, id: string) => { event.stopPropagation(); cancelClick(); props.onContext(event, kind, id); };
 const renderPages = (projectId: string, folderId: string | null = null): ReactNode => logTreeEntries(snapshot, projectId, folderId).map(entry => {
  if (entry.kind === 'folder') {
   const folder = snapshot.folders!.find(value => value.id === entry.id)!;
   const item: LogDragItem = { kind: 'folder', id: folder.id, projectId };
   const closed = collapsed.has(folder.id), naming = editing('folder', folder.id);
   const count = snapshot.pages.filter(page => folder.pageIds.includes(page.id) && !page.deletedAt).length;
   const contents = <><Folder size={14}/>{naming ? <InlineRenameInput key={folder.id} initialValue={folder.title} label="文件夹名称" onCommit={props.onCommitRename} onCancel={props.onCancelRename}/> : <strong>{folder.title}</strong>}<small>{count}</small></>;
   return <div key={folder.id} className={'log-folder' + (draggingId === folder.id ? ' dragging' : '')} role="treeitem" aria-expanded={!closed}>
    <div className={'log-folder-row' + (dropTarget === folder.id ? ' log-row-drop-target' : '')} data-folder-id={folder.id} draggable={!busy && !rename}
     onClick={event => rowClick(event, folder.id)} onDoubleClick={event => doubleClick(event, 'folder', folder.id)} onContextMenu={event => menu(event, 'folder', folder.id)}
     onDragStart={event => start(event, item)} onDragEnd={props.onDragEnd} onDragOver={event => props.onDragOver(event, item)} onDrop={event => props.onDrop(event, item)}>
     <button type="button" className="log-project-collapse" aria-label={(closed ? '展开文件夹 ' : '折叠文件夹 ') + folder.title} disabled={busy || !!rename} onClick={event => { event.stopPropagation(); cancelClick(); props.onToggleProject(folder.id); }}>{closed ? <ChevronRight size={14}/> : <ChevronDown size={14}/>}</button>
     {naming ? <div className="log-project-select">{contents}</div> : <button type="button" className="log-project-select" disabled={busy}>{contents}</button>}
     <button type="button" className="log-row-action" title={'在 ' + folder.title + ' 新建页面'} aria-label={'在文件夹 ' + folder.title + ' 新建页面'} disabled={busy} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); cancelClick(); props.onCreatePage(projectId, folder.id); }}><FilePlus2 size={14}/></button>
     <button type="button" className="log-row-action" title="文件夹操作" aria-label={folder.title + ' 文件夹操作'} disabled={busy} onDoubleClick={event => event.stopPropagation()} onClick={event => menu(event, 'folder', folder.id)}><MoreHorizontal size={14}/></button>
    </div>
    {!closed && <div role="group">{renderPages(projectId, folder.id)}{!count && <div className="log-folder-empty">拖动页面到此文件夹</div>}</div>}
   </div>;
  }
  const page = snapshot.pages.find(value => value.id === entry.id)!;
  const item: LogDragItem = { kind: 'page', id: page.id, projectId };
  const naming = editing('page', page.id), title = current?.id === page.id ? current.title : page.title;
  const contents = <><FileText size={14}/>{naming ? <InlineRenameInput key={page.id} initialValue={title} label="页面名称" onCommit={props.onCommitRename} onCancel={props.onCancelRename}/> : <span>{title}</span>}</>;
  return <div className={'log-page-row' + (current?.id === page.id ? ' active' : '') + (draggingId === page.id ? ' dragging' : '') + (dropTarget === page.id ? ' log-row-drop-target' : '')} role="treeitem" aria-selected={current?.id === page.id} data-page-id={page.id} key={page.id} draggable={!busy && !rename}
   onDoubleClick={event => doubleClick(event, 'page', page.id)} onContextMenu={event => menu(event, 'page', page.id)}
   onClick={event => { if (event.target === event.currentTarget && event.detail <= 1) props.onOpenPage(page.id); }}
   onDragStart={event => start(event, item)} onDragEnd={props.onDragEnd} onDragOver={event => props.onDragOver(event, item)} onDrop={event => props.onDrop(event, item)}>
   {naming ? <div className="log-page-select">{contents}</div> : <button type="button" className="log-page-select" disabled={busy} onClick={event => { if (event.detail <= 1) props.onOpenPage(page.id); }}>{contents}</button>}
   <button type="button" className="log-row-action" title="页面操作" aria-label={page.title + ' 页面操作'} disabled={busy} onDoubleClick={event => event.stopPropagation()} onClick={event => menu(event, 'page', page.id)}><MoreHorizontal size={14}/></button>
  </div>;
 });
 return <div role="tree" aria-label="日志项目树">{projects.map(project => {
  const pages = snapshot.pages.filter(page => page.projectId === project.id && !page.deletedAt);
  const closed = collapsed.has(project.id), naming = editing('project', project.id);
  const item: LogDragItem = { kind: 'project', id: project.id };
  const contents = <><Folder size={15}/>{naming ? <InlineRenameInput key={project.id} initialValue={project.title} label="项目名称" onCommit={props.onCommitRename} onCancel={props.onCancelRename}/> : <strong>{project.title}</strong>}<small title="项目内全部页面（含文件夹）">{pages.length}</small></>;
  return <div key={project.id} className={'log-project' + (draggingId === project.id ? ' dragging' : '')} role="treeitem" aria-expanded={!closed} aria-selected={selectedProject === project.id} onContextMenu={event => menu(event, 'project', project.id)}>
   <div className={'log-project-row' + (dropTarget === project.id ? ' log-row-drop-target' : '')} data-project-id={project.id} draggable={!busy && !rename}
    onDoubleClick={event => doubleClick(event, 'project', project.id)} onClick={event => rowClick(event, project.id)}
    onDragStart={event => start(event, item)} onDragEnd={props.onDragEnd} onDragOver={event => props.onDragOver(event, item)} onDrop={event => props.onDrop(event, item)}>
    <button type="button" className="log-project-collapse" aria-label={(closed ? '展开项目 ' : '折叠项目 ') + project.title} disabled={busy || !!rename} onClick={event => { event.stopPropagation(); cancelClick(); props.onToggleProject(project.id); }}>{closed ? <ChevronRight size={14}/> : <ChevronDown size={14}/>}</button>
    {naming ? <div className="log-project-select">{contents}</div> : <button type="button" className="log-project-select" disabled={busy}>{contents}</button>}
    <button type="button" className="log-row-action" title={'在 ' + project.title + ' 新建页面'} aria-label={'在 ' + project.title + ' 新建页面'} disabled={busy} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); cancelClick(); props.onCreatePage(project.id); }}><FilePlus2 size={14}/></button>
    <button type="button" className="log-row-action" title={'在 ' + project.title + ' 新建文件夹'} aria-label={'在 ' + project.title + ' 新建文件夹'} disabled={busy} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); cancelClick(); props.onCreateFolder(project.id); }}><FolderPlus size={14}/></button>
    <button type="button" className="log-row-action" title="项目操作" aria-label={project.title + ' 项目操作'} disabled={busy} onDoubleClick={event => event.stopPropagation()} onClick={event => menu(event, 'project', project.id)}><MoreHorizontal size={14}/></button>
   </div>
   {!closed && <div role="group">{renderPages(project.id)}{!pages.length && !(snapshot.folders ?? []).some(folder => folder.projectId === project.id) && <button type="button" className="log-add-first" disabled={busy} onClick={() => props.onCreatePage(project.id)}><FilePlus2 size={13}/>新建第一页</button>}</div>}
  </div>;
 })}{!projects.length && <div className="log-tree-empty">暂无项目<br/>点击右上角创建项目</div>}</div>;
}
