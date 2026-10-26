import { sheetValidation } from './sheet';
import type { AcceptanceTest, BobbinSnapshot, DesignMaterial, LogicalWinding, TransformerDesignDocument, WindingStep } from './types';

export const STATUS_LABELS = { draft: '草稿 / 未审核', reviewed: '已审核', released: '已发布' } as const;
export const STEP_LABELS = { winding: '绕线', insulation: '绝缘', margin: '挡墙', assembly: '装配' } as const;
export const TEST_LABELS = { inductance: '电感', leakage: '漏感', dcr: '直流电阻', turnsRatio: '匝比', hipot: '耐压' } as const;
export function testLabel(kind: string): string { return Object.prototype.hasOwnProperty.call(TEST_LABELS, kind) ? TEST_LABELS[kind as keyof typeof TEST_LABELS] : kind; }
export const CONFIRM = '待确认';
export function newId(prefix = 'item'): string {
  return prefix + '-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}
export function copyDocument(document: TransformerDesignDocument): TransformerDesignDocument {
  return JSON.parse(JSON.stringify(document)) as TransformerDesignDocument;
}
export function emptyBobbin(): BobbinSnapshot {
  return { partNumber: null, orientation: null, pinCount: null, view: null, pin1Location: null, pinDiagramNotes: null };
}
export function createBlankDesign(): TransformerDesignDocument {
  return { schemaVersion: 1, designNo: '', title: '', revLabel: 'A', status: 'draft', exampleFlag: false,
    coreSnapshot: null, bobbinSnapshot: emptyBobbin(), logicalWindings: [], windingSteps: [], materials: [],
    assemblyNotes: null, tests: [], dimensions: [], images: [], notes: null, source: null };
}
export function newLogicalWinding(): LogicalWinding {
  return { id: newId('winding'), name: '', role: null, polarityNote: null, terminalNotes: null };
}
export function newWindingStep(kind: WindingStep['kind'], order: number): WindingStep {
  return { id: newId('step'), order, kind, logicalWindingId: null, fromPin: null, toPin: null, turns: null,
    wireSpec: null, parallelCount: null, direction: null, layerNotes: null, material: null, thickness: null, unit: null, notes: null };
}
export function newMaterial(): DesignMaterial {
  return { id: newId('material'), name: '', specification: null, quantity: null, unit: null, notes: null };
}
export function newTest(kind: AcceptanceTest['kind'] = 'inductance'): AcceptanceTest {
  return { id: newId('test'), kind, target: null, unit: null, tolerance: null, conditions: null, notes: null };
}
export function nullableText(value: string): string | null { return value.trim() ? value : null; }
export function nullableNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return CONFIRM;
  return String(value);
}
export function formatMeasured(value: unknown, unit?: string | null): string {
  if (value === null || value === undefined || value === '') return CONFIRM;
  return String(value) + (unit ? ' ' + unit : '（单位待确认）');
}
export function windingName(document: TransformerDesignDocument, id: string | null): string {
  return document.logicalWindings.find(winding => winding.id === id)?.name || CONFIRM;
}
export function sortedSteps(document: TransformerDesignDocument): WindingStep[] {
  return [...document.windingSteps].sort((a, b) => a.order - b.order);
}
export function reorderSteps(steps: WindingStep[], from: number, to: number): WindingStep[] {
  const next = [...steps].sort((a, b) => a.order - b.order);
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [step] = next.splice(from, 1);
  next.splice(to, 0, step);
  return next.map((item, index) => ({ ...item, order: index + 1 }));
}
export function pendingItems(document: TransformerDesignDocument): string[] {
  const pending: string[] = [];
  const bobbin = document.bobbinSnapshot;
  if (!document.coreSnapshot) pending.push('磁芯型号、材质与参数来源');
  if (!bobbin?.partNumber) pending.push('骨架料号');
  if (!bobbin?.view) pending.push('引脚图观察视角');
  if (!bobbin?.pin1Location) pending.push('1脚定位');
  if (!document.logicalWindings.length) pending.push('逻辑绕组');
  for (const winding of document.logicalWindings) {
    if (!winding.role) pending.push((winding.name || '未命名绕组') + '用途');
    if (!winding.polarityNote) pending.push((winding.name || '未命名绕组') + '同名端');
  }
  for (const step of sortedSteps(document)) {
    if (step.kind === 'winding' && (!step.fromPin || !step.toPin || step.turns === null)) pending.push('工序' + step.order + '的引脚或匝数');
    if (step.kind === 'winding' && !step.direction) pending.push('工序' + step.order + '绕向');
    if (step.thickness !== null && !step.unit) pending.push('工序' + step.order + '材料厚度单位');
  }
  for (const test of document.tests) {
    if (test.target === null || test.target === undefined) pending.push(testLabel(test.kind) + '目标值');
    if (!test.unit) pending.push(testLabel(test.kind) + '单位');
    if (!test.conditions) pending.push(testLabel(test.kind) + '测试条件');
    if (!test.tolerance) pending.push(testLabel(test.kind) + '公差 / 判定界限');
  }
  return [...new Set(pending)];
}
export function saveValidation(document: TransformerDesignDocument): string[] {
  const errors: string[] = [];
  if (!document.designNo.trim()) errors.push('请填写设计号。');
  if (document.productionSheet) return [...errors, ...sheetValidation(document.productionSheet)];
  if (!document.title.trim()) errors.push('请填写设计名称。');
  if (!document.revLabel.trim()) errors.push('请填写工程Rev。');
  if (document.bobbinSnapshot?.pinCount !== null && document.bobbinSnapshot?.pinCount !== undefined && (!Number.isInteger(document.bobbinSnapshot.pinCount) || document.bobbinSnapshot.pinCount < 0)) errors.push('骨架引脚数需为非负整数。');
  const windingIds = new Set(document.logicalWindings.map(winding => winding.id));
  for (const step of document.windingSteps) {
    if (step.logicalWindingId && !windingIds.has(step.logicalWindingId)) errors.push('工序' + step.order + '关联的逻辑绕组已不存在。');
    if (step.turns !== null && (!Number.isFinite(step.turns) || step.turns < 0)) errors.push('工序' + step.order + '匝数需为非负数，未知请留空。');
    if (step.parallelCount !== null && (!Number.isInteger(step.parallelCount) || step.parallelCount < 1)) errors.push('工序' + step.order + '并绕股数需为正整数，未知请留空。');
    if (step.thickness !== null && step.thickness < 0) errors.push('材料厚度不能为负数。');
  }
  return errors;
}
export function exportFileName(document: TransformerDesignDocument, extension: string): string {
  const base = document.productionSheet ? (document.title.trim() || '未命名制作单') : (document.designNo || 'transformer') + '_Rev-' + (document.revLabel || 'pending');
  const illegal = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  const cleaned = Array.from(base).map(character => character.charCodeAt(0) < 32 || illegal.has(character) ? '_' : character);
  return cleaned.slice(0, 150).join('') + '.' + extension;
}
/** One transparent historic example. Its missing roles, polarity and units are deliberately preserved. */
export function createExampleDesign(): TransformerDesignDocument {
  const document = createBlankDesign();
  document.designNo = 'EXAMPLE-36W';
  document.title = '36W PQ2020 历史方案示例';
  document.exampleFlag = true;
  document.coreSnapshot = { schemaVersion: 1, libraryRevision: 'legacy-source:ab488b0503eae36c747f4eed4521d3f69b06b54ce416e209de059737f41022a4', coreId: 'legacy-example-pq2020',
    model: 'PQ2020', shape: 'PQ', material: 'PC40', parameters: {}, sources: [{ sourceId: 'legacy-workbook', filename: '变压器设计文件.xlsx', sha256: 'ab488b0503eae36c747f4eed4521d3f69b06b54ce416e209de059737f41022a4', recordId: 'legacy-36w', sheet: '反激16~28-36W 变压器', row: 6 }],
    images: [], rawParameters: [{ name: '型号', value: 'PQ2020', cell: 'D6' }, { name: '材质', value: 'PC40', cell: 'G7' }], conflictNotes: ['示例PC40不能由现行库PC44条目自动替换；磁芯参数尚未确认。'] };
  document.bobbinSnapshot = { partNumber: null, orientation: '立式', pinCount: 14, view: null, pin1Location: null,
    pinDiagramNotes: '历史表格只注明立式6+8；引脚排列、观察视角和1脚定位均待确认。' };
  document.logicalWindings = ['N1', 'N2', 'N3', 'N4'].map(name => ({ id: name, name, role: null, polarityNote: null, terminalNotes: null }));
  const rows = [['N1', '1', '2', 5], ['N2', '11', '14', 16], ['N3', '2', '3', 5], ['N4', '9', '10', 8]] as const;
  document.windingSteps = rows.map((row, index) => ({ ...newWindingStep('winding', index + 1),
    logicalWindingId: row[0], fromPin: row[1], toPin: row[2], turns: row[3],
    wireSpec: index === 3 ? '0.2mm*1' : '1mm*1', parallelCount: 1,
    notes: '仅按原表列出顺序；绕向、分层及实际绝缘顺序待确认。' }));
  document.materials = [
    { id: 'example-tape', name: '胶带', specification: '原表厚度值0.05，单位待确认', quantity: 2, unit: '圈', notes: '各绕组原行均记2圈；不将厚度0.05擅自解释为mm。' },
    { id: 'example-margin', name: '挡墙', specification: '原表顶/底挡墙值均0，单位待确认', quantity: null, unit: null, notes: '不将0擅自解释为无挡墙或0mm。' },
  ];
  document.tests = [{ ...newTest(), target: 14, unit: 'µH', conditions: '测量端子1–3；频率、幅度、温度、其余绕组状态待确认' }];
  document.source = { kind: 'xlsx', fileName: '变压器设计文件.xlsx', sheetName: '反激16~28-36W 变压器', rowStart: 10, rowEnd: 13, rawRows: [], warnings: ['示例摘录绕组行10–13；源标题为C4，磁芯D6，骨架D7，材质G7，电感J6。完整单元格须通过旧设计导入预览查看。', '各原绕组行I/J注明进/出套管，材质、长度与工艺顺序待确认。'] };
  document.notes = '仅示例 / 未审核 / 不可用于生产。N1与N3的角色、是否属于同一逻辑初级及同名端均未知，保持为独立未知绕组。胶带与挡墙原表未写单位。';
  return document;
}
