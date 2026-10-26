import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { JSONContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { listen } from '@tauri-apps/api/event';
import { FileText, FolderPlus, FilePlus2, ChevronRight, Trash2, Save, History, RefreshCw, Copy, LockKeyhole, FileDown } from 'lucide-react';
import { Modal, formatDate } from '../../components/Common';
import { InlineRenameInput } from '../../components/InlineRenameInput';
import { LogProjectTree, type LogDragItem, type LogRenameTarget } from './LogProjectTree';
import { LogTrashPanel } from './LogTrashPanel';
import { TrashDeleteDialog } from './TrashDeleteDialog';
import { describeTrashConfirmation, type TrashConfirmation, type TrashDeleteKind } from './trash';
import { resolveLogSelection } from './selection';
import { useData } from '../../state/DataContext';
import { errorMessage, native } from '../../services/api';
import { registerFlush } from '../../services/saveRegistry';
import { acquireEditLease, releaseEditLease, type EditLeaseStatus } from '../../services/editLease';
import { SimpleEditor } from '../../../third_party/tiptap-simple-editor/adapted/components/tiptap-templates/simple/simple-editor';
import { logApi } from './api';
import { LogAutosave, type LogSaveEvent } from './autosave';
import { LogSaveIndicator } from './LogSaveIndicator';
import { readLogAutosavePreference, writeLogAutosavePreference, observeLogAutosavePreference } from './savePreferences';
import { orderedMove, parseStoredDocument } from './document';
import type { LogFolder, LogHistory, LogPage, LogProject, LogSnapshot, LogTrashSnapshot } from './contracts';
import { ResourceOperationQueue } from './resourceOperations';
import type { LogResourceController } from './resourceApi';
import { resolveLogPdfPage } from './pdf';
import { exportLogPagePdf } from './pdfExport';
import { logDropLocation, pageFolder, type LogTreeKind } from './tree';
import { useViewMemory } from '../../services/useViewMemory';
import { useViewScroll } from '../../services/useViewScroll';
import './dev-logs.css';
export interface DevLogsPageProps { initialProjectId?: string; initialPageId?: string; theme?: 'light' | 'dark' | 'codex'; compact?: boolean }
const EMPTY_SNAPSHOT: LogSnapshot = { projects: [], pages: [] };
type NameDialog = { kind: 'project-create'; title: string };
export function DevLogsPage({ initialProjectId, initialPageId, theme, compact = true }: DevLogsPageProps) {
 const { repo, notify } = useData();
 const [observedTheme, setObservedTheme] = useState(() => document.documentElement.dataset.theme ?? 'light');
 useEffect(() => { const observer = new MutationObserver(() => setObservedTheme(document.documentElement.dataset.theme ?? 'light')); observer.observe(document.documentElement, {attributes:true,attributeFilter:['data-theme']}); return () => observer.disconnect(); }, []);
 const [snapshot, setSnapshot] = useState<LogSnapshot>(EMPTY_SNAPSHOT); const snapshotRef = useRef(snapshot);
 const [current, setCurrent] = useState<LogPage | null>(null); const currentRef = useRef<LogPage | null>(null);
 const [editorDocument, setEditorDocument] = useState<JSONContent | null>(null); const [editorVersion, setEditorVersion] = useState(0);
 const [lease, setLease] = useState<EditLeaseStatus | null>(null); const leaseRef = useRef<EditLeaseStatus | null>(null);
 const [autoSaveEnabled, setAutoSaveEnabled] = useState(readLogAutosavePreference);
 const [unsavedDialog, setUnsavedDialog] = useState<'navigate' | 'external' | null>(null); const [unsavedSaving, setUnsavedSaving] = useState(false);
 const unsavedDecision = useRef<((proceed: boolean) => void) | null>(null); const focusNewPage = useRef(false);
 const [saveEvent, setSaveEvent] = useState<LogSaveEvent>({ id: '', status: 'idle' });
 const [findRequest, setFindRequest] = useState(0);
 const [exporting, setExporting] = useState(false);
 const [error, setError] = useState(''); const [writeBlocked, setWriteBlocked] = useState(false);
 const lastSaveError = useRef<{ id: string; message: string } | null>(null);
 const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
 const [trash, setTrash] = useViewMemory('dev-logs-trash', false, repo.path);
 const [collapsedIds, setCollapsedIds] = useViewMemory<string[]>('dev-logs-collapsed', [], repo.path, value => Array.isArray(value) && value.length <= 10000 && value.every(id => typeof id === 'string') ? value : undefined);
 const collapsed = useMemo(() => new Set(collapsedIds), [collapsedIds]);
 const setCollapsed = useCallback((update: (value: Set<string>) => Set<string>) => setCollapsedIds(previous => [...update(new Set(previous))]), [setCollapsedIds]);
 const [selectedProject, setSelectedProject] = useState(initialProjectId ?? '');
 const [dialog, setDialog] = useState<NameDialog | null>(null); const [context, setContext] = useState<{ kind: LogTreeKind; id: string; x: number; y: number } | null>(null);
 const [history, setHistory] = useState<LogHistory[] | null>(null); const [discardConfirm, setDiscardConfirm] = useState(false);
 const [rename, setRename] = useState<LogRenameTarget | null>(null);
 const [folderDelete, setFolderDelete] = useState<LogFolder | null>(null);
 const [folderDeleteError, setFolderDeleteError] = useState('');
 const [trashSnapshot, setTrashSnapshot] = useState<LogTrashSnapshot | null>(null);
 const [purgeConfirmation, setPurgeConfirmation] = useState<TrashConfirmation | null>(null); const [purgeError, setPurgeError] = useState('');
 const trashRef = useRef(trash); trashRef.current = trash;
 const repositoryKey = useRef<string | null>(null); const selectionWritable = useRef(true);
 const selectedProjectRef = useRef(selectedProject); selectedProjectRef.current = selectedProject;
 const operationTail = useRef<Promise<void>>(Promise.resolve());
 const drag = useRef<LogDragItem | null>(null); const [draggingId, setDraggingId] = useState(''); const [dropTarget, setDropTarget] = useState('');
 const suppressRenameUntil = useRef(0);
 const alive = useRef(true); const request = useRef(0); const pendingOperations = useRef(new Set<Promise<void>>());
 const [resourceBusy, setResourceBusy] = useState(false);
 useViewScroll('dev-logs-tree-' + (trash ? 'trash' : 'projects'), '.log-tree-content', repo.path, loaded);
 useViewScroll('dev-log-page-' + (current?.id ?? ''), '.log-editor-scroll', repo.path, !!current && !!editorDocument);
 const [resourceOperations] = useState(() => new ResourceOperationQueue(value => { if (alive.current) setResourceBusy(value); }));
 const setSelected = useCallback((page: LogPage | null) => { currentRef.current = page; setCurrent(page); }, []);
 const adoptSnapshot = useCallback((next: LogSnapshot) => { snapshotRef.current = next; setSnapshot(next); }, []);
 const [autosave] = useState(() => new LogAutosave(logApi.savePage, event => {
  if (!alive.current) return;
  if (event.page) {
   const next = { ...snapshotRef.current, pages: snapshotRef.current.pages.map(page => page.id === event.page!.id ? event.page! : page) };
   snapshotRef.current = next; setSnapshot(next);
   if (currentRef.current?.id === event.id) setSelected(autosave.draft(event.id) ?? event.page);
  }
  if (currentRef.current?.id === event.id) {
   setSaveEvent(event);
   if (event.status === 'error') { const message = errorMessage(event.error); lastSaveError.current = { id: event.id, message }; setError(message); if (/revision-conflict|\[deleted\]|lease|another window|另一窗口/i.test(message)) setWriteBlocked(true); }
   else if (event.status === 'saved' && lastSaveError.current?.id === event.id) { const message = lastSaveError.current.message; lastSaveError.current = null; setError(previous => previous === message ? '' : previous); }
  }
 }));
 const run = useCallback((action: () => Promise<void>) => {
  const task = operationTail.current.then(async () => { if (alive.current) { setBusy(true); setContext(null); } try { await action(); } catch (failure) { if (alive.current) setError(errorMessage(failure)); } finally { if (alive.current) setBusy(false); } });
  operationTail.current = task; pendingOperations.current.add(task); void task.finally(() => pendingOperations.current.delete(task)); return task;
 }, []);
 useEffect(() => { autosave.setEnabled(autoSaveEnabled); }, [autosave, autoSaveEnabled]);
 useEffect(() => observeLogAutosavePreference(enabled => { autosave.setEnabled(enabled); setAutoSaveEnabled(enabled); }), [autosave]);
 const changeAutoSave = (enabled: boolean) => { try { writeLogAutosavePreference(enabled); autosave.setEnabled(enabled); setAutoSaveEnabled(enabled); } catch (failure) { setError('自动保存设置未能保存：' + errorMessage(failure)); } };
 const flush = useCallback(async () => {
  await resourceOperations.flush();
  if (!autosave.enabled && autosave.isDirty()) {
   const proceed = await new Promise<boolean>(resolve => { unsavedDecision.current = resolve; setUnsavedDialog('navigate'); });
   if (!proceed) throw new Error('操作已取消，未保存的草稿保留在当前页');
  } else await autosave.flush();
 }, [autosave, resourceOperations]);
 useEffect(() => registerFlush(async () => {
  const requireManualDecision = () => {
   if (unsavedDecision.current || (!autosave.enabled && autosave.isDirty())) {
    if (!unsavedDecision.current) setUnsavedDialog('external');
    throw new Error('自动保存已关闭，草稿尚未保存；本次操作已取消，请手动保存或明确放弃后重试');
   }
  };
  await resourceOperations.flush(); requireManualDecision(); while (pendingOperations.current.size) await Promise.all([...pendingOperations.current]); await resourceOperations.flush(); requireManualDecision(); await autosave.flush();
 }), [autosave, resourceOperations]);
 const focusReadyEditor = useCallback((editor: Editor) => {
  if (!focusNewPage.current || !editor.isEditable || !editor.view.dom.isConnected) return;
  editor.view.focus(); focusNewPage.current = false;
 }, []);
 const persistNavigation = useCallback(async (projectId: string | null, pageId: string | null) => {
  const key = repositoryKey.current;
  if (!key || !selectionWritable.current || (pageId && !leaseRef.current?.owned)) return;
  try { await logApi.saveSelection({ repositoryKey: key, projectId, pageId }); }
  catch (failure) { if (alive.current) setError('日志位置未能记住：' + errorMessage(failure)); }
 }, []);
 const refreshTrash = useCallback(async () => {
  const next = await logApi.trashSnapshot();
  if (alive.current) setTrashSnapshot(next);
 }, []);
 const refresh = useCallback(async () => {
  const ticket = ++request.current; const next = await logApi.snapshot();
  if (!alive.current || ticket !== request.current) return;
  adoptSnapshot(next); setLoaded(true);
  const container = next.projects.some(project => project.id === selectedProjectRef.current && !project.deletedAt) ? selectedProjectRef.current : '';
  selectedProjectRef.current = container; setSelectedProject(container);
  if (trashRef.current) await refreshTrash();
  const old = currentRef.current; if (!old) return;
  const page = next.pages.find(value => value.id === old.id); const project = next.projects.find(value => value.id === old.projectId);
  if (!page || page.deletedAt || project?.deletedAt) {
   if (autosave.isDirty(old.id) || resourceOperations.busy) { setWriteBlocked(true); setError('此页面已删除。当前草稿仍保留，请复制草稿后重新载入。'); }
   else if (!resourceOperations.busy) {
    const owned = leaseRef.current?.owned;
    await releaseEditLease(`log:${old.id}`); leaseRef.current = null; setLease(null); setSelected(null); setEditorDocument(null); setRename(null);
    if (owned) await persistNavigation(container || null, null);
   }
  } else if (!resourceOperations.busy && !autosave.isDirty(old.id) && page.revision !== old.revision) {
   const documentChanged = page.documentJson !== old.documentJson;
   autosave.adopt(page); setSelected(page);
   if (documentChanged) { setEditorDocument(parseStoredDocument(page.documentJson, page.schemaVersion) as JSONContent); setEditorVersion(value => value + 1); }
  }
 }, [adoptSnapshot, autosave, setSelected, persistNavigation, refreshTrash, resourceOperations]);
 const openPage = useCallback(async (id: string, force = false, reveal = true) => {
  if (currentRef.current?.id === id && !force) return;
  await flush();
  const page = await logApi.getPage(id); if (page.deletedAt) throw new Error('页面已删除，请从回收站恢复');
  const document = parseStoredDocument(page.documentJson, page.schemaVersion) as JSONContent;
  const previous = currentRef.current;
  if (previous && previous.id !== id) await releaseEditLease(`log:${previous.id}`);
  leaseRef.current = null; setLease(null);
  const nextLease = await acquireEditLease(`log:${id}`);
  selectionWritable.current = nextLease.owned; leaseRef.current = nextLease; setLease(nextLease); autosave.adopt(page); setSelected(page); setSelectedProject(page.projectId);
  setEditorDocument(document); setEditorVersion(value => value + 1); setSaveEvent({ id, status: nextLease.owned ? 'idle' : 'readonly' }); setWriteBlocked(false); setError('');
  selectedProjectRef.current = page.projectId; setRename(null);
  if (reveal) setCollapsed(value => { const next = new Set(value); next.delete(page.projectId); const folderId = pageFolder(snapshotRef.current, page.id); if (folderId) next.delete(folderId); return next; });
  if (nextLease.owned) await persistNavigation(page.projectId, page.id);
 }, [autosave, flush, setSelected, persistNavigation, setCollapsed]);
 const openRef = useRef(openPage); openRef.current = openPage;
 useEffect(() => {
  if (!repo.ready) { adoptSnapshot(EMPTY_SNAPSHOT); setLoaded(false); return; }
  let disposed = false;
  void run(async () => {
   let selectionError = '';
   const [saved] = await Promise.all([logApi.selection().catch(failure => { selectionError = '日志位置暂不可用：' + errorMessage(failure); return null; }), refresh()]);
   if (disposed) return;
   repositoryKey.current = saved?.repositoryKey ?? null;
   const selection = resolveLogSelection(snapshotRef.current, saved, { projectId: initialProjectId, pageId: initialPageId });
   selectedProjectRef.current = selection.projectId ?? ''; setSelectedProject(selection.projectId ?? '');
   if (selection.pageId) await openRef.current(selection.pageId, false, Boolean(initialProjectId || initialPageId));
   if (selectionError) setError(selectionError);
  });
  return () => { disposed = true; };
 }, [repo.ready, repo.path, initialProjectId, initialPageId, adoptSnapshot, refresh, run]);
 useEffect(() => {
  if (!native || !repo.ready) return;
  let disposed = false; let unlisten: (() => void) | undefined;
  void listen('perfboard:data-changed', () => { void refresh().catch(failure => setError(errorMessage(failure))); }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(failure => setError(errorMessage(failure)));
  return () => { disposed = true; unlisten?.(); };
 }, [refresh, repo.ready]);
 useEffect(() => {
  alive.current = true;
   return () => { alive.current = false; ++request.current; const id = currentRef.current?.id; if (id && (resourceOperations.busy || autosave.enabled || !autosave.isDirty(id))) void resourceOperations.flush().then(() => autosave.flush(id)).then(() => releaseEditLease(`log:${id}`)).catch(() => {}); };
 }, [autosave, resourceOperations]);
 useEffect(() => { if (!context) return; const dismiss = () => setContext(null); window.addEventListener('click', dismiss); window.addEventListener('keydown', dismiss); return () => { window.removeEventListener('click', dismiss); window.removeEventListener('keydown', dismiss); }; }, [context]);
 const projects = useMemo(() => snapshot.projects.filter(project => !project.deletedAt).sort((a,b) => a.position - b.position || a.id.localeCompare(b.id)), [snapshot.projects]);
 const editable = !!current && !!lease?.owned && !writeBlocked && !busy && !resourceBusy;
 const resourceController: LogResourceController | undefined = current && repositoryKey.current ? {
  context: { repositoryKey: repositoryKey.current, pageId: current.id, expectedRevision: current.revision },
  onError: failure => { if (alive.current) setError(errorMessage(failure)); },
  onNotice: message => notify(message),
  runImport: operation => {
   const pageId = current.id; const key = repositoryKey.current;
   const assertOrigin = () => {
    const page = snapshotRef.current.pages.find(value => value.id === pageId);
    const project = snapshotRef.current.projects.find(value => value.id === page?.projectId);
    if (!alive.current || currentRef.current?.id !== pageId || repositoryKey.current !== key || !leaseRef.current?.owned || writeBlocked || !page || page.deletedAt || !project || project.deletedAt) throw new Error('原页面已关闭、切换或不可编辑，附件导入已停止');
   };
   return resourceOperations.run(async () => {
    assertOrigin();
    // A resource write validates the persisted revision, so save existing text first.
    await autosave.flush(pageId); assertOrigin();
    await operation({ repositoryKey: key!, pageId, expectedRevision: currentRef.current!.revision });
    assertOrigin();
    // Finish the attachment and page together even when timed autosave is disabled.
    await autosave.flush(pageId);
   });
  },
 } : undefined;
 const revisions = (values: { id: string; revision: number }[]) => values.map(value => ({ id: value.id, expectedRevision: value.revision }));
 const updateDraft = useCallback((change: Partial<Pick<LogPage, 'title' | 'documentJson'>>) => {
  if (!currentRef.current || !leaseRef.current?.owned || writeBlocked) return;
  const page = { ...currentRef.current, ...change }; setSelected(page); autosave.queue(page);
 }, [autosave, setSelected, writeBlocked]);
 async function showProject(id: string) {
  if (currentRef.current && currentRef.current.projectId !== id) {
   await flush(); const old = currentRef.current;
   autosave.discard(old.id); await releaseEditLease(`log:${old.id}`); leaseRef.current = null; setLease(null); setSelected(null); setEditorDocument(null); setRename(null); setWriteBlocked(false);
  }
  selectedProjectRef.current = id; setSelectedProject(id);
  setCollapsed(value => { const next = new Set(value); next.delete(id); return next; });
  if (!currentRef.current) await persistNavigation(id, null);
 }
 async function submitName() {
  if (!dialog) return; const name = dialog.title.trim();
  if (!name) throw new Error('名称不能为空');
  await flush(); const created = await logApi.createProject(name); await refresh(); await showProject(created.id);
  setDialog(null); setError('');
 }
 function beginRename(kind: LogTreeKind, id: string, where: 'header' | 'tree') {
  if (drag.current || Date.now() < suppressRenameUntil.current) return;
  void run(async () => {
   if (kind === 'page') { await openPage(id); if (!leaseRef.current?.owned || writeBlocked) throw new Error('此页当前只读，无法改名'); }
   setRename({ kind, id, where }); setError('');
  });
 }
 async function commitRename(name: string) {
  const target = rename; if (!target) throw new Error('改名已取消');
  let failure: unknown; let failed = false;
  await run(async () => {
   try {
    if (target.kind !== 'folder') await flush();
    if (target.kind === 'project') {
     const project = snapshotRef.current.projects.find(value => value.id === target.id && !value.deletedAt);
     if (!project) throw new Error('项目不存在或已在回收站');
     await logApi.renameProject({ id: project.id, expectedRevision: project.revision, title: name });
    } else if (target.kind === 'folder') {
     const folder = snapshotRef.current.folders?.find(value => value.id === target.id);
     if (!folder) throw new Error('文件夹不存在，请刷新后重试');
     await logApi.renameFolder({ id: folder.id, expectedRevision: folder.revision, title: name });
    } else {
     const page = currentRef.current;
     if (!page || page.id !== target.id || !leaseRef.current?.owned || writeBlocked) throw new Error('此页当前只读，无法改名');
     updateDraft({ title: name }); await autosave.flush(page.id);
    }
    await refresh(); setRename(null);
   } catch (error) { failure = error; failed = true; throw error; }
  });
  if (failed) throw failure;
 }
 async function beginPurge(kind: TrashDeleteKind, id?: string) {
  const fresh = await logApi.trashSnapshot(); setTrashSnapshot(fresh);
  const confirmation = describeTrashConfirmation(fresh, kind, id);
  setPurgeError(''); setPurgeConfirmation(confirmation);
  if (!confirmation && kind !== 'all') setError('此对象已不在回收站，请检查刷新后的列表。');
 }
 async function confirmPurge() {
  const confirmation = purgeConfirmation; if (!confirmation || purgeError) return;
  try {
   const result = confirmation.kind === 'all' ? await logApi.clearTrash(confirmation.snapshotToken)
    : confirmation.kind === 'project' ? await logApi.purgeProject(confirmation.input!) : await logApi.purgePage(confirmation.input!);
   setPurgeConfirmation(null); setPurgeError(''); await refresh();
   notify(`已永久删除 ${result.deletedProjects} 个项目、${result.deletedPages} 个页面及相关历史`);
  } catch (failure) { setPurgeError(errorMessage(failure).replace(/^\[[^\]]+\]\s*/, '')); }
 }
 async function createFolder(projectId: string) {
  const folder = await logApi.createFolder(projectId);
  await refresh();
  setCollapsed(value => { const next = new Set(value); next.delete(projectId); next.delete(folder.id); return next; });
  setError('');
 }
 async function createPage(projectId: string, folderId?: string) {
  await flush();
  const names = new Set(snapshotRef.current.pages.filter(page => page.projectId === projectId && !page.deletedAt).map(page => page.title));
  let name = '未命名页面'; let suffix = 2; while (names.has(name)) name = `未命名页面 ${suffix++}`;
  const page = await logApi.createPage(projectId, name);
  if (folderId) await logApi.moveTreeItem({ kind: 'page', id: page.id, expectedRevision: page.revision, projectId, folderId, before: null });
  await refresh(); focusNewPage.current = true; await openPage(page.id); setError('');
 }
 async function confirmFolderDelete() {
  const folder = folderDelete; if (!folder) return;
  try {
   await flush();
   await logApi.deleteFolder({ id: folder.id, expectedRevision: folder.revision });
   setFolderDelete(null); setFolderDeleteError('');
   setCollapsed(values => { const next = new Set(values); next.delete(folder.id); next.delete(folder.projectId); return next; });
   await refresh(); notify('文件夹已删除，页面已保留在项目根目录');
  } catch (failure) { setFolderDeleteError(errorMessage(failure)); }
 }
 async function decideUnsaved(choice: 'save' | 'discard' | 'cancel') {
  if (unsavedSaving) return;
  if (choice === 'cancel') { const resolve = unsavedDecision.current; unsavedDecision.current = null; setUnsavedDialog(null); resolve?.(false); return; }
  setUnsavedSaving(true);
  try {
   if (choice === 'save') await autosave.flush();
   else {
    const page = currentRef.current;
    if (page) { const fresh = await logApi.getPage(page.id); autosave.discard(page.id); autosave.adopt(fresh); setSelected(fresh); setEditorDocument(parseStoredDocument(fresh.documentJson, fresh.schemaVersion) as JSONContent); setEditorVersion(value => value + 1); setSaveEvent({id:page.id,status:'idle'}); }
   }
   const resolve = unsavedDecision.current; unsavedDecision.current = null; setUnsavedDialog(null); setError(''); resolve?.(true);
  } catch (failure) { setError(errorMessage(failure)); } finally { setUnsavedSaving(false); }
 }
 async function remove(kind: 'project' | 'page', id: string) {
  await flush();
  if (kind === 'project') { const project = snapshotRef.current.projects.find(value => value.id === id); if (!project) return; await logApi.deleteProject({ id, expectedRevision: project.revision }); }
  else { const page = snapshotRef.current.pages.find(value => value.id === id); if (!page) return; await logApi.deletePage({ id, expectedRevision: page.revision }); }
  const selected = currentRef.current;
  if (selected && (kind === 'page' ? selected.id === id : selected.projectId === id)) { autosave.discard(selected.id); await releaseEditLease(`log:${selected.id}`); leaseRef.current = null; setLease(null); setSelected(null); setEditorDocument(null); }
  await refresh(); if (!currentRef.current) await persistNavigation(selectedProjectRef.current || null, null); notify(kind === 'project' ? '项目及页面已移入回收站' : '页面已移入回收站');
 }
 async function restore(kind: 'project' | 'page', value: LogProject | LogPage) { await flush(); const input = { id: value.id, expectedRevision: value.revision }; if (kind === 'project') await logApi.restoreProject(input); else await logApi.restorePage(input); await refresh(); notify('已恢复'); }
 async function reorder(item: LogDragItem, target: LogDragItem) {
  if (item.id === target.id) return;
  await flush(); const latest = await logApi.snapshot();
  if (item.kind === 'project') {
   if (target.kind !== 'project') return;
   const values = latest.projects.filter(value => !value.deletedAt).sort((a,b) => a.position-b.position);
   await logApi.reorderProjects(revisions(orderedMove(values,item.id,target.id)));
  } else {
   const location = logDropLocation(latest, item, target); if (!location) return;
   const values = item.kind === 'page' ? latest.pages : latest.folders ?? [];
   const source = values.find(value => value.id === item.id); if (!source) throw new Error('移动对象不存在，请刷新后重试');
   const beforeValues = location.before?.kind === 'folder' ? latest.folders ?? [] : latest.pages;
   const before = location.before ? beforeValues.find(value => value.id === location.before!.id) : null;
   if (location.before && !before) throw new Error('目标位置已变化，请重试');
   await logApi.moveTreeItem({ ...location, kind: item.kind, id: item.id, expectedRevision: source.revision, before: location.before && before ? { ...location.before, expectedRevision: before.revision } : null });
   setCollapsed(value => { const next = new Set(value); next.delete(location.projectId); if (location.folderId) next.delete(location.folderId); return next; });
  }
  await refresh(); setDraggingId(''); setDropTarget(''); drag.current = null;
 }
 function dragStart(event: DragEvent, item: LogDragItem) { setRename(null); suppressRenameUntil.current = Date.now() + 500; drag.current = item; setDraggingId(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-perfboard-dev-log', JSON.stringify(item)); event.dataTransfer.setData('text/plain', item.id); }
 function dragEnd() { drag.current = null; setDraggingId(''); setDropTarget(''); suppressRenameUntil.current = Date.now() + 500; }
 function canDrop(item: LogDragItem, target: LogDragItem) { return item.kind === 'project' ? target.kind === 'project' && item.id !== target.id : !!logDropLocation(snapshotRef.current, item, target); }
 function dragOver(event: DragEvent, target: LogDragItem) { event.stopPropagation(); const item = drag.current; if (item && canDrop(item, target)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(target.id); } else setDropTarget(''); }
 function drop(event: DragEvent, target: LogDragItem) { event.preventDefault(); event.stopPropagation(); const item = drag.current; if (!item || !canDrop(item, target)) { dragEnd(); return; } dragEnd(); void run(() => reorder(item,target)); }
 function showContext(event: { preventDefault: () => void; clientX: number; clientY: number }, kind: LogTreeKind, id: string) { event.preventDefault(); setContext({ kind, id, x: Math.min(event.clientX, window.innerWidth-178), y: Math.min(event.clientY, window.innerHeight-170) }); }
 async function exportPdf(id: string) {
  const key = repositoryKey.current;
  if (!key) throw new Error('请先打开本地仓库');
  setExporting(true); setError('');
  try {
   await resourceOperations.flush();
   const page = await resolveLogPdfPage(id, currentRef.current, logApi.getPage);
   const projectTitle = snapshotRef.current.projects.find(project => project.id === page.projectId)?.title ?? '';
   if (await exportLogPagePdf(page, key, projectTitle)) notify('PDF 已导出');
  } finally { if (alive.current) setExporting(false); }
 }
 async function copyDraft() { if (currentRef.current) { await navigator.clipboard.writeText(currentRef.current.documentJson); notify('页面 JSON 草稿已复制'); } }
 async function reloadDiscardingDraft() {
  const page = currentRef.current; if (!page) return;
  autosave.discard(page.id); setDiscardConfirm(false); const fresh = await logApi.getPage(page.id);
  if (fresh.deletedAt) { await releaseEditLease(`log:${page.id}`); setSelected(null); setEditorDocument(null); setLease(null); leaseRef.current = null; setWriteBlocked(false); setError(''); await refresh(); return; }
  await openPage(page.id,true);
 }
 async function takeEditing() { const page=currentRef.current; if (!page) return; await openPage(page.id,true); }
 const selectedProjectTitle = snapshot.projects.find(value => value.id === current?.projectId)?.title;
 const contextFolder = snapshot.folders?.find(folder => folder.id === context?.id);
 const trashProjects = snapshot.projects.filter(value => value.deletedAt); const trashPages = snapshot.pages.filter(value => value.deletedAt);
 return <div className={`dev-logs-page ${compact ? 'dev-logs-compact' : ''} ${(theme ?? observedTheme) === 'dark' || (theme ?? observedTheme) === 'codex' ? 'dark' : ''}`} data-testid="dev-logs-page" onKeyDownCapture={event => { if ((event.target as HTMLElement).closest('.inline-rename')) return; if (editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void run(() => autosave.flush()); return; } if (current && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); setFindRequest(value => value + 1); } }}>
  <div className="dev-logs-layout">
   <section className="log-workspace" aria-label="开发日志编辑区">
    <header className="log-document-heading"><div className="log-document-path"><FileText size={18}/><span>{selectedProjectTitle ?? '开发日志'}</span>{current && <><ChevronRight size={14}/> {rename?.where === 'header' && rename.id === current.id ? <InlineRenameInput key={current.id} initialValue={current.title} label="页面标题" onCommit={commitRename} onCancel={() => setRename(null)}/> : <span className="log-page-title-text" data-testid="log-page-title" title={editable ? '双击标题文字改名' : current.title} onDoubleClick={() => { if (editable) beginRename('page', current.id, 'header'); }}>{current.title}</span>}</>}</div><div className="log-document-actions">{current ? <LogSaveIndicator event={saveEvent} pageId={current.id} dirty={autosave.isDirty(current.id)} automatic={autoSaveEnabled}/> : <span role="status">{loaded ? '选择或新建页面' : repo.ready ? '加载中…' : '请先打开本地仓库'}</span>}<label className="log-autosave-toggle" title="开启后每 60 秒自动保存；关闭后请手动保存"><input type="checkbox" role="switch" aria-label="自动保存" checked={autoSaveEnabled} onChange={event => changeAutoSave(event.target.checked)}/><span>自动保存</span></label><button type="button" title="版本历史" aria-label="页面版本历史" disabled={!current || busy} onClick={() => void run(async () => { await flush(); setHistory(await logApi.history(currentRef.current!.id)); })}><History size={16}/></button><button type="button" title="保存当前页面 (Ctrl+S)" aria-label="保存当前页面" disabled={!editable} onClick={() => void run(() => autosave.flush())}><Save size={16}/></button><button type="button" className="log-export-pdf" title="导出当前页面为 PDF（包含未保存内容）" aria-label="导出当前页面为 PDF" disabled={!current || busy || resourceBusy || !!rename} onClick={() => { if (current) void run(() => exportPdf(current.id)); }}><FileDown size={16}/><span>导出 PDF</span></button></div></header>
    {error && <div className="log-error" role="alert"><span>{error}</span>{current && <button onClick={() => void run(copyDraft)}><Copy size={14}/>复制草稿</button>}{writeBlocked && <button onClick={() => setDiscardConfirm(true)}>重新载入</button>}<button title="刷新日志列表" aria-label="刷新日志列表" disabled={busy} onClick={() => void run(refresh)}><RefreshCw size={14}/></button></div>}
    {current && !lease?.owned && <div className="log-readonly" role="status"><LockKeyhole size={15}/><span>另一窗口正在编辑此页，当前为只读。</span><button disabled={busy} onClick={() => void run(takeEditing)}>尝试编辑</button></div>}
    {exporting && <div className="log-resource-progress" role="status" aria-live="polite">正在导出 PDF，请稍候…</div>}
    {resourceBusy && <div className="log-resource-progress" role="status" aria-live="polite">正在保存附件和当前页面（包括未保存的文字），请稍候…</div>}
    {current && editorDocument ? <><SimpleEditor key={`${current.id}:${editorVersion}`} document={editorDocument} onReady={focusReadyEditor} findRequest={findRequest} readOnly={!editable} resources={resourceController} onUpdate={document => updateDraft({ documentJson: JSON.stringify(document) })}/></> : <div className="log-empty"><FileText size={44}/><h2>把每次推进写下来</h2><p>按项目整理开发日志，使用列表、复选框、图片和附件记录进展。</p><button className="primary" disabled={!repo.ready || busy} onClick={() => projects.length ? void run(() => createPage(selectedProject || projects[0].id)) : setDialog({ kind: 'project-create', title: '' })}><FilePlus2 size={16}/>{projects.length ? '新建页面' : '新建项目'}</button><small>内容保存在当前本地仓库。{autoSaveEnabled ? '自动保存间隔为 60 秒。' : '自动保存已关闭，请手动保存。'}</small></div>}
   </section>
   <aside className="log-project-tree" aria-label="开发日志项目与页面树"><div className="log-tree-heading"><h2>开发日志</h2><button title="新建项目" aria-label="新建日志项目" disabled={!repo.ready || busy} onClick={() => setDialog({ kind: 'project-create', title: '' })}><FolderPlus size={17}/></button></div><div className="log-tree-tabs"><button aria-pressed={!trash} onClick={() => setTrash(false)}>项目 <span>{projects.length}</span></button><button aria-pressed={trash} onClick={() => { setTrash(true); void run(refreshTrash); }}><Trash2 size={13}/>回收站 <span>{trashProjects.length + trashPages.filter(page => !trashProjects.some(project => project.id === page.projectId)).length}</span></button></div>
    <div className="log-tree-content">{trash ? <LogTrashPanel snapshot={snapshot} trash={trashSnapshot} busy={busy} onRestore={(kind, value) => void run(() => restore(kind, value))} onDelete={(kind, id) => void run(() => beginPurge(kind, id))}/> :
     <LogProjectTree projects={projects} snapshot={snapshot} current={current} selectedProject={selectedProject} collapsed={collapsed} busy={busy} draggingId={draggingId} dropTarget={dropTarget} rename={rename}
      onToggleProject={id => setCollapsed(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
      onOpenPage={id => void run(() => openPage(id))} onCreatePage={(id, folderId) => void run(() => createPage(id, folderId))} onCreateFolder={id => void run(() => createFolder(id))}
      onBeginRename={(kind, id) => beginRename(kind, id, 'tree')} onCommitRename={commitRename} onCancelRename={() => setRename(null)}
      onContext={showContext} onDragStart={dragStart} onDragEnd={dragEnd} onDragOver={dragOver} onDrop={drop}/>}</div>
    <div className="log-tree-footer">{trash ? '可恢复、永久删除或清空回收站' : '单击项目/文件夹折叠 · 双击改名 · 拖动整理'}<small>当前仓库 · {autoSaveEnabled ? '自动保存 60 秒' : '手动保存'}</small></div>
   </aside>
  </div>
  {context && <div className="log-context-menu" role="menu" style={{ left: context.x, top: context.y }} onClick={event => event.stopPropagation()}><button role="menuitem" onClick={() => { beginRename(context.kind, context.id, 'tree'); setContext(null); setTrash(false); }}>重命名</button>{context.kind === 'page' && <button role="menuitem" disabled={busy || resourceBusy} onClick={() => void run(() => exportPdf(context.id))}>导出为 PDF</button>}{context.kind === 'project' && <><button role="menuitem" onClick={() => void run(() => createPage(context.id))}>新建页面</button><button role="menuitem" onClick={() => void run(() => createFolder(context.id))}>新建文件夹</button></>}{context.kind === 'folder' && contextFolder && <button role="menuitem" onClick={() => void run(() => createPage(contextFolder.projectId, contextFolder.id))}>新建页面</button>}{context.kind === 'folder' && contextFolder && <button role="menuitem" className="danger" disabled={busy || resourceBusy} onClick={() => { setFolderDelete(contextFolder); setFolderDeleteError(''); setContext(null); }}>删除文件夹</button>}{context.kind !== 'folder' && <button role="menuitem" className="danger" onClick={() => void run(() => remove(context.kind === 'project' ? 'project' : 'page',context.id))}>移入回收站</button>}</div>}
  {dialog && <Modal title="新建日志项目" onClose={() => { if (!busy) setDialog(null); }}><form onSubmit={event => { event.preventDefault(); void run(submitName); }}><label className="field"><span>名称</span><input aria-label="日志名称" autoFocus value={dialog.title} maxLength={200} disabled={busy} placeholder="项目名称" onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); } }} onChange={event => setDialog({...dialog,title:event.target.value})}/></label>{error && <p className="error-text" role="alert">{error}</p>}<div className="modal-actions"><button type="button" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className="primary" type="submit" disabled={busy || !repo.ready || !dialog.title.trim()}>保存</button></div></form></Modal>}
  {folderDelete && <Modal title="删除文件夹" onClose={() => { if (!busy) { setFolderDelete(null); setFolderDeleteError(''); } }}><p>确定删除文件夹“{folderDelete.title}”？其中的页面将移回项目根目录，正文、附件和历史版本都会保留。</p>{folderDeleteError && <p className="error-text" role="alert">{folderDeleteError}</p>}<div className="modal-actions"><button disabled={busy} onClick={() => { setFolderDelete(null); setFolderDeleteError(''); }}>取消</button><button className="danger" disabled={busy} onClick={() => void run(confirmFolderDelete)}>删除文件夹并保留页面</button></div></Modal>}
  {purgeConfirmation && <TrashDeleteDialog confirmation={purgeConfirmation} busy={busy} error={purgeError} onCancel={() => { setPurgeConfirmation(null); setPurgeError(''); }} onConfirm={() => void run(confirmPurge)} onRefresh={() => void run(() => beginPurge(purgeConfirmation.kind, purgeConfirmation.input?.id))}/>}
  {unsavedDialog && <Modal title="当前页面尚未保存" onClose={() => { if (!unsavedSaving) void decideUnsaved('cancel'); }}><p>{unsavedDialog === 'external' ? '本次关闭或切换操作已取消。处理草稿后，请重新操作。' : '自动保存已关闭。切换前请选择如何处理当前草稿。'}</p><div className="modal-actions"><button disabled={unsavedSaving} onClick={() => void decideUnsaved('cancel')}>取消</button><button disabled={unsavedSaving} onClick={() => void decideUnsaved('discard')}>放弃草稿</button><button className="primary" disabled={unsavedSaving} onClick={() => void decideUnsaved('save')}>保存草稿</button></div></Modal>}
  {history && <Modal title="页面版本历史" onClose={() => { if (!busy) setHistory(null); }}><p className="log-history-hint">恢复会创建新版本，当前版本仍保留。</p><div className="log-history-list">{history.map(value => <div key={value.revision}><div><strong>版本 {value.revision} · {value.title}</strong><small>{formatDate(value.savedAt)}</small></div><button disabled={!lease?.owned || busy} onClick={() => void run(async () => { await flush(); const page=currentRef.current; if (!page) return; const saved=await logApi.restoreHistory({id:page.id,expectedRevision:page.revision,historyRevision:value.revision}); autosave.adopt(saved); setSelected(saved); setEditorDocument(parseStoredDocument(saved.documentJson,saved.schemaVersion) as JSONContent); setEditorVersion(version => version+1); setHistory(null); setSaveEvent({id:saved.id,status:'saved'}); await refresh(); })}>恢复</button></div>)}</div></Modal>}
  {discardConfirm && <Modal title="重新载入页面" onClose={() => setDiscardConfirm(false)}><p>重新载入会放弃当前未保存的草稿。可先复制草稿保留内容。</p><div className="modal-actions"><button onClick={() => void run(copyDraft)}>复制草稿</button><button disabled={busy} onClick={() => setDiscardConfirm(false)}>取消</button><button className="primary" disabled={busy} onClick={() => void run(reloadDiscardingDraft)}>放弃草稿并重新载入</button></div></Modal>}
 </div>;
}
export const DevLogsFeature = DevLogsPage;
