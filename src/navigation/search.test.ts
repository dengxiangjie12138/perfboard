import { expect, it } from 'vitest';
import type { Part } from '../types';
import { searchParts, searchNotes } from './search';

const part: Part = { id: '1', name: 'STM32F103C8T6', brand: 'ST', lcscNumber: 'C00123', category: 'MCU', packageName: 'LQFP48', parameters: '旧信息', stockStatus: 'unknown', quantity: null, location: '0805电阻盒', brief: '', url: '', createdAt: '', updatedAt: '' };
it.each(['stm32f103', 'st', 'c00123', 'lqfp48', '旧信息'])('finds material metadata %s without coercing text', query => {
  expect(searchParts([part], query)).toEqual([part]);
});
it('returns no unrelated material and retains textual number', () => {
  expect(searchParts([part], 'C999')).toEqual([]);
  expect(part.lcscNumber).toBe('C00123');
});
it('orders matching notes by updated date without mutating the snapshot', () => {
  const first = { id: '1', title: 'test', category: '随笔' as const, searchText: '', createdAt: '', updatedAt: '2026-10-01' };
  const second = { ...first, id: '2', updatedAt: '2026-10-02' };
  const input = [first, second];
  expect(searchNotes(input, 'test').map(note => note.id)).toEqual(['2', '1']);
  expect(input).toEqual([first, second]);
});

it('protects numeric boundaries while retaining actual zero-ohm matches',()=>{expect(searchParts([part],'0')).toEqual([]);const zero={...part,id:'zero',name:'0Ω'};expect(searchParts([zero],'0')).toEqual([zero]);});
