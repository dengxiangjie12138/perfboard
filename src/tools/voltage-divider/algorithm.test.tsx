import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateDivider, DIVIDER_EXAMPLE, dividerCurrent, type DividerInput } from './algorithm';
import { VoltageDividerPage } from './VoltageDividerPage';
import { TOOLS, toolGroupFor } from '../registry';
import { searchPages } from '../../navigation/pages';
import { RouteContent } from '../../navigation/RouteContent';
import { independentRoute } from '../../navigation/windowRoute';
import { toolWindowDefinition, windowHash, windowRouteFromHash } from '../../windows/definitions';

vi.mock('../external-tools', () => ({ ExternalToolsPage: () => null, useExternalTools: () => ({ tools: [] }) }));
vi.mock('../../features/notes/NotesPage', () => ({ NotesPage: () => null }));

function success(patch: Partial<DividerInput> = {}) {
  const result = calculateDivider({ ...DIVIDER_EXAMPLE, ...patch });
  if (!result.ok) throw Error(result.error);
  return result.value;
}

describe('unloaded two-resistor divider', () => {
  it('calculates 5 V with equal 10 kΩ resistors as 2.5 V and 250 µA', () => {
    const r = success(); expect(r.midpointV).toBe(2.5); expect(r.currentA).toBe(.00025);
    expect(dividerCurrent(r.currentA)).toBe('250 µA');
  });
  it('uses the lower resistor for midpoint voltage and both for current', () => {
    const r = success({ supply: '12', upper: '20', lower: '10' });
    expect(r.midpointV).toBe(4); expect(r.currentA).toBe(.0004);
    const swapped = success({ supply: '12', upper: '10', lower: '20' });
    expect(swapped.midpointV).toBe(8); expect(swapped.currentA).toBe(r.currentA);
  });
  it('combines Ω, kΩ and MΩ without changing the physical result', () => {
    expect(success({ upper: '10000', upperUnit: 'Ω', lower: '.01', lowerUnit: 'MΩ' })).toEqual(success());
    expect(success({ supply: '24', upper: '2000', upperUnit: 'Ω', lower: '1' }).currentA).toBe(.008);
  });
  it('handles zero supply and either single zero-ohm resistor', () => {
    expect(success({ supply: '0' })).toMatchObject({ midpointV: 0, currentA: 0 });
    expect(success({ upper: '0' })).toMatchObject({ midpointV: 5, currentA: .0005 });
    expect(success({ lower: '0' })).toMatchObject({ midpointV: 0, currentA: .0005 });
    expect(calculateDivider({ ...DIVIDER_EXAMPLE, upper: '0', lower: '0' })).toMatchObject({ ok: false, error: expect.stringContaining('不能同时为 0') });
  });
  it.each(['', ' ', '-1', 'NaN', 'Infinity'])('rejects invalid voltage or resistance %j', value => {
    for (const key of ['supply', 'upper', 'lower'] as const) expect(calculateDivider({ ...DIVIDER_EXAMPLE, [key]: value }).ok).toBe(false);
  });
  it('avoids intermediate Vin × R2 overflow and refuses nonrepresentable results', () => {
    expect(success({ supply: '1e300', upper: '1e300', upperUnit: 'Ω', lower: '1e300', lowerUnit: 'Ω' }).midpointV).toBe(5e299);
    for (const patch of [{ upper: '1e308' }, { upper: '1e308', upperUnit: 'Ω', lower: '1e308', lowerUnit: 'Ω' }, { supply: '1e308', upper: '1e-300', lower: '1e-300', upperUnit: 'Ω', lowerUnit: 'Ω' }] as const) expect(calculateDivider({ ...DIVIDER_EXAMPLE, ...patch }).ok).toBe(false);
  });
  it('formats current across useful scales without rounding small current to zero', () => {
    expect(dividerCurrent(2)).toBe('2 A'); expect(dividerCurrent(.008)).toBe('8 mA');
    expect(dividerCurrent(2e-9)).toBe('2 nA'); expect(dividerCurrent(1e-15)).not.toBe('0 A');
  });
});

describe('standalone hardware integration', () => {
  it('opens without a repository and supports an independent window route', () => {
    expect(TOOLS.find(tool => tool.page === 'voltage-divider')).toMatchObject({ group: 'hardware', component: VoltageDividerPage, requiresRepository: false });
    expect(toolGroupFor('voltage-divider')).toBe('hardware');
    const route = { page: 'voltage-divider' as const };
    expect(RouteContent({ route, ready: false, theme: 'codex', onTheme: () => {}, onNavigate: () => {} })?.type).toBe(VoltageDividerPage);
    expect(toolWindowDefinition('voltage-divider')?.title).toBe('分压计算器');
    const windowRoute = independentRoute(route)!;
    expect(windowRoute).toEqual({ kind: 'tool', toolId: 'voltage-divider' });
    expect(windowRouteFromHash(windowHash(windowRoute))).toEqual(windowRoute);
  });
  it.each(['分压计算器', '电阻分压', '中点电压', 'fenya jisuan', 'voltage divider'])('finds the tool by %s', query => {
    expect(searchPages(query).map(page => page.page)).toContain('voltage-divider');
  });
  it('shows the default result, circuit and mathematical fractions with immediate calculation', () => {
    const html = renderToStaticMarkup(<VoltageDividerPage />);
    for (const text of ['分压计算器', '供电电压 Vin', '上电阻 R1', '下电阻 R2', '修改数值或单位后立即更新', '2.5', '250 µA', '<mfrac>', '中点无外接负载']) expect(html).toContain(text);
    expect(html).not.toContain('type="submit"');
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });
});
