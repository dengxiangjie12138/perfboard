import { useId } from 'react';
import { dcTransfer, engineeringText as eng, numberText as f, type CircuitParameters, type OpAmpResult } from './algorithm';
import { circuitDefinition, isDynamicCircuit, type CircuitId } from './metadata';
import { DynamicCharts } from './DynamicCharts';
import { ReferenceLink } from './ReferenceLink';
export function TransferChart({ id, parameters: p, result: r }: { id: CircuitId; parameters?: CircuitParameters; result?: OpAmpResult }) {
  const clipId = useId(), c = circuitDefinition(id);
  if (isDynamicCircuit(id)) return <DynamicCharts id={id} parameters={p} result={r} />;
  let plot = null, caption = '等待有效参数后绘制。';
  if (p && r) {
    const transfer = dcTransfer(id,p,r), { input, offset, gain } = transfer;
    const xMax = Math.max(Math.abs(input) * 1.3, Math.max(Math.abs(r.high - offset), Math.abs(r.low - offset)) / Math.max(Math.abs(gain),1e-30) * 1.3, 1e-6);
    const yMax = Math.max(Math.abs(r.low), Math.abs(r.high), 1e-6) * 1.22;
    const x = (v: number) => 49 + (v + xMax) / (2 * xMax) * 294, y = (v: number) => 179 - (v + yMax) / (2 * yMax) * 154;
    const limit = (v: number) => Math.max(r.low, Math.min(r.high, v)), limited = limit(r.output);
    const points = Array.from({ length: 201 }, (_, i) => { const xx = -xMax + 2 * xMax * i / 200; return `${x(xx)},${y(limit(gain * xx + offset))}`; }).join(' ');
    plot = <svg viewBox="0 0 370 230" role="img" aria-label={`直流传输关系，当前理想输出 ${f(r.output)} V，按设定摆幅限幅后 ${f(limited)} V`}><defs><clipPath id={clipId}><rect x="49" y="25" width="294" height="154" /></clipPath></defs>
      {[-2, -1, 0, 1, 2].map(i => <g key={i} className="opamp-chart-grid"><path d={`M${x(i * xMax / 2)} 25V179 M49 ${y(i * yMax / 2)}H343`} /><text x={x(i * xMax / 2)} y="196" textAnchor="middle">{f(i * xMax / 2, 2)}</text><text x="41" y={y(i * yMax / 2) + 3} textAnchor="end">{f(i * yMax / 2, 2)}</text></g>)}
      <g className="opamp-chart-label"><text x="48" y="15">Vout / V</text><text x="343" y="217" textAnchor="end">{transfer.label} / V</text></g>
      <g clipPath={`url(#${clipId})`}><path className="opamp-chart-axis" d={`M49 ${y(0)}H343 M${x(0)} 25V179`} /><path className="opamp-chart-limit" d={`M49 ${y(r.low)}H343 M49 ${y(r.high)}H343`} /><path className="opamp-chart-ideal" d={`M${x(-xMax)} ${y(-gain * xMax + offset)}L${x(xMax)} ${y(gain * xMax + offset)}`} /><polyline className="opamp-chart-line" points={points} /><circle className={'opamp-chart-point' + (limited !== r.output ? ' clipped' : '')} cx={x(input)} cy={y(limited)} r="6"><title>当前输入 {f(input)} V；理想输出 {f(r.output)} V；限幅示意 {f(limited)} V</title></circle></g></svg>;
    caption = transfer.detail + `圆点表示当前工作点；限幅值 ${f(limited)} V 仅为范围示意，不代表器件仿真结果。`;
  }
  return <section className="opamp-card opamp-transfer"><header><h2><span>03</span>直流传输关系</h2><small>随电阻与电源更新</small></header><div className="opamp-chart"><div className="opamp-chart-legend"><span><i className="ideal" />理想线性</span><span><i />按设定摆幅限幅</span></div>{plot}<p>{caption}</p></div>
    <dl className="opamp-mini-results"><div><dt>{id === 'ina2' || id === 'ina3' ? '最大级内噪声增益' : '噪声增益 · NG'}</dt><dd data-testid="opamp-noise-gain">{r ? f(r.noiseGain) + ' V/V' : '—'}</dd></div><div><dt>{id === 'ina2' || id === 'ina3' ? '单级带宽估算 · 不代表整体 −3 dB' : '小信号带宽估算 · GBW / NG'}</dt><dd data-testid="opamp-bandwidth">{r ? eng(r.bandwidth, 'Hz') : '—'}</dd></div></dl>
    <div className="opamp-reference">设计与计算参考：<ReferenceLink href={c.url}>TI {c.document} ↗</ReferenceLink><br />电阻与电源初值取自文档，输入为演示工作点。GBW 为参考器件典型值，带宽按单主极点模型估算。{(id === 'diff' || id === 'ina2' || id === 'ina3') && <><br />CMRR 仅反映当前名义电阻比例，未叠加电阻容差与器件 CMRR。</>}</div></section>;
}
