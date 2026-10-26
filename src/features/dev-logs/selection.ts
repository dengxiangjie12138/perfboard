import type { LogSelection, LogSnapshot } from './contracts';
export interface LogRouteSelection { projectId?: string; pageId?: string }
export interface ResolvedLogSelection { projectId: string | null; pageId: string | null }
/** Resolve IDs against this warehouse; a missing saved object never opens another page. */
export function resolveLogSelection(snapshot: LogSnapshot, saved: LogSelection | null, route: LogRouteSelection = {}): ResolvedLogSelection {
 const projects = snapshot.projects.filter(project => !project.deletedAt);
 const project = (id: string | null | undefined) => projects.find(value => value.id === id);
 const page = (id: string | null | undefined) => snapshot.pages.find(value => value.id === id && !value.deletedAt && project(value.projectId));
 if (route.pageId) {
  const explicit = page(route.pageId);
  return explicit ? { projectId: explicit.projectId, pageId: explicit.id } : { projectId: project(route.projectId)?.id ?? null, pageId: null };
 }
 if (route.projectId) return { projectId: project(route.projectId)?.id ?? null, pageId: null };
 if (saved?.hasSavedSelection) {
  const container = project(saved.projectId);
  const item = page(saved.pageId);
  return { projectId: container?.id ?? null, pageId: container && item?.projectId === container.id ? item.id : null };
 }
 const first = [...projects].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0];
 return { projectId: first?.id ?? null, pageId: null };
}
