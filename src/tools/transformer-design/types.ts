/** Document DTO matches the native snapshot/CAS contract. Empty data stays null. */
export type DesignStatus = 'draft' | 'reviewed' | 'released';
export type StepKind = 'winding' | 'insulation' | 'margin' | 'assembly';
export type TestKind = 'inductance' | 'leakage' | 'dcr' | 'turnsRatio' | 'hipot' | (string & {});
export interface CoreSnapshot {
  schemaVersion: 1;
  libraryRevision: string | number;
  coreId: string;
  model: string;
  shape: string;
  material?: string;
  parameters: { aeMm2?: number; awMm2?: number; alNhPerTurn2?: number; leMm?: number; veMm3?: number; apCm4?: number; dimensionsMm?: string | Record<string, number> };
  selectedVariantId?: string;
  sources: unknown[];
  images: unknown[];
  rawParameters: unknown[];
  conflictNotes: string[];
}
export interface BobbinSnapshot {
  partNumber: string | null; orientation: string | null; pinCount: number | null;
  view: string | null; pin1Location: string | null; pinDiagramNotes: string | null;
}
export interface LogicalWinding {
  id: string; name: string; role: string | null; polarityNote: string | null; terminalNotes: string | null;
}
export interface WindingStep {
  id: string; order: number; kind: StepKind; logicalWindingId: string | null;
  fromPin: string | null; toPin: string | null; turns: number | null; wireSpec: string | null;
  parallelCount: number | null; direction: string | null; layerNotes: string | null;
  material: string | null; thickness: number | null; unit: string | null; notes: string | null;
}
export interface DesignMaterial {
  id: string; name: string; specification: string | null; quantity: number | null; unit: string | null; notes: string | null;
}
export interface AcceptanceTest {
  id: string; kind: TestKind; target: number | null; unit: string | null; tolerance: string | null; conditions: string | null; notes: string | null;
}
export interface DesignDimension {
  id: string; name: string; value: number | null; unit: string | null; tolerance: string | null; notes: string | null;
}
export interface DesignImage {
  id: string; title: string; attachmentId: string | null; url: string | null; notes: string | null;
}
export interface ImportSource {
  kind: 'xlsx' | 'json'; fileName: string; sheetName: string | null;
  rowStart: number | null; rowEnd: number | null; rawRows: string[][]; warnings: string[];
}
export interface TransformerDesignDocument {
  schemaVersion: 1; designNo: string; title: string; revLabel: string; status: DesignStatus; exampleFlag: boolean;
  coreSnapshot: CoreSnapshot | null; bobbinSnapshot: BobbinSnapshot | null;
  logicalWindings: LogicalWinding[]; windingSteps: WindingStep[]; materials: DesignMaterial[];
  assemblyNotes: string | null; tests: AcceptanceTest[]; dimensions: DesignDimension[];
  images: DesignImage[]; notes: string | null; source: ImportSource | null;
  productionSheet?: ProductionSheet | null;
}
export interface TransformerDesignRecord {
  id: string; revision: number; createdAt: string; updatedAt: string; document: TransformerDesignDocument;
}
export interface DesignSummary {
  id: string; revision: number; designNo: string; title: string; revLabel: string;
  status: DesignStatus; exampleFlag: boolean; updatedAt: string;
}
export interface SaveDesignInput { id: string | null; expectedRevision: number | null; document: TransformerDesignDocument }
export interface ImportCandidate {
  candidateId: string; sheetName: string; rowStart: number; rowEnd: number; title: string;
  document: TransformerDesignDocument; warnings: string[];
}
export interface ImportPreview { token: string; fileName: string; candidates: ImportCandidate[]; warnings: string[] }
export interface ConfirmImportInput { token: string; candidateId: string; confirmed: true }
export interface TransformerDesignApi {
  list(): Promise<DesignSummary[] | TransformerDesignRecord[]>;
  get(id: string): Promise<TransformerDesignRecord>;
  save(input: SaveDesignInput): Promise<TransformerDesignRecord>;
  previewImport(): Promise<ImportPreview | null>;
  confirmImport(input: ConfirmImportInput): Promise<TransformerDesignRecord>;
  history?(id: string): Promise<TransformerDesignRecord[]>;
}
export interface CoreOption {
  id: string; model: string; shape: string; material?: string;
  materials?: string[];
  variants?: { id: string; label?: string; material?: string; source?: { filename?: string; sheet?: string; row?: number }; notes?: string[] }[];
}
export interface CoreSelectionApi {
  getCoreOptions(query: { query?: string }): Promise<CoreOption[]> | CoreOption[];
  getCoreOption(id: string): Promise<CoreOption | undefined> | CoreOption | undefined;
  createCoreSnapshot(coreId: string, variantId?: string): Promise<CoreSnapshot | undefined> | CoreSnapshot | undefined;
}
export interface PdfExportOptions {
  fontBytes?: Uint8Array; fontUrl?: string; subsetFont?: boolean;
  rasterizeSvg?: (svg: string) => Promise<Uint8Array>;
  onSave?: (bytes: Uint8Array, fileName: string) => Promise<void | boolean>;
  resolveImage?: (image: DesignImage) => Promise<Uint8Array | undefined>;
}

/** Optional manufacturing sheet. Original legacy document fields remain intact. */
export interface SheetWinding {
 id: string; label: string; start: string; end: string; diameter: string; strands: string; turns: string;
 tape: string; tubeStart: boolean; tubeEnd: boolean; group: 'PRI' | 'SEC' | 'unknown';
 diagramOrder: string; wireType: string; direction: string; note: string;
}
export interface SheetElectrical {
 id: string; start: string; end: string; inductance: string; unit: string; frequency: string; note: string;
}
export interface ProductionSheet {
 schemaVersion: 1; core: string; material: string; bobbinDescription?: string | null; transformerDescription?: string | null; showDiagram: boolean;
 windings: SheetWinding[]; electrical: SheetElectrical[];
}
