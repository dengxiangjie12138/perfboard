import legacy from './core-data.json';
import incomingJson from './additional-core-data.json';
import type { CoreConflict, CoreImageSnapshot, CoreNumericParameters, CoreOption, CoreOptionFilter, CoreOptionSnapshot, CoreParameterSnapshot, CoreShape, CoreVariant, IncomingCoreData } from './types';

const incoming = incomingJson as IncomingCoreData;
const legacySourceId = 'legacy-xls';
const numericUnits: Record<string, string> = {
  aeMm2: 'mm2', awMm2: 'mm2', alNhPerTurn2: 'nH/N2',
  leMm: 'mm', veMm3: 'mm3', apCm4: 'cm4',
};
const legacyKeys = ['model', 'material', 'dimensionsMm', 'apCm4', 'aeMm2', 'awMm2', 'alNhPerTurn2', 'leMm', 'veMm3', 'weightG', 'pclW', 'ptW', 'bobbinWidth', 'bobbinPins', 'bobbinShape'];
const shapeOrder: CoreShape[] = ['EC', 'EE', 'EF', 'EFD', 'EI', 'EP', 'EPC', 'ER', 'EER', 'ETD', 'LP', 'RM', 'PTS', 'PQ', 'UU', 'UI', 'U', 'POT', 'TOROID', 'UNCLASSIFIED'];
export function normalizeCoreModel(model: string): string {
  // Preserve punctuation and digits: EE05, EE5, ER25/51 and ER25-51 are distinct.
  return model.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase();
}
export function classifyLegacyShape(group: string): CoreShape {
  const match = /^TYPE\s+([A-Z]+)\s+CORE$/.exec(group.trim());
  return match && shapeOrder.includes(match[1] as CoreShape) ? match[1] as CoreShape : 'UNCLASSIFIED';
}
export function numericCoreParameters(raw: CoreParameterSnapshot[]): CoreNumericParameters {
  const result: CoreNumericParameters = {};
  for (const parameter of raw) {
    if (parameter.key === 'dimensionsMm' && parameter.unit === 'mm' && typeof parameter.value === 'string' && parameter.value.trim()) {
      result.dimensionsMm = parameter.value;
    } else if (numericUnits[parameter.key] === parameter.unit && typeof parameter.value === 'number' && Number.isFinite(parameter.value)) {
      result[parameter.key as keyof Omit<CoreNumericParameters, 'dimensionsMm'>] = parameter.value;
    }
  }
  return result;
}
const legacyVariants: CoreVariant[] = legacy.records.map(record => {
  const rawParameters = legacy.columns.map(column => ({
    key: legacyKeys[column.index],
    label: column.label,
    value: record.values[column.index],
    unit: column.unit,
    rawHeader: [column.rawHeader, column.rawSubheader].filter(Boolean).join(' / '),
    sourceId: legacySourceId,
    variantId: record.id,
  }));
  return {
    id: record.id, model: String(record.values[0]), shape: classifyLegacyShape(record.group),
    material: String(record.values[1]), parameters: numericCoreParameters(rawParameters), rawParameters,
    source: { sourceId: legacySourceId, filename: legacy.source.filename, sha256: legacy.source.sha256, recordId: record.id, sheet: record.sheet, row: record.row },
    images: [], originalGroup: record.group, notes: [],
  };
});
const importedVariants: CoreVariant[] = incoming.records.map(record => ({
  id: record.id, model: record.model, shape: record.shape,
  ...(record.material ? { material: record.material } : {}),
  source: record.source, sourceReferences: record.sourceReferences ?? [],
  rawParameters: record.rawParameters.map(parameter => ({ ...parameter, sourceId: record.source.sourceId, variantId: record.id })),
  parameters: numericCoreParameters(record.rawParameters),
  images: record.images, notes: record.notes,
}));

function present(value: unknown): boolean { return value !== null && value !== undefined && value !== ''; }
export function coreParameterValuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
  }
  return a === b;
}
function uniqueImages(images: CoreImageSnapshot[]): CoreImageSnapshot[] {
  const seen = new Set<string>();
  return images.filter(image => {
    const key = image.sha256 + ':' + image.binding;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function findConflicts(variants: CoreVariant[]): CoreConflict[] {
  const groups = new Map<string, CoreConflict>();
  for (const variant of variants) {
    for (const parameter of variant.rawParameters) {
      if (parameter.key === 'model' || !present(parameter.value)) continue;
      const entry = groups.get(parameter.key) ?? { key: parameter.key, label: parameter.label, values: [] };
      entry.values.push({ variantId: variant.id, value: parameter.value, unit: parameter.unit });
      groups.set(parameter.key, entry);
    }
    if (variant.material && !variant.rawParameters.some(parameter => parameter.key === 'material')) {
      const entry = groups.get('material') ?? { key: 'material', label: '材质', values: [] };
      entry.values.push({ variantId: variant.id, value: variant.material, unit: null });
      groups.set('material', entry);
    }
  }
  return [...groups.values()].filter(entry => entry.values.some(value => value.unit !== entry.values[0].unit || !coreParameterValuesEqual(value.value, entry.values[0].value)));
}
function consensusParameters(variants: CoreVariant[], conflicts: CoreConflict[]): CoreNumericParameters {
  const result: CoreNumericParameters = {};
  const conflictedKeys = new Set(conflicts.map(conflict => conflict.key));
  const materials = new Set(variants.flatMap(variant => variant.material ? [variant.material] : []));
  if (materials.size > 1) conflictedKeys.add('alNhPerTurn2');
  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.parameters)) {
      if (!conflictedKeys.has(key) && !(key in result)) Object.assign(result, { [key]: value });
    }
  }
  return result;
}
export function mergeCoreVariants(variants: CoreVariant[]): CoreOption[] {
  const groups = new Map<string, CoreVariant[]>();
  for (const variant of variants) {
    const key = variant.shape + ':' + normalizeCoreModel(variant.model);
    const existing = groups.get(key) ?? [];
    existing.push(variant);
    groups.set(key, existing);
  }
  return [...groups.entries()].map(([key, records]) => {
    const conflicts = findConflicts(records);
    return {
      id: 'core:' + encodeURIComponent(key), model: normalizeCoreModel(records[0].model),
      shape: records[0].shape, materials: [...new Set(records.flatMap(record => record.material ? [record.material] : []))],
      variants: records, parameters: consensusParameters(records, conflicts),
      images: uniqueImages(records.flatMap(record => record.images)), conflicts,
      legacyIds: records.filter(record => record.source.sourceId === legacySourceId).map(record => record.id),
    };
  });
}
export const coreOptions = mergeCoreVariants([...legacyVariants, ...importedVariants]);
export const coreShapes = shapeOrder.filter(shape => coreOptions.some(option => option.shape === shape));
export const coreLibraryRevision = ['core-library-v1', legacy.source.sha256, ...incoming.sources.map(source => source.sha256)].join(':');
export const coreLibraryAudit = {
  legacyRecordCount: legacyVariants.length,
  importedRecordCount: importedVariants.length,
  modelCount: coreOptions.length,
  sourceRecordCount: legacyVariants.length + importedVariants.length,
  sourceWorkbookCount: 1 + incoming.sources.length,
  supplementalReferenceCount: importedVariants.reduce((sum, variant) => sum + (variant.sourceReferences?.length ?? 0), 0),
  multiSourceModels: coreOptions.filter(option => option.variants.length > 1).map(option => ({ coreId: option.id, model: option.model, variantIds: option.variants.map(variant => variant.id) })),
  conflictModels: coreOptions.filter(option => option.conflicts.length > 0).map(option => ({ coreId: option.id, model: option.model, conflicts: option.conflicts })),
  unclassifiedModels: coreOptions.filter(option => option.shape === 'UNCLASSIFIED').map(option => option.model),
  importAudit: incoming.audit,
};
export function coreShapeLabel(shape: CoreShape): string {
  return shape === 'TOROID' ? '环形' : shape === 'POT' ? '罐形' : shape === 'UNCLASSIFIED' ? '未分类（待核对）' : shape;
}
export function getCoreOptions({ query = '', shape = '', material = '' }: CoreOptionFilter = {}): CoreOption[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return coreOptions.filter(option =>
    (!shape || option.shape === shape) && (!material || option.materials.includes(material)) &&
    terms.every(term => [option.model, option.shape, ...option.materials, ...option.variants.flatMap(variant => [variant.originalGroup ?? '', variant.source.filename, variant.source.sheet, ...variant.rawParameters.map(parameter => parameter.value ?? '')])].join(' ').toLocaleLowerCase().includes(term)),
  );
}
export function getCoreOption(id: string): CoreOption | undefined {
  return coreOptions.find(option => option.id === id || option.legacyIds.includes(id) || option.variants.some(variant => variant.id === id));
}
export function createCoreSnapshot(coreId: string, variantId?: string): CoreOptionSnapshot | undefined {
  const option = getCoreOption(coreId);
  if (!option) return undefined;
  const selected = variantId ? option.variants.find(variant => variant.id === variantId) : undefined;
  if (variantId && !selected) return undefined;
  const variants = selected ? [selected] : option.variants;
  const materials = [...new Set(variants.flatMap(variant => variant.material ? [variant.material] : []))];
  const snapshot: CoreOptionSnapshot = {
    schemaVersion: 1, libraryRevision: coreLibraryRevision, coreId: option.id,
    model: option.model, shape: option.shape,
    ...(materials.length === 1 ? { material: materials[0] } : {}),
    ...(selected ? { selectedVariantId: selected.id } : {}),
    parameters: selected ? selected.parameters : option.parameters,
    sources: variants.flatMap(variant => [variant.source, ...(variant.sourceReferences ?? [])]),
    images: uniqueImages([...variants.flatMap(variant => variant.images), ...option.images.filter(image => image.binding === 'sheet-series')]),
    rawParameters: variants.flatMap(variant => variant.rawParameters),
    conflictNotes: [
      ...option.conflicts.map(conflict => conflict.label + ' 的来源值不一致' + (selected ? '；已选择 ' + selected.source.filename + ' / ' + selected.source.sheet + ' 第 ' + selected.source.row + ' 行' : '；未自动采用冲突值')),
      ...(!selected && option.materials.length > 1 ? ['多个材质变体；未自动采用跨材质 AL，请选择具体来源'] : []),
    ],
  };
  // Saved designs own this data; a library update must never mutate their snapshots.
  return JSON.parse(JSON.stringify(snapshot)) as CoreOptionSnapshot;
}