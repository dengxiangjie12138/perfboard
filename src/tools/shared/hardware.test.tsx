import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TOOLS } from '../registry';
import { searchPages } from '../../navigation/pages';
import { RouteContent } from '../../navigation/RouteContent';
import { independentRoute } from '../../navigation/windowRoute';
import { toolWindowDefinition, windowHash, windowRouteFromHash } from '../../windows/definitions';
import { PWM_DEVICES } from '../uc28-38xx/devices';
import { HardwareReference, passiveValue, resistor, capacitor, type HardwareToolId } from './hardware';
vi.mock('../external-tools', () => ({ ExternalToolsPage: () => null, useExternalTools: () => ({ tools: [] }) }));
vi.mock('../../features/notes/NotesPage', () => ({ NotesPage: () => null }));
const ids: HardwareToolId[] = ['tl431', 'pullup-divider', 'uc28-38xx', 'pmos-switch'];
describe('new hardware tools integrate without a repository', () => {
  it.each(ids)('opens %s and supports an independent tool window', page => {
    const tool = TOOLS.find(t => t.page === page)!;
    expect(tool.group).toBe('hardware'); expect(tool.requiresRepository).toBe(false);
    expect(RouteContent({ route: { page }, ready: false, theme: 'codex', onTheme: () => {}, onNavigate: () => {} })?.type).toBe(tool.component);
    const route = independentRoute({ page })!; expect(route).toEqual({ kind: 'tool', toolId: page });
    expect(windowRouteFromHash(windowHash(route))).toEqual(route); expect(toolWindowDefinition(page)).toBeDefined();
  });
  it.each([['tl431', 'TL431'], ['tl431', '可调基准'], ['pullup-divider', '端口反接'], ['pullup-divider', '上拉分压'], ['pmos-switch', '高边开关'], ['pmos-switch', 'PMOS'], ['uc28-38xx', 'CS'], ['uc28-38xx', '启动电压']] as const)('searches %s by %s', (page, keyword) => {
    expect(searchPages(keyword).map(p => p.page)).toContain(page);
  });
  it.each(PWM_DEVICES.map(d => d.id))('finds the controller tool for %s', keyword => { expect(searchPages(keyword).map(p => p.page)).toContain('uc28-38xx'); });
  it.each(ids)('renders %s with immediate results, schematic and readable fractions', id => {
    const Component = TOOLS.find(t => t.page === id)!.component;
    const html = renderToStaticMarkup(<Component />);
    for (const text of ['实时计算', '电路与结果', '计算过程', '<svg', '<mfrac>']) expect(html).toContain(text);
    expect(html).not.toMatch(/NaN|Infinity|undefined/); expect(html).not.toContain('type="submit"');
  });
  it('defaults the idle divider to the supplied zero-volt simulation model', () => {
    const Component = TOOLS.find(t => t.page === 'pullup-divider')!.component;
    const html = renderToStaticMarkup(<Component />);
    expect(html).toContain('0.7258970359'); expect(html).toContain('未接入 · 0 V');
    expect(html).toContain('输入支路断开 · 真正悬空'); expect(html).not.toContain('0.7615384615');
  });
  it('exposes the Chinese source as a normal safe browser link', () => {
    const html = renderToStaticMarkup(<HardwareReference tool="tl431" href="https://www.ti.com.cn/cn/lit/gpn/TL431">中文规格书</HardwareReference>);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"'); expect(html).toContain('/cn/lit/gpn/TL431');
  });
  it('normalizes passive units and refuses blank or unknown units', () => {
    expect(passiveValue(resistor('10'))).toBe(10000); expect(passiveValue(resistor('.01', 'MΩ'))).toBe(10000);
    expect(passiveValue(capacitor('1000', 'pF'))).toBeCloseTo(1e-9, 15); expect(passiveValue(capacitor('.001', 'µF'))).toBeCloseTo(1e-9, 15);
    expect(passiveValue(resistor(''))).toBeNaN(); expect(passiveValue(resistor('1', 'bad'))).toBeNaN();
  });
});
