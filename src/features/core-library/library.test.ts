import { describe, expect, it } from 'vitest';
import { coreLibrary, coreRecords, coreUnit, displayCoreValue, searchCores } from './library';
describe('core reference library', () => {
  it('preserves audited source, row identities and all original columns', () => {
    expect(coreLibrary.source.sha256).toBe('de64ab3ac56801eb8b9601416727837b53ae9b11b969b3e222a60799750f688f');
    expect(coreRecords).toHaveLength(137);
    expect(new Set(coreRecords.map(record => record.id)).size).toBe(137);
    expect(coreRecords.every(record => record.values.length === 15)).toBe(true);
    expect(coreLibrary.audit.duplicateModels).toEqual([]);
    expect(coreLibrary.sheet.formulaCells).toEqual([]);
  });
  it('retains mixed pin values, blanks and unconfirmed units without conversion', () => {
    const core = searchCores('EE05')[0];
    expect(core.values[13]).toBe('6-8');
    expect(searchCores('EC35')[0].values[10]).toBe('');
    expect(coreUnit(12)).toBe('原表未注明');
    expect(displayCoreValue('')).toBe('原表未填写');
    expect(coreUnit(4)).toBe('mm2');
  });
  it('searches case-insensitively across original values with material and category filters', () => {
    expect(searchCores('ee05 pc40')).toHaveLength(1);
    expect(searchCores('ee05', '3C85')).toHaveLength(0);
    expect(searchCores('', 'PC40').every(record => record.values[1] === 'PC40')).toBe(true);
    expect(searchCores('', '', 'TYPE  EC  CORE')).toHaveLength(4);
    expect(searchCores('does-not-exist')).toEqual([]);
  });
});
