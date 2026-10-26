import { fail, parseNumericInput, type CalculationResult } from '../shared/numeric';
import { number } from '../shared/units';

export type ResistanceUnit = 'Ω' | 'kΩ' | 'MΩ';
export interface DividerInput { supply: string; upper: string; upperUnit: ResistanceUnit; lower: string; lowerUnit: ResistanceUnit }
export interface DividerResult { supplyV: number; upperOhms: number; lowerOhms: number; midpointV: number; currentA: number }
const multipliers: Record<ResistanceUnit, number> = { 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6 };
export const DIVIDER_EXAMPLE: Readonly<DividerInput> = { supply: '5', upper: '10', upperUnit: 'kΩ', lower: '10', lowerUnit: 'kΩ' };

export function calculateDivider(input: DividerInput): CalculationResult<DividerResult> {
  const supplyV = parseNumericInput(input.supply), upper = parseNumericInput(input.upper), lower = parseNumericInput(input.lower);
  if (!Number.isFinite(supplyV) || supplyV < 0) return fail('供电电压必须是大于或等于 0 的有限数值（V）。');
  if (!Number.isFinite(upper) || upper < 0) return fail('上电阻 R1 必须是大于或等于 0 的有限阻值。');
  if (!Number.isFinite(lower) || lower < 0) return fail('下电阻 R2 必须是大于或等于 0 的有限阻值。');
  const upperOhms = upper * multipliers[input.upperUnit], lowerOhms = lower * multipliers[input.lowerUnit];
  if (!Number.isFinite(upperOhms) || !Number.isFinite(lowerOhms)) return fail('电阻单位换算超出数值范围。');
  const total = upperOhms + lowerOhms;
  if (total === 0) return fail('上、下电阻不能同时为 0 Ω，分压支路会短路。');
  if (!Number.isFinite(total)) return fail('总电阻超出数值范围，请减小输入阻值。');
  // Divide first to avoid overflowing Vin × R2 for otherwise finite results.
  const midpointV = supplyV * (lowerOhms / total), currentA = supplyV / total;
  if (!Number.isFinite(currentA) || (supplyV > 0 && currentA === 0) || (supplyV > 0 && lowerOhms > 0 && midpointV === 0)) return fail('计算结果超出可表示的数值范围，请调整电压或阻值。');
  return { ok: true, value: { supplyV, upperOhms, lowerOhms, midpointV, currentA } };
}

export function dividerCurrent(currentA: number): string {
  const [scale, unit]: readonly [number, string] = currentA === 0 || currentA >= 1 ? [1, 'A'] : currentA >= 1e-3 ? [1e-3, 'mA'] : currentA >= 1e-6 ? [1e-6, 'µA'] : currentA >= 1e-9 ? [1e-9, 'nA'] : [1, 'A'];
  return `${number(currentA / scale)} ${unit}`;
}
