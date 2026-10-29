import {useMemo, useState} from 'react';
import {Download, ExternalLink, List, RefreshCw} from 'lucide-react';
import type {UpdateContextValue} from './UpdateContext';
import {updateSourceLabel} from './updateApi';
import {compareReleaseVersions, orderedReleaseVersions, releaseVersionLabel} from './releaseVersions';

export function ReleaseVersionPicker({update}: {update: UpdateContextValue}) {
  const {status, versionsLoading, versionsError, supported} = update;
  const versions = useMemo(() => orderedReleaseVersions(update.versions ?? []), [update.versions]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const selected = versions.find(version => version.tag === selectedTag)
    ?? versions.find(version => version.version === status.target?.version) ?? versions[0];
  const busy = update.loading || !!update.pendingAction || ['checking', 'downloading', 'installing'].includes(status.phase);
  const relation = selected ? compareReleaseVersions(selected.version, status.currentVersion) : null;
  const current = relation === 0;
  const rollback = relation !== null && relation < 0;
  return <section className="release-version-picker" aria-labelledby="release-version-title">
    <div className="release-version-heading"><h3 id="release-version-title"><List size={17}/> 选择版本下载</h3>
      <button className="small" data-testid="update-load-versions" disabled={!supported || versionsLoading || busy}
        onClick={() => void update.listVersions()}><RefreshCw size={14}/>
        {versionsLoading ? '正在载入…' : update.versions === null ? '载入版本列表' : '刷新版本列表'}</button></div>
    {update.versions === null && !versionsLoading && <p className="help">手动载入已发布的正式版本，可下载指定版本或选择兼容的旧版本回退。</p>}
    {versionsLoading && <p className="help" role="status">正在读取 {updateSourceLabel(status.source)} 正式版本…</p>}
    {update.versions !== null && versions.length === 0 && <p className="help">暂无可下载的正式版本。</p>}
    {selected && <>
      <label className="field release-version-select"><span>下载版本</span><select data-testid="update-version-select" value={selected.tag}
        disabled={!supported || busy || versionsLoading} onChange={event => setSelectedTag(event.currentTarget.value)}>
        {versions.map(version => <option key={version.tag} value={version.tag}>
          {releaseVersionLabel(version, status.currentVersion, versions[0]?.version)}</option>)}</select></label>
      <div className="release-version-selection">
        <strong>所选版本 {selected.version}</strong>
        {selected.notes && <p className="update-notes">{selected.notes}</p>}
        {current ? <p className="help">这是当前正在运行的版本，无需下载。</p>
          : selected.installable ? <>
            {rollback && <p className="help">下载不会立即回退。安装前将再次确认版本，并检查当前数据库格式是否兼容。</p>}
            <button className="small" data-testid="update-download-version" disabled={!supported || busy || versionsLoading}
              onClick={() => void update.downloadVersion(selected.tag)}><Download size={15}/>
              {rollback ? '下载回退版本' : '下载此版本'}</button>
          </> : <>
            <p className="help">此版本缺少应用内更新签名，无法在软件内验证和安装。请到发布页手动下载安装包，并确认旧版本兼容你的数据格式。</p>
            <button className="small" data-testid="update-open-release" disabled={!supported || busy || versionsLoading}
              onClick={() => void update.openRelease(selected.tag)}><ExternalLink size={15}/> 打开发布页下载</button>
          </>}
      </div>
    </>}
    {versionsError && <p className="error-text update-error" role="alert">版本列表读取失败：{versionsError}</p>}
  </section>;
}
