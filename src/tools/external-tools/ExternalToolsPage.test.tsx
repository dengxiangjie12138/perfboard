import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExternalTool } from '../../services/api';
import { ExternalToolsPage } from './ExternalToolsPage';
const fixture = vi.hoisted(() => ({
  repo: { ready: true, path: 'D:/warehouse-a' as string | null },
  tools: [] as ExternalTool[],
  actions: { refresh: vi.fn(), save: vi.fn(), remove: vi.fn(), launch: vi.fn() },
  pick: vi.fn(),
}));
vi.mock('../../state/DataContext', () => ({ useData: () => ({ repo: fixture.repo }) }));
vi.mock('./ExternalToolsProvider', () => ({ useExternalTools: () => ({ tools: fixture.tools, loading: false, error: '', ...fixture.actions }) }));
vi.mock('../../services/api', () => ({ native: true, errorMessage: (value: unknown) => String(value), pickExternalToolExecutable: fixture.pick }));
beforeEach(() => { fixture.repo = { ready: true, path: 'D:/warehouse-a' }; fixture.tools = []; vi.clearAllMocks(); });
it('requires a warehouse and prevents stale tools from rendering when disconnected', () => {
  fixture.repo = { ready: false, path: null };
  fixture.tools = [{ id: 'old', name: 'Old warehouse record', path: 'C:/old.exe', description: 'old description', available: true, status: 'ready' }];
  const html = renderToStaticMarkup(<ExternalToolsPage/>);
  expect(html).toContain('external-tools-no-warehouse');
  expect(html).toContain('请先打开数据仓库');
  expect(html).toContain('data-testid="external-tools-add" disabled=""');
  expect(html).not.toContain('Old warehouse record');
  expect(html).not.toContain('external-tools-list');
});
it('keeps a missing executable visible with exact details and explicit repair', () => {
  fixture.tools = [{ id: 'missing', name: 'Missing application', path: 'C:/Program Files/Local App/app.exe', description: ' Exact introduction\n第二行 ', available: false, status: '程序文件缺失，请重新选择 EXE 路径。' }];
  const html = renderToStaticMarkup(<ExternalToolsPage selectedId="missing"/>);
  expect(html).toContain('Missing application');
  expect(html).toContain('C:/Program Files/Local App/app.exe');
  expect(html).toContain(' Exact introduction\n第二行 ');
  expect(html).toContain('程序文件缺失');
  expect(html).toContain('修复路径');
  expect(html).toContain('disabled="">启动');
  expect(html).toContain('保存在当前数据仓库');
  expect(fixture.actions.launch).not.toHaveBeenCalled();
  expect(fixture.actions.remove).not.toHaveBeenCalled();
  expect(fixture.pick).not.toHaveBeenCalled();
});
it('identifies a selected record absent from the active warehouse', () => {
  const html = renderToStaticMarkup(<ExternalToolsPage selectedId="warehouse-a-record"/>);
  expect(html).toContain('external-tools-missing');
  expect(html).toContain('所选工具在当前仓库中不存在');
  expect(fixture.actions.launch).not.toHaveBeenCalled();
});
