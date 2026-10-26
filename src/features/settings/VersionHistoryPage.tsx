import {useState} from 'react';
import {ChevronDown, ChevronUp} from 'lucide-react';
import {Heading} from '../../components/Common';
import {versionHistory, type VersionHistoryEntry} from './versionHistory';
import './settings.css';

export function VersionEntry({entry}: {entry: VersionHistoryEntry}) {
  const [expanded, setExpanded] = useState(false);
  const detailId = 'version-changes-' + entry.version.replaceAll('.', '-');
  return <section className="card section">
    <button className="version-toggle" aria-expanded={expanded} aria-controls={detailId}
      data-testid={'version-' + entry.version} onClick={() => setExpanded(value => !value)}>
      <strong>Perfboard {entry.version}</strong><span className="tag">当前版本</span>
      {expanded ? <ChevronUp size={18} aria-hidden="true"/> : <ChevronDown size={18} aria-hidden="true"/>}</button>
    <p className="version-description">{entry.dateRange}</p>
    <div id={detailId} className="version-changes" hidden={!expanded}>{entry.groups.map(group =>
      <section className="version-change-group" key={group.label} aria-labelledby={detailId + '-' + group.label}>
        <h3 id={detailId + '-' + group.label}>{group.label}</h3>
        <div className="version-change-scroll" role="region" aria-labelledby={detailId + '-' + group.label} tabIndex={0}>
          <ul>{group.items.map(item => <li key={item}>{item}</li>)}</ul></div></section>)}</div>
  </section>;
}
export function VersionHistoryPage() {
  return <><Heading eyebrow="ABOUT PERFBOARD" title="关于与版本"
    description="物料仓库、笔记与工程工具，在本机完成。"/>
    {versionHistory.map(entry => <VersionEntry key={entry.version} entry={entry}/>)}
    <p className="help">点击版本号查看变更。小更新合并在同一版本下，版本号保持 0.1.0。</p></>;
}
