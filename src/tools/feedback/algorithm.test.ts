import { describe, it, expect } from 'vitest';
import { parseResistance, recommendFeedback, standardResistors } from './algorithm';
import { parseInventoryResistors } from './inventory';
import { percent } from '../shared/units';
const request = { outputVolts: 3, referenceVolts: 1, maxErrorPercent: 0, maxDividerCurrentMa: 0.1 };
describe('feedback electrical constraints', () => {
  it('computes current from reference and each resistor power from I squared R', () => {
    const result = recommendFeedback(request, [{ohms:10000},{ohms:20000}]);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({actualVolts:3,dividerCurrentMa:0.1,topPowerMw:0.2,bottomPowerMw:0.1});
  });
  it('includes the exact cap, rejects any over-cap value, and never fills by relaxing constraints', () => {
    const stock = [{ohms:10000},{ohms:20000}];
    const exact = recommendFeedback(request, stock);
    expect(exact.ok && exact.value).toHaveLength(1);
    const below = recommendFeedback({...request,maxDividerCurrentMa:0.1-Number.EPSILON},stock);
    expect(below.ok && below.value).toEqual([]);
    for (const source of ['E24','E96'] as const) {
      const result = recommendFeedback({...request,maxDividerCurrentMa:0.0000001},standardResistors(source));
      expect(result.ok && result.value).toEqual([]);
      const valid = recommendFeedback({...request,maxErrorPercent:5},standardResistors(source));
      if (!valid.ok) throw new Error(valid.error);
      expect(valid.value.length).toBeGreaterThan(0);
      expect(valid.value.every(c=>c.dividerCurrentMa<=request.maxDividerCurrentMa && Math.abs(c.errorPercent)<=5)).toBe(true);
    }
  });
  it('rejects invalid finite-positive current limits and voltages', () => {
    for (const value of [NaN,Infinity,-Infinity,0,-1]) {
      expect(recommendFeedback({...request,maxDividerCurrentMa:value},[]).ok).toBe(false);
      expect(recommendFeedback({...request,referenceVolts:value},[]).ok).toBe(false);
      expect(recommendFeedback({...request,outputVolts:value},[]).ok).toBe(false);
    }
  });
  it('reads model resistance before legacy parameters and filters inventory identically', () => {
    const inventory=parseInventoryResistors([{id:'a',category:'resistor',name:'10 kΩ',parameters:'1 kΩ'},{id:'b',category:'resistor',name:'legacy model',parameters:'20 kΩ'},{id:'c',category:'resistor',name:'0603',parameters:''}]);
    expect(inventory.map(r=>r.ohms)).toEqual([10000,20000]);
    const result=recommendFeedback(request,inventory);
    expect(result.ok && result.value).toHaveLength(1);
    const excluded=recommendFeedback({...request,maxDividerCurrentMa:0.099},inventory);
    expect(excluded.ok && excluded.value).toEqual([]);
  });
  it('displays the real 3.3 V divider rounding noise as zero without mutating its error', () => {
    const result = recommendFeedback({outputVolts:3.3,referenceVolts:0.8,maxErrorPercent:1,maxDividerCurrentMa:0.1},[{ohms:100000},{ohms:32000}]);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toHaveLength(1);
    const candidate = result.value[0];
    expect(candidate.actualVolts).toBe(0.8*(1+100000/32000));
    expect(candidate.errorPercent).not.toBe(0);
    expect(candidate.errorPercent).toBeCloseTo(1.345724878333523e-14,25);
    expect(percent(candidate.errorPercent)).toBe('0 %');
    const strict = recommendFeedback({outputVolts:3.3,referenceVolts:0.8,maxErrorPercent:0,maxDividerCurrentMa:0.1},[{ohms:100000},{ohms:32000}]);
    expect(strict.ok && strict.value).toEqual([]);
  });
  it('cleans rounding noise in display while keeping strict algorithm comparisons', () => {
    for (const noise of [5e-15,-5e-15,1e-14,-1e-14,1.3457e-14,-1.3457e-14]) expect(percent(noise)).toBe('0 %');
    expect(percent(1e-10)).toBe('+1.00000000e-10 %');
    expect(percent(-1e-10)).toBe('-1.00000000e-10 %');
    const target=0.3; const actual=0.1*(1+20000/10000);
    expect(actual).not.toBe(target);
    const result=recommendFeedback({outputVolts:target,referenceVolts:0.1,maxErrorPercent:0},[{ohms:10000},{ohms:20000}]);
    expect(result.ok && result.value).toEqual([]);
  });
});

describe('explicit resistance labels with supplier metadata', () => {
  it('accepts whitespace tolerance and power suffixes without changing mega/milli semantics or comma formats', () => {
    for (const [label,value] of [['100kΩ ±1% 62.5mW',100000],['20 kΩ ± 1% 100 mW',20000],['1 MΩ ±1% 250mW',1e6],['20 mΩ ±1% 125mW',0.02],['100 ohms ±1% 0.25W',100],['100 欧姆 250mW',100],['47Ω, ±1% 62.5mW',47],['47Ω；原有备注',47]] as const) expect(parseResistance(label)).toBe(value);
  });
  it('still rejects package codes, power labels, unknown suffixes, and zero resistance', () => {
    for (const label of ['0805','0805 ±1% 62.5mW','62.5mW','100W','10k','100 Ω 0805','100 Ω 25 V','100 Ω ±1% unexpected','0Ω ±1% 62.5mW']) expect(parseResistance(label)).toBeNull();
  });
  it('includes ordinary positive supplier resistors in the same constrained search and excludes arrays and zero-ohm jumpers', () => {
    const parsed=parseInventoryResistors([
      {id:'top',category:'厚膜电阻',name:'20kΩ ±1% 100mW',parameters:''},
      {id:'bottom',category:'厚膜电阻',name:'10kΩ ±1% 62.5mW',parameters:''},
      {id:'array',category:'排阻',name:'10kΩ ±5%',parameters:''},
      {id:'jumper',category:'厚膜电阻',name:'0Ω ±1% 62.5mW',parameters:''},
    ]);
    expect(parsed.map(part=>part.id)).toEqual(['top','bottom']);
    const result=recommendFeedback(request,parsed);
    expect(result.ok && result.value).toHaveLength(1);
    if(result.ok)expect(result.value[0]).toMatchObject({actualVolts:3,dividerCurrentMa:0.1,top:{id:'top'},bottom:{id:'bottom'}});
    expect(recommendFeedback({...request,maxDividerCurrentMa:0.099},parsed)).toEqual({ok:true,value:[]});
  });
});
