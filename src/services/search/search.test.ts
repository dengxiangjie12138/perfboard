import { describe, expect, it } from 'vitest';
import { OfflineSearch } from './index';
import { normalizeSearchText } from './text';
import { searchNotes, searchParts } from './repositorySearch';
import type { Part } from '../../types';

const part = (id: string, value: Partial<Part> = {}): Part => ({ id, name: '100KΩ', category: '电阻', packageName: '0603', parameters: '', brand: '风华', lcscNumber: '00C123A', stockStatus: 'in_stock', quantity: 5, location: '电阻盒', brief: '低温漂', url: '', createdAt: 'old', updatedAt: 'old', ...value });
const ids = (query: string, records = [part('right'), part('wrong-value', { name: '100Ω' }), part('wrong-package', { packageName: '0805' })]) => searchParts(records, query, Infinity).map(row => row.id);

describe('offline repository search', () => {
  it.each(['100k 0603', '0603 100K', '  0603\t100k\n电阻  ', '0603 DZH 100K', 'DianZu 100k 0603', '风华 0603 100K', 'fenghua 100K 0603'])('uses whitespace AND across independent fields without ordering: %s', query => {
    expect(ids(query)).toEqual(['right']);
  });
  it('accepts Chinese, pinyin initials, English and numeric input together', () => {
    expect(ids('100k 0603 dz盒')).toEqual(['right']);
    expect(ids('电Zu 0603 100K')).toEqual(['right']);
  });
  it('preserves model case-insensitivity, supplier leading zeros and partial model lookup', () => {
    const records = [part('mcu', { name: 'STM32F103C8T6', category: '主控', packageName: 'LQFP48' })];
    expect(ids('stm32f103 lqfp48 ZK 00c123a', records)).toEqual(['mcu']);
    expect(ids('0C123A', records)).toEqual([]);
    expect(normalizeSearchText('STM32M4')).toBe(normalizeSearchText('stm32m4'));
  });
  it('does not fuzzy-match resistance, package digits, or model typos', () => {
    expect(ids('100k 0603', [part('100ohm', { name: '100Ω' }), part('0805', { packageName: '0805' }), part('larger', { name: '1100kΩ' })])).toEqual([]);
    expect(ids('100k 603')).toEqual([]);
    expect(ids('100k 0604')).toEqual([]);
    expect(ids('stm32f104', [part('mcu', { name: 'STM32F103' })])).toEqual([]);
  });
  it.each([['100mA', '100MA'], ['1mΩ', '1MΩ'], ['4m7', '4M7'], ['mA', 'MA']])('keeps physical milli/mega separate: %s / %s', (milli, mega) => {
    const records = [part('milli', { name: milli, brief: '额定' + milli }), part('mega', { name: mega, brief: '额定' + mega })];
    expect(ids(milli, records)).toEqual(['milli']);
    expect(ids(mega, records)).toEqual(['mega']);
  });
  it('searches the complete repository before the global preview limit', () => {
    const records = Array.from({ length: 1918 }, (_, index) => part(String(index), { name: '10kΩ', packageName: '0805' }));
    records[1917] = part('late-record');
    expect(searchParts(records, '0603 100k').map(row => row.id)).toEqual(['late-record']);
    expect(searchParts(records, '', Infinity)).toHaveLength(1918);
  });
  it('refreshes cached aliases after add, edit, delete, replacement and in-place edits', () => {
    const records = [part('first')];
    expect(ids('DZH 100k', records)).toEqual(['first']);
    records.push(part('new'));
    expect(ids('DZH 100k', records)).toEqual(['first', 'new']);
    records[0].location = '电容盒';
    expect(ids('DZH 100k', records)).toEqual(['new']);
    records.splice(1, 1);
    expect(ids('DZH 100k', records)).toEqual([]);
    expect(ids('DRH 100k', [...records])).toEqual(['first']);
    expect(ids('DZH 100k', [part('fresh')])).toEqual(['fresh']);
  });
  it('ranks literal matches ahead of full pinyin and initials without dropping weaker hits', () => {
    const index = new OfflineSearch<{ id: string; title: string }>(record => [record.title]);
    expect(index.search([{ id: 'initial', title: '大型功率' }, { id: 'full', title: '大' }, { id: 'literal', title: 'DA' }], 'da').map(record => record.id)).toEqual(['literal', 'initial', 'full']);
    expect(index.search([{ id: 'initial', title: '电阻' }, { id: 'literal', title: 'DZ' }], 'dz').map(record => record.id)).toEqual(['literal', 'initial']);
  });
  it('keeps pure Chinese literal so unrelated words with the same initials do not match', () => {
    expect(ids('电压', [part('power', { category: '电源', brief: '' })])).toEqual([]);
  });
  it('matches notes across title/body/category with pinyin and retains update order ties', () => {
    const notes = [{ id: 'older', title: '主控调试', category: '学习笔记' as const, searchText: 'STM32 时钟', createdAt: '', updatedAt: '2026-01-01' }, { id: 'newer', title: '主控调试', category: '学习笔记' as const, searchText: 'stm32 时钟', createdAt: '', updatedAt: '2026-02-01' }];
    expect(searchNotes(notes, 'STM32 ZKTS SHIZHONG').map(note => note.id)).toEqual(['newer', 'older']);
  });
});
