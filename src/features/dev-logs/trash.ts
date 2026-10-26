import type { LogTrashPurge, LogTrashSnapshot } from './contracts';
export type TrashDeleteKind = 'project' | 'page' | 'all';
export interface TrashConfirmation {
 readonly kind: TrashDeleteKind;
 readonly snapshotToken: string;
 readonly input: Readonly<LogTrashPurge> | null;
 readonly projectCount: number;
 readonly pageCount: number;
 readonly titles: readonly string[];
}
/** Copy the visible confirmation scope. Later refreshes cannot broaden it. */
export function describeTrashConfirmation(snapshot: LogTrashSnapshot, kind: TrashDeleteKind, id?: string): TrashConfirmation | null {
 const projects = kind === 'all' ? snapshot.projects : kind === 'project' ? snapshot.projects.filter(value => value.id === id) : [];
 const pages = kind === 'all' ? snapshot.pages : kind === 'project' ? snapshot.pages.filter(value => value.projectId === id) : snapshot.pages.filter(value => value.id === id);
 const target = kind === 'project' ? projects[0] : kind === 'page' ? pages[0] : null;
 if ((kind !== 'all' && !target) || (!projects.length && !pages.length)) return null;
 const input = target ? Object.freeze({ id: target.id, expectedRevision: target.revision, snapshotToken: snapshot.snapshotToken }) : null;
 return Object.freeze({ kind, snapshotToken: snapshot.snapshotToken, input, projectCount: projects.length, pageCount: pages.length,
  titles: Object.freeze([...projects.map(value => `项目：${value.title}`), ...pages.map(value => `页面：${value.title}`)]) });
}
