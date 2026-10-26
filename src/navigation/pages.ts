import type { Page } from '../types';
import { OfflineSearch, type SearchResults } from '../services/search';
import { TOOL_GROUPS, TOOLS } from '../tools/registry';
import { CIRCUITS } from '../tools/opamp/metadata';

export const CORE_LIBRARY_ENTRY = { page: 'cores' as const, title: '磁芯参数库', description: '检索磁芯型号与参考几何参数。', keywords: ['磁芯', 'core', 'ferrite', '型号'] as readonly string[] };

const coreLabels: Partial<Record<Page, string>> = {
  workbench: '工作台', parts: '物料仓库', notes: '笔记', cores: CORE_LIBRARY_ENTRY.title,
  appearance: '软件设置', repository: '仓库与数据', history: '版本与说明', 'dev-logs': '开发日志',
};
const coreKeywords: Partial<Record<Page, string>> = {
  cores: CORE_LIBRARY_ENTRY.keywords.join(' '),
  appearance: '外观 主题 设置 软件 appearance theme settings',
  'dev-logs': '开发日志 开发 运行日志 调试 日志 log logs debug development',
};
export function pageLabel(page: Page): string {
  const core = coreLabels[page];
  if (core) return core;
  const group = TOOL_GROUPS.find(group => group.page === page);
  if (group) return group.title;
  const tool = TOOLS.find(tool => tool.page === page);
  return tool ? TOOL_GROUPS.find(group => group.page === tool.group)!.title + ' / ' + tool.title : page;
}
interface SearchPage { page: Page; label: string; keywords: string; toolItemId?: string }
const pages: SearchPage[] = [
    ...Object.entries(coreLabels).map(([page, label]) => ({ page: page as Page, label: page === 'notes' ? '笔记概览' : label!, keywords: coreKeywords[page as Page] ?? '' })),
    ...TOOL_GROUPS.map(group => ({ page: group.page, label: group.title, keywords: group.description })),
    ...TOOLS.map(tool => ({ page: tool.page, label: pageLabel(tool.page), keywords: [tool.description, ...tool.keywords].join(' ') })),
    ...CIRCUITS.map(circuit => ({ page: 'opamp' as const, toolItemId: circuit.id, label: pageLabel('opamp') + ' / ' + circuit.title, keywords: [circuit.description, ...circuit.keywords].join(' ') })),
  ];
const pageSearch = new OfflineSearch<(typeof pages)[number]>(page => [page.label, page.keywords]);
export function searchPages(query: string): SearchPage[] {
  return pageSearch.search(pages, query);
}
export function searchPageResults(query: string): SearchResults<(typeof pages)[number]> {
  return pageSearch.searchResults(pages, query);
}
