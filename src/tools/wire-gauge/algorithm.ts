import reference from './current-reference.json';
export const NOMINAL_AREAS = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400] as const;
export type CurrentUnit = 'A' | 'mA';
export type ReferenceStatus = 'all' | 'within' | 'below' | 'above';
export interface Candidate { n: number; label: string; area: number; diameter: number; nearest: number | null; conservative: number; normal: number; maximum: number; status: ReferenceStatus }
export type WireResult = { ok: false; error: string } | { ok: true; current: number | null; matchCount: number; candidates: Candidate[] };
export function awgDiameter(n: number): number {
  if (!Number.isInteger(n) || n < -3 || n > 46) throw new RangeError('AWG 必须为 4/0 至 46');
  return 0.127 * 92 ** ((36 - n) / 39);
}
export function awgArea(n: number): number { return Math.PI * awgDiameter(n) ** 2 / 4; }
export function nominalMatch(area: number): number | null {
  if (!Number.isFinite(area) || area < NOMINAL_AREAS[0] || area > NOMINAL_AREAS[NOMINAL_AREAS.length - 1]) return null;
  return NOMINAL_AREAS.reduce<number>((best, value) => Math.abs(value - area) < Math.abs(best - area) ? value : best, NOMINAL_AREAS[0]);
}
export function allWireCandidates(): Candidate[] {
  return reference.rows.map(row => ({ ...row, label: row.n <= 0 ? `${1 - row.n}/0` : String(row.n), area: awgArea(row.n), diameter: awgDiameter(row.n), nearest: nominalMatch(awgArea(row.n)), status: 'all' }));
}
export function calculateWire(raw: string, unit: CurrentUnit): WireResult {
  const all = allWireCandidates();
  if (raw.trim() === '') return { ok: true, current: null, matchCount: 0, candidates: all };
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) return { ok: false, error: '请输入大于 0 的有限电流数值，或留空查看全部规格。' };
  const current = Number(raw) / (unit === 'mA' ? 1000 : 1);
  if (!Number.isFinite(current) || current <= 0) return { ok: false, error: '请输入大于 0 的有限电流数值，或留空查看全部规格。' };
  const matches = all.filter(row => row.conservative <= current && current <= row.maximum);
  const coarser = all.filter(row => current < row.conservative).at(-1);
  const finer = all.find(row => current > row.maximum);
  const candidates = [...(coarser ? [{ ...coarser, status: 'below' as const }] : []), ...matches.map(row => ({ ...row, status: 'within' as const })), ...(finer ? [{ ...finer, status: 'above' as const }] : [])].sort((a, b) => a.n - b.n);
  return { ok: true, current, matchCount: matches.length, candidates };
}
