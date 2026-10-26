import data from './core-data.json';
export type CoreValue = string | number;
export interface CoreRecord { id: string; sheet: string; row: number; group: string; values: CoreValue[] }
// Keep the original audited XLS API intact for existing integrations.
export const coreLibrary = data;
export const coreRecords: CoreRecord[] = data.records;
export function searchCores(query: string, material = '', group = ''): CoreRecord[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return coreRecords.filter(record => (!material || record.values[1] === material) && (!group || record.group === group) && terms.every(term => [record.group, ...record.values].join(' ').toLocaleLowerCase().includes(term)));
}
export function displayCoreValue(value: CoreValue | null | undefined): string { return value === '' || value === null || value === undefined ? '原表未填写' : String(value); }
export function coreUnit(index: number): string {
  const unit = data.columns[index]?.unit;
  if (unit) return unit;
  return index === 12 ? '原表未注明' : '—';
}
export { coreOptions, coreShapes, coreShapeLabel, coreLibraryRevision, coreLibraryAudit, getCoreOptions, getCoreOption, createCoreSnapshot, normalizeCoreModel } from './unified';
export type { CoreShape, CoreScalar, CoreNumericParameters, CoreSourceSnapshot, CoreImageSnapshot, CoreParameterSnapshot, CoreVariant, CoreConflict, CoreOption, CoreOptionSnapshot, CoreOptionFilter } from './types';