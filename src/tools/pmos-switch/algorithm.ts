import { fail, positiveFinite, type CalculationResult } from '../shared/numeric';
export interface PmosRequest { vin: number; vsg: number; currentA: number; maxVgs: number }
export interface PmosResult { r1: number; r2: number; gateV: number; power1: number; power2: number; totalPower: number; exceedsVgs: boolean }
export function calculatePmos(p: PmosRequest): CalculationResult<PmosResult> {
  if (![p.vin, p.vsg, p.currentA, p.maxVgs].every(positiveFinite)) return fail('Vin、目标开启电压、分压支路电流和栅源额定值必须为有限正数。');
  if (p.vsg >= p.vin) return fail('本电路要求 0 < |VGS| < Vin，才能用两颗正阻值电阻分压。');
  const r1 = p.vsg / p.currentA, r2 = (p.vin - p.vsg) / p.currentA, power1 = p.vsg * p.currentA, power2 = (p.vin - p.vsg) * p.currentA, totalPower = p.vin * p.currentA;
  if (![r1, r2, power1, power2, totalPower].every(positiveFinite)) return fail('电阻或功耗超出可表示的数值范围。');
  return { ok: true, value: { r1, r2, gateV: p.vin - p.vsg, power1, power2, totalPower, exceedsVgs: p.vsg >= p.maxVgs } };
}
