import { describe, expect, it } from 'vitest';
import { coreOptions, createCoreSnapshot, getCoreOption, getCoreOptions, normalizeCoreModel } from './library';
import { coreParameterValuesEqual, mergeCoreVariants, numericCoreParameters } from './unified';
import type { CoreVariant } from './types';

function variant(id: string, model: string, ae: number | null, material = 'PC40'): CoreVariant {
  const rawParameters = [
    { key: 'aeMm2', label: 'Ae', value: ae, unit: 'mm2' },
    { key: 'material', label: '材质', value: material, unit: null },
  ];
  return {
    id, model, shape: 'EE', material, rawParameters, parameters: numericCoreParameters(rawParameters),
    source: { sourceId: id, filename: id + '.xls', sha256: 'a'.repeat(64), recordId: id, sheet: 'EE', row: 4 },
    images: [], notes: [],
  };
}
describe('unified concrete core options', () => {
  it('classifies old cores accurately without conflating EF and EFD', () => {
    expect(getCoreOption('Sheet1:40')?.shape).toBe('EF');
    expect(getCoreOption('Sheet1:46')?.shape).toBe('EFD');
    expect(getCoreOptions({ shape: 'PQ' }).some(option => option.model === 'PQ20/20')).toBe(true);
    expect(getCoreOptions({ shape: 'EFD' }).every(option => option.model.startsWith('EFD'))).toBe(true);
    expect(coreOptions.every(option => option.variants.length > 0)).toBe(true);
  });
  it('only normalizes case and surrounding whitespace, preserving model distinctions', () => {
    expect(normalizeCoreModel(' ER9.35  ')).toBe('ER9.35');
    const options = mergeCoreVariants([
      variant('a', 'EE05', 2.63), variant('b', 'ee05  ', 2.63),
      variant('c', 'EE5', 2.63), variant('d', 'EE05/6', 2.63), variant('e', 'EE05-6', 2.63),
    ]);
    expect(options).toHaveLength(4);
    expect(options[0].variants.map(value => value.id)).toEqual(['a', 'b']);
  });
  it('retains competing source values and omits conflicted numeric parameters', () => {
    const [option] = mergeCoreVariants([variant('a', 'EE05', 2.63), variant('b', 'EE05', 3.31, 'PC44')]);
    expect(option.parameters.aeMm2).toBeUndefined();
    expect(option.conflicts.find(conflict => conflict.key === 'aeMm2')?.values.map(value => value.value)).toEqual([2.63, 3.31]);
    expect(option.materials).toEqual(['PC40', 'PC44']);
    expect(option.variants[0].parameters.aeMm2).toBe(2.63);
    expect(option.variants[1].parameters.aeMm2).toBe(3.31);
  });
  it('audits Excel floating-point representation without hiding meaningful differences', () => {
    expect(coreParameterValuesEqual(0.0570285, 0.05702850000000001)).toBe(true);
    expect(coreParameterValuesEqual(2.63, 2.630001)).toBe(false);
    const [option] = mergeCoreVariants([variant('a', 'EE05', 2.63), variant('b', 'EE05', 2.6300000000000003)]);
    expect(option.conflicts).toEqual([]);
    expect(option.variants[1].rawParameters[0].value).toBe(2.6300000000000003);
    expect(option.parameters.aeMm2).toBe(2.63);
  });
  it('merges the actual manual without duplicating series rows and preserves source-only PIN values', () => {
    const ee = getCoreOption('Sheet1:10')!;
    expect(ee.variants).toHaveLength(2);
    expect(ee.images).toHaveLength(1);
    expect(ee.images[0].binding).toBe('sheet-series');
    expect(ee.images[0].sheet).toBe('EE');
    const ei = getCoreOption('Sheet1:56')!;
    expect(ei.variants[0].rawParameters.find(parameter => parameter.key === 'bobbinPins')?.value).toBe('');
    expect(ei.variants[1].rawParameters.find(parameter => parameter.key === 'bobbinPins')?.value).toBe(8);
    expect(ei.conflicts).toEqual([]);
    const pts = getCoreOption('Sheet1:127')!;
    expect(pts.variants[1].sourceReferences?.[0].sourceModel).toBe('P14/8');
    expect(pts.images[0].sourceLabel).toBe('P 型');
    expect(getCoreOption('Sheet1:5')?.images).toEqual([]);
    expect(getCoreOption('Sheet1:40')?.images).toEqual([]);
    expect(getCoreOption('Sheet1:84')?.shape).toBe('ER');
    expect(getCoreOption('Sheet1:84')?.images[0].sheet).toBe('EER');
    expect(createCoreSnapshot(ee.id, 'Sheet1:10')?.images[0].binding).toBe('sheet-series');
  });
  it('keeps AL bound to material variants even when the listed numbers are equal', () => {
    const a = variant('a', 'EE05', 2.63, 'PC40');
    const b = variant('b', 'EE05', 2.63, 'PC44');
    for (const entry of [a, b]) {
      entry.rawParameters.push({ key: 'alNhPerTurn2', label: 'AL', value: 3150, unit: 'nH/N2' });
      entry.parameters = numericCoreParameters(entry.rawParameters);
    }
    const [option] = mergeCoreVariants([a, b]);
    expect(option.parameters.aeMm2).toBe(2.63);
    expect(option.parameters.alNhPerTurn2).toBeUndefined();
    expect(option.variants[0].parameters.alNhPerTurn2).toBe(3150);
  });
  it('does not fill missing numbers, parse qualified loss text, or invent unspecified units', () => {
    expect(numericCoreParameters([
      { key: 'aeMm2', label: 'Ae', value: null, unit: 'mm2' },
      { key: 'awMm2', label: 'Aw', value: '', unit: 'mm2' },
      { key: 'alNhPerTurn2', label: 'AL', value: 3150, unit: null },
      { key: 'pclW', label: 'PCL', value: '11.0(150MT)', unit: 'W' },
    ])).toEqual({});
    const [option] = mergeCoreVariants([variant('a', 'EE05', null), variant('b', 'EE05', 2.63)]);
    expect(option.conflicts).toEqual([]);
    expect(option.parameters.aeMm2).toBe(2.63);
  });
  it('freezes source parameters into independent saved-design snapshots', () => {
    const source = getCoreOption('Sheet1:10')!;
    const snapshot = createCoreSnapshot(source.id, 'Sheet1:10')!;
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.parameters.aeMm2).toBe(2.63);
    expect(snapshot.rawParameters.find(parameter => parameter.key === 'bobbinPins')?.value).toBe('6-8');
    snapshot.parameters.aeMm2 = 999;
    snapshot.sources[0].filename = 'changed';
    snapshot.rawParameters[0].value = 'changed';
    expect(createCoreSnapshot(source.id, 'Sheet1:10')?.parameters.aeMm2).toBe(2.63);
    expect(source.variants[0].source.filename).not.toBe('changed');
    expect(createCoreSnapshot(source.id, 'unknown-variant')).toBeUndefined();
    expect(createCoreSnapshot('unknown-core')).toBeUndefined();
  });
});