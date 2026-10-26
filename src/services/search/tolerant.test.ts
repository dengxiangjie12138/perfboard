import { describe, expect, it } from 'vitest';
import { OfflineSearch } from './index';
import { searchNotes, searchNotesResults, searchParts, searchPartsResults } from './repositorySearch';
import { tolerantSearchWords } from './tolerant';
import type { Part } from '../../types';

const part = (id: string, fields: Partial<Part> = {}): Part => ({ id, name: 'Modbus interface', category: '通讯', packageName: '0603', parameters: '100kΩ', brand: '', lcscNumber: '00C123A', stockStatus: 'unknown', quantity: null, location: '电阻盒', brief: '', url: '', createdAt: '', updatedAt: '', ...fields });

describe('separate tolerant word suggestions', () => {
  it('uses Fuse transposition tolerance while the original API stays deterministic', () => {
    const records = [part('modbus')];
    expect(searchParts(records, 'mdobus')).toEqual([]);
    const results = searchPartsResults(records, 'mdobus');
    expect(results.matches).toEqual([]);
    expect(results.suggestions.map(hit => hit.record.id)).toEqual(['modbus']);
    expect(results.suggestions[0].corrections).toEqual([{ term: 'mdobus', matched: 'modbus' }]);
    expect(results.suggestions[0].score).toBeLessThanOrEqual(0.34);
  });
  it('retains every strict AND constraint in the same record with a fuzzy word', () => {
    const records = [part('right'), part('wrong-package', { packageName: '0805' }), part('wrong-value', { parameters: '1100kΩ' }), part('unrelated', { name: 'Interface' })];
    expect(searchPartsResults(records, 'mdobus 0603 100k').suggestions.map(hit => hit.record.id)).toEqual(['right']);
    expect(searchPartsResults(records, '0603 DZH mdobus 100k').suggestions.map(hit => hit.record.id)).toEqual(['right']);
    expect(searchPartsResults([part('word', { parameters: '' }), part('number', { name: '100kΩ resistor' })], 'mdobus 100k').suggestions).toEqual([]);
  });
  it.each(['mdobus 0604', 'mdobus 603', 'mdobus 1100k', 'mdobus 0C123A', 'STM32F104', 'STM32F104 mdobus'])('keeps digit-bearing technical typo %s out of both result groups', query => {
    const records = [part('technical', { name: 'Modbus STM32F103', parameters: '100kΩ' })];
    expect(searchPartsResults(records, query)).toEqual({ matches: [], suggestions: [] });
  });
  it('preserves milli/mega quantities even beside a tolerant word', () => {
    const records = [part('milli', { parameters: '100mA' }), part('mega', { parameters: '100MA' })];
    expect(searchPartsResults(records, 'mdobus 100mA').suggestions.map(hit => hit.record.id)).toEqual(['milli']);
    expect(searchPartsResults(records, 'mdobus 100MA').suggestions.map(hit => hit.record.id)).toEqual(['mega']);
    expect(searchPartsResults([records[0]], 'mdobus 100MA')).toEqual({ matches: [], suggestions: [] });
  });
  it('does not approximate packages, supplier identifiers, short initials or pure Chinese', () => {
    expect(searchPartsResults([part('package', { name: 'Interface', packageName: 'TSSOP' })], 'TSSOQ').suggestions).toEqual([]);
    expect(searchPartsResults([part('supplier', { name: 'Interface', lcscNumber: 'Supplier' })], 'Suppller').suggestions).toEqual([]);
    const records = [part('chinese', { name: '电阻', category: '', location: '' })];
    expect(searchPartsResults(records, 'dzx')).toEqual({ matches: [], suggestions: [] });
    expect(searchPartsResults(records, '电容')).toEqual({ matches: [], suggestions: [] });
    expect(tolerantSearchWords('STM32F103 LQFP-48 100kΩ Modbus TCP/IP')).toEqual(['modbus']);
  });
  it('preserves exact/pinyin/initial priority and never promotes omitted exact hits to suggestions', () => {
    const index = new OfflineSearch<{ id: string; title: string }>(record => [record.title]);
    const records = [{ id: 'initial', title: '大爱天安' }, { id: 'pinyin', title: '大天' }, { id: 'literal', title: 'datian' }, { id: 'near', title: 'datlan' }];
    const expected = index.search(records, 'datian', Infinity);
    const results = index.searchResults(records, 'datian', 1);
    expect(expected.map(hit => hit.id)).toEqual(['literal', 'pinyin']);
    expect(results.matches).toEqual(expected.slice(0, 1));
    expect(results.suggestions.map(hit => hit.record.id)).toEqual(['near']);
    expect(index.searchResults(records, 'DATIAN').matches).toEqual(expected);
  });
  it('keeps note update ordering within both separate result groups', () => {
    const older = { id: 'old', title: 'Modbus', category: '学习笔记' as const, searchText: '', createdAt: '', updatedAt: '2026-01-01' };
    const newer = { ...older, id: 'new', updatedAt: '2026-02-01' };
    expect(searchNotesResults([older, newer], 'Modbus').matches).toEqual(searchNotes([older, newer], 'Modbus'));
    expect(searchNotesResults([older, newer], 'mdobus').suggestions.map(hit => hit.record.id)).toEqual(['new', 'old']);
  });
  it('refreshes approximate vocabulary after edits, replacements, add and delete', () => {
    const first = part('first'), records = [first];
    expect(searchPartsResults(records, 'mdobus').suggestions.map(hit => hit.record.id)).toEqual(['first']);
    first.name = 'Ethernet';
    expect(searchPartsResults(records, 'mdobus').suggestions).toEqual([]);
    records.push(part('new'));
    expect(searchPartsResults(records, 'mdobus').suggestions.map(hit => hit.record.id)).toEqual(['new']);
    records.splice(1, 1);
    expect(searchPartsResults(records, 'mdobus').suggestions).toEqual([]);
    expect(searchPartsResults([part('fresh')], 'mdobus').suggestions.map(hit => hit.record.id)).toEqual(['fresh']);
  });
});
