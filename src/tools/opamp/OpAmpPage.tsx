import { useViewMemory } from '../../services/useViewMemory';
import { readViewMemory, writeViewMemory } from '../../services/viewMemory';
import { LibraryWorkspace } from './library/LibraryWorkspace';
import { Fragment, useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, RotateCcw, Search } from 'lucide-react';
import { OfflineSearch } from '../../services/search';
import { CIRCUITS, circuitCategory, circuitDefinition, circuitNumber, isCircuitId, isComparatorCircuit, isLibraryCircuit, isDifferentialCircuit, isDynamicCircuit, parameterLabel, type CircuitDefinition, type CircuitId, type ParameterKey } from './metadata';
import { calculateOpAmp, circuitNotices, initialDraft, initialDrafts, matchingDraft, numberText as f, type OpAmpDraft } from './algorithm';
import { CircuitSchematic } from './CircuitSchematic';
import { CalculationSteps } from './CalculationSteps';
import { TransferChart } from './TransferChart';
import { ReferenceLink } from './ReferenceLink';
import { CatalogDialog } from './CatalogDialog';
import { InlineParameterEditor, type ParameterEdit } from './InlineParameterEditor';
import { BufferedParameterField } from './BufferedParameterField';
import { CATALOG } from './catalog';
import { ComparatorWorkspace } from './comparator/ComparatorWorkspace';
import { comparatorMemory } from './comparator/algorithm';
import './opamp.css';

const search = new OfflineSearch<CircuitDefinition>(c => [c.title, c.description, ...c.keywords]);
// Inputs and the selected circuit are kept separately for each WebView.
export function OpAmpPage({ selectedId, selectionRequest }: { selectedId?: string; selectionRequest?: object }) {
  const [id, setId] = useState<CircuitId>(() => isCircuitId(selectedId) ? selectedId : readViewMemory<CircuitId>('opamp-circuit', 'noninv', undefined, value => isCircuitId(value) ? value : undefined));
  const [drafts, setDrafts] = useViewMemory('opamp-drafts', initialDrafts), [selected, setSelected] = useState<ParameterKey | null>(null);
  const [edit, setEdit] = useState<ParameterEdit | null>(null);
  const [query, setQuery] = useViewMemory('opamp-query', ''), [catalogOpen, setCatalogOpen] = useState(false), [matchError, setMatchError] = useState('');
  useEffect(() => { if (isCircuitId(selectedId)) { setId(selectedId); writeViewMemory('opamp-circuit', selectedId); setSelected(null); setEdit(null); setQuery(''); setMatchError(''); } }, [selectedId, selectionRequest]);
  const c = circuitDefinition(id), draft = drafts[id], calculation = calculateOpAmp(id, draft);
  const p = calculation.ok ? calculation.parameters : undefined, r = calculation.ok ? calculation.value : undefined;
  const errors = calculation.ok ? {} : calculation.errors;
  function selectCircuit(next: CircuitId) { setId(next); writeViewMemory('opamp-circuit', next); setSelected(null); setEdit(null); setMatchError(''); }
  function update(next: OpAmpDraft) {
    const calculated = isComparatorCircuit(id) ? calculateOpAmp(id, next) : undefined;
    const memory = calculated?.ok && calculated.value.comparator ? comparatorMemory(calculated.value.comparator) : undefined;
    const retained = memory ? { ...next, memory } : next;
    setDrafts(current => ({ ...current, [id]: retained })); setMatchError('');
  }
  function clearSelection() { setSelected(null); if (document.activeElement instanceof SVGElement && document.activeElement.matches('.opamp-editable')) document.activeElement.blur(); }
  function startEdit(parameter: ParameterKey, anchor: Element) { setSelected(parameter); setEdit({ parameter, anchor }); }
  function example() {
    const values = { ...draft.values }, units = { ...draft.units };
    if (id === 'noninv') { values.r1 = '10'; values.r2 = '10'; units.r1 = 1000; units.r2 = 1000; }
    else if (id === 'follower') values.vin = '1.5';
    else if (id === 'inv') { values.r2 = '50'; units.r2 = 1000; }
    else if (id === 'sum') values.vi2 = String(-Math.abs(Number(values.vi2) || .1));
    else if (isDynamicCircuit(id)) values.frequency = String(Math.min((Number(values.frequency) || 1000) * 10,1e12));
    else values.r4 = String((Number(values.r4) || Number(initialDraft(id).values.r4)) * 1.1);
    update({ values, units });
  }
  function overload() {
    if (!r || !p) return;
    const target = r.high + (r.high-r.low)*.25;
    const [key, value]: [ParameterKey, number] = r.dynamic ? ['amplitude', (Math.max(Math.abs(r.high-r.output),Math.abs(r.low-r.output))+1)/r.gain]
      : isDifferentialCircuit(id) ? ['vi2', (target-r.aMinus*p.vi1-r.aRef*p.vref)/r.aPlus]
      : id === 'sum' ? ['vi1',(target-r.aPlus*p.vi2)/r.aMinus] : ['vin',target/r.gain];
    update({ ...draft, values: { ...draft.values, [key]: String(value) } });
  }
  const differential = isDifferentialCircuit(id), dynamic = isDynamicCircuit(id);
  const clipped = r && (r.output < r.low || r.output > r.high), available = search.search(CIRCUITS, query);
  return <div className="opamp-page" onPointerDown={event => { if (!(event.target as Element).closest('.opamp-editable,.opamp-editor,.opamp-field')) clearSelection(); }} onKeyDown={event => { if (event.key === 'Escape' && !catalogOpen && !edit) clearSelection(); }}>
    <div className="opamp-page-heading"><div><div className="eyebrow">运放选型计算</div><h1>{c.title}</h1><p>{c.description}</p></div><div className="opamp-actions"><button className="small" onClick={() => { update(initialDraft(id)); setSelected(null); setEdit(null); }}><RotateCcw size={14} />恢复 TI 示例</button><ReferenceLink href={c.url}>TI 中文参考设计 <ArrowUpRight size={14} /></ReferenceLink></div></div>
    <div className="opamp-layout"><aside className="opamp-circuit-nav" aria-label="运放电路选择"><label className="opamp-circuit-search"><Search size={14} /><input type="search" aria-label="搜索运放电路" placeholder="搜索电路…" value={query} onChange={event => setQuery(event.target.value)} /></label>{available.map((circuit,index) => <Fragment key={circuit.id}>{(index===0||circuitCategory(available[index-1].id)!==circuitCategory(circuit.id))&&<div className="opamp-nav-label">{circuitCategory(circuit.id)}</div>}<button className={id === circuit.id ? 'active' : ''} aria-pressed={id === circuit.id} onClick={() => selectCircuit(circuit.id)}><span>{circuitNumber(circuit.id)}</span>{circuit.title}</button></Fragment>)}{!available.length && <p className="opamp-nav-empty">没有匹配的已实现电路。</p>}
      <button className="opamp-catalog-trigger" onClick={() => setCatalogOpen(true)}><BookOpen size={14} />参考电路目录 <small>{CATALOG.length}</small></button><p className="opamp-nav-note">目录 38 项已全部开放，支持名称、别名与拼音搜索。</p></aside>
      <div className="opamp-main-column">{isComparatorCircuit(id)?<ComparatorWorkspace id={id} draft={draft} selected={selected} onSelect={setSelected} onEdit={startEdit} errors={errors} result={r} parameters={p} onChange={update}/>:isLibraryCircuit(id)?<LibraryWorkspace id={id} draft={draft} selected={selected} onSelect={setSelected} onEdit={startEdit} errors={errors} result={r} parameters={p} onChange={update}/>:<><section className="opamp-card" aria-label="电路原理图与结果"><header><h2><span>01</span>电路原理图</h2><small>{c.document} · {c.chip}</small></header>
        <div className="opamp-schematic-area"><div className="opamp-diagram-tools">
          <div className="opamp-diagram-actions">{differential && <button className="small" title="按 R1、R2、R3 计算 R4，使两侧比例相等" onClick={() => {
            const matched = matchingDraft(draft); if (matched) { update(matched); setSelected('r4'); } else setMatchError('请先填写有效的 R1、R2 和 R3；匹配后的 R4 需位于计算范围内。');
          }}>匹配电阻比例</button>}
            <button className="small" onClick={example}>{id === 'noninv' ? '试试 2 倍增益' : id === 'follower' ? '试试 1.5 V 输入' : id === 'inv' ? '试试 −5 倍增益' : id === 'sum' ? '试试反向输入' : dynamic ? '试试 10 倍频率' : '试试电阻失配'}</button>
            <button className="small" disabled={!r} onClick={overload}>试试输出超限</button>
          </div>
          <div className="opamp-model-settings" role="group" aria-label="模型参数"><BufferedParameterField key={`${id}-headroom`} id={id} parameter="headroom" draft={draft} error={errors.headroom} onChange={update} /><BufferedParameterField key={`${id}-gbw`} id={id} parameter="gbw" draft={draft} error={errors.gbw} onChange={update} /></div>
        </div>{matchError && <p className="opamp-field-error opamp-match-error" role="alert">{matchError}</p>}
          <CircuitSchematic id={id} draft={draft} selected={selected} onSelect={setSelected} onEdit={startEdit} errors={errors} result={r} />
        </div><p className="opamp-schematic-note">双击器件、输入、基准或供电数值编辑 · Enter / 完成确认 · Esc / 空白取消<span>按 TI 信号拓扑重绘</span></p>
        <div className="opamp-results" aria-live="polite" aria-atomic="true"><div className="primary"><span>{dynamic ? '输出直流中心 · Vout,DC' : '理想输出电压 · Vout'}</span><strong data-testid="opamp-output">{r ? f(r.output) : '—'}<small>V</small></strong><small>{r ? clipped ? '超出设定摆幅 · 见下方提示' : dynamic ? '正弦稳态中心 · 非瞬时输出' : '线性工作假设' : '参数待修正'}</small></div><div><span>{dynamic ? '当前频率增益 · |H|' : differential ? '差模增益 · Ad' : id === 'sum' ? '输入 1 增益 · A1' : '闭环增益 · Av'}</span><strong data-testid="opamp-gain">{r ? f(r.gain) : '—'}<small>V/V</small></strong><small>{r ? f(20 * Math.log10(Math.abs(r.gain)), 2) + ' dB' : '等待有效参数'}</small></div><div><span>{dynamic ? '输出幅值 · 峰值' : differential ? '差分输入 · Vdiff' : id === 'sum' ? '输入 2 增益 · A2' : '线性假设下 · V+'}</span><strong data-testid="opamp-third-result">{r ? f(r.dynamic ? r.dynamic.outputAmplitude : differential ? r.vdiff : id === 'sum' ? r.aPlus : r.vplus) : '—'}<small>{id === 'sum' ? 'V/V' : 'V'}</small></strong><small>{r?.dynamic ? '相位 ' + f(r.dynamic.phase,2) + '°' : differential ? 'Vi2 − Vi1' : id === 'sum' ? '−R3 / R2' : '同相端节点电压'}</small></div></div>
        <div className="opamp-notices" role="status">{r && p ? circuitNotices(id, p, r).map((notice, i) => <p key={i} className={notice.warning ? 'warning' : ''}>{notice.text}</p>) : <div className="opamp-invalid-summary"><p className="error">参数尚未有效，已暂停计算。点击下方参数可重新编辑。</p>{(Object.entries(errors) as [ParameterKey, string][]).map(([key, error]) => <button className="small" key={key} onClick={event => {
          if (key === 'headroom' || key === 'gbw') { const input = event.currentTarget.closest('.opamp-page')?.querySelector<HTMLInputElement>(`#opamp-${key}`); input?.focus(); input?.select(); }
          else startEdit(key, event.currentTarget);
        }}>{parameterLabel(id, key).symbol}：{error}</button>)}</div>}</div>
        <p className="opamp-model-note">H 为假设的两侧摆幅余量；GBW 为可修改的典型值，带宽按单主极点估算。{c.note}</p>
      </section><div className="opamp-bottom"><CalculationSteps id={id} parameters={p} result={r} /><TransferChart id={id} parameters={p} result={r} /></div></>}</div>
    </div><p className="opamp-session-note">输入按当前窗口会话保留；退出应用后恢复示例。计算不依赖仓库，不写入仓库数据。</p>
    {edit && <InlineParameterEditor key={`${id}-${edit.parameter}`} id={id} edit={edit} draft={draft} onChange={update} onClose={() => { setEdit(null); setSelected(null); }} />}
    {catalogOpen && <CatalogDialog onClose={() => setCatalogOpen(false)} onOpen={next => { selectCircuit(next); setQuery(''); setCatalogOpen(false); }} />}
  </div>;
}
