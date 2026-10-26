import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlobalSearch } from './GlobalSearch';
import { PartsPage } from '../features/parts/PartsPage';
import { searchPages } from './pages';
import type { Part, Snapshot } from '../types';

const fixture = vi.hoisted(() => ({ data: { parts: [], notes: [], attachments: [], settings: {} } as Snapshot, tools: [] as { id: string; name: string; description: string }[] }));
vi.mock('../state/DataContext', () => ({ useData: () => ({ data: fixture.data, refresh: vi.fn(), notify: vi.fn(), setError: vi.fn() }) }));
vi.mock('../tools/external-tools', () => ({ ExternalToolsPage: () => null, useExternalTools: () => ({ tools: fixture.tools }) }));
const row = (id: string, name = '100KΩ', packageName = '0603'): Part => ({ id, name, category: '电阻', packageName, parameters: '', stockStatus: 'unknown', quantity: null, location: '电阻盒', brief: '', url: '', createdAt: '', updatedAt: '' });
afterEach(() => { fixture.data = { parts: [], notes: [], attachments: [], settings: {} }; fixture.tools = []; });
const global = (query: string) => renderToStaticMarkup(<GlobalSearch data={fixture.data} query={query} onQuery={() => {}} disabled={false} onNavigate={() => {}} />);
const inventory = (query: string) => renderToStaticMarkup(<PartsPage initialQuery={query} />);

it.each(['100k 0603', '0603 100K', 'dianzu 0603 100k', '0603 DZH 100K'])('both entrances enforce the same cross-field AND and pinyin rule: %s', query => {
  fixture.data.parts = [row('right'), row('wrong-value', '100Ω'), row('wrong-package', '100KΩ', '0805')];
  expect(global(query)).toContain('100KΩ');
  expect(global(query)).not.toContain('100Ω');
  const html = inventory(query);
  expect(html).toContain('data-part-id="right"');
  expect(html).not.toContain('data-part-id="wrong-value"');
  expect(html).not.toContain('data-part-id="wrong-package"');
});
it('global covers tools, external applications, materials and notes while inventory stays materials-only', () => {
  fixture.data.parts = [row('right')];
  fixture.data.notes = [{ id: 'note', title: '电阻笔记', category: '学习笔记', searchText: '', createdAt: '', updatedAt: '' }];
  fixture.tools = [{ id: 'external', name: '电阻助手', description: '库存查看' }];
  const html = global('DIANZU');
  expect(html).toContain('电阻笔记');
  expect(html).toContain('电阻助手');
  expect(html).toContain('100KΩ');
  expect(html).toContain('电阻串联计算');
  expect(inventory('DIANZU')).not.toContain('电阻笔记');
  expect(searchPages('CX CSK').map(page => page.page)).toContain('cores');
});
it('both entrances see additions, edits and deletes from the next full snapshot', () => {
  fixture.data.parts = [row('first')];
  expect(global('100k 0603')).toContain('100KΩ');
  expect(inventory('100k 0603')).toContain('data-part-id="first"');
  fixture.data = { ...fixture.data, parts: [row('new', '10KΩ')] };
  expect(global('100k 0603')).toContain('没有匹配结果');
  expect(inventory('100k 0603')).not.toContain('data-part-id=');
  fixture.data = { ...fixture.data, parts: [row('new')] };
  expect(global('100k 0603')).toContain('100KΩ');
  expect(inventory('100k 0603')).toContain('data-part-id="new"');
  fixture.data = { ...fixture.data, parts: [] };
  expect(global('100k 0603')).toContain('没有匹配结果');
  expect(inventory('100k 0603')).not.toContain('data-part-id=');
});
