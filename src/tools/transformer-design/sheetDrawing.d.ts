import type { ProductionSheet, SheetWinding } from './types';
export function strandLabel(w: SheetWinding): string;
export function diagram(d: ProductionSheet): string;
export function construction(d: ProductionSheet): string;
export function exportDiagram(connection: string, build: string): string;
