import type { NoteCategory } from '../types';
export interface ToolWindowDefinition { id: string; title: string; width: number; height: number; minWidth: number; minHeight: number }
export type WindowRoute =
  | { kind: 'tool'; toolId: string; externalToolId?: string }
  | { kind: 'parts'; partId?: string }
  | { kind: 'notes'; category?: NoteCategory; noteId?: string }
  | { kind: 'dev-logs'; projectId?: string; pageId?: string };
export interface WindowContext extends ToolWindowDefinition { label: string; instanceId: number; route: WindowRoute }
export type ToolWindowContext = WindowContext;
export type CloseAction = 'hide' | 'quit' | 'close-tool' | 'flush';
export interface CloseRequest { action: CloseAction; requestId: number }
