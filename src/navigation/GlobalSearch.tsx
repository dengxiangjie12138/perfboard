import { Search, X, ArrowRight } from 'lucide-react';
import './search.css';
import type { Snapshot } from '../types';
import type { Navigate } from './routes';
import { searchPageResults } from './pages';
import { searchNotesResults, searchPartsResults } from './search';
import type { SearchCorrection } from '../services/search';
import { useExternalTools } from '../tools/external-tools';
import { externalToolRoute, searchExternalToolResults } from './externalToolSearch';

interface Props {
  data: Snapshot; query: string; onQuery: (value: string) => void; disabled: boolean; onNavigate: Navigate;
  placement?: 'topbar' | 'sidebar'; ariaLabel?: string; open?: boolean; onFocus?: () => void; onDismiss?: () => void;
}
const correctionLabel = (corrections: readonly SearchCorrection[]) => corrections.map(value => value.term + ' → ' + value.matched).join('；');
export function GlobalSearch({ data, query, onQuery, disabled, onNavigate, placement = 'topbar', ariaLabel = placement === 'sidebar' ? '侧边栏全局搜索' : '全局搜索', open = true, onFocus, onDismiss }: Props) {
  const { tools } = useExternalTools();
  const q = query.trim(), searchQuery = open ? q : '';

  const external = searchExternalToolResults(tools, searchQuery), pageResults = searchPageResults(searchQuery);
  const partResults = searchPartsResults(data.parts, searchQuery), noteResults = searchNotesResults(data.notes, searchQuery);
  const pages = pageResults.matches, externalTools = external.matches, parts = partResults.matches, notes = noteResults.matches;
  const hasMatches = !!(pages.length || parts.length || notes.length || externalTools.length);
  const hasSuggestions = !!(pageResults.suggestions.length || external.suggestions.length || partResults.suggestions.length || noteResults.suggestions.length);
  const resultsId = 'global-search-' + placement + '-results';
  return <div className={'global-search' + (placement === 'sidebar' ? ' global-search-sidebar' : '')} role="search" aria-label={ariaLabel}
    onFocus={onFocus} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onDismiss?.(); }}>
    <Search size={15} /><input type="search" aria-label={ariaLabel} aria-controls={q && open ? resultsId : undefined} value={query}
    onChange={event => onQuery(event.target.value)} placeholder={placement === 'sidebar' ? '搜索工具、物料、笔记…' : '搜索工具、物料和笔记；支持拼音和分词…'}
    onKeyDown={event => { if (event.key === 'Escape') { onQuery(''); onDismiss?.(); } }} />
    {query && <button className="icon-button" aria-label="清除搜索" onClick={() => onQuery('')}><X size={13} /></button>}
    {q && open && <div className="search-results" id={resultsId} role="region" aria-label={ariaLabel + '结果'}>
      {pages.map(page => <button key={page.page + ':' + (page.toolItemId ?? '')} disabled={disabled} onClick={() => onNavigate({ page: page.page, ...(page.toolItemId ? { toolItemId: page.toolItemId } : {}) })}>
        <span className="search-kind">工具</span>{page.label}<ArrowRight size={14} /></button>)}
      {externalTools.map(tool => <button key={'external-' + tool.id} data-external-tool-id={tool.id} disabled={disabled} title={tool.description} onClick={() => onNavigate(externalToolRoute(tool.id))}>
        <span className="search-kind">外部</span>{tool.name}<ArrowRight size={14} /></button>)}
      {parts.map(part => <button key={part.id} disabled={disabled} onClick={() => onNavigate({ page: 'parts', partId: part.id })}>
        <span className="search-kind">物料</span>{part.name}<ArrowRight size={14} /></button>)}
      {notes.map(note => <button key={note.id} disabled={disabled} onClick={() => onNavigate({ page: 'notes', noteId: note.id })}>
        <span className="search-kind">笔记</span>{note.title}<ArrowRight size={14} /></button>)}
      {!hasMatches && <p>{hasSuggestions ? '没有精确匹配结果' : '没有匹配结果'}</p>}
      {hasSuggestions && <section className="search-suggestions" aria-label="近似建议">
        <p className="search-suggestion-heading">近似建议 · 请核对</p>
        {pageResults.suggestions.map(({ record: page, corrections }) => <button key={'near-page-' + page.page + ':' + (page.toolItemId ?? '')} disabled={disabled} onClick={() => onNavigate({ page: page.page, ...(page.toolItemId ? { toolItemId: page.toolItemId } : {}) })}>
          <span className="search-kind">工具</span><span className="search-suggestion-text">{page.label}<small>{correctionLabel(corrections)}</small></span><ArrowRight size={14} /></button>)}
        {external.suggestions.map(({ record: tool, corrections }) => <button key={'near-external-' + tool.id} data-external-tool-id={tool.id} disabled={disabled} title={tool.description} onClick={() => onNavigate(externalToolRoute(tool.id))}>
          <span className="search-kind">外部</span><span className="search-suggestion-text">{tool.name}<small>{correctionLabel(corrections)}</small></span><ArrowRight size={14} /></button>)}
        {partResults.suggestions.map(({ record: part, corrections }) => <button key={'near-part-' + part.id} disabled={disabled} onClick={() => onNavigate({ page: 'parts', partId: part.id })}>
          <span className="search-kind">物料</span><span className="search-suggestion-text">{part.name}<small>{correctionLabel(corrections)}</small></span><ArrowRight size={14} /></button>)}
        {noteResults.suggestions.map(({ record: note, corrections }) => <button key={'near-note-' + note.id} disabled={disabled} onClick={() => onNavigate({ page: 'notes', noteId: note.id })}>
          <span className="search-kind">笔记</span><span className="search-suggestion-text">{note.title}<small>{correctionLabel(corrections)}</small></span><ArrowRight size={14} /></button>)}
      </section>}
    </div>}
  </div>;
}
