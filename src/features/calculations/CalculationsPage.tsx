import type { Page } from '../../types';
import { TOOLS } from '../../tools/registry';
import { ToolOverviewPage } from '../../tools/ToolOverviewPage';

export type CalculationKind = 'hardware' | 'feedback' | 'stm32' | 'timer';
export interface CalculationsPageProps { kind: CalculationKind; onNavigate?: (kind: CalculationKind) => void }
/** Compatibility entry; metadata and active tool pages live in the registry. */
export function CalculationsPage({ kind, onNavigate }: CalculationsPageProps) {
  if (kind === 'hardware' || kind === 'stm32') {
    const navigate = (page: Page) => {
      if (page === 'hardware' || page === 'stm32' || page === 'feedback' || page === 'timer') onNavigate?.(page);
    };
    return <ToolOverviewPage group={kind} onNavigate={onNavigate ? navigate : undefined} />;
  }
  const Component = TOOLS.find(tool => tool.page === kind)!.component;
  return <Component />;
}
