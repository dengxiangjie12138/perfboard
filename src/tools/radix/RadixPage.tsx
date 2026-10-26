import { useState } from 'react';
import { useViewMemory } from '../../services/useViewMemory';
import { memoryObject } from '../../services/viewMemory';
import { Copy } from 'lucide-react';
import { Heading } from '../../components/Common';
import { applyBitOperation, flipBit, formatInteger, parseIntegerInput, resizeBits, shiftBits, type BitOperation, type BitWidth, type IntegerMode, type ParseResult, type Radix, type ShiftDirection } from './algorithm';
import './radix.css';

type Operand = 'a' | 'b';
type OperandState = { bits: bigint; draft: { radix: Radix; raw: string; result: ParseResult } | null };
export interface RadixState { a: OperandState; b: OperandState; width: BitWidth; mode: IntegerMode; shiftCount: string; group: 4 | 8; notice: string }
export const initialRadixState: RadixState = { a: { bits: 0n, draft: null }, b: { bits: 0n, draft: null }, width: 32, mode: 'unsigned', shiftCount: '1', group: 4, notice: '' };
export function radixMemory(state: RadixState) {
  const operand = (value: OperandState) => ({ bits: value.bits.toString(), draft: value.draft ? { radix: value.draft.radix, raw: value.draft.raw, status: value.draft.result.status, message: value.draft.result.status === 'valid' ? undefined : value.draft.result.message } : null });
  return { a: operand(state.a), b: operand(state.b), width: state.width, mode: state.mode, shiftCount: state.shiftCount, group: state.group, notice: state.notice };
}
export function restoreRadixMemory(value: unknown): RadixState | undefined {
  if (!memoryObject(value) || ![8,16,32,64].includes(value.width as number) || !['unsigned','signed'].includes(value.mode as string) || ![4,8].includes(value.group as number) || typeof value.shiftCount !== 'string') return;
  const width = value.width as BitWidth, mode = value.mode as IntegerMode;
  const operand = (input: unknown): OperandState | undefined => {
    if (!memoryObject(input) || typeof input.bits !== 'string' || !/^\d{1,20}$/.test(input.bits)) return;
    const bits = BigInt(input.bits); if (bits >= (1n << BigInt(width))) return;
    if (input.draft === null) return { bits, draft: null };
    if (!memoryObject(input.draft) || ![2,8,10,16].includes(input.draft.radix as number) || typeof input.draft.raw !== 'string' || input.draft.raw.length > 1000) return;
    const radix = input.draft.radix as Radix, raw = input.draft.raw;
    let result: ParseResult;
    if (input.draft.status === 'error' || input.draft.status === 'incomplete') {
      if (typeof input.draft.message !== 'string') return;
      result = { status: input.draft.status, message: input.draft.message };
    } else {
      if (input.draft.status !== undefined && input.draft.status !== 'valid') return;
      result = parseIntegerInput(raw, radix, width, mode);
      if ((input.draft.status === 'valid' && result.status !== 'valid') || (result.status === 'valid' && result.bits !== bits)) return;
    }
    return { bits, draft: { radix, raw, result } };
  };
  const a = operand(value.a), b = operand(value.b);
  return a && b ? { a, b, width, mode, shiftCount: value.shiftCount, group: value.group as 4 | 8, notice: typeof value.notice === 'string' ? value.notice : '' } : undefined;
}
export type RadixAction = { type: 'input'; operand: Operand; radix: Radix; raw: string } | { type: 'width'; width: BitWidth } | { type: 'mode'; mode: IntegerMode } | { type: 'operation'; operation: BitOperation } | { type: 'shiftCount'; raw: string } | { type: 'shift'; direction: ShiftDirection } | { type: 'flip'; index: number } | { type: 'group'; group: 4 | 8 };
export function operandValid(operand: OperandState) { return !operand.draft || operand.draft.result.status === 'valid'; }
export function shiftCountValue(raw: string, width: BitWidth): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const count = BigInt(raw.trim());
  return count <= BigInt(width) ? Number(count) : null;
}
function retainInvalid(operand: OperandState, bits: bigint): OperandState { return { bits, draft: operandValid(operand) ? null : operand.draft }; }
export function radixReducer(state: RadixState, action: RadixAction): RadixState {
  switch (action.type) {
    case 'input': {
      const result = parseIntegerInput(action.raw, action.radix, state.width, state.mode);
      return { ...state, [action.operand]: { bits: result.status === 'valid' ? result.bits : state[action.operand].bits, draft: { radix: action.radix, raw: action.raw, result } }, notice: '' };
    }
    case 'width': {
      const a = resizeBits(state.a.bits, state.width, action.width, state.mode);
      const b = resizeBits(state.b.bits, state.width, action.width, state.mode);
      const narrow = action.width < state.width;
      const changed = [a.truncated ? 'A' : '', b.truncated ? 'B' : ''].filter(Boolean).join('、');
      const pending = !operandValid(state.a) || !operandValid(state.b) ? ' 未完成的输入已保留；继续编辑后按新设置校验。' : '';
      return { ...state, width: action.width, a: retainInvalid(state.a, a.bits), b: retainInvalid(state.b, b.bits), notice: (narrow ? `已保留低 ${action.width} 位。` + (changed ? `${changed} 的高位已截断，数值发生变化。` : '移除的高位未改变数值。') : state.mode === 'signed' ? '已按符号位扩展到新位宽。' : '已在高位补 0 扩展到新位宽。') + pending };
    }
    case 'mode': return { ...state, mode: action.mode, a: retainInvalid(state.a, state.a.bits), b: retainInvalid(state.b, state.b.bits), notice: '位模式保持不变；十进制按所选无符号整数或补码重新解释。' + (!operandValid(state.a) || !operandValid(state.b) ? ' 未完成的输入已保留，继续编辑后按新设置校验。' : '') };
    case 'operation': {
      if (!operandValid(state.a) || (action.operation !== 'not' && !operandValid(state.b))) return state;
      return { ...state, a: { bits: applyBitOperation(action.operation, state.a.bits, state.b.bits, state.width), draft: null }, notice: `${action.operation.toUpperCase()} 结果已更新 A；B 保持不变。` };
    }
    case 'shiftCount': return { ...state, shiftCount: action.raw };
    case 'shift': {
      const count = shiftCountValue(state.shiftCount, state.width);
      if (!operandValid(state.a) || count === null) return state;
      const result = shiftBits(state.a.bits, count, state.width, action.direction);
      return result.status === 'valid' ? { ...state, a: { bits: result.bits, draft: null }, notice: '移位结果已更新 A；B 保持不变。' } : { ...state, notice: result.message };
    }
    case 'flip': {
      if (!operandValid(state.a)) return state;
      const result = flipBit(state.a.bits, action.index, state.width);
      return result.status === 'valid' ? { ...state, a: { bits: result.bits, draft: null }, notice: `已翻转 A 的第 ${action.index} 位；B 保持不变。` } : { ...state, notice: result.message };
    }
    case 'group': return { ...state, group: action.group };
  }
}
const BASES: { radix: Radix; key: string; label: string }[] = [{ radix: 2, key: 'bin', label: '二进制 BIN' }, { radix: 8, key: 'oct', label: '八进制 OCT' }, { radix: 10, key: 'dec', label: '十进制 DEC' }, { radix: 16, key: 'hex', label: '十六进制 HEX' }];
export async function copyIntegerText(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<string> {
  try { if (!clipboard) throw new Error('unavailable'); await clipboard.writeText(text); return '已复制。'; }
  catch { return '复制失败，请选择输入框中的内容手动复制。'; }
}
export function RadixPage() {
  const [remembered, setRemembered] = useViewMemory('radix', () => radixMemory(initialRadixState), undefined, value => { const state = restoreRadixMemory(value); return state ? radixMemory(state) : undefined; });
  const state = restoreRadixMemory(remembered)!;
  const [copyMessage, setCopyMessage] = useState('');
  const validA = operandValid(state.a), validB = operandValid(state.b);
  const count = shiftCountValue(state.shiftCount, state.width);
  const bitIndices = Array.from({ length: state.width }, (_, index) => state.width - 1 - index);
  const bitGroups = Array.from({ length: state.width / state.group }, (_, index) => bitIndices.slice(index * state.group, (index + 1) * state.group));
  function send(action: RadixAction) { setCopyMessage(''); setRemembered(previous => radixMemory(radixReducer(restoreRadixMemory(previous)!, action))); }
  return <div className="radix-page"><Heading eyebrow="常用小工具" title="进制转换" description="固定宽度整数与位运算。输入 A 和 B，运算结果更新 A。" />
    <section className="card radix-settings" aria-label="整数设置">
      <label>位宽<select data-testid="radix-width" value={state.width} onChange={event => send({ type: 'width', width: Number(event.target.value) as BitWidth })}>{[8,16,32,64].map(width => <option key={width} value={width}>{width} 位</option>)}</select></label>
      <label>整数解释<select data-testid="radix-mode" value={state.mode} onChange={event => send({ type: 'mode', mode: event.target.value as IntegerMode })}><option value="unsigned">无符号整数</option><option value="signed">有符号整数（补码）</option></select></label>
      <p className="muted">切换解释保持位模式；缩小位宽保留低位。二、八、十六进制显示完整位模式。</p>
    </section>
    <div className="radix-operands">{(['a','b'] as const).map(operand => {
      const value = state[operand], valid = operandValid(value);
      return <section className="card radix-operand" key={operand} aria-label={operand === 'a' ? 'A 工作值' : 'B 操作数'}>
        <h2>{operand.toUpperCase()} <small>{operand === 'a' ? '工作值' : '操作数'}</small></h2>
        {BASES.map(base => <div className="radix-input-row" key={base.key}><label htmlFor={`radix-${operand}-${base.key}`}>{base.label}</label><input id={`radix-${operand}-${base.key}`} data-testid={`radix-${operand}-${base.key}`} value={value.draft?.radix === base.radix ? value.draft.raw : formatInteger(value.bits, base.radix, state.width, state.mode)} onChange={event => send({ type: 'input', operand, radix: base.radix, raw: event.target.value })} autoComplete="off" spellCheck={false} aria-invalid={!valid && value.draft?.radix === base.radix} aria-describedby={!valid ? `radix-${operand}-error` : undefined} /><button data-testid={`radix-copy-${operand}-${base.key}`} disabled={!valid} aria-label={`复制 ${operand.toUpperCase()} 的${base.label}`} onClick={async () => setCopyMessage(await copyIntegerText(formatInteger(value.bits, base.radix, state.width, state.mode), navigator.clipboard))}><Copy size={15} /></button></div>)}
        {!valid && value.draft && value.draft.result.status !== 'valid' && <p id={`radix-${operand}-error`} className="radix-error" role="alert">{value.draft.result.message} 其他进制保留上次有效值；完成输入后联动。</p>}
      </section>;
    })}</div>
    <section className="card radix-operations" aria-label="位运算"><h2>位运算 <small>结果更新 A，B 保持不变</small></h2>
      <div className="radix-button-row">{(['and','or','xor','not'] as const).map(operation => <button key={operation} data-testid={`radix-${operation}`} disabled={!validA || (operation !== 'not' && !validB)} onClick={() => send({ type: 'operation', operation })}>{operation.toUpperCase()} <small>{({and:'与',or:'或',xor:'异或',not:'A 取反'})[operation]}</small></button>)}</div>
      <div className="radix-shifts"><label htmlFor="radix-shift-count">移位位数<input id="radix-shift-count" data-testid="radix-shift-count" inputMode="numeric" value={state.shiftCount} onChange={event => send({ type: 'shiftCount', raw: event.target.value })} aria-invalid={count === null} /></label>
      {([{direction:'left',key:'left',label:'左移'},{direction:'logicalRight',key:'logical-right',label:'逻辑右移（补 0）'},{direction:'arithmeticRight',key:'arithmetic-right',label:'算术右移（按符号位）'}] as const).map(shift => <button key={shift.key} data-testid={`radix-shift-${shift.key}`} disabled={!validA || count === null} onClick={() => send({ type: 'shift', direction: shift.direction })}>{shift.label}</button>)}</div>
      {count === null && <p className="radix-error" role="alert">移位位数须为 0–{state.width} 的整数。</p>}
      <p className="muted radix-help">左移移出的高位丢弃；逻辑右移补 0。算术右移始终按 A 的最高位补齐，包括无符号显示模式。</p>
    </section>
    {(state.notice || copyMessage) && <p className="radix-notice" role="status">{copyMessage || state.notice}</p>}
    <section className="card radix-bit-panel" aria-label="A 位模式"><div className="radix-bit-heading"><h2>A 位模式 <small>点击翻转，最低位编号 0</small></h2><label>分组<select data-testid="radix-group" value={state.group} onChange={event => send({ type: 'group', group: Number(event.target.value) as 4 | 8 })}><option value={4}>每 4 位</option><option value={8}>每 8 位</option></select></label></div>
      <div className={`radix-bit-groups radix-group-${state.group}`}>{bitGroups.map(indices => <div className="radix-bit-group" key={indices[0]}><span className="radix-bit-range">{indices[0]}–{indices[indices.length-1]}</span><div>{indices.map(index => { const bit = (state.a.bits >> BigInt(index)) & 1n; return <button key={index} data-testid={`radix-bit-${index}`} disabled={!validA} aria-label={`第 ${index} 位，当前 ${bit}，点击翻转`} aria-pressed={bit === 1n} className={bit === 1n ? 'set' : ''} onClick={() => send({ type: 'flip', index })}><small>{index}</small><strong>{bit.toString()}</strong></button>; })}</div></div>)}</div>
    </section>
  </div>;
}
