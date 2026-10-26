import type { LogSnapshot } from './contracts';
export type LogTreeKind = 'project' | 'folder' | 'page';
export interface LogDragItem { kind: LogTreeKind; id: string; projectId?: string }
export interface LogTreeEntry { kind: 'folder' | 'page'; id: string; position: number }
export interface LogDropLocation { projectId: string; folderId: string | null; before: { kind: 'folder' | 'page'; id: string } | null }
export function pageFolder(snapshot: LogSnapshot, pageId: string): string | null {
 return snapshot.folders?.find(folder => folder.pageIds.includes(pageId))?.id ?? null;
}
export function logTreeEntries(snapshot: LogSnapshot, projectId: string, folderId: string | null = null): LogTreeEntry[] {
 const items: LogTreeEntry[] = snapshot.pages.filter(page => page.projectId === projectId && !page.deletedAt && pageFolder(snapshot, page.id) === folderId).map(page => ({ kind: 'page', id: page.id, position: page.position }));
 if (!folderId) items.push(...(snapshot.folders ?? []).filter(folder => folder.projectId === projectId).map(folder => ({ kind: 'folder' as const, id: folder.id, position: folder.position })));
 return items.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}
/** Project row = root end; folder row = enter (pages) / before (folders); page = before. */
export function logDropLocation(snapshot: LogSnapshot, source: LogDragItem, target: LogDragItem): LogDropLocation | null {
 if (source.kind === 'project' || source.id === target.id) return null;
 const projectId = target.kind === 'project' ? target.id : target.projectId;
 if (!projectId || source.projectId !== projectId) return null;
 if (target.kind === 'project') return { projectId, folderId: null, before: null };
 if (target.kind === 'folder') return source.kind === 'page'
  ? { projectId, folderId: target.id, before: null }
  : { projectId, folderId: null, before: { kind: 'folder', id: target.id } };
 const folderId = pageFolder(snapshot, target.id);
 if (source.kind === 'folder' && folderId) return null;
 return { projectId, folderId, before: { kind: 'page', id: target.id } };
}
