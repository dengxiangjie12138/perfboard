import { fail, positiveFinite, type CalculationResult } from '../shared/numeric';
export type Connection = 'normal' | 'idle' | 'reverse';
export type IdleMode = 'zero' | 'disconnected';
export interface PullupRequest { vin: number; pullupV: number; r1: number; r2: number; r3: number; adcMax: number; idleMode: IdleMode }
export interface PullupState { kind: Connection; inputV: number | null; outputV: number; i1: number; i2: number; i3: number; inRange: boolean }
export interface PullupResult { states: PullupState[]; k: number; b: number }
export function calculatePullup(p: PullupRequest): CalculationResult<PullupResult> {
  if (![p.vin, p.pullupV].every(v => Number.isFinite(v) && v >= 0)) return fail('输入电压幅值和上拉电源必须为有限非负数。');
  if (![p.r1, p.r2, p.r3, p.adcMax].every(positiveFinite)) return fail('三颗电阻及采样端允许上限必须为有限正数。');
  if (p.idleMode !== 'zero' && p.idleMode !== 'disconnected') return fail('请选择未接入时的输入等效状态。');
  const scale = Math.min(p.r1, p.r2, p.r3), w1 = scale / p.r1, w2 = scale / p.r2, w3 = scale / p.r3;
  const states = (['normal', 'idle', 'reverse'] as const).map(kind => {
    const inputV = kind === 'idle' ? p.idleMode === 'disconnected' ? null : 0 : kind === 'normal' ? p.vin : -p.vin;
    const outputV = ((inputV ?? 0) * (inputV === null ? 0 : w1) + p.pullupV * w3) / ((inputV === null ? 0 : w1) + w2 + w3);
    return { kind, inputV, outputV, i1: inputV === null ? 0 : (inputV - outputV) / p.r1, i2: outputV / p.r2, i3: (p.pullupV - outputV) / p.r3, inRange: outputV >= 0 && outputV <= p.adcMax };
  });
  const k = 1 + p.r1 / p.r2 + p.r1 / p.r3, b = -p.r1 / p.r3 * p.pullupV;
  if (![k, b, ...states.flatMap(s => [s.outputV, s.i1, s.i2, s.i3])].every(Number.isFinite)) return fail('电压或电流超出可表示范围。');
  return { ok: true, value: { states, k, b } };
}
