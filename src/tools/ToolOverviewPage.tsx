import { ArrowRight } from 'lucide-react';
import { Heading } from '../components/Common';
import type { Page } from '../types';
import { TOOL_GROUPS, TOOLS, type ToolGroupId } from './registry';

export function ToolOverviewPage({ group, onNavigate }: { group: ToolGroupId; onNavigate?: (page: Page) => void }) {
  const definition = TOOL_GROUPS.find(value => value.page === group)!;
  return <><Heading eyebrow={definition.eyebrow} title={definition.title} description={definition.description} />
    <div className="tool-grid">{TOOLS.filter(tool => tool.group === group).map(tool => {
      const Icon = tool.icon;
      return <button key={tool.page} className="card tool-card" disabled={!onNavigate} onClick={() => onNavigate?.(tool.page)}>
        <Icon size={25} /><h2>{tool.title}</h2><p>{tool.description}</p><span>打开 <ArrowRight size={17} /></span>
      </button>;
    })}</div></>;
}
