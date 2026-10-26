import { describe, expect, it } from 'vitest';
import { calculatePmos, type PmosRequest } from './algorithm';
const base: PmosRequest = { vin: 12, vsg: 5, currentA: .0005, maxVgs: 20 };
function value(patch: Partial<PmosRequest> = {}) {
  const result = calculatePmos({ ...base, ...patch }); if (!result.ok) throw Error(result.error); return result.value;
}
describe('PMOS static gate divider', () => {
  it('matches the screenshot calculation for 60 V, 5 V, 500 µA', () => {
    expect(value({ vin: 60 })).toMatchObject({ r1: 10000, r2: 110000, gateV: 55 });
  });
  it('calculates branch current and dissipated power independently of load current', () => {
    const r = value(); expect(r).toMatchObject({ r1: 10000, r2: 14000, gateV: 7 });
    expect(12 / (r.r1 + r.r2)).toBeCloseTo(.0005, 12);
    expect(12 * r.r1 / (r.r1 + r.r2)).toBe(5);
    expect(r.power1 + r.power2).toBeCloseTo(r.totalPower, 12); expect(r.totalPower).toBe(.006);
    expect(r.power1).toBeCloseTo(.0025, 10);
  });
  it('warns at the VGS rating instead of rejecting a finite theoretical result', () => {
    expect(value({ maxVgs: 5 }).exceedsVgs).toBe(true); expect(value().exceedsVgs).toBe(false);
  });
  it.each(['vin', 'vsg', 'currentA', 'maxVgs'] as const)('rejects invalid positive %s', key => {
    for (const invalid of [0, -1, NaN, Infinity]) expect(calculatePmos({ ...base, [key]: invalid }).ok).toBe(false);
  });
  it('rejects non-positive R2 and numeric overflow', () => {
    for (const patch of [{ vsg: 12 }, { vsg: 13 }, { vin: 1e308, currentA: 1e-308 }]) expect(calculatePmos({ ...base, ...patch }).ok).toBe(false);
  });
});
