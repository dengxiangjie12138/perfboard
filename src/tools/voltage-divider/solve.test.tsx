import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readMemory, viewMemoryKey } from '../../services/viewMemory';
import { number } from '../shared/units';
import { DividerFields } from './VoltageDividerPage';
import { DividerEquations } from './DividerEquations';
import { calculateDivider, changeDividerInput, DIVIDER_EXAMPLE, DIVIDER_PARAMETERS, dividerResultValue, restoreDividerInput, selectDividerTarget, type DividerInput } from './algorithm';

const fixture: DividerInput = { ...DIVIDER_EXAMPLE, supply: '12', midpoint: '3', upper: '30', lower: '10' };
function solve(patch: Partial<DividerInput> = {}) {
  const result = calculateDivider({ ...fixture, ...patch });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function failure(patch: Partial<DividerInput>) {
  const result = calculateDivider({ ...fixture, ...patch });
  if (result.ok) throw new Error('Expected an invalid or ambiguous divider');
  return result.error;
}

describe('four-way divider solving', () => {
  it.each(DIVIDER_PARAMETERS)('solves %s from exactly the other three conditions', solveFor => {
    const value = solve({ solveFor, [solveFor]: 'not a condition' });
    expect(value.supplyV).toBeCloseTo(12, 12);
    expect(value.midpointV).toBeCloseTo(3, 12);
    expect(value.upperOhms).toBeCloseTo(30000, 9);
    expect(value.lowerOhms).toBeCloseTo(10000, 9);
    expect(value.currentA).toBe(.0003);
  });
  it('solves a non-standard lower resistor and mixed resistance units', () => {
    const value = solve({ solveFor: 'lower', supply: '12', midpoint: '3.3', upper: '10000', upperUnit: 'Ω', lowerUnit: 'MΩ' });
    expect(value.lowerOhms).toBeCloseTo(3793.103448275862, 9);
    expect(value.currentA).toBeCloseTo(.00087, 12);
    for (const solveFor of DIVIDER_PARAMETERS) {
      expect(solve({ solveFor, supply: '12', midpoint: '4', upper: '20000', upperUnit: 'Ω', lower: '.01', lowerUnit: 'MΩ' })).toMatchObject({ supplyV: 12, midpointV: 4, upperOhms: 20000, lowerOhms: 10000 });
    }
  });
  it('keeps valid zero-boundary solutions', () => {
    expect(solve({ solveFor: 'supply', midpoint: '0' })).toMatchObject({ supplyV: 0, midpointV: 0, currentA: 0 });
    expect(solve({ solveFor: 'upper', midpoint: '12' })).toMatchObject({ upperOhms: 0, midpointV: 12 });
    expect(solve({ solveFor: 'lower', midpoint: '0' })).toMatchObject({ lowerOhms: 0, midpointV: 0 });
  });
  it.each([
    { solveFor: 'supply', lower: '0', midpoint: '0' },
    { solveFor: 'upper', supply: '0', midpoint: '0' },
    { solveFor: 'lower', supply: '0', midpoint: '0' },
    { solveFor: 'upper', lower: '0', midpoint: '0' },
    { solveFor: 'lower', upper: '0', midpoint: '12' },
  ] as const)('distinguishes multiple solutions: %j', patch => {
    expect(failure(patch)).toContain('无法唯一确定');
  });
  it.each([
    { solveFor: 'upper', midpoint: '13' }, { solveFor: 'lower', midpoint: '13' },
    { solveFor: 'upper', supply: '0', midpoint: '1' }, { solveFor: 'lower', supply: '0', midpoint: '1' },
    { solveFor: 'supply', lower: '0', midpoint: '1' }, { solveFor: 'upper', lower: '0', midpoint: '1' },
    { solveFor: 'lower', upper: '0', midpoint: '1' },
  ] as const)('rejects an inconsistent set of conditions: %j', patch => {
    expect(failure(patch)).toContain('无解');
    expect(failure(patch)).not.toContain('无法唯一确定');
  });
  it.each([{ solveFor: 'upper', midpoint: '0' }, { solveFor: 'lower', midpoint: '12' }] as const)('does not present an infinite resistor as a solution: %j', patch => {
    expect(failure(patch)).toContain('无有限解');
  });
  it('rejects a shorted branch for both voltage targets', () => {
    for (const solveFor of ['midpoint', 'supply'] as const) expect(failure({ solveFor, upper: '0', lower: '0', midpoint: '0' })).toContain('不能同时为 0');
  });
  it.each(DIVIDER_PARAMETERS)('validates the three known inputs while solving %s', solveFor => {
    for (const key of DIVIDER_PARAMETERS.filter(key => key !== solveFor)) {
      for (const value of ['', '-1', 'NaN', 'Infinity']) expect(calculateDivider({ ...fixture, solveFor, [key]: value }).ok).toBe(false);
    }
  });
  it('avoids avoidable product/quotient overflow in inverse equations and rejects a non-finite answer', () => {
    const units = { upperUnit: 'Ω', lowerUnit: 'Ω' } as const;
    expect(solve({ ...units, solveFor: 'upper', supply: '1e300', midpoint: '1e-300', lower: '1e-300' }).upperOhms).toBeCloseTo(1e300, -285);
    expect(solve({ ...units, solveFor: 'supply', midpoint: '1e-300', upper: '1e300', lower: '1e-300' }).supplyV).toBeCloseTo(1e300, -285);
    expect(failure({ ...units, solveFor: 'upper', supply: '1e300', midpoint: '1e-300', lower: '1e300' })).toContain('范围');
    expect(failure({ ...units, solveFor: 'supply', midpoint: '1e300', upper: '1e300', lower: '1e-300' })).toContain('范围');
    expect(solve({ ...units, solveFor: 'midpoint', supply: '1e300', upper: '1e300', lower: '1e-300' }).midpointV).toBe(1e-300);
  });
});

describe('target selection, units and stored input migration', () => {
  it('materializes the previous result at full precision before changing the target', () => {
    const input = { ...DIVIDER_EXAMPLE, supply: '7', upper: '1', lower: '2', upperUnit: 'Ω', lowerUnit: 'Ω' } as const;
    const previous = solve(input).midpointV;
    const next = selectDividerTarget(input, 'upper');
    expect(next.midpoint).toBe(String(previous));
    expect(next.midpoint).not.toBe(number(previous));
    expect(next.supply).toBe(input.supply);
    expect(solve(next).upperOhms).toBeCloseTo(1, 13);
    expect(selectDividerTarget(next, 'upper')).toBe(next);
    let repeated: DividerInput = input;
    for (let count = 0; count < 50; count++) for (const target of DIVIDER_PARAMETERS) repeated = selectDividerTarget(repeated, target);
    expect(solve(repeated).upperOhms).toBeCloseTo(1, 12);
    expect(solve(repeated).lowerOhms).toBeCloseTo(2, 12);
  });
  it('changes only presentation for the target resistor unit, then carries its full value into the next mode', () => {
    const input: DividerInput = { ...fixture, solveFor: 'upper' };
    const value = solve(input), changed = { ...input, upperUnit: 'MΩ' as const };
    expect(solve(changed)).toEqual(value);
    expect(dividerResultValue('upper', value, changed)).toBe(.03);
    const next = selectDividerTarget(changed, 'midpoint');
    expect(next.upper).toBe('0.03');
    expect(solve(next).upperOhms).toBe(30000);
  });
  it('preserves unfinished inputs when no result can be carried across', () => {
    const input = { ...fixture, supply: '', solveFor: 'midpoint' as const };
    expect(selectDividerTarget(input, 'upper')).toEqual({ ...input, solveFor: 'upper' });
  });
  it('carries the latest valid result through an unfinished input instead of an old hidden value', () => {
    let input = changeDividerInput({ ...DIVIDER_EXAMPLE }, { supply: '12', upper: '20' });
    expect(input.midpoint).toBe('4');
    input = changeDividerInput(input, { upper: '' });
    expect(input.midpoint).toBe('4');
    expect(calculateDivider(input).ok).toBe(false);
    const next = selectDividerTarget(input, 'upper');
    expect(next.midpoint).toBe('4');
    expect(solve(next).upperOhms).toBe(20000);
  });
  it('migrates the original three-input memory to midpoint solving and roundtrips new preferences', () => {
    const legacy = { supply: '12', upper: '20', upperUnit: 'kΩ', lower: '10', lowerUnit: 'kΩ' };
    const stored = JSON.stringify({ version: 1, value: legacy });
    const storage = { getItem: () => stored, setItem: () => {} };
    const restored = readMemory(storage, viewMemoryKey('main', 'voltage-divider'), { ...DIVIDER_EXAMPLE }, restoreDividerInput);
    expect(restored).toMatchObject({ ...legacy, solveFor: 'midpoint' });
    expect(solve(restored).midpointV).toBe(4);
    const newValue = changeDividerInput({ ...fixture, solveFor: 'supply', upperUnit: 'MΩ' }, {});
    expect(restoreDividerInput(JSON.parse(JSON.stringify(newValue)))).toEqual(newValue);
  });
  it('rejects invalid target, resistance units or malformed values instead of persisting an unusable form', () => {
    for (const value of [null, [], { ...fixture, solveFor: 'both' }, { ...fixture, lowerUnit: 'milliohm' }, { ...fixture, midpoint: {} }]) expect(restoreDividerInput(value)).toBeUndefined();
  });
});

describe('single-choice fields and corresponding equations', () => {
  it.each(DIVIDER_PARAMETERS)('renders exactly one selected radio and one readonly result while solving %s', solveFor => {
    const input = { ...fixture, solveFor }, result = solve(input);
    const html = renderToStaticMarkup(<DividerFields input={input} result={result} onChange={() => {}} onSelect={() => {}} />);
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g)!;
    expect(radios).toHaveLength(4);
    expect(new Set(radios.map(radio => /name="([^"]+)"/.exec(radio)![1])).size).toBe(1);
    expect(radios.filter(radio => radio.includes('checked=""'))).toHaveLength(1);
    expect(radios.find(radio => radio.includes('checked=""'))).toContain(`value="${solveFor}"`);
    const numbers = html.match(/<input[^>]*type="number"[^>]*>/g)!;
    expect(numbers).toHaveLength(4);
    expect(numbers.filter(field => field.includes('readOnly=""'))).toHaveLength(1);
    expect(numbers.find(field => field.includes('readOnly=""'))).toContain(`data-testid="divider-input-${solveFor}"`);
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });
  it.each([
    ['midpoint', 'Vmid = Vin × R2 / (R1 + R2)'], ['supply', 'Vin = Vmid × (R1 + R2) / R2'],
    ['upper', 'R1 = R2 × (Vin − Vmid) / Vmid'], ['lower', 'R2 = R1 × Vmid / (Vin − Vmid)'],
  ] as const)('shows the selected %s equation and current from the same solution', (solveFor, equation) => {
    const html = renderToStaticMarkup(<DividerEquations solveFor={solveFor} result={solve({ solveFor })} />);
    expect(html).toContain(`aria-label="${equation}"`);
    expect(html).toContain('I = Vin / (R1 + R2)');
    expect(html).toContain('<mfrac>');
    expect(html).toContain('300 µA');
  });
});
