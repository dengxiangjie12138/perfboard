import { useViewMemory } from '../../services/useViewMemory';
import { memoryChoice } from '../../services/viewMemory';
import { calculateWire, type CurrentUnit, type ReferenceStatus } from './algorithm';
import './wire-gauge.css';
const fmt = (value: number) => value.toLocaleString('zh-CN', { maximumSignificantDigits: 6 });
const statusText: Record<ReferenceStatus, string> = { all: '', within: '参考区间内', below: '低于参考范围', above: '超过参考范围' };
export function WireGaugePage() {
  const [current, setCurrent] = useViewMemory('wire-current', '');
  const [unit, setUnit] = useViewMemory<CurrentUnit>('wire-unit', 'A', undefined, memoryChoice(['A','mA']));
  const result = calculateWire(current, unit);
  return <div className="wire-page"><section className="card wire-reference"><div className="wire-toolbar"><h1>线径对照</h1><label>期望电流<input data-testid="wire-current" inputMode="decimal" value={current} placeholder="留空显示全部" onChange={event => setCurrent(event.target.value)} /></label><label className="wire-unit">单位<select data-testid="wire-current-unit" value={unit} onChange={event => setUnit(event.target.value as CurrentUnit)}><option>A</option><option>mA</option></select></label></div>
      {result.ok ? <><p className="wire-summary" data-testid="wire-result-stats" role="status">{result.current === null ? `全部 ${result.candidates.length} 个 AWG 规格` : `${fmt(result.current)} A · ${result.matchCount} 个参考区间内规格 · 展示 ${result.candidates.length} 项（含相邻规格）`}{result.current !== null && result.matchCount === 0 && '；无匹配规格'}</p><div className="wire-table-scroll"><table data-testid="wire-candidates"><thead><tr><th scope="col">AWG</th><th scope="col">裸导体直径 <span>mm</span></th><th scope="col">平方数 <span>mm²</span></th><th scope="col">国标常用平方参考 <span>mm²</span></th><th scope="col">保守参考电流 <span>A</span></th><th scope="col">正常参考电流 <span>A</span></th><th scope="col">最大参考电流 <span>A</span></th></tr></thead><tbody>{result.candidates.map(row => <tr key={row.n} data-reference-status={row.status}><th scope="row">{row.label}{row.status !== 'all' && <small className={`wire-status wire-status-${row.status}`}>{statusText[row.status]}</small>}</th><td>{fmt(row.diameter)}</td><td>{fmt(row.area)}</td><td>{row.nearest === null ? '—' : fmt(row.nearest)}</td><td>{row.conservative.toFixed(3)}</td><td>{row.normal.toFixed(3)}</td><td>{row.maximum.toFixed(3)}</td></tr>)}</tbody></table></div></> : <p role="alert" className="wire-error">{result.error}</p>}
      <p className="wire-footnote">三档电流为<a href="https://www.liuwenhao.me/?p=5554" target="_blank" rel="noreferrer">原表参考值</a>，适用条件未注明。</p>
      <details className="wire-notes"><summary>换算依据与规格对照</summary><p>裸圆导体直径与面积按 <a href="https://nvlpubs.nist.gov/nistpubs/Legacy/hb/nbshandbook100.pdf" target="_blank" rel="noreferrer">NBS/NIST AWG 几何关系</a>计算：d = 0.127 × 92^((36 − n)/39) mm，A = πd²/4；4/0 的 n = −3，1/0 的 n = 0。</p><p>国标常用平方参考采用 0.5–400 mm² 常用公称序列，按面积就近匹配，仅作规格对照。小于 0.5 mm² 显示“—”。</p></details>
    </section></div>;
}
