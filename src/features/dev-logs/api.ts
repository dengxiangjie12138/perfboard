import { invoke } from '@tauri-apps/api/core';
import { parseStoredDocument } from './document';
import type { LogSnapshot, LogProject, LogFolder, LogPage, LogPageSave, LogHistory, RevisionItem, LogTrashSnapshot, LogTrashPurge, LogTrashDeleteResult, LogSelection, LogSelectionSave } from './contracts';
import type { LogDropLocation } from './tree';
export const logApi = {
 createFolder: (projectId: string) => invoke<LogFolder>('dev_log_folder_create', { projectId }),
 renameFolder: (input: RevisionItem & { title: string }) => invoke<LogFolder>('dev_log_folder_rename', { input }),
 deleteFolder: (input: RevisionItem) => invoke<void>('dev_log_folder_delete', { input }),
 moveTreeItem: (input: Omit<LogDropLocation, 'before'> & RevisionItem & { kind: 'page' | 'folder'; before: (RevisionItem & { kind: 'page' | 'folder' }) | null }) => invoke<void>('dev_log_tree_move', { input }),
 snapshot: () => invoke<LogSnapshot>('dev_logs_snapshot'),
 trashSnapshot: () => invoke<LogTrashSnapshot>('dev_log_trash_snapshot'),
 purgeProject: (input: LogTrashPurge) => invoke<LogTrashDeleteResult>('dev_log_project_purge', { input }),
 purgePage: (input: LogTrashPurge) => invoke<LogTrashDeleteResult>('dev_log_page_purge', { input }),
 clearTrash: (snapshotToken: string) => invoke<LogTrashDeleteResult>('dev_log_trash_clear', { input: { snapshotToken } }),
 selection: () => invoke<LogSelection>('dev_log_selection_get'),
 saveSelection: (input: LogSelectionSave) => invoke<LogSelection>('dev_log_selection_save', { input }),
 getPage: (id: string) => invoke<LogPage>('dev_log_page_get', { id }),
 createProject: (title: string) => invoke<LogProject>('dev_log_project_create', { title }),
 renameProject: (input: RevisionItem & { title: string }) => invoke<LogProject>('dev_log_project_rename', { input }),
 deleteProject: (input: RevisionItem) => invoke<LogProject>('dev_log_project_delete', { input }),
 restoreProject: (input: RevisionItem) => invoke<LogProject>('dev_log_project_restore', { input }),
 reorderProjects: (items: RevisionItem[]) => invoke<LogProject[]>('dev_log_projects_reorder', { items }),
 createPage: (projectId: string, title: string) => invoke<LogPage>('dev_log_page_create', { projectId, title }),
 savePage: (input: LogPageSave) => invoke<LogPage>('dev_log_page_save', { input: { ...input, documentJson: JSON.stringify(parseStoredDocument(input.documentJson, input.schemaVersion)) } }),
 deletePage: (input: RevisionItem) => invoke<LogPage>('dev_log_page_delete', { input }),
 restorePage: (input: RevisionItem) => invoke<LogPage>('dev_log_page_restore', { input }),
 reorderPages: (projectId: string, items: RevisionItem[]) => invoke<LogPage[]>('dev_log_pages_reorder', { projectId, items }),
 history: (id: string) => invoke<LogHistory[]>('dev_log_page_history', { id }),
 restoreHistory: (input: RevisionItem & { historyRevision: number }) => invoke<LogPage>('dev_log_page_restore_history', { input }),
};
