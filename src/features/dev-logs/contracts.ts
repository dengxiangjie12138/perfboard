export interface LogProject { id: string; title: string; position: number; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null }
export interface LogPage { id: string; projectId: string; title: string; documentJson: string; schemaVersion: number; position: number; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null }
export interface LogFolder { id: string; projectId: string; title: string; position: number; revision: number; pageIds: string[] }
export interface LogSnapshot { projects: LogProject[]; pages: LogPage[]; folders?: LogFolder[] }
export interface LogHistory { pageId: string; revision: number; title: string; documentJson: string; schemaVersion: number; savedAt: string }
export interface RevisionItem { id: string; expectedRevision: number }
export interface LogPageSave extends RevisionItem { title: string; documentJson: string; schemaVersion: number }
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'readonly';
export const DOCUMENT_SCHEMA_VERSION = 1;
export const EMPTY_DOCUMENT = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
export interface LogTrashSnapshot { projects: LogProject[]; pages: LogPage[]; snapshotToken: string }
export interface LogTrashPurge extends RevisionItem { snapshotToken: string }
export interface LogTrashDeleteResult { deletedProjects: number; deletedPages: number; deletedHistory: number }
export interface LogSelection { repositoryKey: string; projectId: string | null; pageId: string | null; hasSavedSelection: boolean }
export interface LogSelectionSave { repositoryKey: string; projectId: string | null; pageId: string | null }
