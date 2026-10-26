import type { ReactNode } from 'react';
import { numberText as f, type CircuitParameters } from '../algorithm';
import type { ComparatorId } from '../metadata';
import { monitoredSupply, oscillatorPoint, solveComparator, type ComparatorResult, type LogicState } from './algorithm';
export interface TracePoint { x:number; y:number }
export function comparatorSweep(id:ComparatorId,p:CircuitParameters,start:number,end:number,direction:'up'|'down'):TracePoint[] {
  const baseline=solveComparator(id,p), epsilon=(end-start)*1e-10;
  const samples=Array.from({length:101},(_,i)=>start+(end-start)*i/100);
  for(const threshold of [baseline.lower,baseline.upper]) for(const delta of [-epsilon,0,epsilon]) if(threshold+delta>start&&threshold+delta<end)samples.push(threshold+delta);
  samples.sort((a,b)=>direction==='up'?a-b:b-a);
  let memory:LogicState=direction==='up'?(baseline.inverting?'high':'low'):(baseline.inverting?'low':'high');
  const points:TracePoint[]=[];
  for(const x of samples) {
    const next=solveComparator(id,{...p,[monitoredSupply(id)?'vcc':'vin']:x},memory);
    if(next.state!==memory) points.push({x,y:memory==='high'?next.high:next.low});
    points.push({x,y:next.output});memory=next.state;
  }
  return points;
}
function Plot({series,xLabel,children,point,band,verticals=[]}:{series:{points:TracePoint[];className:string}[];xLabel:string;children?:ReactNode;point?:TracePoint;band?:[number,number];verticals?:number[]}) {
  const all=series.flatMap(s=>s.points).filter(pt=>Number.isFinite(pt.x)&&Number.isFinite(pt.y));
  if(!all.length)return null;
  const xmin=Math.min(...all.map(pt=>pt.x)),xmax=Math.max(...all.map(pt=>pt.x)),xspan=xmax-xmin||1;
  const min=Math.min(...all.map(pt=>pt.y)),max=Math.max(...all.map(pt=>pt.y)),pad=Math.max((max-min)*.16,Math.max(Math.abs(max),Math.abs(min),1)*.02),ymin=min-pad,ymax=max+pad;
  const x=(v:number)=>64+(v-xmin)/xspan*552,y=(v:number)=>208-(v-ymin)/(ymax-ymin)*184;
  return <svg className="opamp-comparator-plot" viewBox="0 0 640 255" role="img" aria-label={xLabel}>
    {band&&<rect className="opamp-chart-band" x={x(band[0])} y="24" width={Math.max(0,x(band[1])-x(band[0]))} height="184"/>}
    <g className="opamp-chart-grid">{Array.from({length:5},(_,i)=>{const xv=xmin+xspan*i/4,yv=ymin+(ymax-ymin)*i/4;return <g key={i}><path d={`M64 ${y(yv)}H616 M${x(xv)} 24V208`}/><text x="55" y={y(yv)+3} textAnchor="end">{f(yv,3)}</text><text x={x(xv)} y="227" textAnchor="middle">{f(xv,3)}</text></g>;})}</g>
    <path className="opamp-chart-axis" d="M64 24V208H616"/>
    {verticals.map((v,i)=><path key={i} className="opamp-chart-limit" d={`M${x(v)} 24V208`}/>)}
    {series.map((s,i)=><polyline key={i} className={s.className} points={s.points.filter(pt=>Number.isFinite(pt.x)&&Number.isFinite(pt.y)).map(pt=>`${x(pt.x)},${y(pt.y)}`).join(' ')}/>)}
    {point&&Number.isFinite(point.y)&&<circle className="opamp-chart-point" cx={x(point.x)} cy={y(point.y)} r="4"/>}
    <g className="opamp-chart-label"><text x="64" y="14">电压 / V</text><text x="340" y="250" textAnchor="middle">{xLabel}</text>{children}</g>
  </svg>;
}
export function ComparatorCharts({id,parameters:p,result:r}:{id:ComparatorId;parameters?:CircuitParameters;result?:ComparatorResult}) {
  if(!p||!r)return <section className="opamp-card"><header><h2><span>03</span>比较器响应</h2></header><p className="opamp-empty">修正参数后显示传输与时域响应。</p></section>;
  if(r.oscillator) {
    const o=r.oscillator;
    const times=Array.from({length:601},(_,i)=>o.period*3*i/600);
    // Add both sides of every transition so the output has vertical edges, not sampling ramps.
    for(let i=0;i<3;i++)for(const t of [o.period*i,o.period*i+o.highTime])times.push(t,Math.max(0,t-o.period*1e-10));
    times.sort((a,b)=>a-b);
    const output=times.map(t=>({x:t*1e6,y:oscillatorPoint(r,t).output})),cap=times.map(t=>({x:t*1e6,y:oscillatorPoint(r,t).capacitor}));
    return <section className="opamp-card opamp-comparator-charts"><header><h2><span>03</span>充放电与方波响应</h2><small>3 个周期 · 理想稳态</small></header><div className="opamp-chart">{o.running?<><h3>电容电压 Vc 与输出 Vout</h3><Plot xLabel="时间 / µs" series={[{points:cap,className:'opamp-chart-falling'},{points:output,className:'opamp-chart-line'}]}/><div className="opamp-chart-legend"><span><i/>Vout</span><span><i className="falling"/>Vc · 指数充放电</span></div><p>Vc 到达 VH 时输出转低，到达 VL 时输出转高。理想频率 {f(o.frequency)} Hz，占空比 {f(o.duty*100,2)}%。传播延迟未计入。</p></>:<p>当前阈值无法形成周期振荡，已暂停波形。</p>}</div></section>;
  }
  let lo=Math.min(r.lower,r.upper,r.input,p.vee),hi=Math.max(r.lower,r.upper,r.input,p.vcc);
  if(id==='zero-cross'){lo=Math.min(lo,p.vin-p.amplitude);hi=Math.max(hi,p.vin+p.amplitude);}
  const span=Math.max(hi-lo,.1);lo-=span*.15;hi+=span*.15;
  // Supply-monitor sweeps stay above Vee; their output rail follows the swept supply.
  if(monitoredSupply(id))lo=Math.max(p.vee+1e-6,lo);
  const up=comparatorSweep(id,p,lo,hi,'up'),down=comparatorSweep(id,p,lo,hi,'down');
  const waveTimes=Array.from({length:601},(_,i)=>3/p.frequency*i/600);
  const source=waveTimes.map(t=>({x:t*1000,y:p.vin+p.amplitude*Math.sin(2*Math.PI*p.frequency*t)}));
  const pins=source.map(pt=>({x:pt.x,y:Math.max(p.vee-p.diodeDrop,p.vee+(pt.y-p.vee)*r.dividerRatio)}));
  const wave=source.map(pt=>({x:pt.x,y:pt.y>p.vee?r.high:r.low}));
  return <section className="opamp-card opamp-comparator-charts" aria-label="比较器响应"><header><h2><span>03</span>阈值与传输关系</h2><small>输入上升 / 下降</small></header><div className="opamp-chart">
    <Plot xLabel={`${id==='overvoltage'?'SUPPLY':id==='undervoltage'?'VBAT':'Vin'} / V`} series={[{points:down,className:'opamp-chart-falling'},{points:up,className:'opamp-chart-line'}]} point={r.boundary?undefined:{x:r.input,y:r.output}} band={r.width>0?[r.lower,r.upper]:undefined} verticals={[r.lower,...r.width>0?[r.upper]:[]]}/>
    <div className="opamp-chart-legend"><span><i/>输入上升 →</span><span><i className="falling"/>输入下降 ←</span><span>圆点：当前值</span></div>
    <p>{id==='window'?'阴影为允许窗口，窗口内输出高。':r.width>0?'阴影为滞回区；输入上升与下降的翻转点不同。':'无外部迟滞；上升与下降曲线重合，临界点不保证输出状态。'}{monitoredSupply(id)?' 扫描被测电源时，比较器供电同步变化；工作范围以提示为准。':''}</p>
    {id==='zero-cross'&&<><h3>输入正弦 · Vp 为峰值</h3><Plot xLabel="时间 / ms · Vin" series={[{points:source,className:'opamp-chart-line'}]}/><h3>比较器同相引脚 · 含负向钳位</h3><Plot xLabel="时间 / ms · V+" series={[{points:pins,className:'opamp-chart-falling'}]}/><h3>比较器输出</h3>{p.amplitude===0&&r.boundary?<p>输入固定在比较门限，输出逻辑不确定，已暂停输出波形。</p>:<Plot xLabel="时间 / ms · Vout" series={[{points:wave,className:'opamp-chart-line'}]}/>}<p>三个通道独立纵轴；输出为无延迟的理想符号判决，不包含器件内部迟滞与过驱动恢复。</p></>}
  </div></section>;
}
