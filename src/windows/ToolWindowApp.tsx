import { useEffect, useState } from 'react';
import { X, ArrowLeft, CopyPlus } from 'lucide-react';
import { useData } from '../state/DataContext';
import { api, errorMessage } from '../services/api';
import { TOOLS } from '../tools/registry';
import { CoreLibraryPage } from '../features/core-library/CoreLibraryPage';
import { PartsPage } from '../features/parts/PartsPage';
import { NotesPage } from '../features/notes/NotesPage';
import { DevLogsPage } from '../features/dev-logs/DevLogsPage';
import { sameWindowRoute, windowRouteFromHash } from './definitions';
import type { WindowContext } from './contracts';
import { useWindowClose } from './useWindowClose';
import { useSharedTheme } from './useSharedTheme';
import './windows.css';
import { useViewScroll } from '../services/useViewScroll';
export function ToolWindowApp() {
  const { repo, loading, error, setError, message } = useData();
  const [context, setContext] = useState<WindowContext | null>(null);
  const [opening, setOpening] = useState(false);
  const theme = useSharedTheme(); useWindowClose(setError);
  useEffect(() => {
    let disposed = false;
    void api.windowContext().then(value => {
      const route = windowRouteFromHash(location.hash);
      if (!route || !sameWindowRoute(value.route, route)) throw new Error('独立窗口路由与本机窗口不匹配。');
      if (!disposed) setContext(value);
    }).catch(error => { if (!disposed) setError(errorMessage(error)); });
    return () => { disposed = true; };
  }, [setError]);
  const route = context?.route;
  const tool = route?.kind === 'tool' ? TOOLS.find(tool => tool.page === route.toolId) : undefined;
  const Component = tool?.component;
  const needsRepository = route?.kind !== 'tool' || (route.toolId !== 'cores' && (route.toolId === 'external-tools' || tool?.requiresRepository !== false));
  const blocked = needsRepository && !repo.ready;
  useViewScroll('window-content-' + (route?.kind === 'tool' ? route.toolId : route?.kind === 'notes' ? route.category : route?.kind ?? ''), '.tool-window-content', repo.path, !!context && !loading && !blocked);
  const attempt = (work: () => Promise<unknown>) => void work().catch(error => setError(errorMessage(error)));
  const openNew = () => { if (!route || opening) return; setOpening(true); void api.openWindow(route).catch(error => setError(errorMessage(error))).finally(() => setOpening(false)); };
  return <div className="tool-window-shell">
    <header className="tool-window-header"><strong>{context?.title ?? '独立窗口'}</strong><span>窗口 {context?.instanceId ?? '…'} · 共享资料仓库</span>
      <button className="small" disabled={!context || opening} onClick={openNew} aria-label="新开独立窗口"><CopyPlus size={14} /><span>新开窗口</span></button>
      <button className="small" onClick={() => attempt(api.showMainWindow)}><ArrowLeft size={14} /><span>主窗口</span></button>
      <button className="icon-button" aria-label="关闭工具窗口" title="保存并关闭此窗口" onClick={() => attempt(api.closeToolWindow)}><X size={17} /></button>
    </header>
    <main className={'tool-window-content'+(route?.kind==='parts'&&!blocked&&!loading?' inventory-host':'')+(route?.kind==='dev-logs'&&!blocked&&!loading?' logs-host':'')}>
      {error && <div className="global-error" role="alert">{error}<button className="icon-button" aria-label="关闭错误提示" onClick={() => setError(null)}><X size={16} /></button></div>}
      {!context || loading ? <div className="empty-state">正在准备窗口…</div> : blocked ? <div className="empty-state">请先在主窗口打开资料仓库。<br /><button onClick={() => attempt(api.showMainWindow)}>回到主窗口</button></div> : route?.kind === 'parts' ? <PartsPage key={repo.path} initialPartId={route.partId} /> : route?.kind === 'notes' ? <NotesPage key={repo.path} category={route.category} initialNoteId={route.noteId} /> : route?.kind === 'dev-logs' ? <DevLogsPage key={repo.path} initialProjectId={route.projectId} initialPageId={route.pageId} theme={theme} compact /> : route?.kind === 'tool' && route.toolId === 'cores' ? <CoreLibraryPage /> : Component ? <Component key={route?.kind === 'tool' && route.toolId === 'external-tools' ? repo.path : undefined} selectedId={route?.kind === 'tool' ? route.externalToolId : undefined} /> : <div className="empty-state">页面不可用。</div>}
    </main>
    {message && <div className="toast" role="status">{message}</div>}
    <footer className="tool-window-footer">每次打开都会新建独立窗口。各功能按窗口编号记住上次状态，仓库资料分别记忆；JSON 原文草稿继续保留。</footer>
  </div>;
}
