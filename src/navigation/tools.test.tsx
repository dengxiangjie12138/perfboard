import { expect, it, vi } from 'vitest';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarNav } from './SidebarNav';
import { RouteContent } from './RouteContent';
import { pageLabel, searchPages } from './pages';
import { GlobalSearch } from './GlobalSearch';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';
import { CoreLibraryPage } from '../features/core-library';
import { JsonPage } from '../tools/json';
import { ExternalToolsPage } from '../tools/external-tools';
import { WireGaugePage } from '../tools/wire-gauge';
import { StandingReminderPage } from '../features/standing-reminder/StandingReminderPage';
import { independentRoute } from './windowRoute';
import { TOOLS, TOOL_GROUPS, TOOL_SECTIONS } from '../tools/registry';
import { RadixPage } from '../tools/radix';
import { RepositoryPage } from '../features/settings/RepositoryPage';
import { externalToolRoute, searchExternalTools } from './externalToolSearch';
import type { AppRoute } from './routes';
import type { Page } from '../types';
vi.mock('../features/notes/NotesPage', () => ({ NotesPage: () => null }));
const external = vi.hoisted(() => ({ tools: [
  { id: 'serial-user', name: 'SuperConnectX', path: 'fixture-serial.exe', description: '串口采样调试', available: true, status: '就绪' },
  { id: 'scope-user', name: '示波器助手', path: 'fixture-scope.exe', description: 'USB波形读取', available: false, status: '找不到文件' },
  { id: 'other-user', name: '另一应用', path: 'fixture-other.exe', description: '不会匹配串口', available: true, status: '就绪' },
], launch: vi.fn() }));
vi.mock('../tools/external-tools', () => ({ ExternalToolsPage: () => null, useExternalTools: () => ({ tools: external.tools, launch: external.launch }) }));
const emptyData = { parts: [], notes: [], attachments: [], settings: {} };
vi.mock('../state/DataContext', () => ({ useData: () => ({ data: { parts: [], notes: [], attachments: [], settings: {} } }) }));
const groups = { hardware: true, stm32: true, utilities: true, notes: true };
const sidebar = (page: Page = 'radix') => renderToStaticMarkup(<SidebarNav route={{ page }} disabled={false} groups={groups} toggleGroup={() => {}} onNavigate={() => {}} />);
const content = (route: AppRoute) => RouteContent({ route, ready: false, theme: 'codex', onTheme: () => {}, onNavigate: () => {} });
interface TestElementProps {
  children?: ReactNode;
  onClick?: () => void;
  'data-external-tool-id'?: string;
  'aria-controls'?: string;
  'aria-expanded'?: boolean;
}
function findButton(node: ReactNode, matches: (props: TestElementProps) => boolean): ReactElement<TestElementProps> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<TestElementProps>(child)) continue;
    if (child.type === 'button' && matches(child.props)) return child;
    const nested = findButton(child.props.children, matches);
    if (nested) return nested;
  }
}
it('renders one full common-utilities toggle row with its collapsed submenu', () => {
  const html = renderToStaticMarkup(<SidebarNav route={{page:'workbench'}} disabled={false} groups={{...groups,utilities:false}} toggleGroup={() => {}} onNavigate={() => {}}/>);
  expect(html).toContain('aria-expanded="false" aria-controls="submenu-utilities"');
  expect(html).toContain('id="submenu-utilities" class="submenu" hidden=""');
  expect(html.match(/aria-controls="submenu-utilities"/g)).toHaveLength(1);
});
it('places all three calculator groups under one tools heading without extra arrow controls', () => {
  const html = sidebar();
  expect(TOOL_SECTIONS.map(section => section.title)).toEqual(['工具']);
  expect(TOOL_GROUPS.map(group => group.section)).toEqual(['tools','tools','tools']);
  expect(html.match(/class="nav-heading">工具/g)).toHaveLength(1);
  expect(html).not.toContain('class="nav-heading">常用小工具');
  for (const group of ['hardware','stm32','utilities']) expect(html).toContain(`aria-controls="submenu-${group}"`);
  const utilities = html.slice(html.indexOf('id="submenu-utilities"'), html.indexOf('class="nav-heading">记录'));
  for (const title of ['进制转换','JSON解析','外部工具']) expect(utilities).toContain(title);
  expect(html).not.toContain('chevron');
  for (const title of ['LED限流计算','电阻串联计算','电阻并联计算']) expect(html).toContain(title);
});
it('preserves static converter and hardware keyword search', () => {
  for (const query of ['二进制','八进制','十进制','十六进制','BIN','OCT','DEC','HEX','XOR']) expect(searchPages(query).map(result => result.page)).toContain('radix');
  for (const [query,page] of [['发光二极管','led'],['电阻串联计算','resistor-series'],['电阻并联计算','resistor-parallel']] as const) expect(searchPages(query).map(result => result.page)).toContain(page);
});
it('opens standalone calculators and workbench without a repository while retaining repository-tool gates', () => {
  expect(content({ page: 'radix' })?.type).toBe(RadixPage);
  expect(content({ page: 'workbench' })?.type).toBe(WorkbenchPage);
  for (const page of ['resistor-series','resistor-parallel'] as const) expect(content({ page })?.type).toBe(TOOLS.find(tool => tool.page === page)?.component);
  for (const page of ['led','feedback','timer'] as const) expect(content({ page })?.type).toBe(RepositoryPage);
});
it('keeps cores as a workspace reference entry and opens JSON and cores offline', () => {
  const html = sidebar('cores');
  const workspace = html.slice(html.indexOf('class="nav-heading">工作空间'), html.indexOf('class="nav-heading">工具'));
  expect(workspace).toContain('磁芯参数库');
  expect(workspace.indexOf('磁芯参数库')).toBeGreaterThan(workspace.indexOf('物料仓库'));
  expect(TOOLS.some(tool => tool.page === 'cores')).toBe(false);
  expect(pageLabel('cores')).toBe('磁芯参数库');
  expect(content({ page: 'json' })?.type).toBe(JsonPage);
  expect(content({ page: 'cores' })?.type).toBe(CoreLibraryPage);
});
it('finds JSON and core entries and displays their workbench cards', () => {
  for (const query of ['JSON','格式化','压缩','转义','反转义']) expect(searchPages(query).map(result => result.page)).toContain('json');
  for (const query of ['磁芯','core','ferrite','型号']) {
    expect(searchPages(query).map(result => result.page)).toContain('cores');
    expect(renderToStaticMarkup(<GlobalSearch data={emptyData} query={query} onQuery={() => {}} disabled={false} onNavigate={() => {}} />)).toContain('磁芯参数库');
  }
  const workbench = renderToStaticMarkup(<WorkbenchPage onNavigate={() => {}} />);
  expect(workbench).toContain('<h2>磁芯参数库</h2>');
  expect(workbench).toContain('<h2>JSON解析</h2>');
});
it('replaces the dedicated serial route with the generic external-tool entry', () => {
  const tool = TOOLS.find(value => value.page === 'external-tools');
  expect(tool?.group).toBe('utilities');
  expect(tool?.requiresRepository).toBe(false);
  expect(TOOLS.some(value => String(value.page) === 'external-serial')).toBe(false);
  for (const query of ['外部工具','应用']) expect(searchPages(query).map(result => result.page)).toContain('external-tools');
  expect(searchPages('SuperConnectX')).toHaveLength(0);
  expect(sidebar('external-tools')).toContain('外部工具');
  expect(content({ page: 'external-tools' })?.type).toBe(ExternalToolsPage);
});
it('uses only name and description to search the full application list including unavailable entries', () => {
  expect(searchExternalTools(external.tools, '  SUPERconnectx  ').map(tool => tool.id)).toEqual(['serial-user']);
  expect(searchExternalTools(external.tools, 'USB波形').map(tool => tool.id)).toEqual(['scope-user']);
  expect(searchExternalTools(external.tools, 'fixture-scope.exe')).toEqual([]);
  expect(searchExternalTools(external.tools, '')).toHaveLength(3);
  const html = renderToStaticMarkup(<GlobalSearch data={emptyData} query="USB波形" onQuery={() => {}} disabled={false} onNavigate={() => {}} />);
  expect(html).toContain('data-external-tool-id="scope-user"');
  expect(html).toContain('示波器助手');
});
it('routes search results by their own identifier without launching and preserves missing identifiers for the page to explain', () => {
  external.launch.mockClear();
  const route = externalToolRoute('scope-user');
  expect(route).toEqual({ page: 'external-tools', externalToolId: 'scope-user' });
  expect(route.partId).toBeUndefined();
  expect(route.noteId).toBeUndefined();
  expect(content(route)?.props.selectedId).toBe('scope-user');
  expect(content(externalToolRoute('deleted-id'))?.props.selectedId).toBe('deleted-id');
  renderToStaticMarkup(<GlobalSearch data={emptyData} query="SuperConnectX" onQuery={() => {}} disabled={false} onNavigate={() => {}} />);
  const onNavigate = vi.fn();
  const search = GlobalSearch({ data: emptyData, query: 'USB波形', onQuery: () => {}, disabled: false, onNavigate });
  findButton(search, props => props['data-external-tool-id'] === 'scope-user')?.props.onClick?.();
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(route);
  renderToStaticMarkup(<WorkbenchPage onNavigate={() => {}} initialQuery="USB波形" />);
  expect(external.launch).not.toHaveBeenCalled();
});
it('shows every matching external record beyond the material and note preview limit in both searches', () => {
  const original = external.tools;
  try {
    external.tools = Array.from({ length: 12 }, (_, index) => ({
      ...original[0], id: 'application-' + index, name: '应用 ' + index, description: '覆盖记录说明', available: index !== 11,
    }));
    expect(searchExternalTools(external.tools, '覆盖记录')).toHaveLength(12);
    const global = renderToStaticMarkup(<GlobalSearch data={emptyData} query="覆盖记录" onQuery={() => {}} disabled={false} onNavigate={() => {}} />);
    const workbench = renderToStaticMarkup(<WorkbenchPage onNavigate={() => {}} initialQuery="覆盖记录" />);
    for (const tool of external.tools) {
      expect(global).toContain('data-external-tool-id="' + tool.id + '"');
      expect(workbench).toContain('data-external-tool-id="' + tool.id + '"');
    }
    expect(workbench).toContain('不可用 · 查看记录');
  } finally { external.tools = original; }
});
it('reflects application rename, add, and delete in both searches when the provider updates', () => {
  const original = external.tools;
  try {
    let html = renderToStaticMarkup(<WorkbenchPage onNavigate={() => {}} initialQuery="USB波形" />);
    expect(html).toContain('<h2>示波器助手</h2>');
    expect(html).not.toContain('<h2>SuperConnectX</h2>');
    external.tools = [{ ...original[1], name: '新版波形工具' }, { ...original[0], id: 'new-id', name: 'USB波形新应用' }];
    html = renderToStaticMarkup(<GlobalSearch data={emptyData} query="USB波形" onQuery={() => {}} disabled={false} onNavigate={() => {}} />);
    expect(html).toContain('新版波形工具');
    expect(html).toContain('data-external-tool-id="new-id"');
    expect(html).not.toContain('示波器助手');
    html = renderToStaticMarkup(<WorkbenchPage onNavigate={() => {}} initialQuery="USB波形" />);
    expect(html).toContain('<h2>新版波形工具</h2>');
    expect(html).toContain('data-external-tool-id="new-id"');
    expect(html).not.toContain('<h2>示波器助手</h2>');
    external.tools = [];
    expect(renderToStaticMarkup(<GlobalSearch data={emptyData} query="SuperConnectX" onQuery={() => {}} disabled={false} onNavigate={() => {}} />)).toContain('没有匹配结果');
    expect(renderToStaticMarkup(<WorkbenchPage onNavigate={() => {}} />)).not.toContain('data-external-tool-id=');
  } finally { external.tools = original; }
});
it('registers wire-gauge calculation with reference-current language', () => {
  const tool = TOOLS.find(value => value.page === 'wire-gauge');
  expect(tool?.group).toBe('hardware');
  expect(tool?.requiresRepository).toBe(false);
  expect(tool?.description).not.toContain('电流密度');
  for (const query of ['AWG','线规','线径','电流','截面积','期望电流']) expect(searchPages(query).map(result => result.page)).toContain('wire-gauge');
  expect(content({ page: 'wire-gauge' })?.type).toBe(WireGaugePage);
  expect(renderToStaticMarkup(<WorkbenchPage onNavigate={() => {}} />)).toContain('<h2>线径计算</h2>');
});

it('registers one warehouse-independent standing reminder tool in search and independent windows', () => {
 const tool = TOOLS.find(value => value.page === 'standing-reminder');
 expect(tool?.group).toBe('utilities'); expect(tool?.requiresRepository).toBe(false);
 expect(content({page:'standing-reminder'})?.type).toBe(StandingReminderPage);
 expect(independentRoute({page:'standing-reminder'})).toEqual({kind:'tool',toolId:'standing-reminder'});
 for (const query of ['久坐','休息','standing']) expect(searchPages(query).map(result=>result.page)).toContain('standing-reminder');
 expect(sidebar()).toContain('久坐提醒');
});
