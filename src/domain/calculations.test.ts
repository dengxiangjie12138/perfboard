import { it, expect } from 'vitest';
import { calculateTimer, feedbackVoltage, parseNumericInput } from './calculations';
it('retains legacy calculation facade exports', () => {
  expect(feedbackVoltage(1,10000,10000)).toEqual({ok:true,value:2});
  expect(calculateTimer(72e6,1000,71,999,16).ok).toBe(true);
  expect(parseNumericInput('72')).toBe(72);
});
