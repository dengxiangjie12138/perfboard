import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepositoryPage } from './RepositoryPage';

const state = vi.hoisted(() => ({
  repo: { ready: true, configured: true, path: '', error: null },
  reloadStatus: vi.fn(), notify: vi.fn(), setError: vi.fn(),
}));
vi.mock('../../state/DataContext', () => ({ useData: () => state }));

beforeEach(() => vi.clearAllMocks());
it.each([
  ['\\\\?\\D:\\洞洞板\\洞洞板仓库', 'D:\\洞洞板\\洞洞板仓库'],
  ['\\\\?\\UNC\\服务器\\共享\\洞洞板', '\\\\服务器\\共享\\洞洞板'],
])('renders the current repository without changing its canonical path', (canonical, display) => {
  state.repo.path = canonical;
  const html = renderToStaticMarkup(<RepositoryPage />);
  expect(html).toContain('<p class="path-text">' + display + '</p>');
  expect(html).not.toContain(canonical);
  expect(state.repo.path).toBe(canonical);
  expect(state.reloadStatus).not.toHaveBeenCalled();
});
