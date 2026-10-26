import { useId } from 'react';
import { engineeringText as eng, numberText as f, type CircuitParameters, type OpAmpResult } from './algorithm';
import { frequencyResponse, sinePoint } from './dynamic';
import { circuitDefinition, type CircuitId } from './metadata';
import { ReferenceLink } from './ReferenceLink';
export function DynamicCharts({ id, parameters: p, result: r }: { id: CircuitId; parameters?: CircuitParameters; result?: OpAmpResult }) {
  const clip = useId(), c = circuitDefinition(id), d = r?.dynamic;
  if (!p || !r || !d || (id !== 'integrator' && id !== 'differentiator')) return <section className="opamp-card"><header><h2><span>03</span>频率与时间响应</h2></header><p className="opamp-empty">等待有效参数后绘制。</p></section>;
  const poles = [d.inputPole,d.feedbackPole,d.unityFrequency].filter(n=>n>0 && Number.isFinite(n));
  const minF = Math.max(1e-9, Math.min(p.frequency / 100,...poles.map(n=>n/10))), maxF = Math.max(p.frequency * 100,...poles.map(n=>n*10));
  const logMin = Math.log10(minF), logMax = Math.log10(maxF), fx = (frequency: number) => 58 + (Math.log10(frequency)-logMin)/(logMax-logMin)*582;
  const samples = Array.from({length:241},(_,i)=>{const frequency=10**(logMin+(logMax-logMin)*i/240), response=frequencyResponse(id,p,frequency);return {frequency,db:20*Math.log10(Math.max(response.magnitude,1e-300)),phase:response.phase};});
  const lo = Math.floor(Math.min(...samples.map(s=>s.db))/20)*20, hi = Math.max(lo+20,Math.ceil(Math.max(...samples.map(s=>s.db))/20)*20);
  const gy = (db:number)=>168-(db-lo)/(hi-lo)*130, phaseLo=id==='integrator'?80:-280, phaseHi=id==='integrator'?190:-80, py=(phase:number)=>326-(phase-phaseLo)/(phaseHi-phaseLo)*110;
  const currentX=fx(p.frequency), duration=3/p.frequency;
  const points = Array.from({length:401},(_,i)=>{const time=duration*i/400;return {time,...sinePoint(p,d,time)};});
  const yLow=Math.min(p.vin-p.amplitude,r.output-d.outputAmplitude), yHigh=Math.max(p.vin+p.amplitude,r.output+d.outputAmplitude), pad=Math.max((yHigh-yLow)*.08,1e-6), clipped=r.output-d.outputAmplitude<r.low || r.output+d.outputAmplitude>r.high;
  const tx=(t:number)=>58+t/duration*582, ty=(v:number)=>202-(v-yLow+pad)/(yHigh-yLow+2*pad)*166, limit=(v:number)=>Math.max(r.low,Math.min(r.high,v));
  return <section className="opamp-card opamp-dynamic-charts" aria-label="频率与时间响应"><header><h2><span>03</span>频率与时间响应</h2><small>RC 网络 · 正弦稳态</small></header>
    <div className="opamp-chart"><h3>幅频与相频</h3><svg viewBox="0 0 680 365" role="img" aria-label={`幅相响应，当前增益 ${f(d.magnitude)} V/V，相位 ${f(d.phase)} 度`}>
      <g className="opamp-chart-grid">{[0,1,2,3,4].map(i=><g key={i}><path d={`M58 ${gy(lo+(hi-lo)*i/4)}H640 M${58+i*582/4} 38V326`} /><text x="48" y={gy(lo+(hi-lo)*i/4)+3} textAnchor="end">{f(lo+(hi-lo)*i/4,1)}</text><text x={58+i*582/4} y="345" textAnchor="middle">{eng(10**(logMin+(logMax-logMin)*i/4),'Hz')}</text></g>)}{[phaseLo,(phaseLo+phaseHi)/2,phaseHi].map(v=><g key={v}><path d={`M58 ${py(v)}H640`} /><text x="48" y={py(v)+3} textAnchor="end">{f(v)}</text></g>)}</g>
      <g className="opamp-chart-label"><text x="58" y="23">增益 / dB</text><text x="58" y="203">相位 / °</text></g>
      <polyline className="opamp-chart-line" points={samples.map(s=>`${fx(s.frequency)},${gy(s.db)}`).join(' ')} /><polyline className="opamp-chart-line" points={samples.map(s=>`${fx(s.frequency)},${py(s.phase)}`).join(' ')} />
      <path className="opamp-chart-limit" d={`M${currentX} 38V326`} /><circle className="opamp-chart-point" cx={currentX} cy={gy(20*Math.log10(d.magnitude))} r="4" /><circle className="opamp-chart-point" cx={currentX} cy={py(d.phase)} r="4" />
    </svg><p>完整 RC 传递函数，未叠加有限开环增益与压摆率。当前 f = {eng(p.frequency,'Hz')}；频率过高时以页面 GBW 提示为准。</p>
    <h3>正弦稳态 · 三个周期</h3><div className="opamp-chart-legend"><span><i className="ideal" />输入</span><span><i />理想输出</span><span><i className="limited" />按设定摆幅限幅</span></div>
    <svg viewBox="0 0 680 245" role="img" aria-label={`正弦稳态，输出直流中心 ${f(r.output)} V，输出峰值幅度 ${f(d.outputAmplitude)} V`}><defs><clipPath id={clip}><rect x="58" y="36" width="582" height="166" /></clipPath></defs>
      <g className="opamp-chart-grid">{[0,1,2,3,4].map(i=><g key={i}><path d={`M58 ${36+i*166/4}H640 M${58+i*582/4} 36V202`} /><text x="48" y={36+i*166/4+3} textAnchor="end">{f(yHigh+pad-i*(yHigh-yLow+2*pad)/4,2)}</text><text x={58+i*582/4} y="220" textAnchor="middle">{f(duration*i/4*1e3,4)}</text></g>)}</g>
      <g className="opamp-chart-label"><text x="58" y="23">电压 / V</text><text x="640" y="238" textAnchor="end">时间 / ms</text></g>
      <g clipPath={`url(#${clip})`}><polyline className="opamp-chart-ideal" points={points.map(s=>`${tx(s.time)},${ty(s.input)}`).join(' ')} /><polyline className="opamp-chart-line" points={points.map(s=>`${tx(s.time)},${ty(s.output)}`).join(' ')} />{clipped && <polyline className="opamp-chart-limit" points={points.map(s=>`${tx(s.time)},${ty(limit(s.output))}`).join(' ')} />}</g>
    </svg><p>稳态中心已包含输入直流分量与参考电压。限幅仅作范围示意，不模拟上电、初始电荷或饱和恢复。</p></div>
    <dl className="opamp-mini-results"><div><dt>输出幅值 · 峰值</dt><dd data-testid="opamp-ac-amplitude">{f(d.outputAmplitude)} V</dd></div><div><dt>时间常数</dt><dd data-testid="opamp-time-constant">{eng(d.tau*1e3,'ms')}</dd></div></dl>
    <div className="opamp-reference">设计与计算参考：<ReferenceLink href={c.url}>TI {c.document} ↗</ReferenceLink><br />{c.note} 未计入器件失调、偏置电流、容差和寄生参数。</div>
  </section>;
}
