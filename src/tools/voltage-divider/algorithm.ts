import { fail, parseNumericInput, type CalculationResult } from '../shared/numeric';
import { number } from '../shared/units';

export type ResistanceUnit = 'Ω' | 'kΩ' | 'MΩ';
export const DIVIDER_PARAMETERS = ['supply', 'upper', 'lower', 'midpoint'] as const;
export type DividerParameter = typeof DIVIDER_PARAMETERS[number];
export interface DividerInput { supply: string; upper: string; upperUnit: ResistanceUnit; lower: string; lowerUnit: ResistanceUnit; midpoint: string; solveFor: DividerParameter }
export interface DividerResult { supplyV: number; upperOhms: number; lowerOhms: number; midpointV: number; currentA: number }
const multipliers: Record<ResistanceUnit, number> = { 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6 };
export const DIVIDER_EXAMPLE: Readonly<DividerInput> = { supply: '5', upper: '10', upperUnit: 'kΩ', lower: '10', lowerUnit: 'kΩ', midpoint: '2.5', solveFor: 'midpoint' };
export const DIVIDER_LABELS: Record<DividerParameter, string> = { supply: '供电电压 Vin', upper: '上电阻 R1', lower: '下电阻 R2', midpoint: '中点电压 Vmid' };

/** Accept the previous three-input memory shape; discard malformed settings. */
export function restoreDividerInput(value: unknown): DividerInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const saved = value as Record<string, unknown>, input = { ...DIVIDER_EXAMPLE };
  for (const key of DIVIDER_PARAMETERS) {
    if (Object.hasOwn(saved, key)) {
      if (typeof saved[key] !== 'string' || saved[key].length > 256) return undefined;
      input[key] = saved[key];
    }
  }
  for (const key of ['upperUnit', 'lowerUnit'] as const) {
    if (Object.hasOwn(saved, key)) {
      if (!Object.hasOwn(multipliers, String(saved[key]))) return undefined;
      input[key] = saved[key] as ResistanceUnit;
    }
  }
  if (Object.hasOwn(saved, 'solveFor')) {
    if (!DIVIDER_PARAMETERS.includes(saved.solveFor as DividerParameter)) return undefined;
    input.solveFor = saved.solveFor as DividerParameter;
  }
  return changeDividerInput(input, {});
}

/** Try equivalent orders before declaring a finite result unrepresentable. */
function productRatio(value: number, numerator: number, denominator: number): number {
  if (value === 0 || numerator === 0) return 0;
  for (const result of [value * (numerator / denominator), (value / denominator) * numerator, (value * numerator) / denominator]) {
    if (Number.isFinite(result) && result > 0) return result;
  }
  return NaN;
}

export function dividerResultValue(key: DividerParameter, result: DividerResult, input: DividerInput): number {
  if (key === 'supply') return result.supplyV;
  if (key === 'midpoint') return result.midpointV;
  return key === 'upper' ? result.upperOhms / multipliers[input.upperUnit] : result.lowerOhms / multipliers[input.lowerUnit];
}

/** Keep the latest valid computed value available through unfinished edits. */
export function changeDividerInput(input: DividerInput, patch: Partial<DividerInput>): DividerInput {
  const next = { ...input, ...patch }, result = calculateDivider(next);
  return result.ok ? { ...next, [next.solveFor]: String(dividerResultValue(next.solveFor, result.value, next)) } : next;
}

/** Presentation rounding must never become a condition for the next solve. */
export function selectDividerTarget(input: DividerInput, solveFor: DividerParameter): DividerInput {
  if (input.solveFor === solveFor) return input;
  const result = calculateDivider(input);
  return { ...input, ...(result.ok ? { [input.solveFor]: String(dividerResultValue(input.solveFor, result.value, input)) } : {}), solveFor };
}

export function calculateDivider(input: DividerInput): CalculationResult<DividerResult> {
  const target = input.solveFor ?? 'midpoint';
  if (!DIVIDER_PARAMETERS.includes(target)) return fail('请选择一个有效的求解参数。');
  const known = {} as Record<DividerParameter, number>;
  for (const key of DIVIDER_PARAMETERS) {
    if (key === target) continue;
    const value = parseNumericInput(input[key]);
    if (!Number.isFinite(value) || value < 0) return fail(`${DIVIDER_LABELS[key]}必须是大于或等于 0 的有限数值。`);
    known[key] = value;
  }
  let supplyV = known.supply, midpointV = known.midpoint;
  let upperOhms = target === 'upper' ? NaN : known.upper * multipliers[input.upperUnit];
  let lowerOhms = target === 'lower' ? NaN : known.lower * multipliers[input.lowerUnit];
  if ((target !== 'upper' && !Number.isFinite(upperOhms)) || (target !== 'lower' && !Number.isFinite(lowerOhms))) return fail('电阻单位换算超出数值范围。');
  if ((target === 'supply' || target === 'midpoint') && upperOhms === 0 && lowerOhms === 0) return fail('上、下电阻不能同时为 0 Ω，分压支路会短路。');
  if (target !== 'midpoint' && target !== 'supply' && midpointV > supplyV) return fail('无解：中点电压不能大于供电电压。');
  if (target === 'supply') {
    if (lowerOhms === 0) return midpointV === 0
      ? fail('无法唯一确定供电电压：下电阻为 0 Ω 时，中点电压始终为 0 V。')
      : fail('无解：下电阻为 0 Ω 时，中点电压只能为 0 V。');
    supplyV = productRatio(midpointV, upperOhms + lowerOhms, lowerOhms);
  } else if (target === 'upper') {
    if (supplyV === 0) return fail('无法唯一确定上电阻：供电和中点电压均为 0 V，多个阻值都满足条件。');
    if (lowerOhms === 0) return midpointV === 0
      ? fail('无法唯一确定上电阻：下电阻为 0 Ω、中点为 0 V，多个上电阻值都满足条件。')
      : fail('无解：下电阻为 0 Ω 时，中点电压只能为 0 V。');
    if (midpointV === 0) return fail('无有限解：下电阻大于 0 Ω 时，有限的上电阻不能使中点电压等于 0 V。');
    upperOhms = productRatio(lowerOhms, supplyV - midpointV, midpointV);
  } else if (target === 'lower') {
    if (supplyV === 0) return fail('无法唯一确定下电阻：供电和中点电压均为 0 V，多个阻值都满足条件。');
    if (upperOhms === 0) return midpointV === supplyV
      ? fail('无法唯一确定下电阻：上电阻为 0 Ω、中点等于供电电压，多个下电阻值都满足条件。')
      : fail('无解：上电阻为 0 Ω 时，中点电压只能等于供电电压。');
    if (midpointV === supplyV) return fail('无有限解：上电阻大于 0 Ω 时，有限的下电阻不能使中点等于供电电压。');
    lowerOhms = productRatio(upperOhms, midpointV, supplyV - midpointV);
  }
  if (!Number.isFinite(upperOhms) || !Number.isFinite(lowerOhms)) return fail('计算结果超出可表示的数值范围，请调整数值或电阻单位。');
  const total = upperOhms + lowerOhms;
  if (total === 0) return fail('上、下电阻不能同时为 0 Ω，分压支路会短路。');
  if (!Number.isFinite(total)) return fail('总电阻超出数值范围，请减小输入阻值。');
  if (target === 'midpoint') midpointV = productRatio(supplyV, lowerOhms, total);
  const currentA = supplyV / total;
  if (![supplyV, midpointV, currentA].every(Number.isFinite) || (supplyV > 0 && currentA === 0)
    || (upperOhms > 0 && upperOhms / multipliers[input.upperUnit] === 0) || (lowerOhms > 0 && lowerOhms / multipliers[input.lowerUnit] === 0)) return fail('计算结果超出可表示的数值范围，请调整数值或电阻单位。');
  return { ok: true, value: { supplyV, upperOhms, lowerOhms, midpointV, currentA } };
}

export function dividerCurrent(currentA: number): string {
  const [scale, unit]: readonly [number, string] = currentA === 0 || currentA >= 1 ? [1, 'A'] : currentA >= 1e-3 ? [1e-3, 'mA'] : currentA >= 1e-6 ? [1e-6, 'µA'] : currentA >= 1e-9 ? [1e-9, 'nA'] : [1, 'A'];
  return `${number(currentA / scale)} ${unit}`;
}
