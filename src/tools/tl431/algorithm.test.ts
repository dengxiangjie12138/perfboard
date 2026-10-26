import { describe, expect, it } from 'vitest';
import { calculateTl431, type Tl431Request } from './algorithm';
const base: Tl431Request = { mode: 'voltage', r1: 10000, r2: 10000, target: 5, vref: 2.495, irefA: 2e-6, supplyV: 12, supplyOhms: 1000, loadA: 0 };
function value(patch: Partial<Tl431Request> = {}) {
  const result = calculateTl431({ ...base, ...patch });
  if (!result.ok) throw Error(result.error);
  return result.value;
}
describe('TL431 reference and bias KCL', () => {
  it('includes positive REF current flowing into the device', () => {
    expect(value({ irefA: 0 }).outputV).toBeCloseTo(4.99, 10);
    const r = value(); expect(r.outputV).toBeCloseTo(5.01, 10);
    expect(r.upperCurrent - r.lowerCurrent).toBeCloseTo(base.irefA, 12);
    expect(r.cathodeCurrent).toBeCloseTo(.0067385, 10);
    expect(r.cathodePower).toBeCloseTo(5.01 * .0067385, 10);
    expect(r.regulated).toBe(true);
  });
  it('solves the upper resistor and round trips through voltage mode', () => {
    const r = value({ mode: 'r1', target: 5 });
    expect(r.r1).toBeCloseTo(2.505 / .0002515, 7);
    expect(value({ r1: r.r1 }).outputV).toBeCloseTo(5, 10);
    expect(value({ mode: 'r1', target: base.vref }).r1).toBe(0);
  });
  it('accounts for the load and division current when finding maximum Rs', () => {
    const r = value({ loadA: .002 });
    expect(r.cathodeCurrent).toBeCloseTo(.0047385, 10);
    expect(r.maxSupplyOhms).toBeCloseTo((12 - 5.01) / (.002 + .0002515 + .001), 7);
  });
  it.each([{ supplyV: 4 }, { supplyOhms: 1e5 }, { supplyOhms: 1 }, { r1: 2e5 }])('flags an invalid regulation condition %j without claiming actual output', patch => {
    const r = value(patch); expect(r.regulated).toBe(false); expect(r.cathodePower).toBeNull(); expect(r.issues.length).toBeGreaterThan(0);
  });
  it.each(['r2', 'vref', 'supplyOhms'] as const)('rejects invalid positive field %s', key => {
    for (const invalid of [0, -1, NaN, Infinity]) expect(calculateTl431({ ...base, [key]: invalid }).ok).toBe(false);
  });
  it('rejects invalid target, current, resistance and numeric overflow', () => {
    for (const patch of [{ target: 2, mode: 'r1' as const }, { target: 37, mode: 'r1' as const }, { irefA: -1 }, { r1: -1 }, { loadA: Infinity }, { vref: 37 }, { r1: 1e308, irefA: 1e100 }]) expect(calculateTl431({ ...base, ...patch }).ok).toBe(false);
  });
});
