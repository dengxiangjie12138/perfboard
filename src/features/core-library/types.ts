export type CoreShape = 'EC' | 'EE' | 'EF' | 'EFD' | 'EI' | 'EP' | 'EPC' | 'ER' | 'EER' | 'ETD' | 'LP' | 'RM' | 'PTS' | 'PQ' | 'UU' | 'UI' | 'U' | 'POT' | 'TOROID' | 'UNCLASSIFIED';
export type CoreScalar = string | number | null;
export interface CoreNumericParameters {
  aeMm2?: number;
  awMm2?: number;
  alNhPerTurn2?: number;
  leMm?: number;
  veMm3?: number;
  apCm4?: number;
  dimensionsMm?: string;
}
export interface CoreSourceSnapshot {
  sourceId: string;
  filename: string;
  sha256: string;
  recordId: string;
  sheet: string;
  row: number;
  cellRange?: string;
  sourceModel?: string;
}
export interface CoreImageSnapshot {
  id: string;
  assetPath: string;
  sha256: string;
  alt: string;
  sourceMedia: string;
  sourceSha256?: string;
  sourceLabel?: string;
  sourceId?: string;
  filename?: string;
  sourceWorkbookSha256?: string;
  sheet: string;
  anchor?: string;
  binding: 'exact-model' | 'sheet-series';
  model: string;
}
export interface CoreParameterSnapshot {
  key: string;
  label: string;
  value: CoreScalar;
  unit: string | null;
  rawHeader?: string;
  cell?: string;
  sourceId?: string;
  variantId?: string;
}
export interface CoreVariant {
  id: string;
  model: string;
  shape: CoreShape;
  material?: string;
  source: CoreSourceSnapshot;
  sourceReferences?: CoreSourceSnapshot[];
  parameters: CoreNumericParameters;
  rawParameters: CoreParameterSnapshot[];
  images: CoreImageSnapshot[];
  originalGroup?: string;
  notes: string[];
}
export interface CoreConflict {
  key: string;
  label: string;
  values: { variantId: string; value: CoreScalar; unit: string | null }[];
}
export interface CoreOption {
  id: string;
  model: string;
  shape: CoreShape;
  materials: string[];
  variants: CoreVariant[];
  parameters: CoreNumericParameters;
  images: CoreImageSnapshot[];
  conflicts: CoreConflict[];
  legacyIds: string[];
}
export interface CoreOptionSnapshot {
  schemaVersion: 1;
  libraryRevision: string;
  coreId: string;
  model: string;
  shape: CoreShape;
  material?: string;
  selectedVariantId?: string;
  parameters: CoreNumericParameters;
  sources: CoreSourceSnapshot[];
  images: CoreImageSnapshot[];
  rawParameters: CoreParameterSnapshot[];
  conflictNotes: string[];
}
export interface CoreOptionFilter {
  query?: string;
  shape?: CoreShape | '';
  material?: string;
}
export interface IncomingCoreData {
  sources: { id: string; filename: string; sha256: string; bytes: number; format: string }[];
  records: {
    id: string;
    model: string;
    shape: CoreShape;
    material: string | null;
    source: CoreSourceSnapshot;
    sourceReferences?: CoreSourceSnapshot[];
    rawParameters: CoreParameterSnapshot[];
    images: CoreImageSnapshot[];
    notes: string[];
  }[];
  audit: { recordCount: number; sheets: { name: string; recordCount: number }[]; notes: string[] };
}