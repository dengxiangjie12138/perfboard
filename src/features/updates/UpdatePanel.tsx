import {useState} from 'react';
import {ArrowUpCircle, Download, RefreshCw} from 'lucide-react';
import {Modal} from '../../components/Common';
import {formatBytes} from '../settings/settingsApi';
import type {UpdateContextValue} from './UpdateContext';
import type {UpdateStatus} from './updateApi';

export function updateStatusLabel(status: UpdateStatus, loading: boolean): string {
  if (loading) return '正在读取更新设置…';
  if (status.phase === 'checking') return '正在检查更新…';
  if (status.phase === 'downloading') return '正在下载新版本…';
  if (status.phase === 'installing') return '正在保存并准备安装…';
  if (status.phase === 'ready') return '安装包已下载并通过验证';
  if (status.available) return '发现新版本 ' + status.available.version;
  if (status.error) return '更新检查未完成';
  return status.lastCheckedAt ? '已是最新版本' : '尚未检查更新';
}
function checkedTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', {hour12: false});
}
export function UpdatePanel({update}: {update: UpdateContextValue}) {
  const {status, loading, pendingAction, supported} = update;
  const [confirmInstall, setConfirmInstall] = useState(false);
  const running = ['checking', 'downloading', 'installing'].includes(status.phase);
  const busy = loading || !!pendingAction || running;
  const total = status.totalBytes !== null && status.totalBytes > 0 ? status.totalBytes : null;
  const progress = total === null ? undefined : Math.min(100, Math.max(0, status.downloadedBytes / total * 100));
  const ready = status.phase === 'ready';
  const portable = status.installation === 'portable';
  return <section className="card section update-panel" aria-labelledby="software-update-title">
    <div className="card-title update-heading"><h2 id="software-update-title"><RefreshCw size={19}/> 软件更新</h2>
      <span className="muted">当前版本 {status.currentVersion}</span></div>
    <div className="update-check-row">
      <p className="update-status" role="status" aria-live="polite">{updateStatusLabel(status, loading)}</p>
      <button className="small" data-testid="update-check" disabled={!supported || busy} onClick={() => void update.check()}>
        <RefreshCw size={15} className={status.phase === 'checking' ? 'update-spinning' : undefined}/>
        {status.phase === 'checking' || pendingAction === 'check' ? '正在检查…' : '检查更新'}</button>
    </div>
    <label className="setting-toggle"><input type="checkbox" data-testid="update-auto-check"
      checked={status.autoCheckEnabled} disabled={!supported || busy}
      onChange={event => void update.setAutoCheck(event.currentTarget.checked)}/>
      <span>自动检查更新</span></label>
    <p className="help">开启后，启动时及运行期间每 6 小时检查一次，托盘运行也生效。发现新版会在左侧“版本与说明”显示提示，由你决定下载和安装。</p>
    <div className="update-details"><span>更新来源：GitHub Releases</span>
      <span>{status.lastCheckedAt ? '上次检查：' + checkedTime(status.lastCheckedAt) : '上次检查：尚未检查'}</span></div>
    {status.available && <div className="update-available">
      <div className="update-version"><ArrowUpCircle size={18}/><strong>新版本 {status.available.version}</strong>
        {status.available.pubDate && <span className="muted">{checkedTime(status.available.pubDate)}</span>}</div>
      {status.available.notes && <p className="update-notes">{status.available.notes}</p>}
      {status.phase === 'downloading' && <div className="update-progress">
        <progress aria-label="新版本下载进度" max={100} value={progress}/>
        <span>{formatBytes(status.downloadedBytes)}{total !== null ? ' / ' + formatBytes(total) : ''}
          {progress !== undefined ? ' · ' + Math.floor(progress) + '%' : ''}</span>
      </div>}
      <div className="update-actions">
        {!ready && status.phase !== 'installing' && <button className="primary" data-testid="update-download"
          disabled={!supported || busy} onClick={() => void update.download()}><Download size={16}/>
          {status.phase === 'downloading' || pendingAction === 'download' ? '正在下载…' : '下载更新'}</button>}
        {ready && status.installation === 'installed' && <button className="primary" data-testid="update-install"
          disabled={!supported || busy} onClick={() => setConfirmInstall(true)}><ArrowUpCircle size={16}/> 保存并重启更新</button>}
        {ready && status.installation === 'portable' && <button className="primary" data-testid="update-open-installer"
          disabled={!supported || busy || !status.installerPath} onClick={() => setConfirmInstall(true)}><ArrowUpCircle size={16}/> 运行安装包</button>}
      </div>
      {status.installation === 'portable' && <p className="help">当前为便携运行。下载完成后，可保存并退出洞洞板，再运行安装包；安装版支持后续在应用内升级。</p>}
    </div>}
    {status.error && <p className="error-text update-error" role="alert">{status.error}</p>}
    {!supported && <p className="help">请在 Perfboard Windows 应用中检查和安装更新。</p>}
    {confirmInstall && <Modal title={portable ? '运行安装包' : '安装新版本'} onClose={() => {if (!busy) setConfirmInstall(false)}}>
      <p>{portable ? '将保存所有窗口中正在编辑的内容，然后退出洞洞板并运行安装包。请在安装器中继续完成安装，你的数据库和附件会继续保留。'
        : '将保存所有窗口中正在编辑的内容，然后退出并安装新版本。你的数据库和附件会继续保留。'}</p>
      <p className="help">如果取消保存或保存失败，本次更新会停止，编辑窗口保持打开。</p>
      <div className="update-actions"><button disabled={busy} onClick={() => setConfirmInstall(false)}>暂不安装</button>
        <button className="primary" disabled={busy} onClick={() => {void (portable ? update.openInstaller() : update.install()).then(() => setConfirmInstall(false))}}>
          {portable ? '保存并退出后运行' : '保存并安装'}</button></div>
    </Modal>}
  </section>;
}
