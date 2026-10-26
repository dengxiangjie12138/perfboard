import { useEffect, useRef, useState } from 'react';
import { X, PanelLeft } from 'lucide-react';
import type { Page, ThemePreference } from './types';
import { useData } from './state/DataContext';
import { api, errorMessage, native } from './services/api';
import { flushAll, isSaveCancelled } from './services/saveRegistry';
import { formatDisplayPath } from './utils/displayPath';
import { TOOLS, toolGroupFor } from './tools/registry';
import { SidebarNav } from './navigation/SidebarNav';
import { RepositoryConnection } from './navigation/RepositoryConnection';
import { GlobalSearch } from './navigation/GlobalSearch';
import { RouteContent } from './navigation/RouteContent';
import { pageLabel } from './navigation/pages';
import type { AppRoute, NavigationGroups } from './navigation/routes';
import { OpenWindowButton } from './windows/ToolWindowButton';
import { useWindowClose } from './windows/useWindowClose';
import './windows/windows.css';
import { independentRoute } from './navigation/windowRoute';
import { useViewMemory } from './services/useViewMemory';
import { readViewMemory, writeViewMemory } from './services/viewMemory';
import { rememberedRoute } from './navigation/viewMemory';
import { useViewScroll } from './services/useViewScroll';
import { themePreference } from './services/theme';
import { useResolvedTheme } from './services/useResolvedTheme';

export default function App() {
  const { data, repo, loading, error, message, setError } = useData();
  const [route, setRoute] = useState<AppRoute>({ page: 'workbench' });
  const [groups, setGroups] = useViewMemory<NavigationGroups>('navigation-groups', { hardware: false, stm32: false, utilities: true, notes: true });
  const [mobile, setMobile] = useState(false);
  const [themeOverride, setThemeOverride] = useState<ThemePreference | null>(null);
  const [localTheme, setLocalTheme] = useViewMemory<ThemePreference>('theme-preference', 'codex', undefined, themePreference);
  const [query, setQuery] = useState('');
  const [sideQuery,setSideQuery]=useState('');
  const [activeSearch,setActiveSearch]=useState<'topbar'|'sidebar'|null>(null);
  const [navigating, setNavigating] = useState(false);
  const navigationLock = useRef(false), previousRepo = useRef(repo.path);
  const sidebarRef = useRef<HTMLElement>(null);
  const restoredRouteScope = useRef<string | undefined>(undefined);
  const preference = themeOverride ?? themePreference(data.settings.theme) ?? localTheme;
  const theme = useResolvedTheme(preference);
  const changeTheme = (value: ThemePreference) => { setThemeOverride(value); setLocalTheme(value); };
  useViewScroll('navigation', '.sidebar nav');
  useViewScroll('page-' + route.page + '-' + (route.category ?? ''), '.main-content', repo.path, !loading);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const nav = sidebar?.querySelector('nav');
    if (!sidebar || !nav) return;
    const updateSearchWidth = () => {
      sidebar.style.setProperty('--sidebar-nav-scrollbar-gutter', `${Math.max(0, nav.offsetWidth - nav.clientWidth)}px`);
    };
    updateSearchWidth();
    const observer = new ResizeObserver(updateSearchWidth);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    document.body.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('codex', theme === 'codex');
  }, [theme]);
  useEffect(() => {
    if (previousRepo.current !== repo.path) {
      previousRepo.current = repo.path; setThemeOverride(null); setRoute({ page: 'workbench' });
    }
  }, [repo.path]);
  useEffect(() => {
    if (loading) return;
    const scope = repo.path ?? '';
    if (restoredRouteScope.current === scope) return;
    restoredRouteScope.current = scope;
    setRoute(readViewMemory<AppRoute>('main-route', { page: 'workbench' }, repo.path, rememberedRoute));
  }, [loading, repo.path]);
  useWindowClose(setError);
  useEffect(() => { if (native) void api.setSharedTheme(theme).catch(error => setError(errorMessage(error))); }, [theme, setError]);

  async function navigate(next: AppRoute) {
    if (loading || navigationLock.current) return;
    navigationLock.current = true; setNavigating(true);
    try {
      await flushAll('navigate');
      setRoute(next);
      writeViewMemory('main-route', rememberedRoute(next), repo.path);
      const group = toolGroupFor(next.page);
      if (group) setGroups(current => ({ ...current, [group]: true }));
      if (next.page === 'notes') setGroups(current => ({ ...current, notes: true }));
      setMobile(false); setQuery(''); setSideQuery(''); setActiveSearch(null);
      document.querySelector('.main-content')?.scrollTo(0, 0);
    } catch (failure) {
      if (!isSaveCancelled(failure)) setError('保存失败，已保留当前页面：' + errorMessage(failure));
    } finally { navigationLock.current = false; setNavigating(false); }
  }
  const onNavigate = (next: AppRoute) => void navigate(next);
  const go = (page: Page, noteId?: string, partId?: string, externalToolId?: string, toolItemId?: string) => onNavigate({ page, noteId, partId, externalToolId, toolItemId });
  const displayRepoPath = repo.path === null ? null : formatDisplayPath(repo.path);
  const ready = repo.ready;
  const windowRoute=independentRoute(route);
  const openIndependent=(next:AppRoute)=>{const target=independentRoute(next);if(target)void api.openWindow(target).catch(e=>setError(errorMessage(e)));};
  const essay = ready && !loading && route.page === 'notes' && route.category === '随笔';
  const standalone = route.page === 'workbench' || route.page === 'cores' || route.page === 'utilities' || TOOLS.some(tool => tool.page === route.page && tool.requiresRepository === false);
  const breadcrumb = !ready && !standalone && route.page !== 'appearance' && route.page !== 'history' ? '仓库与数据' : pageLabel(route.page);

  return <div className="app-shell">
    <aside ref={sidebarRef} className={'sidebar ' + (mobile ? 'mobile-open' : '')}>
      <div className="brand"><span className="brand-mark">▦</span><div><strong>洞洞板</strong><small>PERFBOARD · 工程工具箱</small></div></div>
      <GlobalSearch data={data} query={sideQuery} onQuery={setSideQuery} disabled={loading || navigating} onNavigate={onNavigate}
        placement="sidebar" open={activeSearch==='sidebar'} onFocus={()=>setActiveSearch('sidebar')} onDismiss={()=>setActiveSearch(current=>current==='sidebar'?null:current)} />
      <SidebarNav route={route} disabled={loading || navigating} groups={groups} onNavigate={onNavigate} onOpenWindow={openIndependent}
        toggleGroup={group => setGroups(current => ({ ...current, [group]: !current[group] }))} />
      <div className="side-footer"><RepositoryConnection repo={repo} checking={loading} />
        <small title={displayRepoPath ?? ''}>{displayRepoPath ?? '数据保存在你选择的目录'}</small><span>Perfboard · 0.1.0</span>
      </div>
    </aside>
    {mobile && <button className="sidebar-shade" aria-label="关闭导航" onClick={() => setMobile(false)} />}
    <div className="workspace">
      <header className="topbar"><button className="icon-button mobile-toggle" aria-label="切换导航" onClick={() => setMobile(value => !value)}>
        <PanelLeft size={19} /></button><div className="breadcrumb-actions"><span className="breadcrumb">{breadcrumb}{route.page === 'notes' && route.category ? ' / ' + route.category : ''}</span>
        {windowRoute && <OpenWindowButton route={windowRoute} disabled={loading || navigating} onError={setError} />}</div>
        <GlobalSearch data={data} query={query} onQuery={setQuery} disabled={loading || navigating} onNavigate={onNavigate} open={activeSearch==='topbar'} onFocus={()=>setActiveSearch('topbar')} onDismiss={()=>setActiveSearch(current=>current==='topbar'?null:current)} />
        <span className="local-badge">本地</span>
      </header>
      <main className={'main-content' + (essay ? ' main-content-essay' : '') + (route.page==='parts'&&ready&&!loading?' inventory-host':'') + (route.page==='dev-logs'&&ready&&!loading?' logs-host':'')}>
        {error && <div className="global-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError(null)}><X size={17} /></button></div>}
        {loading ? <div className="empty-state">正在打开本地仓库…</div> :
          <RouteContent key={repo.path} route={route} ready={ready} theme={theme} themePreference={preference} onTheme={changeTheme} onNavigate={go} />}
      </main>
    </div>
    {message && <div className="toast" role="status">{message}</div>}
  </div>;
}
