import { fail, positiveFinite, type CalculationResult } from '../shared/numeric';
export type ResistorSeries = 'E24' | 'E96';
export interface Resistor { ohms: number; id?: string; name?: string; location?: string; stockStatus?: string }
export interface FeedbackCandidate { top: Resistor; bottom: Resistor; actualVolts: number; errorPercent: number; dividerCurrentMa: number; topPowerMw: number; bottomPowerMw: number }
export interface FeedbackRequest { outputVolts: number; referenceVolts: number; maxErrorPercent: number; maxDividerCurrentMa?: number }
// Published preferred values, not rounded powers of 10 (E24 and E96 differ).
const E24 = [100,110,120,130,150,160,180,200,220,240,270,300,330,360,390,430,470,510,560,620,680,750,820,910];
const E96 = [100,102,105,107,110,113,115,118,121,124,127,130,133,137,140,143,147,150,154,158,162,165,169,174,178,182,187,191,196,200,205,210,215,221,226,232,237,243,249,255,261,267,274,280,287,294,301,309,316,324,332,340,348,357,365,374,383,392,402,412,422,432,442,453,464,475,487,499,511,523,536,549,562,576,590,604,619,634,649,665,681,698,715,732,750,768,787,806,825,845,866,887,909,931,953,976];
export function standardResistors(series: ResistorSeries): Resistor[] {
  const bases = series === 'E96' ? E96 : E24;
  const values: Resistor[] = [];
  // Explicit tool search range: 10 ohms through 1 megohm, inclusive.
  for (let decade = -1; decade <= 4; decade++) for (const base of bases) {
    const ohms = Number((base * 10 ** decade).toPrecision(12));
    if (ohms >= 10 && ohms <= 1e6) values.push({ ohms });
  }
  return values;
}
export function feedbackVoltage(referenceVolts: number, topOhms: number, bottomOhms: number): CalculationResult<number> {
  if (![referenceVolts, topOhms, bottomOhms].every(positiveFinite)) return fail('基准电压和电阻必须为有限正数。');
  const actual = referenceVolts * (1 + topOhms / bottomOhms);
  if (!positiveFinite(actual)) return fail('计算结果超出可表示范围。');
  return { ok: true, value: actual };
}
export function recommendFeedback(request: FeedbackRequest, resistors: readonly Resistor[], limit = 12): CalculationResult<FeedbackCandidate[]> {
  const { outputVolts, referenceVolts, maxErrorPercent, maxDividerCurrentMa = 0.1 } = request;
  if (!positiveFinite(maxDividerCurrentMa)) return fail("最大分压电流必须为有限正数。");
  if (!positiveFinite(outputVolts) || !positiveFinite(referenceVolts) || outputVolts <= referenceVolts) return fail('要求 Vout > Vref > 0，且电压必须为有限数。');
  if (!Number.isFinite(maxErrorPercent) || maxErrorPercent < 0 || maxErrorPercent > 100) return fail('标称误差上限必须在 0–100 % 之间。');
  if (!Number.isSafeInteger(limit) || limit < 1) return fail('候选数量必须为正整数。');
  if (resistors.some(r => !positiveFinite(r.ohms))) return fail('候选电阻包含无效阻值。');
  const candidates: FeedbackCandidate[] = [];
  for (const top of resistors) for (const bottom of resistors) {
    // The same standard value can be used twice. A repository item requires two parts.
    const result = feedbackVoltage(referenceVolts, top.ohms, bottom.ohms);
    if (!result.ok) continue;
    const dividerCurrentAmps = referenceVolts / bottom.ohms;
    const dividerCurrentMa = dividerCurrentAmps * 1000;
    const topPowerMw = dividerCurrentAmps ** 2 * top.ohms * 1000;
    const bottomPowerMw = dividerCurrentAmps ** 2 * bottom.ohms * 1000;
    if (![dividerCurrentMa, topPowerMw, bottomPowerMw].every(positiveFinite) || dividerCurrentMa > maxDividerCurrentMa) continue;
    const errorPercent = (result.value - outputVolts) / outputVolts * 100;
    if (Number.isFinite(errorPercent) && Math.abs(errorPercent) <= maxErrorPercent) candidates.push({ top, bottom, actualVolts: result.value, errorPercent, dividerCurrentMa, topPowerMw, bottomPowerMw });
  }
  candidates.sort((a,b) => Math.abs(a.errorPercent) - Math.abs(b.errorPercent) || a.top.ohms - b.top.ohms || a.bottom.ohms - b.bottom.ohms);
  return { ok: true, value: candidates.slice(0,limit) };
}
// Accept explicit units only; do not mistake package codes or quantities for ohms.
export function parseResistance(text: string): number | null {
  const match = text.trim().match(/^(?:阻值\s*[:：=]\s*)?(\d+(?:\.\d+)?|\.\d+)\s*(k|K|M|m)?\s*(?:Ω|Ω|ohms?|欧姆)(?:\s*[,，;；]\s*.*|\s+(?:±\s*(?:\d+(?:\.\d+)?|\.\d+)\s*%(?:\s+(?:\d+(?:\.\d+)?|\.\d+)\s*(?:mW|W))?|(?:\d+(?:\.\d+)?|\.\d+)\s*(?:mW|W)))?$/i);
  if (!match) return null;
  const multiplier = match[2] === 'M' ? 1e6 : match[2] === 'm' ? 1e-3 : match[2]?.toLowerCase() === 'k' ? 1e3 : 1;
  const value = Number(match[1]) * multiplier;
  return positiveFinite(value) ? value : null;
}
