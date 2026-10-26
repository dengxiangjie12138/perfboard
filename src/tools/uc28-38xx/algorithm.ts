import { fail, positiveFinite, type CalculationResult } from '../shared/numeric';
import { pwmDevice } from './devices';
export interface TimingRequest { part: string; rt: number; ct: number; targetSwitchHz: number; legacyCorrection: boolean }
export interface TimingResult { k: number; oscillatorHz: number; switchingHz: number; targetRt: number; messages: string[] }
export function calculateTiming(p: TimingRequest): CalculationResult<TimingResult> {
  const device = pwmDevice(p.part);
  if (!device) return fail('请选择已支持的 TI 型号。');
  if (![p.rt, p.ct, p.targetSwitchHz].every(positiveFinite)) return fail('RT、CT 和目标开关频率必须为有限正数。');
  const k = device.family === 'uc3841' ? p.legacyCorrection ? .3 * Math.log10(p.ct * 1e12) : 1 : 1.72;
  if (!positiveFinite(k)) return fail('UC3841 修正模型要求 Kc=0.3log10(CT/pF)>0。');
  const oscillatorHz = k / p.rt / p.ct, switchingHz = oscillatorHz / device.divide, targetRt = k / (p.targetSwitchHz * device.divide) / p.ct;
  if (![oscillatorHz, switchingHz, targetRt].every(positiveFinite)) return fail('频率或反算阻值超出可表示范围。');
  const messages: string[] = [];
  if (device.family === 'ucc') {
    messages.push('UCC 数据表给出典型曲线。本页以 K=1.72 的工程近似估算，非 TI 保证公式；10 kΩ/3.3 nF≈52.1 kHz，与表中 53 kHz 典型点接近，请按曲线或实测校准。');
    if (p.rt < 1000 || p.rt > 100000 || p.ct < 220e-12 || p.ct > 4.7e-9) messages.push('当前参数超出所参考 UCC 典型曲线的主要范围（RT 1–100 kΩ、CT 220 pF–4.7 nF），估算不宜直接作为设计定值。');
  } else if (device.family === 'uc') {
    if (p.rt < 5000 || p.rt > 100000 || p.ct < 1e-9 || p.ct > 100e-9) messages.push('UC3842/3/4/5 数据表建议 RT 5–100 kΩ、CT 1–100 nF，且禁止 RT<5 kΩ；当前值超出该范围。');
    if (targetRt < 5000 || targetRt > 100000) messages.push('反算 RT 不在 5–100 kΩ 建议范围内，请调整 CT 或目标频率。');
  } else messages.push(p.legacyCorrection ? 'UC3841 使用数据表第 4 页 Kc 修正的一阶估算；不能套用 UC3842 的 1.72 系数。' : 'UC3841 使用第 6 页测试电路的标称简式 1/(RTCT)；可切换为第 4 页 Kc 修正近似。18 脚器件的最大占空比还由外部 RAMP 网络决定。');
  if (oscillatorHz > device.maxOscHz || p.targetSwitchHz * device.divide > device.maxOscHz) messages.push('当前或目标振荡频率超过此型号的工作频率上限。上限针对振荡器，分频型号的开关频率还需除以 2。');
  return { ok: true, value: { k, oscillatorHz, switchingHz, targetRt, messages } };
}
export interface SenseResult { threshold: number; resistor: number; minimumTripA: number; maximumTripA: number; powerW: number }
export function calculateSense(part: string, peakA: number, rmsA: number, legacyThreshold: number): CalculationResult<SenseResult> {
  const device = pwmDevice(part); if (!device) return fail('型号无效。');
  if (!positiveFinite(peakA) || !Number.isFinite(rmsA) || rmsA < 0 || rmsA > peakA) return fail('峰值电流必须为正，RMS 电流应在 0 到峰值电流之间。');
  const legacy = device.family === 'uc3841', threshold = legacy ? legacyThreshold : 1;
  if (!positiveFinite(threshold) || (legacy && threshold > 3)) return fail('UC3841 外部电流比较门限必须为 0–3 V 之间的正数。');
  const resistor = threshold / peakA, powerW = rmsA * rmsA * resistor, minimumTripA = legacy ? peakA : .9 / resistor, maximumTripA = legacy ? peakA : 1.1 / resistor;
  if (![resistor, minimumTripA, maximumTripA].every(positiveFinite) || !Number.isFinite(powerW)) return fail('采样电阻或功耗超出可表示范围。');
  return { ok: true, value: { threshold, resistor, minimumTripA, maximumTripA, powerW } };
}
export interface FilterRequest { resistor: number; capacitor: number; targetTau: number; minOn: number; slopeAperUs: number; delayMaxNs: number }
export interface FilterResult { tau: number; cutoffHz: number; settling90: number; targetCapacitor: number; onTimeRatio: number; extraCurrentA: number; tooSlow: boolean }
export function calculateCsFilter(p: FilterRequest): CalculationResult<FilterResult> {
  if (![p.resistor, p.capacitor, p.targetTau, p.minOn].every(positiveFinite) || ![p.slopeAperUs, p.delayMaxNs].every(v => Number.isFinite(v) && v >= 0)) return fail('滤波 R、C、目标时间常数和最短导通时间必须为正；电流斜率与延迟须为有限非负数。');
  const tau = p.resistor * p.capacitor, cutoffHz = 1 / (2 * Math.PI * tau), settling90 = Math.LN10 * tau, targetCapacitor = p.targetTau / p.resistor, onTimeRatio = tau / p.minOn, extraCurrentA = p.slopeAperUs * 1e6 * (tau + p.delayMaxNs * 1e-9);
  if (![tau, cutoffHz, settling90, targetCapacitor, onTimeRatio].every(positiveFinite) || !Number.isFinite(extraCurrentA)) return fail('RC 滤波结果超出可表示范围。');
  return { ok: true, value: { tau, cutoffHz, settling90, targetCapacitor, onTimeRatio, extraCurrentA, tooSlow: onTimeRatio > .1 * (1 + 1e-9) } };
}
export interface LegacyUvResult { on: readonly [number, number, number]; off: readonly [number, number, number] }
export function calculateLegacyUv(top: number, bottom: number): CalculationResult<LegacyUvResult> {
  if (![top, bottom].every(positiveFinite)) return fail('UC3841 启动检测上下电阻必须为有限正数。');
  const ratio = 1 + top / bottom, off = [2.8 * ratio, 3 * ratio, 3.2 * ratio] as const, on = [off[0] + 170e-6 * top, off[1] + 200e-6 * top, off[2] + 230e-6 * top] as const;
  if (![...off, ...on].every(positiveFinite)) return fail('启动门限超出可表示范围。');
  return { ok: true, value: { on, off } };
}
