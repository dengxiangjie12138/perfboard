import { fail, positiveFinite, type CalculationResult } from '../shared/numeric';
export type TimerBits = 16 | 32;
export interface TimerResult { psc: number; arr: number; frequencyHz: number; periodSeconds: number; errorPercent: number; errorHz: number }
export function maxTimerArr(bits: TimerBits): number { return bits === 32 ? 4294967295 : 65535; }
function validateClock(clockHz: number, targetHz: number, bits: TimerBits): string | null {
  if (bits !== 16 && bits !== 32) return '请选择 16 bit 或 32 bit ARR。';
  if (!positiveFinite(clockHz) || !positiveFinite(targetHz)) return 'TIM 时钟与目标频率必须为有限正数。';
  if (targetHz > clockHz) return '目标频率不能高于 TIM 输入时钟。';
  const minimum = clockHz / (65536 * (maxTimerArr(bits) + 1));
  if (targetHz < minimum) return '目标低于所选 PSC / ARR 范围的最低可表示频率。';
  return null;
}
export function calculateTimer(clockHz: number, targetHz: number, psc: number, arr: number, bits: TimerBits): CalculationResult<TimerResult> {
  const error = validateClock(clockHz,targetHz,bits);
  if (error) return fail(error);
  if (!Number.isSafeInteger(psc) || psc < 0 || psc > 65535) return fail('PSC 必须为 0–65535 的整数。');
  if (!Number.isSafeInteger(arr) || arr < 0 || arr > maxTimerArr(bits)) return fail(`ARR 必须为 0–${maxTimerArr(bits)} 的整数。`);
  const divisor = (psc + 1) * (arr + 1); // At most 2^48, exactly representable.
  const frequencyHz = clockHz / divisor;
  const periodSeconds = divisor / clockHz;
  const errorHz = frequencyHz - targetHz;
  const errorPercent = errorHz / targetHz * 100;
  if (![frequencyHz,periodSeconds].every(positiveFinite) || !Number.isFinite(errorPercent)) return fail('频率、周期或误差超出可表示范围。');
  return { ok: true, value: { psc,arr,frequencyHz,periodSeconds,errorPercent,errorHz } };
}
export function recommendTimer(clockHz: number, targetHz: number, bits: TimerBits): CalculationResult<TimerResult> {
  const error = validateClock(clockHz,targetHz,bits);
  if (error) return fail(error);
  const ratio = clockHz / targetHz;
  if (!positiveFinite(ratio) || ratio > 65536 * (maxTimerArr(bits) + 1)) return fail('目标分频比超出可表示范围。');
  const maximumCount = maxTimerArr(bits) + 1;
  let best: TimerResult | undefined;
  for (let psc = 0; psc <= 65535; psc++) {
    const idealCount = ratio / (psc + 1);
    // For each PSC, frequency is monotone in ARR; either nearest bracketing
    // integer is optimal. Clamp endpoints to include representable limits.
    for (const count of new Set([Math.max(1, Math.min(maximumCount, Math.floor(idealCount))),Math.max(1, Math.min(maximumCount, Math.ceil(idealCount)))])) {
      const result = calculateTimer(clockHz,targetHz,psc,count-1,bits);
      if (!result.ok) continue;
      const candidate = result.value;
      if (!best || Math.abs(candidate.errorHz) < Math.abs(best.errorHz) || (Math.abs(candidate.errorHz) === Math.abs(best.errorHz) && candidate.arr > best.arr)) best = candidate;
    }
  }
  return best ? { ok: true, value: best } : fail('没有可表示的频率和周期，请检查输入。');
}
