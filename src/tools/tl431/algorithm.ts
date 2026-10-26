import { fail, positiveFinite, type CalculationResult } from '../shared/numeric';
export interface Tl431Request { mode: 'voltage' | 'r1'; r1: number; r2: number; target: number; vref: number; irefA: number; supplyV: number; supplyOhms: number; loadA: number }
export interface Tl431Result { outputV: number; r1: number; lowerCurrent: number; upperCurrent: number; supplyCurrent: number; cathodeCurrent: number; maxSupplyOhms: number | null; cathodePower: number | null; regulated: boolean; issues: string[] }
export function calculateTl431(p: Tl431Request): CalculationResult<Tl431Result> {
  if (![p.r2, p.vref, p.supplyOhms].every(positiveFinite) || ![p.irefA, p.supplyV, p.loadA].every(v => Number.isFinite(v) && v >= 0)) return fail('R2、Vref 和供电限流电阻必须为正；供电电压、负载电流和 REF 电流须为有限非负数。');
  if (p.vref > 36) return fail('Vref 超出 TL431 的 36 V 工作范围。');
  if (p.mode === 'r1' && (!Number.isFinite(p.target) || p.target < p.vref || p.target > 36)) return fail('目标电压必须在 Vref 到 36 V 之间。');
  const lowerCurrent = p.vref / p.r2, upperCurrent = lowerCurrent + p.irefA;
  const r1 = p.mode === 'r1' ? (p.target - p.vref) / upperCurrent : p.r1;
  if (!Number.isFinite(r1) || r1 < 0) return fail('上电阻 R1 必须为有限非负数。');
  // Positive Iref flows into REF: KCL gives IR1 = IR2 + Iref (TI SLVA445).
  const outputV = p.vref + upperCurrent * r1, supplyCurrent = (p.supplyV - outputV) / p.supplyOhms, cathodeCurrent = supplyCurrent - p.loadA - upperCurrent;
  const maxSupplyOhms = p.supplyV > outputV ? (p.supplyV - outputV) / (p.loadA + upperCurrent + .001) : null;
  if (![outputV, lowerCurrent, upperCurrent, supplyCurrent, cathodeCurrent, ...(maxSupplyOhms === null ? [] : [maxSupplyOhms])].every(Number.isFinite)) return fail('计算结果超出可表示范围。');
  const issues: string[] = [];
  if (outputV > 36) issues.push('理论设定电压超过 36 V 工作范围');
  if (p.supplyV <= outputV) issues.push('供电电压不足以建立目标输出');
  if (cathodeCurrent < .001) issues.push('阴极电流小于按通用 TL431 采用的 1 mA 最低设计值');
  if (cathodeCurrent > .1) issues.push('阴极电流超过 100 mA 工作范围');
  const regulated = !issues.length, cathodePower = regulated ? outputV * cathodeCurrent : null;
  if (cathodePower !== null && !Number.isFinite(cathodePower)) return fail('阴极功耗超出可表示范围。');
  return { ok: true, value: { outputV, r1, lowerCurrent, upperCurrent, supplyCurrent, cathodeCurrent, maxSupplyOhms, cathodePower, regulated, issues } };
}
