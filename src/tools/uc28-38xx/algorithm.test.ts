import { describe, expect, it } from 'vitest';
import { calculateTiming, calculateSense, calculateCsFilter, calculateLegacyUv } from './algorithm';
import { PWM_DEVICES, pwmDevice, pwmDocument, pwmProduct } from './devices';
import type { CalculationResult } from '../shared/numeric';
function value<T>(result: CalculationResult<T>): T { if (!result.ok) throw Error(result.error); return result.value; }
const timing = { part: 'UCC28C41', rt: 10000, ct: 3.3e-9, targetSwitchHz: 50000, legacyCorrection: false };
const filter = { resistor: 100, capacitor: 1e-9, targetTau: 100e-9, minOn: 1e-6, slopeAperUs: .1, delayMaxNs: 70 };
describe('TI controller model selection', () => {
  it('contains 17 unique supported parts and official selected-part links', () => {
    expect(PWM_DEVICES).toHaveLength(17); expect(new Set(PWM_DEVICES.map(d => d.id)).size).toBe(17);
    expect(pwmDevice('UC3846')).toBeUndefined();
    for (const d of PWM_DEVICES) { expect(pwmDocument(d.id)).toBe(`https://www.ti.com.cn/cn/lit/gpn/${d.id}`); expect(pwmProduct(d.id)).toBe(`https://www.ti.com.cn/product/cn/${d.id}`); }
  });
  it.each(PWM_DEVICES.filter(d => d.family === 'ucc').map(d => d.id))('uses correct UVLO and divide for %s', part => {
    const d = pwmDevice(part)!, suffix = part.slice(-2), high = ['42', '44'].includes(suffix), low = ['40', '41'].includes(suffix);
    expect(d.on).toEqual(high ? [13.5, 14.5, 15.5] : low ? [6.5, 7, 7.5] : [7.8, 8.4, 9]);
    expect(d.off).toEqual(high ? [8, 9, 10] : low ? [6.1, 6.6, 7.1] : [7, 7.6, 8.2]);
    expect(d.divide).toBe(['41', '44', '45'].includes(suffix) ? 2 : 1);
    expect(d.maxOscHz).toBe(1e6); expect(d.delayMaxNs).toBe(70);
    expect(d.temperature).toContain(part.startsWith('UCC28') ? '−40' : '85');
  });
  it.each(['UC3842', 'UC3843', 'UC3844', 'UC3845'])('uses UC384x rather than UC184x limits for %s', part => {
    const d = pwmDevice(part)!, high = ['UC3842', 'UC3844'].includes(part);
    expect(d.on).toEqual(high ? [14.5, 16, 17.5] : [7.8, 8.4, 9]);
    expect(d.off).toEqual(high ? [8.5, 10, 11.5] : [7, 7.6, 8.2]);
    expect(d.divide).toBe(['UC3844', 'UC3845'].includes(part) ? 2 : 1);
    expect(d.maxOscHz).toBe(5e5); expect(d.delayMaxNs).toBe(300);
  });
  it('keeps UC3841 external startup and current-limit architecture separate', () => {
    expect(pwmDevice('UC3841')).toMatchObject({ family: 'uc3841', on: null, off: null, startupMaxUa: 6000, delayMaxNs: 400 });
    const uv = value(calculateLegacyUv(20000, 12000)); expect(uv.on[1]).toBeCloseTo(12, 10); expect(uv.off[1]).toBeCloseTo(8, 10);
    expect(uv.on[0]).toBeLessThan(12); expect(uv.on[2]).toBeGreaterThan(12);
    expect(calculateLegacyUv(0, 12000).ok).toBe(false); expect(calculateLegacyUv(1e308, 1e-308).ok).toBe(false);
  });
});
describe('RT/CT frequency and target resistance', () => {
  it.each(PWM_DEVICES.map(d => d.id))('round trips the requested switching frequency for %s', part => {
    const r = value(calculateTiming({ ...timing, part }));
    expect(r.switchingHz).toBeCloseTo(r.oscillatorHz / pwmDevice(part)!.divide, 8);
    expect(value(calculateTiming({ ...timing, part, rt: r.targetRt })).switchingHz).toBeCloseTo(50000, 7);
  });
  it('distinguishes UCC oscillator from half-rate output and identifies engineering approximation', () => {
    const r = value(calculateTiming(timing)); expect(r.oscillatorHz).toBeCloseTo(52121.212121, 5); expect(r.switchingHz).toBeCloseTo(26060.606061, 5);
    expect(r.targetRt).toBeCloseTo(5212.121212, 5); expect(r.messages.join()).toContain('非 TI 保证公式');
  });
  it('uses UC3842 1.72 but UC3841 independent nominal or CT/pF correction', () => {
    const p = { ...timing, rt: 20000, ct: 1e-9 };
    expect(value(calculateTiming({ ...p, part: 'UC3842' })).oscillatorHz).toBeCloseTo(86000, 7);
    expect(value(calculateTiming({ ...p, part: 'UC3841' })).oscillatorHz).toBeCloseTo(50000, 7);
    const corrected = value(calculateTiming({ ...p, part: 'UC3841', legacyCorrection: true }));
    expect(corrected.k).toBeCloseTo(.9, 12); expect(corrected.oscillatorHz).toBeCloseTo(45000, 7);
  });
  it('warns on RT design range and oscillator rather than output frequency limit', () => {
    const r = value(calculateTiming({ ...timing, part: 'UC3844', rt: 2000, ct: 1e-9 }));
    expect(r.messages.join()).toContain('禁止 RT<5'); expect(r.messages.join()).toContain('振荡频率超过');
  });
  it('rejects invalid inputs and a nonpositive legacy correction', () => {
    for (const patch of [{ part: 'unknown' }, { rt: 0 }, { ct: NaN }, { targetSwitchHz: -1 }, { rt: 1e-308, ct: 1e-308 }, { part: 'UC3841', ct: 1e-13, legacyCorrection: true }]) expect(calculateTiming({ ...timing, ...patch }).ok).toBe(false);
  });
});
describe('current sense and RC filter', () => {
  it('uses the 1 V typical threshold and 0.9–1.1 V trip interval', () => {
    const r = value(calculateSense('UCC28C41', 2, .7, NaN));
    expect(r.resistor).toBe(.5); expect(r.powerW).toBeCloseTo(.245, 10); expect(r.minimumTripA).toBe(1.8); expect(r.maximumTripA).toBe(2.2);
  });
  it('uses the externally supplied threshold only for UC3841', () => {
    expect(value(calculateSense('UC3841', 2, .7, .2)).resistor).toBe(.1);
    expect(calculateSense('UC3841', 2, .7, 4).ok).toBe(false);
    expect(calculateSense('UC3841', 2, .7, NaN).ok).toBe(false);
  });
  it('rejects invalid peak, RMS and part', () => {
    for (const [part, peak, rms] of [['bad', 2, .7], ['UC3842', 0, 0], ['UC3842', 2, 3], ['UC3842', 2, -1], ['UC3842', Infinity, 1]] as const) expect(calculateSense(part, peak, rms, .2).ok).toBe(false);
  });
  it('calculates 100 Ω and 1000 pF as 100 ns and 1.59155 MHz', () => {
    const r = value(calculateCsFilter(filter));
    expect(r.tau).toBeCloseTo(100e-9, 15); expect(r.cutoffHz).toBeCloseTo(1591549.430919, 5);
    expect(r.settling90).toBeCloseTo(230.2585093e-9, 15); expect(r.targetCapacitor).toBeCloseTo(1e-9, 15);
    expect(r.extraCurrentA).toBeCloseTo(.017, 12); expect(r.tooSlow).toBe(false);
    expect(value(calculateCsFilter({ ...filter, capacitor: 2e-9 })).tooSlow).toBe(true);
    expect(value(calculateCsFilter({ ...filter, slopeAperUs: 0 })).extraCurrentA).toBe(0);
  });
  it('rejects invalid filter quantities and nonrepresentable results', () => {
    for (const patch of [{ resistor: 0 }, { capacitor: -1 }, { targetTau: NaN }, { minOn: 0 }, { slopeAperUs: -1 }, { delayMaxNs: Infinity }, { resistor: 1e308, capacitor: 1e308 }]) expect(calculateCsFilter({ ...filter, ...patch }).ok).toBe(false);
  });
});
