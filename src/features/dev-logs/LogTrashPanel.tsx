import { FileText, Folder, RotateCcw, Trash2 } from 'lucide-react';
import type { LogPage, LogProject, LogSnapshot, LogTrashSnapshot } from './contracts';
import type { TrashDeleteKind } from './trash';
interface Props {
 snapshot: LogSnapshot;
 trash: LogTrashSnapshot | null;
 busy: boolean;
 onRestore: (kind: 'project' | 'page', value: LogProject | LogPage) => void;
 onDelete: (kind: TrashDeleteKind, id?: string) => void;
}
export function LogTrashPanel({ snapshot, trash, busy, onRestore, onDelete }: Props) {
 const projects = trash?.projects ?? [];
 const pages = trash?.pages ?? [];
 const standalone = pages.filter(page => !projects.some(project => project.id === page.projectId));
 return <div className="log-trash-panel">
  <div className="log-trash-controls"><span>{projects.length} 个项目 · {pages.length} 个页面</span><button type="button" className="danger" aria-label="清空日志回收站" disabled={busy || !trash || (!projects.length && !pages.length)} onClick={() => onDelete('all')}><Trash2 size={13}/>清空回收站</button></div>
  <p className="log-trash-hint">恢复项目会同时恢复随项目删除的页面。永久删除会移除相关页面及版本历史。</p>
  {projects.map(project => <div className="log-trash-item" key={project.id} data-trash-kind="project" data-trash-id={project.id}><Folder size={15}/><div><strong>{project.title}</strong><small>项目 · {pages.filter(page => page.projectId === project.id).length} 页</small></div><button type="button" title={`恢复项目 ${project.title}`} aria-label={`恢复项目 ${project.title}`} disabled={busy} onClick={() => onRestore('project', project)}><RotateCcw size={15}/></button><button type="button" className="danger" title={`永久删除项目 ${project.title}`} aria-label={`永久删除项目 ${project.title}`} disabled={busy} onClick={() => onDelete('project', project.id)}><Trash2 size={15}/></button></div>)}
  {standalone.map(page => <div className="log-trash-item" key={page.id} data-trash-kind="page" data-trash-id={page.id}><FileText size={15}/><div><strong>{page.title}</strong><small>{snapshot.projects.find(project => project.id === page.projectId)?.title}</small></div><button type="button" title={`恢复页面 ${page.title}`} aria-label={`恢复页面 ${page.title}`} disabled={busy} onClick={() => onRestore('page', page)}><RotateCcw size={15}/></button><button type="button" className="danger" title={`永久删除页面 ${page.title}`} aria-label={`永久删除页面 ${page.title}`} disabled={busy} onClick={() => onDelete('page', page.id)}><Trash2 size={15}/></button></div>)}
  {!trash ? <div className="log-tree-empty">正在读取回收站…</div> : !projects.length && !pages.length && <div className="log-tree-empty">回收站为空</div>}
 </div>;
}
