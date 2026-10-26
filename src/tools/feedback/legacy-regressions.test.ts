import { describe, expect, it } from 'vitest';
import { feedbackVoltage, parseResistance, recommendFeedback, standardResistors } from './algorithm';
import { parseNumericInput } from '../shared/numeric';
describe('feedback calculations', () => {
  it('uses the positive-reference divider formula and computes signed nominal error', () => {
    const voltage = feedbackVoltage(0.8,31250,10000); if (!voltage.ok) throw new Error(voltage.error); expect(voltage.value).toBeCloseTo(3.3,12);
    const result = recommendFeedback({outputVolts:3.3,referenceVolts:0.8,maxErrorPercent:1},[{ohms:10000},{ohms:31000}]);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.value[0].actualVolts).toBeCloseTo(3.28,12); expect(result.value[0].errorPercent).toBeCloseTo(-0.6060606060606,10); }
  });
  it('rejects empty, non-finite, zero, negative, inverted and overflowing inputs', () => {
    expect(Number.isNaN(parseNumericInput('   '))).toBe(true);
    for (const value of [NaN,Infinity,-Infinity,0,-1]) expect(feedbackVoltage(value,10000,10000).ok).toBe(false);
    expect(feedbackVoltage(1,Number.MAX_VALUE,Number.MIN_VALUE).ok).toBe(false);
    for (const request of [ {outputVolts:0.8,referenceVolts:0.8,maxErrorPercent:1}, {outputVolts:0.5,referenceVolts:0.8,maxErrorPercent:1}, {outputVolts:3.3,referenceVolts:0.8,maxErrorPercent:NaN}, {outputVolts:3.3,referenceVolts:0.8,maxErrorPercent:101} ]) expect(recommendFeedback(request,standardResistors('E24')).ok).toBe(false);
    expect(recommendFeedback({outputVolts:3.3,referenceVolts:0.8,maxErrorPercent:1},[{ohms:NaN}]).ok).toBe(false);
  });
  it('uses actual E24 and E96 mantissas over the explicitly stated range', () => {
    const e24 = standardResistors('E24').map(r=>r.ohms), e96 = standardResistors('E96').map(r=>r.ohms);
    expect(e24).toHaveLength(121); expect(e96).toHaveLength(481);
    expect(e24).toContain(4700); expect(e96).toContain(4750); expect(e96).not.toContain(4700);
    expect(e24[0]).toBe(10); expect(e96.at(-1)).toBe(1e6);
    const result = recommendFeedback({outputVolts:3.3,referenceVolts:0.8,maxErrorPercent:1},standardResistors('E96'));
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toHaveLength(12);
    for (let i=0;i<result.value.length;i++) { const c=result.value[i]; expect(c.actualVolts).toBe(0.8*(1+c.top.ohms/c.bottom.ohms)); expect(Math.abs(c.errorPercent)).toBeLessThanOrEqual(1); if(i) expect(Math.abs(c.errorPercent)).toBeGreaterThanOrEqual(Math.abs(result.value[i-1].errorPercent)); }
  });
  it('allows two resistors with the same nominal value and strict zero-error filtering', () => {
    const result = recommendFeedback({outputVolts:2,referenceVolts:1,maxErrorPercent:0},[{ohms:10000}]);
    expect(result.ok && result.value).toHaveLength(1);
  });
  it('only parses explicit resistance units without guessing package numbers', () => {
    expect(parseResistance('10 kΩ')).toBe(10000); expect(parseResistance('阻值：4.7 kΩ')).toBe(4700); expect(parseResistance('1 MΩ')).toBe(1e6); expect(parseResistance('20 mΩ')).toBe(0.02);
    expect(parseResistance('100 ohm')).toBe(100); expect(parseResistance('0603')).toBeNull(); expect(parseResistance('10k')).toBeNull(); expect(parseResistance('100 Ω ± 1%')).toBe(100); expect(parseResistance('0 Ω')).toBeNull();
  });
});
