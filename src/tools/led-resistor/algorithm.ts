import type { Part } from '../../types';
import { parseInventoryResistors } from '../feedback/inventory';
import { standardResistors, type Resistor, type ResistorSeries } from '../feedback/algorithm';
import { fail, positiveFinite, type CalculationResult } from '../shared/numeric';
export interface LedRequest { supplyV: number; forwardV: number; currentMa: number; count: number; margin: number }
export interface LedResistor extends Resistor { part?: Part; ratedPowerW?: number }
export interface LedCandidate { resistor: LedResistor; actualMa: number; deviationPercent: number; powerW: number; requiredPowerW: number; suggestedPowerW: number | null; powerStatus: 'pass' | 'insufficient' | 'unknown' }
export interface LedResult { voltageDrop: number; theoryOhms: number; theoryPowerW: number; requiredPowerW: number; suggestedPowerW: number | null; candidates: LedCandidate[] }
export const POWER_RATINGS_W = [0.0625, 0.1, 0.125, 0.25, 0.5, 1, 2, 3, 5, 10, 20, 25, 50, 100] as const;
export function suggestedRating(requiredW: number): number | null { return POWER_RATINGS_W.find(value => value >= requiredW) ?? null; }
function normalizeFractionPower(text: string): string {
  return text.replace(/(\d+)\s*\/\s*(\d+)\s*(mW|W)(?![A-Za-z0-9])/g, (_, numerator: string, denominator: string, unit: string) => Number(denominator) > 0 ? String(Number(numerator) / Number(denominator)) + " " + unit : "invalid-power");
}
// Only explicit power units following a readable resistance or power label are trusted.
export function parseRatedPower(part: Pick<Part, 'name' | 'brief' | 'parameters'>): number | undefined {
  const numberUnit = '(\\d+\\s*\\/\\s*\\d+|\\d+(?:\\.\\d+)?|\\.\\d+)\\s*(mW|W)(?![A-Za-z0-9])';
  const powers: number[] = [];
  function collect(text: string, expression: RegExp) {
    for (const match of text.matchAll(expression)) {
      if (match[2] !== 'mW' && match[2] !== 'W') { powers.push(NaN); continue; }
      const token = match[1].replace(/\s/g, '');
      const fraction = token.split('/');
      const numeric = fraction.length === 2 ? Number(fraction[0]) / Number(fraction[1]) : Number(token);
      const value = numeric * (match[2] === 'mW' ? 0.001 : 1);
      if (!positiveFinite(value) || value > 1000) { powers.push(NaN); continue; }
      powers.push(value);
    }
  }
  // Names must start with a resistance that the shared inventory parser recognizes.
  if (parseInventoryResistors([{ id: '', name: normalizeFractionPower(part.name), category: '电阻' }]).length) {
    collect(part.name, new RegExp('(?:Ω|Ω|ohms?|欧姆)(?:\\s*[,，;；]\\s*|\\s+)(?:±\\s*[\\d.]+\\s*%\\s+)?' + numberUnit, 'gi'));
  }
  for (const text of [part.name, part.brief, part.parameters]) collect(text, new RegExp('(?:额定功率|功率)\\s*[:：=]\\s*' + numberUnit, 'g'));
  // Legacy explicit resistance/power tails use the same readable name rules.
  if (parseInventoryResistors([{ id: '', name: normalizeFractionPower(part.parameters), category: '电阻' }]).length) collect(part.parameters, new RegExp('(?:Ω|Ω|ohms?|欧姆)\\s+(?:±\\s*[\\d.]+\\s*%\\s+)?' + numberUnit, 'gi'));
  return powers.length && powers.every(value => Number.isFinite(value) && value === powers[0]) ? powers[0] : undefined;
}
export function inventoryLedResistors(parts: readonly Part[]): LedResistor[] {
  const originals = new Map(parts.map(part => [part.id, part]));
  return parseInventoryResistors(parts.map(part => ({ ...part, name: normalizeFractionPower(part.name), parameters: normalizeFractionPower(part.parameters) }))).map(resistor => { const part = originals.get(resistor.id!)!; return { ...resistor, name: part.name, part, ratedPowerW: parseRatedPower(part) }; });
}
export function availableLedResistors(resistors: readonly LedResistor[]): LedResistor[] {
  return resistors.filter(resistor => !resistor.part || (resistor.part.stockStatus !== 'out_of_stock' && resistor.part.quantity !== 0));
}
export function ledStandardResistors(series: ResistorSeries): LedResistor[] { return standardResistors(series); }
export function calculateLed(request: LedRequest, resistors: readonly LedResistor[], limit = 12): CalculationResult<LedResult> {
  const { supplyV, forwardV, currentMa, count, margin } = request;
  if (![supplyV, forwardV, currentMa].every(positiveFinite)) return fail('电源电压、单颗 LED 正向压降和目标电流必须为有限正数。');
  if (!Number.isSafeInteger(count) || count <= 0) return fail('LED 串联数量必须为正整数。');
  if (!Number.isFinite(margin) || margin < 1) return fail('功率余量系数必须是大于或等于 1 的有限数。');
  if (!Number.isSafeInteger(limit) || limit < 1) return fail('候选数量必须为正整数。');
  const voltageDrop = supplyV - count * forwardV;
  if (!positiveFinite(voltageDrop)) return fail('电源电压必须大于所有串联 LED 的正向压降之和。');
  const targetA = currentMa / 1000;
  const theoryOhms = voltageDrop / targetA, theoryPowerW = voltageDrop * targetA, requiredPowerW = theoryPowerW * margin;
  if (![targetA, theoryOhms, theoryPowerW, requiredPowerW].every(positiveFinite)) return fail('计算结果超出可表示范围，请调整参数。');
  if (resistors.some(resistor => !positiveFinite(resistor.ohms))) return fail('候选电阻包含无效阻值。');
  const candidates: LedCandidate[] = [];
  for (const resistor of availableLedResistors(resistors)) {
    if (resistor.ohms < theoryOhms) continue;
    const actualMa = voltageDrop / resistor.ohms * 1000;
    const powerW = voltageDrop * (actualMa / 1000), needed = powerW * margin;
    if (![actualMa, powerW, needed].every(positiveFinite) || actualMa > currentMa) continue;
    const powerStatus = !positiveFinite(resistor.ratedPowerW ?? NaN) ? 'unknown' : resistor.ratedPowerW! >= needed ? 'pass' : 'insufficient';
    candidates.push({ resistor, actualMa, deviationPercent: (actualMa - currentMa) / currentMa * 100, powerW, requiredPowerW: needed, suggestedPowerW: suggestedRating(needed), powerStatus });
  }
  const rank = { pass: 0, unknown: 1, insufficient: 2 };
  candidates.sort((a, b) => rank[a.powerStatus] - rank[b.powerStatus] || a.resistor.ohms - b.resistor.ohms || (a.resistor.id ?? '').localeCompare(b.resistor.id ?? ''));
  return { ok: true, value: { voltageDrop, theoryOhms, theoryPowerW, requiredPowerW, suggestedPowerW: suggestedRating(requiredPowerW), candidates: candidates.slice(0, limit) } };
}

// Vishay D/CRCW e3, P70 standard operating mode. Never infer inventory ratings.
export const PACKAGE_REFERENCE = [
  { packageName: '0402', powerW: 0.063 }, { packageName: '0603', powerW: 0.1 },
  { packageName: '0805', powerW: 0.125 }, { packageName: '1206', powerW: 0.25 },
  { packageName: '1210', powerW: 0.5 }, { packageName: '2010', powerW: 0.75 }, { packageName: '2512', powerW: 1 },
] as const;
export function referencePackages(requiredPowerW: number) {
  return positiveFinite(requiredPowerW) ? PACKAGE_REFERENCE.filter(item => item.powerW >= requiredPowerW).slice(0, 2) : [];
}



