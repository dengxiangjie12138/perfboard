import type { RepoStatus } from '../types';

export function RepositoryConnection({ repo, checking = false }: { repo: RepoStatus; checking?: boolean }) {
  const connected = !checking && repo.configured && repo.ready && Boolean(repo.path) && !repo.error;
  const label = checking ? '正在连接仓库…' : connected ? '本地仓库已连接' : repo.error ? '仓库连接失败' : '等待连接仓库';
  return <span className="repository-connection" role="status" data-testid="repo-connection-status">
    <span className={'status-dot' + (connected ? ' connected' : '')} aria-hidden="true" />{label}
  </span>;
}
