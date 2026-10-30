import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSaveShortcut } from '../../services/useSaveShortcut';
import { Heading } from '../../components/Common';
import { errorMessage, native, pickExternalToolExecutable, type ExternalTool, type ExternalToolInput } from '../../services/api';
import { useData } from '../../state/DataContext';
import { useExternalTools } from './ExternalToolsProvider';
import { selectedExternalTool } from './store';
import './external-tools.css';
const emptyDraft: ExternalToolInput = { name: '', path: '', description: '' };
export function ExternalToolsPage({ selectedId }: { selectedId?: string }) {
  const { repo } = useData();
  const { tools, loading, error, refresh, save, remove, launch } = useExternalTools();
  const [draft, setDraft] = useState<ExternalToolInput | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLFormElement | null>(null), saveLock = useRef(false);
  const selectedRef = useRef<HTMLLIElement | null>(null);
  const selected = selectedExternalTool(tools, selectedId);
  const previousRepository = useRef(repo.path);
  useEffect(() => { if (selected) selectedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [selected]);
  useEffect(() => { if (previousRepository.current !== repo.path || !repo.ready) { previousRepository.current = repo.path; setDraft(null); setNotice(''); } }, [repo.path, repo.ready]);
  const disabled = busy || loading || !native || !repo.ready;
  useSaveShortcut(editorRef, () => saveDraft(), {enabled: !!draft && !disabled, primary: true});
  async function choose() {
    try { const path = await pickExternalToolExecutable(); if (path) setDraft(value => value ? { ...value, path } : value); }
    catch (e) { setNotice(errorMessage(e)); }
  }
  async function submit(e: FormEvent) {e.preventDefault(); await saveDraft()}
  async function saveDraft() {
    if (!draft || disabled || saveLock.current || !editorRef.current?.reportValidity()) return;
    if (!draft.name.trim() || !draft.path.trim() || !draft.description.trim()) {setNotice('请填写工具名称、本机 EXE 路径和应用介绍。'); return}
    saveLock.current = true;
    setBusy(true); setNotice('');
    try { await save(draft); setDraft(null); setNotice('工具已保存到当前仓库，可按名称和应用介绍搜索。'); }
    catch (e) { setNotice(errorMessage(e)); }
    finally {saveLock.current = false; setBusy(false);}
  }
  async function start(tool: ExternalTool) {
    setBusy(true); setNotice('');
    try { await launch(tool.id); setNotice('已启动 ' + tool.name + '，请在独立程序窗口中使用。'); }
    catch (e) { setNotice(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function erase(tool: ExternalTool) {
    setBusy(true); setNotice('');
    try { await remove(tool.id); if (draft?.id === tool.id) setDraft(null); setNotice('已删除工具记录。'); }
    catch (e) { setNotice(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <div className="external-tools-page">
    <Heading eyebrow="常用小工具" title="外部工具" description="管理本机应用；名称、路径和应用介绍随当前仓库备份与迁移。" action={<button className="primary" data-testid="external-tools-add" disabled={disabled} onClick={() => { setDraft({ ...emptyDraft }); setNotice(''); }}>添加工具</button>} />
    {!repo.ready && <div className="empty-state" data-testid="external-tools-no-warehouse" role="status">请先打开数据仓库，再查看和管理外部工具。</div>}
    {repo.ready && <div className="external-tools-toolbar"><span className="muted">{tools.length} 个工具 · 保存在当前数据仓库</span><button disabled={disabled} onClick={() => void refresh().catch(e => setNotice(errorMessage(e)))}>刷新状态</button></div>}
    {!native && <p className="help">请在 Perfboard Windows 应用中管理和启动本机程序。</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {notice && <p className="external-tools-notice" role="status">{notice}</p>}
    {repo.ready && selectedId && !loading && !selected && <p className="error-text" data-testid="external-tools-missing" role="status">所选工具在当前仓库中不存在，请重新选择。</p>}
    {repo.ready && draft && <form ref={editorRef} className="external-tools-editor" onSubmit={e => void submit(e)}>
      <h2>{draft.id ? '编辑工具' : '添加工具'}</h2>
      <label>工具名称<input data-testid="external-tools-name" autoFocus required maxLength={100} value={draft.name} disabled={disabled} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>本机 EXE 路径<div className="external-tools-path-row"><input data-testid="external-tools-path" required value={draft.path} disabled={disabled} onChange={e => setDraft({ ...draft, path: e.target.value })} placeholder="选择程序安装目录中的 EXE 文件" /><button type="button" disabled={disabled} onClick={() => void choose()}>重新选择 EXE</button></div></label>
      <label>应用介绍 <span className="muted">用于搜索</span><textarea data-testid="external-tools-description" required maxLength={4000} rows={3} value={draft.description} disabled={disabled} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="例如：串口调试、数据收发或硬件通信测试" /></label>
      <p className="help">迁移后程序路径可能失效，可在此重新选择。仅点击“启动”才会运行程序。</p>
      <div className="button-row"><button className="primary" title="保存工具 (Ctrl+S)" disabled={disabled || !draft.name.trim() || !draft.description.trim() || !draft.path.trim()} type="submit">保存工具</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>取消</button></div>
    </form>}
    {repo.ready && !loading && !tools.length && !error && <div className="empty-state">还没有外部工具。添加本机应用后，可通过搜索找到并启动。</div>}
    {repo.ready && <ul className="external-tools-list" data-testid="external-tools-list">
      {tools.map(tool => <li key={tool.id} ref={tool.id === selectedId ? selectedRef : undefined} className={tool.id === selectedId ? 'selected' : ''} data-tool-id={tool.id}>
        <div className="external-tools-info"><h2>{tool.name}</h2><p>{tool.description}</p><code>{tool.path}</code><p className={tool.available ? 'help' : 'error-text'} data-testid={'external-tool-status-' + tool.id}>{tool.status}</p></div>
        <div className="external-tools-actions"><button className="primary" disabled={disabled || !tool.available} onClick={() => void start(tool)}>启动</button><button disabled={disabled} onClick={() => { setDraft({ id: tool.id, name: tool.name, path: tool.path, description: tool.description }); setNotice(''); }}>{tool.available ? '编辑' : '修复路径'}</button><button className="danger" disabled={disabled} onClick={() => void erase(tool)}>删除记录</button></div>
      </li>)}
    </ul>}
  </div>;
}
