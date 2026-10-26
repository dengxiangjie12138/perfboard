import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepositoryConnection } from './RepositoryConnection';
import type { RepoStatus } from '../types';

const ready: RepoStatus = { configured: true, ready: true, path: 'D:/fixture', error: null };
it('shows success only after a verified repository connection', () => {
  const html = renderToStaticMarkup(<RepositoryConnection repo={ready} />);
  expect(html).toContain('status-dot connected');
  expect(html).toContain('本地仓库已连接');
});
it.each([
  [{ ...ready, ready: false }, false],
  [{ ...ready, error: 'Database unavailable' }, false],
  [{ ...ready, configured: false }, false],
  [{ ...ready, path: null }, false],
  [ready, true],
])('never shows success for an unverified or failed state', (repo, checking) => {
  const html = renderToStaticMarkup(<RepositoryConnection repo={repo} checking={checking} />);
  expect(html).not.toContain('status-dot connected');
  expect(html).not.toContain('本地仓库已连接');
});
