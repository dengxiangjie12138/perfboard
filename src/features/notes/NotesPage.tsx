import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Excalidraw, MainMenu, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawProps, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { Plus, Search, FileText, Trash2, Save, Download, Upload, RefreshCw } from 'lucide-react';
import { Modal } from '../../components/Common';
import { useData } from '../../state/DataContext';
import { api, errorMessage } from '../../services/api';
import { KeyedAutosave, type SaveEvent } from '../../services/autosave';
import { registerFlush } from '../../services/saveRegistry';
import { useSaveShortcut } from '../../services/useSaveShortcut';
import { acquireEditLease, releaseEditLease, type EditLeaseStatus } from '../../services/editLease';
import type { Note, NoteCategory, NoteInput } from '../../types';
import { EMPTY_SCENE, sanitizeScene, restoreStoredScene, sceneSearchText } from './scene';
import { useViewMemory } from '../../services/useViewMemory';
import { memoryChoice, memoryObject, readViewMemory, writeViewMemory } from '../../services/viewMemory';
import '@excalidraw/excalidraw/index.css';
import './notes.css';
export const NOTE_CATEGORIES: NoteCategory[] = ['硬件错题本', '软件错题本', '随笔', '学习笔记'];
export interface NotesPageProps { category?: NoteCategory; initialNoteId?: string }
const statusText = { idle: '已载入', pending: '等待保存…', saving: '正在保存…', saved: '已保存', error: '保存失败，草稿仍在当前页面' };
function useCanvasTheme(): 'light' | 'dark' {
  const read = () => ['dark', 'codex'].includes(document.documentElement.dataset.theme ?? document.body.dataset.theme ?? '') ? 'dark' : 'light';
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => { const observer = new MutationObserver(() => setTheme(read())); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] }); return () => observer.disconnect(); }, []);
  return theme;
}
function NoteCanvas({ initialData, onScene, theme, onError, readOnly, noteId, repository }: { initialData: ExcalidrawInitialDataState; onScene: (json: string, searchText: string, hydrated: boolean) => void; theme: 'light' | 'dark'; onError: (message: string) => void; readOnly: boolean; noteId: string; repository: string | null }) {
  const ready = useRef(false);
  const expectedIds = useRef(new Set((initialData.elements ?? []).filter(element => !element.isDeleted).map(element => element.id)));
  const lastJson = useRef('');
  const lastView = useRef('');
  const [canvasInitial] = useState(() => {
    const fallback = { x: initialData.appState?.scrollX ?? 0, y: initialData.appState?.scrollY ?? 0, zoom: initialData.appState?.zoom?.value ?? 1 };
    const view = readViewMemory('note-canvas-' + noteId, fallback, repository, value => memoryObject(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y) && typeof value.zoom === 'number' && value.zoom >= .1 && value.zoom <= 30 ? { x: value.x, y: value.y, zoom: value.zoom as typeof fallback.zoom } : undefined);
    return { ...initialData, appState: { ...initialData.appState, scrollX: view.x, scrollY: view.y, zoom: { value: view.zoom } as NonNullable<NonNullable<ExcalidrawInitialDataState['appState']>['zoom']> } };
  });
  const onChange: NonNullable<ExcalidrawProps['onChange']> = (elements, appState, files) => {
    if (!ready.current && (appState.isLoading || [...expectedIds.current].some(id => !elements.some(element => element.id === id)))) return;
    const view = { x: appState.scrollX, y: appState.scrollY, zoom: appState.zoom.value };
    const viewJson = JSON.stringify(view);
    if (lastView.current !== viewJson) { lastView.current = viewJson; writeViewMemory('note-canvas-' + noteId, view, repository); }
    const localElements = elements.filter(element => element.type !== 'embeddable' && element.type !== 'iframe');
    const json = serializeAsJSON(localElements, appState, files, 'local');
    if (!ready.current) { ready.current = true; lastJson.current = json; onScene(json, sceneSearchText(localElements), true); return; }
    if (json !== lastJson.current) { lastJson.current = json; onScene(json, sceneSearchText(localElements), false); }
  };
  return <Excalidraw initialData={canvasInitial} viewModeEnabled={readOnly} onChange={onChange} theme={theme} langCode="zh-CN" aiEnabled={false} validateEmbeddable={false} renderEmbeddable={() => null} handleKeyboardGlobally={false} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, export: { saveFileToDisk: true } } }} onLinkOpen={(element, event) => { event.preventDefault(); if (element.link && /^https?:\/\//i.test(element.link)) void api.openUrl(element.link).catch(failure => onError('无法打开链接：' + errorMessage(failure))); }}><MainMenu><MainMenu.DefaultItems.Export /><MainMenu.DefaultItems.SaveAsImage />{!readOnly && <><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ChangeCanvasBackground /></>}</MainMenu></Excalidraw>;
}
export function NotesPage({ category: initialCategory, initialNoteId }: NotesPageProps) {
  const { data, repo, refresh, notify } = useData();
  const theme = useCanvasTheme();
  const focused = Boolean(initialCategory);
  const compact = focused;
  const [opening, setOpening] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const viewName = 'notes-' + (initialCategory ?? 'overview');
  const [category, setCategory] = useViewMemory<NoteCategory | '全部'>(viewName + '-category', initialCategory ?? '全部', repo.path, memoryChoice(['全部', ...NOTE_CATEGORIES]));
  const [query, setQuery] = useViewMemory(viewName + '-query', '', repo.path);
  const [rememberedNoteId, setRememberedNoteId] = useViewMemory(viewName + '-selected', '', repo.path);
  const [note, setNote] = useState<Note | null>(null);
  const [scene, setScene] = useState<ExcalidrawInitialDataState | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lease, setLease] = useState<EditLeaseStatus | null>(null);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [blockedNote, setBlockedNote] = useState<{ note: Note; reason: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ scene: ExcalidrawInitialDataState; removed: number; targetId: string } | null>(null);
  const [saveEvent, setSaveEvent] = useState<SaveEvent>({ id: '', status: 'idle' });
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});
  const current = useRef<NoteInput | null>(null);
  const noteId = useRef<string | null>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  const leaseRef = useRef<EditLeaseStatus | null>(null);
  const heldResources = useRef(new Set<string>());
  const revisions = useRef(new Map<string, number>());
  const editable = Boolean(note && lease?.owned && lease.resource === `note:${note.id}`);
  const saveScope = useRef<HTMLDivElement>(null), createScope = useRef<HTMLFormElement>(null), metadataScope = useRef<HTMLDivElement>(null);
  const pendingOperations = useRef(new Set<Promise<void>>());
  const operationQueue = useRef(Promise.resolve());
  const track = useCallback((action: () => Promise<void>) => {
    const task = operationQueue.current.then(action);
    operationQueue.current = task.catch(() => {});
    pendingOperations.current.add(task);
    void task.finally(() => pendingOperations.current.delete(task)).catch(failure => setError(errorMessage(failure)));
    return task;
  }, []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const [autosave] = useState(() => new KeyedAutosave<NoteInput>(async value => {
    const saved = await api.saveNote({ ...value, expectedRevision: revisions.current.get(value.id) ?? value.expectedRevision });
    revisions.current.set(saved.id, saved.revision ?? 0);
    if (current.current?.id === saved.id) current.current = { ...current.current, expectedRevision: saved.revision };
    try { await refreshRef.current(); setRefreshError(''); }
    catch (failure) { setRefreshError('笔记已保存，但列表更新失败：' + errorMessage(failure)); }
  }, event => { if (event.id === noteId.current) setSaveEvent(event); }));
  const releaseHeld = useCallback(async (resource: string) => {
    if (!heldResources.current.has(resource)) return;
    await releaseEditLease(resource);
    heldResources.current.delete(resource);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let unregister = () => {};
    const drain = async () => {
      while (pendingOperations.current.size) await Promise.all([...pendingOperations.current]);
      await autosave.flush();
      if (!mounted.current) {
        for (const resource of [...heldResources.current]) await releaseHeld(resource);
        unregister();
      }
    };
    unregister = registerFlush(drain);
    return () => {
      mounted.current = false;
      // A failed save retains the draft's saver and lease for a later retry.
      // Normal navigation runs the save barrier before unmounting this editor.
      void drain().then(unregister).catch(() => {});
    };
  }, [autosave, releaseHeld]);
  const retryRefresh = useCallback(async () => { try { await refresh(); setRefreshError(''); } catch (failure) { setRefreshError('列表更新失败：' + errorMessage(failure)); } }, [refresh]);
  const flush = useCallback(async () => { try { await autosave.flush(); setError(''); return true; } catch (failure) { setError(`保存失败：${errorMessage(failure)}。请重试保存后再离开。`); return false; } }, [autosave]);
  const finishMetadata = () => track(async () => { if (await flush()) setEditingMetadata(false); });
  useSaveShortcut(saveScope, flush, {primary: true, enabled: editable && loaded && !busy});
  useSaveShortcut(createScope, () => {if (createScope.current?.reportValidity()) return track(createNote);}, {enabled: repo.ready && !busy});
  useSaveShortcut(metadataScope, finishMetadata, {enabled: editable && loaded && !busy});
  const openNote = useCallback(async (id: string, retryEditing = false) => {
    if (id === noteId.current && !retryEditing) return;
    const ticket = ++request.current;
    const resource = `note:${id}`;
    const previouslyHeld = heldResources.current.has(resource);
    let acquired = false;
    let selected = false;
    setBusy(true);
    if (!await flush()) { if (ticket === request.current) setBusy(false); return; }
    if (ticket !== request.current || !mounted.current) return;
    try {
      const nextLease = await acquireEditLease(resource);
      if (nextLease.owned) { heldResources.current.add(resource); acquired = true; }
      if (ticket !== request.current || !mounted.current) return;
      // Re-acquiring a released note loads its latest saved scene and discards
      // clean autosave-cache values that may predate another window's edits.
      const fetched = await api.getNote(id);
      if (ticket !== request.current || !mounted.current) return;
      if (initialCategory && fetched.category !== initialCategory) throw new Error('该笔记不属于当前分类，请从对应分类或笔记概览打开。');
      let restored: ExcalidrawInitialDataState;
      try { restored = restoreStoredScene(fetched.sceneJson); }
      catch (failure) {
        const previous = leaseRef.current;
        if (previous?.owned && previous.resource !== resource) await releaseHeld(previous.resource);
        current.current = null; noteId.current = null; leaseRef.current = null;
        setLease(null); setNote(null); setScene(null); setLoaded(false); setPendingImport(null);
        setBlockedNote({ note: fetched, reason: errorMessage(failure) + ' 原始数据库内容未修改。' }); setError(''); return;
      }
      const previous = leaseRef.current;
      if (previous?.owned && previous.resource !== resource) await releaseHeld(previous.resource);
      if (ticket !== request.current || !mounted.current) return;
      current.current = { id: fetched.id, title: fetched.title, category: fetched.category, searchText: fetched.searchText, sceneJson: fetched.sceneJson, expectedRevision: fetched.revision };
      revisions.current.set(id, fetched.revision ?? 0);
      noteId.current = id; leaseRef.current = nextLease; selected = true;
      setRememberedNoteId(id);
      setLease(nextLease); setNote(fetched); setScene(restored); setLoaded(false); setEditorVersion(value => value + 1);
      setBlockedNote(null); setPendingImport(null); setDeleteConfirm(false); setSaveEvent({ id, status: 'idle' }); setError('');
      setDraftTitles(value => { const next = { ...value }; delete next[id]; return next; });
    } catch (failure) { setError(errorMessage(failure)); }
    finally {
      if (acquired && !selected && !previouslyHeld && leaseRef.current?.resource !== resource) {
        try { await releaseHeld(resource); } catch (failure) { setError(errorMessage(failure)); }
      }
      if (ticket === request.current) setBusy(false);
    }
  }, [flush, initialCategory, releaseHeld, setRememberedNoteId]);
  const openedInitial = useRef(false);
  useEffect(() => {
    if (!repo.ready || openedInitial.current) return;
    openedInitial.current = true;
    const id = initialNoteId || rememberedNoteId;
    if (!id) return;
    if (!initialNoteId && !data.notes.some(value => value.id === id && (category === '全部' || value.category === category))) { setRememberedNoteId(''); return; }
    void track(() => openNote(id));
  }, [initialNoteId, rememberedNoteId, repo.ready, data.notes, category, openNote, track, setRememberedNoteId]);
  useEffect(() => { if (initialCategory) setCategory(initialCategory); }, [initialCategory]);
  const notes = useMemo(() => data.notes.filter(value => (category === '全部' || value.category === category) && `${draftTitles[value.id] ?? value.title}\n${value.searchText}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data.notes, category, query, draftTitles]);
  function changeMetadata(update: Partial<Pick<NoteInput, 'title' | 'category'>>) {
    if (!current.current || !leaseRef.current?.owned || !loaded || busy) return;
    current.current = { ...current.current, ...update };
    setNote(value => value ? { ...value, ...update } : value);
    if (update.title !== undefined) setDraftTitles(value => ({ ...value, [current.current!.id]: update.title! }));
    autosave.queue({ ...current.current, title: current.current.title.trim() || '未命名笔记' });
  }
  async function clearSelection() {
    if (leaseRef.current?.owned) await releaseHeld(leaseRef.current.resource);
    ++request.current;
    current.current = null; noteId.current = null; leaseRef.current = null; setLease(null);
    setRememberedNoteId('');
    setNote(null); setScene(null); setLoaded(false); setBlockedNote(null); setPendingImport(null); setDeleteConfirm(false); setEditingMetadata(false);
  }
  async function switchCategory(next: NoteCategory | '全部') {
    if (busy || next === category) return;
    setBusy(true);
    try {
      if (!await flush()) return;
      if (next !== '全部' && current.current?.category !== next) await clearSelection();
      setCategory(next);
    } finally { setBusy(false); }
  }
  async function moveNote(next: NoteCategory) {
    if (!current.current || !leaseRef.current?.owned || !loaded || busy || current.current.category === next) return;
    changeMetadata({ category: next });
    setBusy(true);
    try {
      if (!await flush()) return;
      if (category !== '全部' && next !== category) await clearSelection();
    } finally { setBusy(false); }
  }
  function onScene(id: string, json: string, searchText: string, hydrated: boolean) {
    if (!current.current || current.current.id !== id) return;
    if (hydrated) { setLoaded(true); return; }
    if (!leaseRef.current?.owned || busy) return;
    current.current = { ...current.current, sceneJson: json, searchText };
    autosave.queue({ ...current.current, title: current.current.title.trim() || '未命名笔记' });
  }
  async function createNote() {
    if (!repo.ready || busy) return;
    setBusy(true);
    if (!await flush()) { setBusy(false); return; }
    const id = crypto.randomUUID(), resource = `note:${id}`;
    try {
      const createdLease = await acquireEditLease(resource);
      if (!createdLease.owned) throw new Error('新笔记已在另一个窗口编辑，请重试创建。');
      heldResources.current.add(resource);
      const created = await api.saveNote({ id, title: newTitle.trim() || '未命名笔记', category: category === '全部' ? '随笔' : category, searchText: '', sceneJson: EMPTY_SCENE, expectedRevision: 0 });
      revisions.current.set(id, created.revision ?? 0);
      await retryRefresh();
      setCreating(false); setNewTitle('');
      await openNote(created.id);
    } catch (failure) { setError(errorMessage(failure)); }
    finally {
      if (leaseRef.current?.resource !== resource) {
        try { await releaseHeld(resource); } catch (failure) { setError(errorMessage(failure)); }
      }
      setBusy(false);
    }
  }
  async function deleteNote() {
    if (!note || !editable || busy) return;
    setBusy(true);
    if (!await flush()) { setBusy(false); return; }
    try { await api.deleteNote(note.id); await clearSelection(); await retryRefresh(); notify('笔记已删除'); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  function downloadScene(json: string, title: string) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${(title || '未命名笔记').replace(/[<>:"/\\|?*]/g, '_')}.excalidraw`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportNote() { if (current.current?.sceneJson) downloadScene(current.current.sceneJson, current.current.title); }
  async function applyImportedScene(imported: ExcalidrawInitialDataState, targetId: string) {
    if (!current.current || !leaseRef.current?.owned || current.current.id !== targetId) return;
    setBusy(true);
    try {
      if (!await flush() || current.current?.id !== targetId) return;
      setLoaded(false); setScene(imported); setEditorVersion(value => value + 1); setPendingImport(null);
      const json = JSON.stringify({ type: 'excalidraw', version: 2, source: 'Perfboard', ...imported });
      current.current = { ...current.current, sceneJson: json, searchText: sceneSearchText(imported.elements ?? []) };
      autosave.queue({ ...current.current });
    } finally { setBusy(false); }
  }
  async function importScene(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !current.current || !leaseRef.current?.owned || !loaded || busy) return;
    const targetId = current.current.id;
    setBusy(true);
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error('画布文件超过 80 MB，请先缩减图片大小。');
      const restored = sanitizeScene(await file.text());
      if (current.current?.id !== targetId) return;
      if (restored.removed) { setPendingImport({ ...restored, targetId }); return; }
      await applyImportedScene(restored.scene, targetId);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  const compactToolbar = <div className="notes-toolbar" role="toolbar" aria-label={`${category}笔记操作`} data-testid="note-compact-toolbar"><div><button data-testid="note-edit-metadata" aria-label="编辑笔记标题和分类" title={note ? `${note.title}（${note.category}）` : category} disabled={!note || !editable || !loaded || busy} onClick={() => setEditingMetadata(true)}><FileText size={15} /><span className="notes-compact-title">{note?.title ?? category}</span></button><span role="status" className={saveEvent.status === 'error' ? 'notes-save-error' : ''}>{!note ? `选择或新建${category}` : !loaded ? '载入画布…' : !editable ? '只读 · 另一个窗口正在编辑' : statusText[saveEvent.status]}{saveEvent.status === 'error' && `：${errorMessage(saveEvent.error)}`}</span></div><div><button data-testid="note-new" disabled={!repo.ready || busy} onClick={() => setCreating(true)}><Plus size={15} />新建笔记</button><button data-testid="note-open" disabled={!repo.ready || busy} onClick={() => setOpening(true)}><FileText size={15} />打开笔记</button><button data-testid="note-save-metadata" title="保存笔记 (Ctrl+S)" disabled={!editable || !loaded || busy} onClick={() => void flush()}><Save size={15} />{saveEvent.status === 'error' ? '重试保存' : '保存'}</button><label className={`notes-import ${!editable || !loaded || busy ? 'disabled' : ''}`}><Upload size={15} />导入<input type="file" accept=".excalidraw,.json" aria-label="导入本地 Excalidraw 画布" disabled={!editable || !loaded || busy} onChange={event => void track(() => importScene(event))} /></label><button disabled={!loaded || busy} onClick={exportNote}><Download size={15} />导出</button><button title="删除笔记" aria-label="删除笔记" disabled={busy || !note || !editable} onClick={() => setDeleteConfirm(true)}><Trash2 size={15} /></button></div></div>;
  return <div ref={saveScope} className={`notes-page ${compact ? 'notes-page-focused notes-page-compact' : ''}`}>{!focused && <header className="notes-heading"><div><div className="eyebrow">IDEAS & NOTES</div><h1>想法落在纸上。</h1><p>画下电路、记录问题，让下一次动手更有把握。</p></div><span className="notes-count">{data.notes.length} 篇笔记</span></header>}<div className="notes-layout">{!focused && <aside className="notes-sidebar card"><div className="notes-list-heading"><h2>笔记本</h2><button className="notes-icon" title="新建笔记" aria-label="新建笔记" data-testid="note-new" disabled={!repo.ready || busy} onClick={() => setCreating(value => !value)}><Plus size={18} /></button></div><label className="notes-search"><Search size={16} /><input aria-label="搜索笔记标题和画布文字" placeholder="搜索标题或画布文字" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="notes-categories" aria-label="笔记分类">{(['全部', ...NOTE_CATEGORIES] as const).map(value => <button key={value} aria-pressed={category === value} disabled={busy} onClick={() => void track(() => switchCategory(value))}>{value}</button>)}</div>{creating && <form ref={createScope} className="notes-new" onSubmit={event => { event.preventDefault(); void track(createNote); }}><input autoFocus aria-label="新笔记标题" placeholder="新笔记标题" value={newTitle} maxLength={160} onChange={event => setNewTitle(event.target.value)} /><button className="primary" disabled={busy || !repo.ready} type="submit" title="创建并保存笔记 (Ctrl+S)">创建{category === '全部' ? '随笔' : category}</button></form>}<div className="notes-list">{notes.map(value => <button className={`notes-item ${note?.id === value.id ? 'active' : ''}`} key={value.id} data-testid="note-list-row" data-note-id={value.id} disabled={busy} onClick={() => void track(() => openNote(value.id))}><FileText size={16} /><span><strong>{draftTitles[value.id] ?? value.title}</strong><small>{value.category} · {new Date(value.updatedAt).toLocaleDateString('zh-CN')}</small></span></button>)}{notes.length === 0 && <div className="notes-list-empty">{query ? '没有找到匹配的笔记' : '这里还没有笔记'}</div>}</div><div className="notes-local">保存在当前本地仓库</div></aside>}<section className="notes-workspace card">{refreshError && <div className="notes-error" role="status">{refreshError}<button onClick={() => void retryRefresh()}>刷新列表</button></div>}{error && <div className="notes-error" role="alert">{error}<button onClick={() => void flush()}>重试保存</button></div>}{compact && compactToolbar}{note && lease && !editable && <div className="notes-lease-conflict" role="status" data-testid="note-lease-conflict"><span>这篇笔记正在另一个窗口编辑，当前窗口为只读。请在原窗口保存并切换笔记或关闭窗口，再重试编辑。</span><button disabled={busy} onClick={() => void track(() => openNote(note.id, true))}>重试编辑</button></div>}{note && scene ? <>{!compact && <div className="notes-editor-heading"><input aria-label="笔记标题" data-testid="note-title" maxLength={160} value={note.title} disabled={!editable || !loaded || busy} onChange={event => changeMetadata({ title: event.target.value })} /><select aria-label="当前笔记分类" disabled={!editable || !loaded || busy} value={note.category} onChange={event => { const next = event.currentTarget.value as NoteCategory; void track(() => moveNote(next)); }}>{NOTE_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></div>}{!compact && <div className="notes-toolbar"><span role="status" className={saveEvent.status === 'error' ? 'notes-save-error' : ''}>{!loaded ? '载入画布…' : !editable ? '只读 · 另一个窗口正在编辑' : statusText[saveEvent.status]}{saveEvent.status === 'error' && `：${errorMessage(saveEvent.error)}`}</span><div><button data-testid="note-save-metadata" title="保存笔记 (Ctrl+S)" disabled={!editable || !loaded || busy} onClick={() => void flush()}><Save size={15} />{saveEvent.status === 'error' ? '重试保存' : '保存'}</button><label className={`notes-import ${!editable || !loaded || busy ? 'disabled' : ''}`}><Upload size={15} />导入<input type="file" accept=".excalidraw,.json" aria-label="导入本地 Excalidraw 画布" disabled={!editable || !loaded || busy} onChange={event => void track(() => importScene(event))} /></label><button disabled={!loaded || busy} onClick={exportNote}><Download size={15} />导出</button><button title="删除笔记" aria-label="删除笔记" disabled={busy || !editable} onClick={() => setDeleteConfirm(true)}><Trash2 size={15} /></button></div></div>}{pendingImport && <div className="notes-delete-confirm" role="alert" data-testid="note-import-filter-confirm"><span>导入文件含 {pendingImport.removed} 个外部嵌入或不安全图片，已过滤。确认后将用过滤后的画布替换当前笔记。</span><button disabled={busy} onClick={() => setPendingImport(null)}>取消导入</button><button disabled={busy} onClick={() => void track(() => applyImportedScene(pendingImport.scene, pendingImport.targetId))}>确认导入过滤后的画布</button></div>}{deleteConfirm && <div className="notes-delete-confirm" role="alert"><span>删除“{note.title}”？此操作无法撤销。</span><button onClick={() => setDeleteConfirm(false)} disabled={busy}>取消</button><button className="danger" onClick={() => void track(deleteNote)} disabled={busy}>确认删除</button></div>}<div className={`notes-canvas ${busy ? 'notes-canvas-busy' : ''}`}><NoteCanvas key={`${note.id}:${editorVersion}`} initialData={scene} noteId={note.id} repository={repo.path} onScene={(json, searchText, hydrated) => onScene(note.id, json, searchText, hydrated)} theme={theme} onError={setError} readOnly={!editable} /></div></> : blockedNote ? <div className="notes-empty" role="alert" data-testid="note-restore-blocked"><div className="notes-empty-icon"><FileText size={34} /></div><h2>无法完整恢复“{blockedNote.note.title}”</h2><p>{blockedNote.reason}</p><button className="primary" data-testid="note-export-original" onClick={() => downloadScene(blockedNote.note.sceneJson, blockedNote.note.title + "-原始备份")}><Download size={16} />导出原始 JSON</button></div> : <div className="notes-empty"><div className="notes-empty-icon"><FileText size={34} /></div><h2>{busy ? '正在载入笔记…' : '从一个想法开始'}</h2><p>{repo.ready ? (focused ? '打开当前分类的笔记，或新建一张自由画布。' : '选择左侧笔记，或新建一张自由画布。') : '先打开本地仓库，再创建你的第一篇笔记。'}</p><button className="primary" disabled={!repo.ready || busy} onClick={() => setCreating(true)}>{busy ? <RefreshCw size={16} /> : <Plus size={16} />}新建笔记</button></div>}</section></div>{compact && creating && <Modal title={`新建${category}`} onClose={() => { if (!busy) setCreating(false); }}><form ref={createScope} onSubmit={event => { event.preventDefault(); void track(createNote); }}><label className="field"><span>标题</span><input autoFocus aria-label="新笔记标题" placeholder="新笔记标题" value={newTitle} maxLength={160} disabled={busy} onChange={event => setNewTitle(event.currentTarget.value)} /></label>{error && <p className="error-text" role="alert">{error}</p>}<div className="modal-actions"><button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button><button className="primary" disabled={busy || !repo.ready} type="submit" title="创建并保存笔记 (Ctrl+S)">创建{category}</button></div></form></Modal>}{compact && opening && <Modal title={`打开${category}`} onClose={() => { if (!busy) setOpening(false); }}><label className="field"><span>当前分类笔记</span><select aria-label="切换当前分类笔记" value={note?.id ?? ''} disabled={busy || !repo.ready} onChange={event => { const id = event.currentTarget.value; if (id) void track(async () => { await openNote(id); if (noteId.current === id) setOpening(false); }); }}><option value="" disabled>{notes.length ? '选择笔记' : '当前分类暂无笔记'}</option>{notes.map(value => <option key={value.id} value={value.id}>{draftTitles[value.id] ?? value.title}</option>)}</select></label>{error && <p className="error-text" role="alert">{error}</p>}<div className="modal-actions"><button disabled={busy} onClick={() => setOpening(false)}>关闭</button></div></Modal>}{compact && editingMetadata && note && <Modal title="编辑笔记" onClose={() => { if (!busy) void finishMetadata(); }}><div ref={metadataScope}><label className="field"><span>标题</span><input autoFocus aria-label="笔记标题" data-testid="note-title" maxLength={160} value={note.title} disabled={!editable || !loaded || busy} onChange={event => changeMetadata({ title: event.currentTarget.value })} /></label><label className="field"><span>分类</span><select aria-label="当前笔记分类" disabled={!editable || !loaded || busy} value={note.category} onChange={event => { const next = event.currentTarget.value as NoteCategory; void track(() => moveNote(next)); }}>{NOTE_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label>{error && <p className="error-text" role="alert">{error}</p>}<div className="modal-actions"><button disabled={busy} title="保存笔记 (Ctrl+S)" onClick={() => void finishMetadata()}>完成</button></div></div></Modal>}</div>;
}
