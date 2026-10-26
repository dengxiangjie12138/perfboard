import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpAmpPage } from './OpAmpPage';
import { CalculationSteps } from './CalculationSteps';
import { calculateOpAmp, initialDraft } from './algorithm';
import { CIRCUITS, isComparatorCircuit, isLibraryCircuit, isDynamicCircuit } from './metadata';
import { CATALOG, catalogReference } from './catalog';
import { pageLabel, searchPages } from '../../navigation/pages';
import { TOOLS, toolGroupFor } from '../registry';
import { toolWindowDefinition } from '../../windows/definitions';
import { GlobalSearch } from '../../navigation/GlobalSearch';
import { WorkbenchPage } from '../../features/workbench/WorkbenchPage';
import { RouteContent } from '../../navigation/RouteContent';
vi.mock('../../state/DataContext', () => ({ useData: () => ({ data: { parts: [], notes: [], attachments: [], settings: {} }, repo: { ready: false }, setError: vi.fn() }) }));
vi.mock('../external-tools', () => ({ ExternalToolsPage: () => null, useExternalTools: () => ({ tools: [] }) }));
vi.mock('../../features/notes/NotesPage', () => ({ NotesPage: () => null }));
describe('op amp module registration and search', () => {
  it.each(CIRCUITS.filter(c=>isLibraryCircuit(c.id)))('searches new TI circuit $title from global and workbench search', c=>{
    expect(searchPages(c.title).some(entry=>entry.page==='opamp'&&entry.toolItemId===c.id)).toBe(true);
    const global=renderToStaticMarkup(<GlobalSearch data={{parts:[],notes:[],attachments:[],settings:{}}} query={c.title} onQuery={()=>{}} disabled={false} onNavigate={()=>{}}/>);
    expect(global).toContain(c.title);
    expect(renderToStaticMarkup(<WorkbenchPage initialQuery={c.title} onNavigate={()=>{}}/>)).toContain(c.title);
  });
  it('is a repository-independent hardware tool in its own folder and separate window', () => {
    expect(TOOLS.find(tool => tool.page === 'opamp')).toMatchObject({ title: '运放选型计算', group: 'hardware', requiresRepository: false, component: OpAmpPage });
    expect(toolGroupFor('opamp')).toBe('hardware'); expect(pageLabel('opamp')).toBe('硬件计算选型 / 运放选型计算');
    expect(toolWindowDefinition('opamp')?.minWidth).toBe(900);
    const html = renderToStaticMarkup(<RouteContent route={{ page: 'opamp', toolItemId: 'diff' }} ready={false} theme="codex" onTheme={() => {}} onNavigate={() => {}} />);
    expect(html).toContain('差分放大电路'); expect(html).toContain('opamp-output'); expect(html).not.toContain('repo-path');
  });
  it.each([['同相放大', 'noninv'], ['非反相放大', 'noninv'], ['tongxiang fangda', 'noninv'], ['TX FD', 'noninv'], ['差分放大', 'diff'], ['减法器', 'diff'], ['chafen fangda', 'diff'], ['CF FD', 'diff'],['电压跟随','follower'],['反相放大','inv'],['加法器','sum'],['双运放仪表','ina2'],['三运放仪表','ina3'],['jifenqi','integrator'],['weifenqi','differentiator']])('searches %s with a circuit-specific route', (query, id) => {
    expect(searchPages(query).some(entry => entry.page === 'opamp' && entry.toolItemId === id)).toBe(true);
    const global = renderToStaticMarkup(<GlobalSearch data={{ parts: [], notes: [], attachments: [], settings: {} }} query={query} onQuery={() => {}} disabled={false} onNavigate={() => {}} />);
    expect(global).toContain(CIRCUITS.find(c => c.id === id)!.title);
    expect(renderToStaticMarkup(<WorkbenchPage initialQuery={query} onNavigate={() => {}} />)).toContain(CIRCUITS.find(c => c.id === id)!.title);
  });
  it('renders diagram editing, visible supplies and model settings without a parameter sidebar', () => {
    for (const c of CIRCUITS) {
      const html = renderToStaticMarkup(<OpAmpPage selectedId={c.id} />);
      const chart=isLibraryCircuit(c.id)?'响应与曲线':isComparatorCircuit(c.id)?c.id==='relaxation'?'充放电与方波响应':'阈值与传输关系':isDynamicCircuit(c.id)?'频率与时间响应':'直流传输关系';
      for (const text of ['运放电路选择', '搜索运放电路', '电路原理图与结果', '模型参数', '计算过程', chart, c.document, c.url]) expect(html).toContain(text);
      for (const key of [...c.resistors, ...(c.capacitors ?? []), ...c.inputs, 'vcc', 'vee']) expect(html).toContain(`data-parameter="${key}"`);
      expect(html).toContain('双击器件、输入、基准或供电数值编辑'); expect(html).not.toContain('opamp-parameters');
      expect(html).toContain('<mfrac>'); expect(html).toContain('<msub>');
      expect(html).toContain(`编辑 Vcc，${Number(initialDraft(c.id).values.vcc)} V`);
      expect(html).not.toMatch(/NaN|Infinity|undefined/);
    }
    expect(CATALOG).toHaveLength(38);
    expect(CATALOG.filter(entry => entry[4])).toHaveLength(38);
    expect(CATALOG.filter(entry => entry[0] === '基础放大与运算').every(entry=>entry[4])).toBe(true);
    expect(CATALOG.every(entry => /^https:\/\/www\.ti\.com\.cn\/(cn\/lit\/pdf\/ZH|tool\/cn\/)/.test(catalogReference(entry)))).toBe(true);
  });
  it('updates the numeric fraction, output and noise-gain bandwidth in mathematical notation', () => {
    const draft = initialDraft('noninv'); draft.values.r1 = '19.19';
    const result = calculateOpAmp('noninv', draft); if (!result.ok) throw Error('Invalid fixture');
    const html = renderToStaticMarkup(<CalculationSteps id="noninv" parameters={result.parameters} result={result.value} />);
    expect(html).toContain('aria-label="Vout = Vin × (1 + R1 / R2)"');
    expect(html).toContain('= 0.5 V × (1 + 19.19 kΩ / 1.01 kΩ) = 10 V');
    expect(html).toContain('BW ≈ GBW / NG = 3 MHz / 20 = 150 kHz');
    expect(html).toContain('<mn>19.19</mn>');
  });
  it('keeps the mismatched difference formula and reference contribution in the typeset steps', () => {
    const draft = initialDraft('diff'); draft.values.r4 = '22'; draft.values.vref = '.5';
    const result = calculateOpAmp('diff', draft); if (!result.ok) throw Error('Invalid fixture');
    const html = renderToStaticMarkup(<CalculationSteps id="diff" parameters={result.parameters} result={result.value} />);
    expect(html).toContain('失配时的信号分解'); expect(html).toContain('= 2.5469 V');
    expect(html).not.toContain('比例匹配时的简式');
    expect(html).toContain('BW ≈ GBW / NG = 1 MHz / 3 = 333.3333 kHz');
  });
  it('withholds typeset results when parameters are invalid', () => {
    const html = renderToStaticMarkup(<CalculationSteps id="diff" />);
    expect(html).toContain('修正参数后显示计算过程'); expect(html).not.toContain('<math');
  });
});
