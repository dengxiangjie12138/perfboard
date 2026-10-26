import { describe, expect, it } from 'vitest';
import { calculateTimer, recommendTimer } from './algorithm';
describe('timer calculations', () => {
  it('includes both register +1 terms and keeps units in Hz and seconds', () => {
    const result = calculateTimer(72e6,1000,71,999,16);
    expect(result).toEqual({ok:true,value:{psc:71,arr:999,frequencyHz:1000,periodSeconds:0.001,errorPercent:0,errorHz:0}});
    expect(calculateTimer(72e6,72e6,0,0,16).ok).toBe(true);
  });
  it('rejects non-finite, blank, zero, fractional and overflowing inputs', () => {
    for (const value of [NaN,Infinity,-Infinity,0,-1]) { expect(recommendTimer(value,1000,16).ok).toBe(false); expect(recommendTimer(72e6,value,16).ok).toBe(false); }
    for(const value of [-1,65536,0.5,Infinity,NaN]) expect(calculateTimer(72e6,1000,value,999,16).ok).toBe(false);
    for(const value of [-1,65536,0.5,Infinity,NaN]) expect(calculateTimer(72e6,1000,71,value,16).ok).toBe(false);
    expect(calculateTimer(72e6,1000,0,4294967296,32).ok).toBe(false);
    expect(recommendTimer(72e6,72e6+1,16).ok).toBe(false);
    expect(calculateTimer(Number.MIN_VALUE,Number.MIN_VALUE,0,0,16).ok).toBe(false);
    expect(recommendTimer(1,Number.MIN_VALUE,32).ok).toBe(false);
  });
  it('finds exact factors, preferring larger ARR at identical error', () => {
    const result = recommendTimer(72e6,1000,16);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.psc).toBe(1); expect(result.value.arr).toBe(35999); expect(result.value.errorHz).toBe(0);
    const result32 = recommendTimer(72e6,1000,32);
    if (!result32.ok) throw new Error(result32.error);
    expect(result32.value.psc).toBe(0); expect(result32.value.arr).toBe(71999);
  });
  it('includes the minimum representable frequency for both register widths', () => {
    for (const bits of [16,32] as const) {
      const maximumCount = bits === 16 ? 65536 : 4294967296;
      const minimum = 72e6 / (65536*maximumCount);
      const result = recommendTimer(72e6,minimum,bits);
      if (!result.ok) throw new Error(result.error);
      expect(result.value.psc).toBe(65535); expect(result.value.arr).toBe(maximumCount-1); expect(result.value.errorPercent).toBe(0);
      expect(recommendTimer(72e6,minimum*0.999,bits).ok).toBe(false);
    }
  });
  it('reports nonzero error accurately for a non-representable request', () => {
    const result = recommendTimer(100,37,16);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.psc).toBe(0); expect(result.value.arr).toBe(2);
    expect(result.value.frequencyHz).toBe(100/3); expect(result.value.errorPercent).toBeCloseTo((100/3-37)/37*100,12);
  });
  it('selects the true smaller frequency error instead of rounding the divider', () => {
    // Ratio 1.4 rounds to 1, but frequency error is smaller with divisor 2.
    const result = recommendTimer(140,100,16);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.arr).toBe(1); expect(result.value.frequencyHz).toBe(70); expect(result.value.errorPercent).toBe(-30);
  });
});
