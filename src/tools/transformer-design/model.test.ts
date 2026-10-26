import { describe, expect, it } from 'vitest';
import { copyDocument, createBlankDesign, createExampleDesign, displayValue, formatMeasured, newWindingStep, nullableNumber, pendingItems, reorderSteps, saveValidation, testLabel } from './model';

describe('transformer manufacturing snapshots', () => {
  it('keeps missing measurements distinct from an explicit zero through JSON round trip', () => {
    const design = createExampleDesign();
    design.tests[0] = { ...design.tests[0], target: 0, tolerance: '±0.1', conditions: '1–3脚，1kHz，25°C' };
    const restored = JSON.parse(JSON.stringify(design));
    expect(restored.tests[0].target).toBe(0);
    expect(restored.tests[0].unit).toBe('µH');
    expect(restored.bobbinSnapshot.view).toBeNull();
    expect(nullableNumber('')).toBeNull();
    expect(nullableNumber('0')).toBe(0);
    expect(displayValue(null)).toBe('待确认');
    expect(displayValue(0)).toBe('0');
    expect(formatMeasured(0, null)).toContain('单位待确认');
    expect(pendingItems(restored)).not.toContain('电感目标值');
  });
  it('freezes nested source data rather than sharing live library objects', () => {
    const original = createExampleDesign();
    original.coreSnapshot!.parameters.aeMm2 = 31.5;
    const snapshot = copyDocument(original);
    snapshot.coreSnapshot!.parameters.aeMm2 = 35;
    snapshot.coreSnapshot!.sources.push({ sourceId: 'another' });
    snapshot.materials[0].specification = 'changed';
    expect(original.coreSnapshot!.parameters.aeMm2).toBe(31.5);
    expect(original.coreSnapshot!.sources).toHaveLength(1);
    expect(original.materials[0].specification).toContain('0.05');
  });
  it('preserves independently editable segments of one logical winding when reordered', () => {
    const one = { ...newWindingStep('winding', 1), logicalWindingId: 'P', fromPin: '1', toPin: '2', turns: 5 };
    const insulation = { ...newWindingStep('insulation', 2), thickness: 0.05, unit: null };
    const two = { ...newWindingStep('winding', 3), logicalWindingId: 'P', fromPin: '2', toPin: '3', turns: 5 };
    const reordered = reorderSteps([one, insulation, two], 2, 0);
    expect(reordered.map(step => step.id)).toEqual([two.id, one.id, insulation.id]);
    expect(reordered.map(step => step.order)).toEqual([1, 2, 3]);
    expect(reordered.filter(step => step.logicalWindingId === 'P')).toHaveLength(2);
    expect(reordered[2].unit).toBeNull();
    expect(one.order).toBe(1);
  });
  it('keeps the single 36W example explicitly unreviewed and does not invent N1/N3 roles', () => {
    const design = createExampleDesign();
    expect(design.exampleFlag).toBe(true);
    expect(design.status).toBe('draft');
    expect(design.coreSnapshot?.material).toBe('PC40');
    expect(design.bobbinSnapshot?.pinCount).toBe(14);
    expect(design.bobbinSnapshot?.pinDiagramNotes).toContain('6+8');
    expect(design.logicalWindings.find(winding => winding.name === 'N1')?.role).toBeNull();
    expect(design.logicalWindings.find(winding => winding.name === 'N3')?.polarityNote).toBeNull();
    expect(design.windingSteps.map(step => [step.fromPin, step.toPin, step.turns])).toEqual([['1', '2', 5], ['11', '14', 16], ['2', '3', 5], ['9', '10', 8]]);
    expect(design.windingSteps[3].wireSpec).toBe('0.2mm*1');
    expect(design.materials[0].specification).toContain('单位待确认');
    expect(design.coreSnapshot?.parameters.aeMm2).toBeUndefined();
  });
  it('retains arbitrary custom test names instead of inherited object properties', () => {
    expect(testLabel('inductance')).toBe('电感');
    for (const kind of ['temperatureRise', 'constructor', 'toString', '__proto__']) expect(testLabel(kind)).toBe(kind);
  });
  it('allows an incomplete draft but refuses an orphaned winding reference', () => {
    const design = createBlankDesign();
    design.designNo = 'TR-001'; design.title = '新记录';
    expect(saveValidation(design)).toEqual([]);
    design.windingSteps = [{ ...newWindingStep('winding', 1), logicalWindingId: 'missing' }];
    expect(saveValidation(design).join('')).toContain('已不存在');
  });
});
