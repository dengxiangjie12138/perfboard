import { memoryObject } from '../../services/viewMemory';
import type { TransformerDesignDocument, TransformerDesignRecord } from './types';
export interface DesignViewMemory {
  active: boolean; dirty: boolean; document: TransformerDesignDocument | null;
  baseline: TransformerDesignDocument | null; record: TransformerDesignRecord | null;
}
function document(value: unknown, requireSheet = true): value is TransformerDesignDocument {
  if (!memoryObject(value) || value.schemaVersion !== 1 || !['designNo','title','revLabel'].every(key => typeof value[key] === 'string') || !['draft','reviewed','released'].includes(value.status as string) || typeof value.exampleFlag !== 'boolean') return false;
  if (!['logicalWindings','windingSteps','materials','tests','dimensions','images'].every(key => Array.isArray(value[key]) && (value[key] as unknown[]).every(memoryObject))) return false;
  if (value.source !== null && (!memoryObject(value.source) || !Array.isArray(value.source.warnings) || !value.source.warnings.every(item => typeof item === 'string'))) return false;
  const sheet = value.productionSheet;
  if (sheet === null || sheet === undefined) return !requireSheet;
  if (!memoryObject(sheet) || sheet.schemaVersion !== 1 || typeof sheet.core !== 'string' || typeof sheet.material !== 'string' || typeof sheet.showDiagram !== 'boolean' || !Array.isArray(sheet.windings) || !Array.isArray(sheet.electrical)) return false;
  return sheet.windings.every(w => memoryObject(w) && ['id','label','start','end','diameter','strands','turns','tape','diagramOrder','wireType','direction','note'].every(key => typeof w[key] === 'string') && ['PRI','SEC','unknown'].includes(w.group as string) && typeof w.tubeStart === 'boolean' && typeof w.tubeEnd === 'boolean') && sheet.electrical.every(e => memoryObject(e) && ['id','start','end','inductance','unit','frequency','note'].every(key => typeof e[key] === 'string'));
}
export function restoreDesignView(value: unknown): DesignViewMemory | undefined {
  if (!memoryObject(value) || typeof value.active !== 'boolean' || typeof value.dirty !== 'boolean') return;
  if (!value.active) return { active: false, dirty: false, document: null, baseline: null, record: null };
  if (!document(value.document) || !document(value.baseline)) return;
  if (value.record !== null && (!memoryObject(value.record) || typeof value.record.id !== 'string' || !Number.isInteger(value.record.revision) || Number(value.record.revision) < 1 || typeof value.record.createdAt !== 'string' || typeof value.record.updatedAt !== 'string' || !document(value.record.document, false))) return;
  return value as unknown as DesignViewMemory;
}
