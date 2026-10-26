import type { NoteCategory, Page } from '../types';

export interface AppRoute { page: Page; category?: NoteCategory; noteId?: string; partId?: string; externalToolId?: string; toolItemId?: string; projectId?: string; logPageId?: string }
export interface NavigationGroups { hardware: boolean; stm32: boolean; utilities: boolean; notes: boolean }
export type Navigate = (route: AppRoute) => void;
export type PageNavigate = (page: Page, noteId?: string, partId?: string, externalToolId?: string, toolItemId?: string) => void;
