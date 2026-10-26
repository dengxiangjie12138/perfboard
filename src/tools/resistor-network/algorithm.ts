import { fail, positiveFinite, type CalculationResult } from '../shared/numeric';
export type NetworkMode = 'series' | 'parallel';
export type ResistanceUnit = 'Ω' | 'kΩ' | 'MΩ';
export interface ResistorInput { resistance: string; unit: ResistanceUnit; power: string }
export interface NetworkResult { equivalentOhms: number; ratedPowerW: number; limitingIndices: number[] }
const multipliers: Record<ResistanceUnit, number> = { 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6 };
export function calculateNetwork(mode: NetworkMode, rows: ResistorInput[]): CalculationResult<NetworkResult> {
  if (rows.length === 0) return fail('至少需要一颗电阻。');
  const resistances: number[] = [], powers: number[] = [];
  for (const [index, row] of rows.entries()) {
    const raw = row.resistance.trim() === '' ? NaN : Number(row.resistance);
    const power = row.power.trim() === '' ? NaN : Number(row.power);
    if (!positiveFinite(raw)) return fail(`R${index + 1} 阻值必须是有限正数；当前不支持 0 Ω 短路。`);
    const ohms = raw * multipliers[row.unit];
    if (!positiveFinite(ohms)) return fail(`R${index + 1} 阻值单位换算超出数值范围。`);
    if (!positiveFinite(power)) return fail(`R${index + 1} 额定功率必须是有限正数（W）。`);
    resistances.push(ohms); powers.push(power);
  }
  // Normalize before summation: no reciprocal or unnecessary R × P overflow.
  const scale = resistances.reduce((value, r) => mode === 'series' ? Math.max(value, r) : Math.min(value, r), resistances[0]);
  const sum = resistances.reduce((value, r) => value + (mode === 'series' ? r / scale : scale / r), 0);
  const equivalentOhms = mode === 'series' ? scale * sum : scale / sum;
  if (!positiveFinite(equivalentOhms)) return fail('等效电阻超出数值范围，无法表示。');
  const limits = resistances.map((r, index) => Math.log(powers[index]) + (mode === 'series' ? -Math.log(r) : Math.log(r)));
  const limit = limits.reduce((value, item) => Math.min(value, item), limits[0]);
  const logPower = limit + (mode === 'series' ? Math.log(equivalentOhms) : -Math.log(equivalentOhms));
  const ratedPowerW = Math.exp(logPower);
  if (!positiveFinite(ratedPowerW)) return fail('整组额定功率限制超出数值范围，无法表示。');
  const limitingIndices = limits.flatMap((value, index) => Math.abs(value - limit) <= 1e-12 ? [index] : []);
  return { ok: true, value: { equivalentOhms, ratedPowerW, limitingIndices } };
}
export function formatNetworkNumber(value: number): string {
  return Number(value.toPrecision(12)).toString();
}