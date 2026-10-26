import { describe, expect, it } from 'vitest';
import type { Part } from '../../types';
import { calculateLed, inventoryLedResistors, ledStandardResistors, parseRatedPower, referencePackages, suggestedRating, type LedRequest } from './algorithm';
const request: LedRequest = { supplyV: 5, forwardV: 2, currentMa: 10, count: 1, margin: 2 };
const part = (id: string, changes: Partial<Part> = {}): Part => ({ id, name: '330 Ω', category: '电阻', packageName: '0805', parameters: '', location: id, stockStatus: 'in_stock', quantity: 3, brief: '', url: '', createdAt: '', updatedAt: '', ...changes });
describe('LED series resistor', () => {
  it('computes ohms, amperes, watts and each candidate independently', () => {
    const result = calculateLed(request, [{ ohms: 300 }, { ohms: 330 }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.theoryOhms).toBe(300); expect(result.value.theoryPowerW).toBe(0.03);
    expect(result.value.suggestedPowerW).toBe(0.0625);
    expect(result.value.candidates[1].actualMa).toBeCloseTo(9.090909);
    expect(result.value.candidates[1].powerW).toBeCloseTo(9 / 330);
    expect(result.value.candidates[1].deviationPercent).toBeCloseTo(-9.090909);
    expect(calculateLed({ ...request, supplyV: 12, count: 3 }, []).ok).toBe(true);
  });
  it('rejects invalid inputs, insufficient voltage and numeric overflow', () => {
    for (const field of ['supplyV', 'forwardV', 'currentMa'] as const) for (const value of [0, -1, NaN, Infinity]) expect(calculateLed({ ...request, [field]: value }, []).ok).toBe(false);
    for (const value of [0, -1, 1.5, NaN, Infinity]) expect(calculateLed({ ...request, count: value }, []).ok).toBe(false);
    for (const value of [0.5, NaN, Infinity]) expect(calculateLed({ ...request, margin: value }, []).ok).toBe(false);
    expect(calculateLed({ ...request, supplyV: 2 }, []).ok).toBe(false);
    expect(calculateLed({ ...request, count: 3 }, []).ok).toBe(false);
    expect(calculateLed({ ...request, currentMa: Number.MIN_VALUE }, []).ok).toBe(false);
    expect(calculateLed(request, [{ ohms: NaN }]).ok).toBe(false);
  });
  it('rounds upward with the reused E24/E96 range and never admits higher current', () => {
    for (const series of ['E24', 'E96'] as const) {
      const result = calculateLed({ ...request, currentMa: 20 }, ledStandardResistors(series));
      if (!result.ok) throw new Error(result.error);
      expect(result.value.candidates[0].resistor.ohms).toBe(150);
      expect(result.value.candidates.every(item => item.actualMa <= 20)).toBe(true);
      expect(ledStandardResistors(series).at(-1)?.ohms).toBe(1e6);
    }
    const none = calculateLed({ ...request, currentMa: 0.000001 }, ledStandardResistors('E24'));
    expect(none.ok && none.value.candidates).toEqual([]);
  });
  it('preserves independent inventory records, full original part and actual package', () => {
    const parts = [part('a'), part('b', { packageName: '1206', brief: '额定功率：0.25 W' }), part('c', { category: 'MCU' }), part('d', { name: '300 Ω 1/8W' })];
    const inventory = inventoryLedResistors(parts);
    expect(inventory.map(item => item.id)).toEqual(['a', 'b', 'd']);
    expect(inventory[1].part).toBe(parts[1]); expect(inventory[1].part?.packageName).toBe('1206');
    expect(inventory[2].ratedPowerW).toBe(0.125);
    const result = calculateLed(request, inventory);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.candidates[0].powerStatus).toBe('pass');
    expect(result.value.candidates.at(-1)?.powerStatus).toBe('unknown');
  });
  it('recognizes explicit units and conflicts without guessing from package or model', () => {
    const parse = (changes: Partial<Part>) => parseRatedPower(part('power', changes));
    expect(parse({ name: '330 Ω 125mW' })).toBe(0.125);
    expect(parse({ name: '330 Ω 1/8 W' })).toBe(0.125);
    expect(parse({ brief: '功率：1/8W' })).toBe(0.125);
    expect(parse({ parameters: '阻值：330 Ω 0.25 W' })).toBe(0.25);
    expect(parse({ name: '330 Ω 0.25 W', brief: '额定功率：0.5 W' })).toBeUndefined();
    expect(parse({ packageName: '2512', name: 'RC1206 250mW' })).toBeUndefined();
    expect(parse({ brief: '功率：1001 W' })).toBeUndefined();
    expect(parse({ brief: '功率：1/0W' })).toBeUndefined();
    expect(parse({ name: '330 Ω 125MW' })).toBeUndefined();
  });
  it('applies adjustable margin, flags insufficient ratings and rounds rating upwards', () => {
    const result = calculateLed({ ...request, margin: 10 }, [{ ohms: 300, ratedPowerW: 0.25 }, { ohms: 330, ratedPowerW: 0.5 }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.candidates.map(item => item.powerStatus)).toEqual(['pass', 'insufficient']);
    expect(result.value.suggestedPowerW).toBe(0.5);
    expect(suggestedRating(101)).toBeNull();
  });
});

it('keeps series-specific standard-mode packaging references independent from inventory', () => {
  expect(referencePackages(0.061).map(item => item.packageName)).toEqual(['0402', '0603']);
  expect(referencePackages(0.126).map(item => item.packageName)).toEqual(['1206', '1210']);
  expect(referencePackages(1.01)).toEqual([]);
  expect(inventoryLedResistors([part('unknown', { packageName: '2512' })])[0].ratedPowerW).toBeUndefined();
});

it('excludes explicitly unavailable inventory without merging records or changing original names', () => {
  const parts = [part('stock', { name: '330 Ω 1/8 W', brief: '功率：0.125 W' }), part('unknown', { stockStatus: 'unknown' }), part('out', { stockStatus: 'out_of_stock', brief: '功率：1 W' }), part('zero', { quantity: 0, brief: '功率：1 W' })];
  const inventory = inventoryLedResistors(parts);
  expect(inventory).toHaveLength(4);
  expect(inventory[0].name).toBe(parts[0].name);
  expect(inventory[0].ratedPowerW).toBe(0.125);
  const result = calculateLed(request, inventory);
  if (!result.ok) throw new Error(result.error);
  expect(result.value.candidates.map(item => item.resistor.id)).toEqual(['stock', 'unknown']);
  expect(result.value.candidates[1].resistor.part?.stockStatus).toBe('unknown');
});
