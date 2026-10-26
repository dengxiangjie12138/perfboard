import type { Theme, ThemePreference } from '../types';
import { VersionHistoryPage } from '../features/settings/VersionHistoryPage';
import { DevLogsPage } from '../features/dev-logs/DevLogsPage';
import { PartsPage } from '../features/parts/PartsPage';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';
import { AppearancePage } from '../features/settings/AppearancePage';
import { RepositoryPage } from '../features/settings/RepositoryPage';
import { NotesPage } from '../features/notes/NotesPage';
import { CoreLibraryPage } from '../features/core-library';
import { TOOLS } from '../tools/registry';
import { ToolOverviewPage } from '../tools/ToolOverviewPage';
import type { AppRoute, PageNavigate } from './routes';

interface Props {
  route: AppRoute; ready: boolean; theme: Theme; themePreference?: ThemePreference; onTheme: (theme: ThemePreference) => void;
  onNavigate: PageNavigate;
}
export function RouteContent({ route, ready, theme, themePreference, onTheme, onNavigate }: Props) {
  if (route.page === 'appearance') return <AppearancePage theme={themePreference ?? theme} onTheme={onTheme} />;
  if (route.page === 'history') return <VersionHistoryPage />;
  if (route.page === 'cores') return <CoreLibraryPage />;
  if (route.page === 'utilities') return <ToolOverviewPage group="utilities" onNavigate={onNavigate} />;
  if (route.page === 'workbench') return <WorkbenchPage onNavigate={onNavigate} />;
  const tool = TOOLS.find(value => value.page === route.page);
  if (tool?.requiresRepository === false) { const Component = tool.component; return <Component selectedId={tool.page === 'external-tools' ? route.externalToolId : tool.page === 'opamp' ? route.toolItemId : undefined} selectionRequest={route} />; }
  if (!ready || route.page === 'repository') return <RepositoryPage />;
  if (route.page === 'dev-logs') return <DevLogsPage initialProjectId={route.projectId} initialPageId={route.logPageId} theme={theme} />;
  if (route.page === 'parts') return <PartsPage key={route.partId ?? 'parts'} initialPartId={route.partId} />;
  if (route.page === 'notes') return <NotesPage key={[route.category ?? 'all', route.noteId ?? ''].join('-')}
    category={route.category} initialNoteId={route.noteId} />;
  if (route.page === 'hardware' || route.page === 'stm32') return <ToolOverviewPage group={route.page} onNavigate={onNavigate} />;
  const Component = tool?.component;
  return Component ? <Component /> : null;
}
