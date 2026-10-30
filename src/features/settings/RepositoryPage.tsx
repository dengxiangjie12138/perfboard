import {useEffect, useRef, useState} from 'react';
import {Database, FolderOpen, Archive, RefreshCw, Clock} from 'lucide-react';
import {api, errorMessage, native, pickDirectory, pickBackup} from '../../services/api';
import {flushAll} from '../../services/saveRegistry';
import {useSaveShortcut} from '../../services/useSaveShortcut';
import {useData} from '../../state/DataContext';
import {Heading} from '../../components/Common';
import {formatDisplayPath} from '../../utils/displayPath';
import {autoBackupSettingsEqual, backupResultLabel, defaultAutoBackupSettings, formatBytes, isDailyTime,
  settingsApi, type AutoBackupSettings, type AutoBackupStatus, type RepositoryStatistics} from './settingsApi';
import './settings.css';

export function RepositorySizeBadge({statistics, loading, error}: {
  statistics: RepositoryStatistics | null; loading: boolean; error: string | null;
}) {
  if (loading && !statistics) return <span className="muted" role="status">正在读取大小…</span>;
  if (error || !statistics) return <span className="tag ask" role="status">{error ? '大小读取失败' : '大小未读取'}</span>;
  return <span className="repository-byte-badge" data-testid="repository-db-size"
    title={'perfboard.sqlite3：' + statistics.databaseBytes.toLocaleString('zh-CN') + ' 字节；WAL 和附件另计'}>
    <Database size={13} aria-hidden="true"/> 数据库 {formatBytes(statistics.databaseBytes)}</span>;
}
export function AutomaticBackupForm({status, draft, loading, busy, error, onDraft, onChoose, onSave, onRetry}: {
  status: AutoBackupStatus | null; draft: AutoBackupSettings; loading: boolean; busy: boolean; error: string | null;
  onDraft: (settings: AutoBackupSettings) => void; onChoose: () => void; onSave: () => void | Promise<void>; onRetry: () => void;
}) {
  const changed = status !== null && !autoBackupSettingsEqual(draft, status.settings);
  const disabled = !native || loading || busy || !status;
  const invalid = !isDailyTime(draft.time) || (draft.enabled && !draft.parentDirectory?.trim());
  const result = status?.lastResult ?? null;
  const saveScope = useRef<HTMLElement | null>(null);
  useSaveShortcut(saveScope, onSave, {enabled: !disabled && changed && !invalid});
  return <section ref={saveScope} className="card section"><div className="card-title"><h2><Clock size={19}/> 自动备份</h2>
    <span className="tag">{loading ? '正在读取…' : status ? (status.settings.enabled ? '已开启' : '已关闭') : '未读取'}</span></div>
    <label className="setting-toggle"><input data-testid="auto-backup-enabled" type="checkbox"
      checked={draft.enabled} disabled={disabled} onChange={event => onDraft({...draft, enabled: event.currentTarget.checked})}/>
      <span>每天自动备份当前仓库</span></label>
    <div className="auto-backup-fields"><label className="field"><span>备份父目录</span><div className="input-action">
      <input data-testid="auto-backup-directory" readOnly value={draft.parentDirectory ? formatDisplayPath(draft.parentDirectory) : ''}
        placeholder="选择备份目录" disabled={disabled}/><button disabled={disabled} onClick={onChoose}><FolderOpen size={15}/> 选择目录</button>
    </div></label><label className="field"><span>每天执行时间（本机时间）</span><input data-testid="auto-backup-time" type="time"
      value={draft.time} step={60} disabled={disabled} onChange={event => onDraft({...draft, time: event.currentTarget.value})}/></label></div>
    <p className="help">默认关闭。应用或系统托盘运行时，每天到点备份一次；当天到点后启动会执行当天备份。关闭应用后不运行。</p>
    <p className="help">包含数据库和附件，只保留本功能创建的最近 5 份自动备份。手动备份保留原样。</p>
    {draft.enabled && !draft.parentDirectory && <p className="help">请先选择备份父目录。</p>}
    {!isDailyTime(draft.time) && <p className="error-text" role="alert">请选择有效的每天执行时间。</p>}
    <div className="button-row section"><button className="primary" title="保存自动备份设置 (Ctrl+S)" data-testid="auto-backup-save"
      disabled={disabled || !changed || invalid} onClick={onSave}>{busy ? '正在保存…' : '保存自动备份设置'}</button>
      <button className="small" disabled={!native || loading || busy} onClick={onRetry}><RefreshCw size={14}/> 读取状态</button></div>
    <p className="auto-backup-saved" role="status">{changed ? '有未保存的修改。' : status ? '当前设置已保存。' : '等待读取已保存的设置。'}
      {status && ' 已保存：' + (status.settings.enabled ? '每天 ' + status.settings.time : '关闭') +
        (status.settings.parentDirectory ? ' · ' + formatDisplayPath(status.settings.parentDirectory) : '')}</p>
    {error && <p className="error-text section" role="alert">{error}</p>}
    <div className="auto-backup-status"><p role="status">{backupResultLabel(result)}</p>
      {result && <p className="muted">{new Date(result.attemptedAt).toLocaleString('zh-CN')}</p>}
      {result?.backupPath && <p className="path-text">{formatDisplayPath(result.backupPath)}</p>}
      {result?.error && <p className="error-text" role="alert">{result.error}</p>}
      {result?.cleanupWarning && <p className="error-text" role="alert">备份保留检查：{result.cleanupWarning}</p>}
    </div></section>;
}
function AutomaticBackupSection() {
  const {notify} = useData();
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const [draft, setDraft] = useState<AutoBackupSettings>({...defaultAutoBackupSettings});
  const [loading, setLoading] = useState(native), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const ticket = useRef(0), saveLock = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!native) return;
    let disposed = false;
    const read = async (initial = false) => {
      if (saveLock.current) return;
      const current = ++ticket.current;
      try {
        const value = await settingsApi.autoBackupStatus();
        if (!disposed && current === ticket.current) {setStatus(value); if (initial) setDraft({...value.settings}); setError(null)}
      } catch (failure) {if (!disposed && current === ticket.current) setError(errorMessage(failure))}
      finally {if (!disposed && current === ticket.current) setLoading(false)}
    };
    void read(true);
    const interval = window.setInterval(() => void read(), 30000);
    return () => {disposed = true; mounted.current = false; ++ticket.current; window.clearInterval(interval)};
  }, []);
  async function retry() {
    const current = ++ticket.current;
    setLoading(true);
    try {
      const value = await settingsApi.autoBackupStatus();
      if (mounted.current && current === ticket.current) {setStatus(value); if (!status) setDraft({...value.settings}); setError(null)}
    } catch (failure) {if (mounted.current && current === ticket.current) setError(errorMessage(failure))}
    finally {if (mounted.current && current === ticket.current) setLoading(false)}
  }
  async function choose() {
    try {
      const directory = await pickDirectory('选择自动备份的父目录');
      if (directory && mounted.current) setDraft(current => ({...current, parentDirectory: directory}));
    } catch (failure) {if (mounted.current) setError(errorMessage(failure))}
  }
  async function save() {
    if (saveLock.current) return;
    saveLock.current = true; ++ticket.current; setBusy(true); setError(null);
    try {
      const value = await settingsApi.saveAutoBackup(draft);
      if (mounted.current) {setStatus(value); setDraft({...value.settings}); notify('自动备份设置已保存')}
    } catch (failure) {if (mounted.current) setError(errorMessage(failure))}
    finally {saveLock.current = false; if (mounted.current) setBusy(false)}
  }
  return <AutomaticBackupForm status={status} draft={draft} loading={loading} busy={busy} error={error}
    onDraft={setDraft} onChoose={() => void choose()} onSave={save} onRetry={() => void retry()}/>;
}

export function RepositoryPage() {
  const {repo, reloadStatus, notify, setError} = useData();
  const [path, setPath] = useState(''), [busy, setBusy] = useState(false), [backup, setBackup] = useState('');
  const [statistics, setStatistics] = useState<RepositoryStatistics | null>(null);
  const [statsLoading, setStatsLoading] = useState(false), [statsError, setStatsError] = useState<string | null>(null);
  const statsTicket = useRef(0);
  useEffect(() => {
    const current = ++statsTicket.current;
    setStatistics(null); setStatsError(null); setStatsLoading(repo.ready && native); setBackup('');
    if (repo.ready && native) {
      void settingsApi.repositoryStatistics().then(value => {if (current === statsTicket.current) setStatistics(value)})
        .catch(failure => {if (current === statsTicket.current) setStatsError(errorMessage(failure))})
        .finally(() => {if (current === statsTicket.current) setStatsLoading(false)});
    }
    return () => {++statsTicket.current};
  }, [repo.path, repo.ready]);
  async function readStatistics() {
    const current = ++statsTicket.current;
    setStatsLoading(true); setStatsError(null);
    try {const value = await settingsApi.repositoryStatistics(); if (current === statsTicket.current) setStatistics(value)}
    catch (failure) {if (current === statsTicket.current) {setStatistics(null); setStatsError(errorMessage(failure))}}
    finally {if (current === statsTicket.current) setStatsLoading(false)}
  }
  async function choose() {try {const selected = await pickDirectory(); if (selected) setPath(selected)} catch (failure) {setError(errorMessage(failure))}}
  async function connect(create: boolean) {
    if (!path.trim()) return;
    setBusy(true); setError(null);
    try {await flushAll(); await api.openRepo(path.trim(), create); await reloadStatus(); notify(create ? '仓库已初始化' : '已打开仓库')}
    catch (failure) {setError(errorMessage(failure))} finally {setBusy(false)}
  }
  async function runBackup() {
    setBusy(true);
    try {
      await flushAll(); const destination = await pickBackup();
      if (destination) {const result = await api.backup(destination); setBackup(result); notify('备份完成')}
    } catch (failure) {setError(errorMessage(failure))} finally {setBusy(false)}
  }
  return <><Heading eyebrow="LOCAL REPOSITORY" title={repo.ready ? '仓库与备份' : '选择你的本地仓库'}
    description="物料、笔记和附件保存在你选择的目录中。"/>
    <section className="card"><div className="card-title repository-current-title"><h2><Database size={19}/>
      {repo.ready ? '当前仓库' : repo.configured ? '恢复仓库连接' : '开始使用'}</h2>
      <div className="repository-heading-status">{repo.ready && <RepositorySizeBadge statistics={statistics} loading={statsLoading} error={statsError}/>}
        <span className={'tag ' + (repo.ready ? 'ok' : 'ask')}>{repo.ready ? '已连接' : '未连接'}</span></div></div>
      {repo.path && <p className="path-text">{formatDisplayPath(repo.path)}</p>}{repo.error && <p className="error-text">{repo.error}</p>}
      {repo.ready && <><dl className="repository-sizes">{statistics && <>
        <div><dt>WAL 日志</dt><dd>{formatBytes(statistics.walBytes)}</dd></div>
        <div><dt>附件文件</dt><dd>{formatBytes(statistics.attachmentsBytes)} · {statistics.attachmentFiles.toLocaleString('zh-CN')} 个</dd></div></>}</dl>
        <div className="repository-size-actions"><p className="help">数据库大小仅含 perfboard.sqlite3；WAL、附件单列，不含备份和缓存。</p>
          <button className="small" disabled={!native || statsLoading || busy} onClick={() => void readStatistics()}><RefreshCw size={14}/> 刷新大小</button></div>
        {statistics && <p className="help">读取时间：{new Date(statistics.measuredAt).toLocaleString('zh-CN')}</p>}
        {statsError && <p className="error-text" role="alert">{statsError}</p>}</>}
      {!native && <p className="muted">请在 Perfboard Windows 应用中选择仓库。浏览器仅用于界面预览。</p>}
      <label className="field section"><span>仓库目录</span><div className="input-action"><input data-testid="repo-path" value={path}
        onChange={event => setPath(event.target.value)} placeholder="选择现有仓库，或一个新的空目录"/>
        <button disabled={busy || !native} data-testid="repo-choose" onClick={() => void choose()}><FolderOpen size={16}/> 选择目录</button></div></label>
      <div className="button-row"><button className="primary" disabled={busy || !native || !path.trim()} data-testid="repo-open"
        onClick={() => void connect(false)}>打开现有仓库</button><button disabled={busy || !native || !path.trim()} data-testid="repo-create"
        onClick={() => void connect(true)}>初始化所选目录</button>{repo.configured && <button disabled={busy || !native}
        onClick={() => void reloadStatus()}><RefreshCw size={15}/> 重新连接</button>}</div>
      <p className="help">初始化需要明确确认你选择的目录。现有仓库会保留原有数据，无法连接时请重新指定位置。</p></section>
    {repo.ready && <><section className="card section"><div className="card-title"><h2><Archive size={19}/> 完整备份</h2></div>
      <p className="muted">复制数据库和附件到新的目录，用于迁移和恢复。</p><button disabled={busy || !native}
        onClick={() => void runBackup()}>选择位置并备份</button>{backup && <p className="path-text" role="status">已备份到 {formatDisplayPath(backup)}</p>}</section>
      <AutomaticBackupSection key={repo.path}/></>}</>;
}
