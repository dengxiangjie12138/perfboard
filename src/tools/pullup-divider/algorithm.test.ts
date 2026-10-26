import { describe, expect, it } from 'vitest';
import { calculatePullup, type PullupRequest } from './algorithm';
const base: PullupRequest = { vin: 30, pullupV: 3.3, r1: 47000, r2: 3000, r3: 10000, adcMax: 3.3, idleMode: 'zero' };
function value(patch: Partial<PullupRequest> = {}) {
  const result = calculatePullup({ ...base, ...patch }); if (!result.ok) throw Error(result.error); return result.value;
}
describe('pull-up divider connection states', () => {
  it('calculates the supplied 47k/3k/10k example', () => {
    const r = value(); expect(r.states[0].outputV).toBeCloseTo((30 / 47000 + 3.3 / 10000) / (1 / 47000 + 1 / 3000 + 1 / 10000), 10);
    expect(r.states[0].outputV).toBeCloseTo(2.13, 2);
    expect(r.k).toBeCloseTo(21.3666666667, 8); expect(r.b).toBeCloseTo(-15.51, 10);
  });
  it('matches the simulator and Mathcad zero-volt source with R1 still connected', () => {
    const idle = value().states[1]; expect(idle).toMatchObject({ kind: 'idle', inputV: 0 });
    expect(idle.outputV).toBeCloseTo(.7258970359, 10);
    expect(idle.outputV.toFixed(3)).toBe('0.726');
    expect(-idle.i1 * 1e6).toBeCloseTo(15.44461778, 7);
    expect(value({ vin: 0 }).states[0].outputV).toBe(idle.outputV);
    expect(value({ vin: 100 }).states[1].outputV).toBe(idle.outputV);
  });
  it('can explicitly remove the input branch for true open circuit', () => {
    const open = value({ idleMode: 'disconnected' }).states[1]; expect(open).toMatchObject({ kind: 'idle', inputV: null, i1: 0 });
    expect(open.outputV).toBeCloseTo(3.3 * 3 / 13, 10);
    expect(value({ vin: 0 }).states[0].outputV).not.toBeCloseTo(open.outputV, 5);
    expect(value({ r1: 1, idleMode: 'disconnected' }).states[1].outputV).toBeCloseTo(open.outputV, 10);
    expect(value({ idleMode: 'disconnected' }).states[0]).toEqual(value().states[0]);
    expect(value({ idleMode: 'disconnected' }).states[2]).toEqual(value().states[2]);
  });
  it('preserves reverse negative voltage and satisfies KCL for all states', () => {
    const r = value(); expect(r.states[2].inputV).toBe(-30); expect(r.states[2].outputV).toBeLessThan(0); expect(r.states[2].inRange).toBe(false);
    for (const s of [...r.states, ...value({ idleMode: 'disconnected' }).states]) {
      expect(s.i1 + s.i3).toBeCloseTo(s.i2, 12);
      if (s.inputV !== null) expect(r.k * s.outputV + r.b).toBeCloseTo(s.inputV, 10);
    }
  });
  it('reports backfeed and overvoltage rather than silently clamping', () => {
    const normal = value({ vin: 1000 }).states[0]; expect(normal.outputV).toBeGreaterThan(3.3); expect(normal.inRange).toBe(false); expect(normal.i3).toBeLessThan(0);
  });
  it.each(['r1', 'r2', 'r3', 'adcMax'] as const)('rejects invalid positive %s', key => {
    for (const invalid of [0, -1, NaN, Infinity]) expect(calculatePullup({ ...base, [key]: invalid }).ok).toBe(false);
  });
  it('allows zero sources but rejects negative source amplitude and overflow', () => {
    expect(value({ vin: 0, pullupV: 0 }).states.every(s => s.outputV === 0)).toBe(true);
    for (const patch of [{ vin: -1 }, { pullupV: NaN }, { r1: 1e308, r2: 1e-308 }]) expect(calculatePullup({ ...base, ...patch }).ok).toBe(false);
  });
});
