import { useState } from 'react';
import { ArrowRight, Box, Cable, Layers, FileText, Search, Triangle, type LucideIcon } from 'lucide-react';
import type { Page } from '../../types';
import { useData } from '../../state/DataContext';
import { Heading, Empty, formatDate } from '../../components/Common';
import { TOOLS } from '../../tools/registry';
import { CORE_LIBRARY_ENTRY } from '../../navigation/pages';
import { searchNotes, searchParts } from '../../navigation/search';
import { useExternalTools } from '../../tools/external-tools';
import { searchExternalTools } from '../../navigation/externalToolSearch';
import type { PageNavigate } from '../../navigation/routes';
import { CIRCUITS } from '../../tools/opamp/metadata';
import { OfflineSearch } from '../../services/search';
const circuitSearch = new OfflineSearch<(typeof CIRCUITS)[number]>(circuit => [circuit.title, circuit.description, ...circuit.keywords]);
interface WorkbenchEntry { page: Page; title: string; description: string; keywords: readonly string[]; icon: LucideIcon; toolItemId?: string }

export function WorkbenchPage({ onNavigate, initialQuery = '' }: { onNavigate: PageNavigate; initialQuery?: string }) {
  const { data } = useData();
  const { tools } = useExternalTools();
  const [query, setQuery] = useState(initialQuery);
  const entries: WorkbenchEntry[] = [
    { page: 'parts' as Page, title: '物料仓库', description: '型号、品牌、库存和存放位置', keywords: [] as readonly string[], icon: Box },
    { ...CORE_LIBRARY_ENTRY, icon: Layers },
    ...TOOLS,
    { page: 'notes' as Page, title: '笔记概览', description: '记录问题、思路和学习过程', keywords: [] as readonly string[], icon: FileText },
  ];
  const q = query.trim().toLocaleLowerCase(), parts = searchParts(data.parts, q), notes = searchNotes(data.notes, q);
  const externalTools = searchExternalTools(tools, q);
  const matchingEntries = entries.filter(entry => [entry.title, entry.description, ...entry.keywords].join(' ').toLocaleLowerCase().includes(q));
  if (q) matchingEntries.push(...circuitSearch.search(CIRCUITS, query).map(circuit => ({ page: 'opamp' as const, title: circuit.title, description: circuit.description, keywords: circuit.keywords, icon: Triangle, toolItemId: circuit.id })));
  return <>
    <Heading eyebrow="YOUR ENGINEERING WORKSPACE" title="从这里，继续手边的工作。" description="工具、物料和笔记都在同一个工作台。" />
    <label className="workbench-search"><Search size={19} /><input data-testid="workbench-search" aria-label="搜索工具、物料和笔记"
      placeholder="搜索工具、物料和笔记…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="stats-row"><span><strong>{data.parts.length}</strong> 种物料</span><span><strong>{data.notes.length}</strong> 篇笔记</span>
      <span><strong>{data.parts.filter(part => part.stockStatus === 'low' || part.stockStatus === 'out_of_stock').length}</strong> 项待补充</span></div>
    <div className="tool-grid">{matchingEntries.map(entry => {
      const Icon = entry.icon;
      return <button className="card tool-card" key={entry.page + ':' + (entry.toolItemId ?? '')} onClick={() => entry.toolItemId ? onNavigate(entry.page, undefined, undefined, undefined, entry.toolItemId) : onNavigate(entry.page)}><Icon size={25} />
        <h2>{entry.title}</h2><p>{entry.description}</p><span>打开 <ArrowRight size={17} /></span></button>;
    })}
    {externalTools.map(tool => <button className="card tool-card" key={'external-' + tool.id} data-external-tool-id={tool.id} onClick={() => onNavigate('external-tools', undefined, undefined, tool.id)}><Cable size={25} />
      <h2>{tool.name}</h2><p>{tool.description || '本机外部应用'}</p><span>{tool.available ? '打开记录' : '不可用 · 查看记录'} <ArrowRight size={17} /></span></button>)}</div>
    <div className="two-column section">
      <section className="card"><div className="card-title"><h2>{q ? '匹配物料' : '物料一览'}</h2><button className="link" onClick={() => onNavigate('parts')}>查看全部</button></div>
        {parts.length ? parts.map(part => <button key={part.id} className="list-item" onClick={() => onNavigate('parts', undefined, part.id)}>
          <div><strong>{part.name}</strong><small>{[part.packageName, part.brand, part.location].filter(Boolean).join(' · ') || part.category}</small></div><ArrowRight size={16} /></button>) :
          <Empty>{q ? '没有匹配的物料' : '仓库还是空的。添加第一种物料，记录型号和位置。'}</Empty>}
      </section>
      <section className="card"><div className="card-title"><h2>{q ? '匹配笔记' : '最近笔记'}</h2><button className="link" onClick={() => onNavigate('notes')}>查看全部</button></div>
        {notes.length ? notes.map(note => <button key={note.id} className="list-item" onClick={() => onNavigate('notes', note.id)}>
          <div><strong>{note.title || '未命名笔记'}</strong><small>{note.category} · {formatDate(note.updatedAt)}</small></div><ArrowRight size={16} /></button>) :
          <Empty>{q ? '没有匹配的笔记' : '记录一个问题，或画下新的思路。'}</Empty>}
      </section>
    </div>
  </>;
}
