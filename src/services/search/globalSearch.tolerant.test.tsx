import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlobalSearch } from '../../navigation/GlobalSearch';
import { searchExternalToolResults } from '../../navigation/externalToolSearch';
import { pageLabel, searchPages } from '../../navigation/pages';
import type { Snapshot } from '../../types';

const fixture = vi.hoisted(() => ({ tools: [] as { id: string; name: string; description: string; path?: string; available?: boolean }[] }));
vi.mock('../../tools/external-tools', () => ({ ExternalToolsPage: () => null, useExternalTools: () => ({ tools: fixture.tools }) }));
const data: Snapshot = { parts: [], notes: [], attachments: [], settings: {} };
afterEach(() => { fixture.tools = []; });

it('labels a protocol typo as a separate approximate suggestion', () => {
  fixture.tools = [{ id: 'missing', name: 'Modbus reader', description: 'Protocol notes', path: 'private.exe', available: false }];
  const html = renderToStaticMarkup(<GlobalSearch data={data} query="mdobus" onQuery={() => {}} disabled={false} onNavigate={() => {}} />);
  expect(html).toContain('没有精确匹配结果');
  expect(html).toContain('aria-label="近似建议"');
  expect(html).toContain('mdobus → modbus');
  expect(html).toContain('data-external-tool-id="missing"');
  expect(html).not.toContain('private.exe');
  expect(searchExternalToolResults(fixture.tools, 'private')).toEqual({ matches: [], suggestions: [] });
});
it('renders two independent placements with unique accessible result regions and only the focused popup', () => {
  fixture.tools = [{ id: 'protocol', name: 'Modbus', description: '' }];
  const both = (sidebarOpen: boolean) => renderToStaticMarkup(<>
    <GlobalSearch data={data} query="Modbus" onQuery={() => {}} disabled={false} onNavigate={() => {}} open={!sidebarOpen} />
    <GlobalSearch data={data} query="mdobus" onQuery={() => {}} disabled={false} onNavigate={() => {}} placement="sidebar" open={sidebarOpen} />
  </>);
  const sidebar = both(true), topbar = both(false);
  expect(sidebar).toContain('aria-label="全局搜索"');
  expect(sidebar).toContain('aria-label="侧边栏全局搜索"');
  expect(sidebar).toContain('id="global-search-sidebar-results"');
  expect(sidebar).not.toContain('id="global-search-topbar-results"');
  expect(topbar).toContain('id="global-search-topbar-results"');
  expect(topbar).not.toContain('id="global-search-sidebar-results"');
  expect(sidebar.match(/data-external-tool-id="protocol"/g)).toHaveLength(1);
  expect(topbar.match(/data-external-tool-id="protocol"/g)).toHaveLength(1);
  expect(sidebar).toContain('value="Modbus"');
  expect(sidebar).toContain('value="mdobus"');
});
it('finds the software-settings rename and development log entry with existing phonetic matching', () => {
  expect(pageLabel('appearance')).toBe('软件设置');
  for (const query of ['外观', '软件设置', 'RJ SZ', 'appearance', 'theme']) expect(searchPages(query).map(page => page.page)).toContain('appearance');
  for (const query of ['开发日志', 'KF RZ', 'debug', 'log']) expect(searchPages(query).map(page => page.page)).toContain('dev-logs');
});
