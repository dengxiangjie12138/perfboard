import type { AppRoute } from './routes';
import type { NoteCategory, Page } from '../types';
import { TOOLS } from '../tools/registry';
import { memoryObject } from '../services/viewMemory';
const pages = new Set<string>(['workbench','parts','hardware','stm32','notes','appearance','repository','history','utilities','cores','dev-logs', ...TOOLS.map(tool => tool.page)]);
const categories: NoteCategory[] = ['硬件错题本','软件错题本','随笔','学习笔记'];
/** Object IDs are restored by their feature, never replayed as navigation commands. */
export function rememberedRoute(value: unknown): AppRoute | undefined {
  if (!memoryObject(value) || typeof value.page !== 'string' || !pages.has(value.page)) return;
  const page = value.page as Page;
  return page === 'notes' && categories.includes(value.category as NoteCategory) ? { page, category: value.category as NoteCategory } : { page };
}
