import type { CircuitParameters } from '../algorithm';
import type { ComparatorId, ParameterKey } from '../metadata';
export type LogicState = 'high' | 'low';
export interface ComparatorResult {
  lower: number; upper: number; width: number; input: number; reference: number;
  high: number; low: number; output: number; plus: number; minus: number;
  state: LogicState; held: boolean; boundary: boolean; inverting: boolean;
  pullupCurrent: number; dividerRatio: number;
  oscillator?: { running: boolean; highTime: number; lowTime: number; period: number; frequency: number; duty: number; tau: number };
}
export const openDrain = (id: ComparatorId) => ['schmitt-inv', 'schmitt-noninv', 'window', 'undervoltage'].includes(id);
export const monitoredSupply = (id: ComparatorId) => id === 'overvoltage' || id === 'undervoltage';
export function comparatorModelKeys(id: ComparatorId): ParameterKey[] { return openDrain(id) ? ['vol', 'tpd'] : ['voh', 'vol', 'tpd']; }
export function comparatorValidation(id: ComparatorId, p: CircuitParameters) {
  const errors: Partial<Record<ParameterKey, string>> = {};
  for (const key of ['voh', 'vol', 'tpd', 'diodeDrop'] as const) if (p[key] < 0) errors[key] = '数值不能为负数。';
  if (!openDrain(id) && p.voh + p.vol >= p.vcc - p.vee) errors.voh = '高、低电平压降之和必须小于总供电。';
  if (openDrain(id) && p.vpu <= p.vee + p.vol) errors.vpu = 'Vpu 必须高于设定低电平 Vee + ΔVOL。';
  if (id === 'undervoltage') {
    if (p.vitLow <= 0) errors.vitLow = '内部下降门限必须大于 0。';
    if (p.vitHigh < p.vitLow) errors.vitHigh = '上升门限不能低于下降门限。';
  }
  if (id === 'comparator' && ![0, 1].includes(p.hysteresis)) errors.hysteresis = '请选择有效的迟滞模式。';
  return errors;
}
const divider = (top: number, bottom: number, rt: number, rb: number) => (top / rt + bottom / rb) / (1 / rt + 1 / rb);
const bias = (top: number, bottom: number, output: number, rt: number, rb: number, rf: number) => (top / rt + bottom / rb + output / rf) / (1 / rt + 1 / rb + 1 / rf);
export function comparatorInput(id: ComparatorId, p: CircuitParameters) { return monitoredSupply(id) ? p.vcc : p.vin; }
/** Static ideal comparator states. Open-drain high state includes pull-up and feedback loading. */
export function solveComparator(id: ComparatorId, p: CircuitParameters, memory: LogicState = 'low'): ComparatorResult {
  const low = p.vee + p.vol, highRail = p.vcc - p.voh, input = comparatorInput(id, p);
  let lower = p.vee, upper = p.vee, reference = p.vee, plus = input, minus = p.vee;
  let high = openDrain(id) ? p.vpu : highRail;
  const inverting = id === 'comparator' || id === 'schmitt-inv';
  const ratio = p.r2 / (p.r1 + p.r2);
  if (id === 'comparator') {
    reference = divider(p.vref, p.vee, p.r1, p.r2);
    lower = p.hysteresis ? bias(p.vref, p.vee, low, p.r1, p.r2, p.r3) : reference;
    upper = p.hysteresis ? bias(p.vref, p.vee, high, p.r1, p.r2, p.r3) : reference;
  } else if (id === 'schmitt-inv') {
    reference = divider(p.vref, p.vee, p.r1, p.r2);
    lower = bias(p.vref, p.vee, low, p.r1, p.r2, p.r4);
    upper = bias(p.vref, p.vee, p.vpu, p.r1, p.r2, p.r3 + p.r4);
    high = (p.vpu * p.r4 + upper * p.r3) / (p.r3 + p.r4);
  } else if (id === 'schmitt-noninv') {
    reference = divider(p.vref, p.vee, p.r4, p.r5);
    upper = reference + p.r1 / p.r2 * (reference - low);
    lower = reference + p.r1 / (p.r2 + p.r3) * (reference - p.vpu);
    const highPlus = divider(input, p.vpu, p.r1, p.r2 + p.r3);
    high = (p.vpu * p.r2 + highPlus * p.r3) / (p.r2 + p.r3);
  } else if (id === 'window') {
    lower = p.vee + (p.vcc - p.vee) * p.r1 / (p.r1 + p.r2 + p.r3);
    upper = p.vee + (p.vcc - p.vee) * (p.r1 + p.r2) / (p.r1 + p.r2 + p.r3);
  } else if (id === 'overvoltage') {
    reference = p.vref; lower = upper = p.vee + (p.vref - p.vee) / ratio;
    plus = p.vee + (input - p.vee) * ratio; minus = reference;
  } else if (id === 'undervoltage') {
    lower = p.vee + p.vitLow / ratio; upper = p.vee + p.vitHigh / ratio;
    plus = p.vee + (input - p.vee) * ratio;
  } else if (id === 'zero-cross') {
    plus = Math.max(p.vee - p.diodeDrop, p.vee + (input - p.vee) * ratio);
  } else {
    lower = bias(p.vcc, p.vee, low, p.r2, p.r3, p.r4);
    upper = bias(p.vcc, p.vee, high, p.r2, p.r3, p.r4);
  }
  const tolerance = Math.max(1, Math.abs(lower), Math.abs(upper)) * 1e-12;
  const onLower = Math.abs(input - lower) <= tolerance, onUpper = Math.abs(input - upper) <= tolerance;
  let state: LogicState = memory, held = false, boundary = false;
  if (id === 'window') {
    boundary = onLower || onUpper;
    if (!boundary) state = input > lower && input < upper ? 'high' : 'low';
    plus = input; minus = input > upper ? upper : lower;
  } else if (input > upper + tolerance) state = inverting ? 'low' : 'high';
  else if (input < lower - tolerance) state = inverting ? 'high' : 'low';
  else if (upper - lower > tolerance) held = true;
  else boundary = true;
  if (inverting) { minus = input; plus = state === 'high' ? upper : lower; }
  if (id === 'schmitt-noninv') { plus = state === 'high' ? divider(input, p.vpu, p.r1, p.r2 + p.r3) : divider(input, low, p.r1, p.r2); minus = reference; }
  if (id === 'undervoltage') minus = p.vee + (state === 'high' ? p.vitLow : p.vitHigh);
  const output = state === 'high' ? high : low;
  const pullupKey = id === 'window' ? 'r4' : 'r3';
  const result: ComparatorResult = { lower, upper, width: upper - lower, input, reference, high, low, output, plus, minus, state, held, boundary, inverting,
    pullupCurrent: openDrain(id) ? (p.vpu - output) / p[pullupKey] : 0, dividerRatio: ratio };
  if (id === 'relaxation') {
    const tau = p.r1 * p.c1, running = low < lower && lower < upper && upper < high;
    const highTime = running ? tau * Math.log1p((upper - lower) / (high - upper)) : 0;
    const lowTime = running ? tau * Math.log1p((upper - lower) / (lower - low)) : 0;
    const period = highTime + lowTime;
    result.oscillator = { running: running && Number.isFinite(period) && period > 0, highTime, lowTime, period, frequency: period > 0 ? 1 / period : 0, duty: period > 0 ? highTime / period : 0, tau };
  }
  return result;
}
/** Update the retained logic only after valid edits; invalid drafts leave memory intact. */
export const comparatorMemory = (r: ComparatorResult) => r.boundary || r.oscillator ? undefined : r.state;
export function oscillatorPoint(r: ComparatorResult, time: number) {
  const o = r.oscillator;
  if (!o?.running) return { output: r.low, capacitor: r.lower };
  const t = ((time % o.period) + o.period) % o.period, high = t < o.highTime;
  return { output: high ? r.high : r.low, capacitor: high ? r.lower + (r.high - r.lower) * -Math.expm1(-t / o.tau)
    : r.upper + (r.low - r.upper) * -Math.expm1(-(t - o.highTime) / o.tau) };
}
