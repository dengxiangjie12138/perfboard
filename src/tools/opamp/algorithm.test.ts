import { describe, expect, it } from 'vitest';
import { calculateOpAmp, circuitNotices, initialDraft, matchingDraft, type OpAmpDraft } from './algorithm';
import type { CircuitId, ParameterKey } from './metadata';
const result = (id: CircuitId, patch: Partial<OpAmpDraft['values']> = {}) => {
  const draft = initialDraft(id), r = calculateOpAmp(id, { ...draft, values: { ...draft.values, ...patch } });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
describe('TI-derived op amp linear calculations', () => {
  it('reproduces the noninverting reference and recalculates gain/output/bandwidth', () => {
    const first = result('noninv');
    expect(first.value.gain).toBeCloseTo(10); expect(first.value.output).toBeCloseTo(5); expect(first.value.bandwidth).toBeCloseTo(300000);
    const changed = result('noninv', { r1: '19.19', vin: '-0.25' });
    expect(changed.value.gain).toBeCloseTo(20); expect(changed.value.output).toBeCloseTo(-5); expect(changed.value.bandwidth).toBeCloseTo(150000);
  });
  it('uses noise gain 3 rather than differential gain 2 for the difference reference', () => {
    const { value: r } = result('diff');
    expect(r.output).toBeCloseTo(2); expect(r.gain).toBeCloseTo(2); expect(r.vplus).toBeCloseTo(5 / 6);
    expect(r.noiseGain).toBe(3); expect(r.bandwidth).toBeCloseTo(1e6 / 3); expect(r.cmrr).toBe(Infinity);
  });
  it('uses the general transfer function after changing only R4 and Vref', () => {
    const { value: r } = result('diff', { r4: '22', vref: '.5' });
    expect(r.output).toBeCloseTo(2.546875); expect(r.gain).toBeCloseTo(2.03125);
    expect(r.commonGain).toBeCloseTo(.0625); expect(r.matched).toBe(false); expect(r.cmrr).toBeCloseTo(30.237667, 5);
  });
  it('agrees with an independently derived KCL solution across mismatched resistor networks', () => {
    for (const r1 of ['.1', '10', '250']) for (const r2 of ['.22', '4.7', '30'])
      for (const r3 of ['.68', '20']) for (const r4 of ['.33', '22']) for (const vref of ['-.2', '0', '1.1']) {
        const { value: r, parameters: p } = result('diff', { r1, r2, r3, r4, vref, vi1: '-.4', vi2: '.8' });
        const node = (p.vi2 / p.r2 + p.vref / p.r4) / (1 / p.r2 + 1 / p.r4);
        expect(r.output).toBeCloseTo(node + (node - p.vi1) * p.r3 / p.r1, 8);
        expect(r.output).toBeCloseTo(r.gain * r.vdiff + r.commonGain * r.vcm + r.aRef * p.vref, 8);
      }
  });
  it('handles common inputs, polarity reversal and non-identical but matched ratios', () => {
    expect(result('diff', { vi1: '1', vi2: '1' }).value.output).toBeCloseTo(0);
    expect(result('diff', { vi1: '2', vi2: '1' }).value.output).toBeCloseTo(-2);
    const { value: r } = result('diff', { r2: '20', r4: '40', vref: '.7' });
    expect(r.matched).toBe(true); expect(r.output).toBeCloseTo(2.7);
  });
  it('converts each resistance unit independently and preserves drafts when matching', () => {
    const d = initialDraft('diff');
    d.values.r1 = '10000'; d.units.r1 = 1; d.values.r3 = '.02'; d.units.r3 = 1000000;
    const r = calculateOpAmp('diff', d); expect(r.ok && r.value.output).toBeCloseTo(2);
    d.values.r4 = '22';
    const matched = matchingDraft(d)!;
    expect(matched.values.r4).toBe('20'); expect(d.values.r4).toBe('22');
    expect(calculateOpAmp('diff', matched).ok).toBe(true);
    d.values.r1 = '0'; expect(matchingDraft(d)).toBeNull();
  });
  it.each<[ParameterKey, string]>([['r1', ''], ['r2', '0'], ['r3', '-1'], ['r4', 'NaN'], ['gbw', '0'], ['headroom', '-.1'], ['vcc', 'Infinity'], ['vi1', '1e8']])('rejects %s=%s without returning a stale output', (key, value) => {
    const d = initialDraft('diff'); d.values[key] = value;
    const r = calculateOpAmp('diff', d); expect(r.ok).toBe(false); if (!r.ok) expect(r.errors[key]).toBeTruthy();
  });
  it('rejects inverted supply rails and an empty swing interval', () => {
    const d = initialDraft('diff'); d.values.vcc = '-3';
    const r = calculateOpAmp('diff', d); expect(!r.ok && r.errors.vcc).toBeTruthy();
    d.values.vcc = '2.75'; d.values.headroom = '2.75';
    const swing = calculateOpAmp('diff', d); expect(!swing.ok && swing.errors.headroom).toBeTruthy();
  });
  it('keeps ideal output while explaining clipping, ratio mismatch and device constraints', () => {
    const { parameters: p, value: r } = result('diff', { r4: '22', vi2: '5', vcc: '15', vee: '-15' });
    expect(r.output).toBeGreaterThan(9);
    const notices = circuitNotices('diff', p, r);
    expect(notices.some(n => n.text.includes('比例失配'))).toBe(true);
    expect(notices.some(n => n.text.includes('总供电范围'))).toBe(true);
    const clip = result('noninv', { vin: '3' });
    expect(clip.value.output).toBeCloseTo(30);
    expect(circuitNotices('noninv', clip.parameters, clip.value).some(n => n.text.includes('超出设定摆幅'))).toBe(true);
  });
});
