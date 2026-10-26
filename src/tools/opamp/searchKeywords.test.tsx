import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfflineSearch } from '../../services/search';
import { searchPages } from '../../navigation/pages';
import { GlobalSearch } from '../../navigation/GlobalSearch';
import { WorkbenchPage } from '../../features/workbench/WorkbenchPage';
import { CIRCUITS, circuitDefinition, type CircuitDefinition, type CircuitId } from './metadata';
import { searchCatalog } from './catalogSearch';

vi.mock('../../state/DataContext', () => ({ useData: () => ({ data: { parts: [], notes: [], attachments: [], settings: {} } }) }));
vi.mock('../external-tools', () => ({ ExternalToolsPage: () => null, useExternalTools: () => ({ tools: [] }) }));
vi.mock('../../features/notes/NotesPage', () => ({ NotesPage: () => null }));

const circuitSearch = new OfflineSearch<CircuitDefinition>(c => [c.title, c.description, ...c.keywords]);
const cases: readonly (readonly [CircuitId, string])[] = [
  ['follower', '阻抗变换'], ['inv', '倒相放大'], ['noninv', '正相放大'], ['sum', '混音电路'],
  ['diff', '差分转单端'], ['ina2', '两运放仪表放大器'], ['ina3', '电桥放大'],
  ['integrator', '积分运算'], ['differentiator', '变化率检测'],
  ['ac-inv', '电容耦合反相放大'], ['ac-noninv', '非反相交流放大'], ['lowpass-inv', '反相低通滤波'],
  ['sk-highpass', '萨伦凯高通'], ['sk-lowpass', 'SK低通'], ['mfb-bandpass', '多重反馈带通'],
  ['tia', '光电流放大'], ['current-uni', '单向电流采样'], ['current-bi', '充放电电流检测'], ['howland', '电压转电流'],
  ['pwm', '可调占空比'], ['reference', '参考电压源'], ['sine-osc', 'RC移相振荡'], ['hv-driver', '运放扩流'],
  ['half-wave', '精密二极管'], ['full-wave', '取绝对值'], ['single-diff', '非平衡转平衡'],
  ['level-shift', '电平搬移'], ['pga', '增益调节'], ['mic-noninv', '麦克风电压放大'], ['mic-tia', '麦克风电流放大'],
  ['comparator', '单门限检测'], ['schmitt-inv', '反向施密特'], ['schmitt-noninv', '非反相施密特'],
  ['window', '区间检测'], ['zero-cross', '正弦转方波'], ['overvoltage', '过压报警'],
  ['undervoltage', '电池欠压检测'], ['relaxation', '矩形波发生器'],
];

describe('human circuit search vocabulary', () => {
  it.each(cases)('finds %s by %s in every search entry', (id, query) => {
    const title = circuitDefinition(id).title;
    expect(circuitSearch.search(CIRCUITS, query).map(c => c.id)).toContain(id);
    expect(searchCatalog(query).map(entry => entry[4])).toContain(id);
    expect(searchPages(query).some(page => page.page === 'opamp' && page.toolItemId === id)).toBe(true);
    expect(renderToStaticMarkup(<GlobalSearch data={{ parts: [], notes: [], attachments: [], settings: {} }} query={query} onQuery={() => {}} disabled={false} onNavigate={() => {}} />)).toContain(title);
    expect(renderToStaticMarkup(<WorkbenchPage initialQuery={query} onNavigate={() => {}} />)).toContain(title);
  });

  it.each([
    ['差分转单端', 'diff', 'single-diff'], ['单端转差分', 'single-diff', 'diff'],
    ['differential-to-single-ended', 'diff', 'single-diff'], ['single-ended-to-differential', 'single-diff', 'diff'],
  ] as const)('preserves the direction of %s', (query, expected, excluded) => {
    const ids = circuitSearch.search(CIRCUITS, query).map(c => c.id);
    expect(ids[0]).toBe(expected);
    expect(ids).not.toContain(excluded);
    const catalogIds = searchCatalog(query).map(c => c[4]);
    expect(catalogIds[0]).toBe(expected);
    expect(catalogIds).not.toContain(excluded);
  });

  it.each([
    ['chafen zhuan danduan', 'diff'], ['CF ZDD', 'diff'], ['正相 fangda', 'noninv'],
    ['i/v转换', 'tia'], ['V/I转换', 'howland'], ['BPF', 'mfb-bandpass'],
    ['施米特', 'schmitt-inv'], ['话筒前置', 'mic-noninv'], ['话筒前置', 'mic-tia'],
    ['differential to single ended', 'diff'], ['single ended to differential', 'single-diff'],
  ] as const)('supports pinyin, mixed input and abbreviations: %s', (query, id) => {
    expect(circuitSearch.search(CIRCUITS, query).map(c => c.id)).toContain(id);
    expect(searchCatalog(query).map(entry => entry[4])).toContain(id);
    expect(searchPages(query).some(page => page.toolItemId === id)).toBe(true);
  });
});
