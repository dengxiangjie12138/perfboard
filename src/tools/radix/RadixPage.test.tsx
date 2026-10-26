import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RadixPage, copyIntegerText, initialRadixState, operandValid, radixReducer, shiftCountValue, radixMemory, restoreRadixMemory, type RadixState } from './RadixPage';
import { formatInteger } from './algorithm';
const input = (state: RadixState, raw: string, operand: 'a' | 'b' = 'a') => radixReducer(state, { type: 'input', operand, radix: 10, raw });
it('persists exact 64-bit patterns and incomplete inputs as JSON-safe decimal strings', () => {
  const valid=input(radixReducer(initialRadixState,{type:'width',width:64}),'18446744073709551615');
  const state=radixReducer(valid,{type:'input',operand:'b',radix:16,raw:'0x'});
  expect(restoreRadixMemory(JSON.parse(JSON.stringify(radixMemory(state))))).toEqual(state);
  expect(restoreRadixMemory({...radixMemory(state),width:7})).toBeUndefined();
  expect(restoreRadixMemory({...radixMemory(state),a:{bits:'18446744073709551616',draft:null}})).toBeUndefined();
});
it('keeps invalid drafts pending across width changes and restoration', () => {
  let state=radixReducer(initialRadixState,{type:'width',width:8});
  state=input(input(state,'42'),'300');
  state=radixReducer(state,{type:'width',width:16});
  const restored=restoreRadixMemory(JSON.parse(JSON.stringify(radixMemory(state))))!;
  expect(restored).toEqual(state); expect(operandValid(restored.a)).toBe(false);
  expect(restored.a.bits).toBe(42n); expect(restored.a.draft?.raw).toBe('300');
});
it('keeps 64-bit values exact and the active raw input untouched', () => {
  const state = input(radixReducer(initialRadixState, { type: 'width', width: 64 }), '18446744073709551615');
  expect(state.a.bits).toBe(18446744073709551615n);
  expect(state.a.draft?.raw).toBe('18446744073709551615');
  expect(formatInteger(state.a.bits, 16, 64, 'unsigned')).toBe('FFFFFFFFFFFFFFFF');
});
it('preserves intermediate and invalid input while refusing operations and bit flips', () => {
  const valid = input(initialRadixState, '42');
  for (const raw of ['', '-', '0x', 'GG', '100000000']) {
    const radix = raw === '' || raw === '-' ? 10 : 16;
    const state = radixReducer(valid, { type: 'input', operand: 'a', radix, raw });
    expect(state.a.draft?.raw).toBe(raw);
    expect(state.a.bits).toBe(42n);
    expect(operandValid(state.a)).toBe(false);
    expect(radixReducer(state, { type: 'operation', operation: 'not' })).toBe(state);
    expect(radixReducer(state, { type: 'flip', index: 0 })).toBe(state);
    expect(radixReducer(state, { type: 'shift', direction: 'left' })).toBe(state);
  }
});
it('invalid B prevents binary operations but does not prevent NOT of A', () => {
  const state = input(input(initialRadixState, '3'), '', 'b');
  expect(radixReducer(state, { type: 'operation', operation: 'xor' })).toBe(state);
  expect(radixReducer(state, { type: 'operation', operation: 'not' }).a.bits).toBe(4294967292n);
});
it('narrows with an explicit truncation notice and sign-extends when widening', () => {
  const narrowed = radixReducer(input(initialRadixState, '511'), { type: 'width', width: 8 });
  expect(narrowed.a.bits).toBe(255n);
  expect(narrowed.notice).toContain('高位已截断');
  const signed = radixReducer(narrowed, { type: 'mode', mode: 'signed' });
  expect(signed.a.bits).toBe(255n);
  expect(formatInteger(signed.a.bits, 10, 8, signed.mode)).toBe('-1');
  const wide = radixReducer(signed, { type: 'width', width: 64 });
  expect(wide.a.bits).toBe(18446744073709551615n);
  expect(wide.notice).toContain('符号位扩展');
});
it('preserves unfinished raw drafts through width and mode changes', () => {
  const pending = input(input(initialRadixState, '42'), '-');
  const changed = radixReducer(radixReducer(pending, { type: 'mode', mode: 'signed' }), { type: 'width', width: 8 });
  expect(changed.a.draft?.raw).toBe('-');
  expect(operandValid(changed.a)).toBe(false);
  expect(changed.notice).toContain('输入已保留');
});
it('operations and flips affect A only and distinguish the two right shifts', () => {
  const state = input(input(radixReducer(initialRadixState, { type: 'width', width: 8 }), '128'), '7', 'b');
  expect(radixReducer(state, { type: 'shift', direction: 'logicalRight' }).a.bits).toBe(64n);
  expect(radixReducer(state, { type: 'shift', direction: 'arithmeticRight' }).a.bits).toBe(192n);
  for (const changed of [radixReducer(state, { type: 'operation', operation: 'or' }), radixReducer(state, { type: 'flip', index: 0 }), radixReducer(state, { type: 'shift', direction: 'left' })]) expect(changed.b).toBe(state.b);
  expect(radixReducer(state, { type: 'flip', index: 0 }).a.bits).toBe(129n);
});
it('validates shift counts before bounded Number conversion', () => {
  expect(shiftCountValue('64', 64)).toBe(64);
  for (const raw of ['', '-', '1.5', '-1', '65', '999999999999999999999999']) expect(shiftCountValue(raw, 64)).toBeNull();
});
it('renders eight integer fields, distinct shift buttons, bit numbers, and per-row copy controls', () => {
  const html = renderToStaticMarkup(<RadixPage />);
  for (const operand of ['a','b']) for (const base of ['bin','oct','dec','hex']) {
    expect(html).toContain(`data-testid="radix-${operand}-${base}"`);
    expect(html).toContain(`data-testid="radix-copy-${operand}-${base}"`);
  }
  expect(html).toContain('radix-shift-logical-right');
  expect(html).toContain('radix-shift-arithmetic-right');
  expect(html).toContain('radix-bit-31');
  expect(html).toContain('radix-bit-0');
  expect(html).toContain('最低位编号 0');
});
it('reports clipboard failure without throwing and copies exact text on success', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  expect(await copyIntegerText('FFFFFFFFFFFFFFFF', { writeText })).toBe('已复制。');
  expect(writeText).toHaveBeenCalledWith('FFFFFFFFFFFFFFFF');
  expect(await copyIntegerText('42', undefined)).toContain('复制失败');
  expect(await copyIntegerText('42', { writeText: vi.fn().mockRejectedValue(new Error('denied')) })).toContain('复制失败');
});
