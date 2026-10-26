import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateNetwork, formatNetworkNumber, type NetworkMode, type ResistorInput } from './algorithm';
import { ResistorSeriesPage } from '../resistor-series';
import { ResistorParallelPage } from '../resistor-parallel';
const row = (resistance = '1', unit: ResistorInput['unit'] = 'kΩ', power = '0.25'): ResistorInput => ({ resistance, unit, power });
function success(mode: NetworkMode, rows: ResistorInput[]) {
  const result = calculateNetwork(mode, rows);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
describe('resistor network', () => {
  it('equal ratings add only when each branch reaches its rating together', () => {
    for (const mode of ['series', 'parallel'] as const) {
      const result = success(mode, [row(), row(), row()]);
      expect(result.ratedPowerW).toBeCloseTo(0.75, 12);
      expect(result.equivalentOhms).toBeCloseTo(mode === 'series' ? 3000 : 1000 / 3, 10);
      expect(result.limitingIndices).toEqual([0, 1, 2]);
    }
  });
  it('finds the different bottlenecks for 1k and 2k', () => {
    const series = success('series', [row(), row('2')]);
    const parallel = success('parallel', [row(), row('2')]);
    expect(series.ratedPowerW).toBeCloseTo(0.375, 12);
    expect(parallel.ratedPowerW).toBeCloseTo(0.375, 12);
    expect(series.limitingIndices).toEqual([1]);
    expect(parallel.limitingIndices).toEqual([0]);
  });
  it('converts all supported resistance units and accepts per-row overrides', () => {
    expect(success('series', [row('1000', 'Ω'), row('1'), row('0.001', 'MΩ')]).equivalentOhms).toBe(3000);
    expect(success('series', [row('1', 'kΩ', '0.5'), row('2')]).ratedPowerW).toBeCloseTo(0.375, 12);
  });
  it('rejects empty, zero, negative, nonfinite and unit overflow inputs', () => {
    for (const value of ['', ' ', '0', '-1', 'Infinity', 'NaN', '1e-999']) {
      for (const mode of ['series', 'parallel'] as const) {
        expect(calculateNetwork(mode, [row(value)]).ok).toBe(false);
        expect(calculateNetwork(mode, [row('1', 'Ω', value)]).ok).toBe(false);
      }
    }
    expect(calculateNetwork('series', []).ok).toBe(false);
    expect(calculateNetwork('series', [row('1e308', 'MΩ')]).ok).toBe(false);
  });
  it('avoids reciprocal and product overflow for finite extreme values', () => {
    for (const mode of ['series', 'parallel'] as const) {
      for (const resistance of ['1e-300', '1e300']) {
        const result = success(mode, [row(resistance, 'Ω'), row(resistance, 'Ω')]);
        expect(result.ratedPowerW).toBeCloseTo(0.5, 10);
        expect(result.equivalentOhms).toBeGreaterThan(0);
        expect(Number.isFinite(result.equivalentOhms)).toBe(true);
      }
    }
    expect(calculateNetwork('series', [row('1e308', 'Ω'), row('1e308', 'Ω')]).ok).toBe(false);
    expect(calculateNetwork('parallel', [row('5e-324', 'Ω'), row('5e-324', 'Ω'), row('5e-324', 'Ω')]).ok).toBe(false);
    expect(calculateNetwork('series', [row('1', 'Ω', '1e308'), row('1', 'Ω', '1e308')]).ok).toBe(false);
    expect(formatNetworkNumber(1e-300)).not.toBe('0');
  });
  it('renders two standalone pages using shared controls and theme variables', () => {
    for (const [mode, Page] of [['series', ResistorSeriesPage], ['parallel', ResistorParallelPage]] as const) {
      const html = renderToStaticMarkup(createElement(Page));
      expect(html).toContain(`${mode}-network-add`);
      expect(html).toContain(`${mode}-network-default-power`);
      expect(html).toContain(`${mode}-network-apply-power`);
      expect(html).toContain(`${mode}-network-remove-2`);
      expect(html).toContain(`${mode}-network-power-1`);
      expect(html).toContain('calc-heading');
      expect(html).toContain('calc-card');
      expect(html).not.toContain('role="tab"');
      expect(html).toContain('本次会话');
    }
  });
});