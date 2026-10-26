import { numberText as f, type CircuitParameters } from '../algorithm';
import type { LibraryId } from './ids';
import { isAC, isAudio, libraryResponse, rectified, solveLibrary, type LibraryResult } from './algorithm';
import { magnitude } from './network';
interface Point {x:number;y:number}
function Plot({series,xLabel,yLabel,point}:{series:{points:Point[];secondary?:boolean}[];xLabel:string;yLabel:string;point?:Point}) {
  const points=series.flatMap(s=>s.points).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!points.length)return null;
  const xmin=Math.min(...points.map(p=>p.x)),xmax=Math.max(...points.map(p=>p.x)),ymin=Math.min(...points.map(p=>p.y)),ymax=Math.max(...points.map(p=>p.y));
  const dx=xmax-xmin||1,pad=Math.max((ymax-ymin)*.12,1e-5),dy=ymax-ymin+pad*2;
  const x=(v:number)=>64+(v-xmin)/dx*552,y=(v:number)=>208-(v-ymin+pad)/dy*180;
  return <svg className="opamp-comparator-plot" viewBox="0 0 640 255" role="img" aria-label={`${yLabel}随${xLabel}变化`}>
    <g className="opamp-chart-grid">{Array.from({length:5},(_,i)=>{const xv=xmin+dx*i/4,yv=ymin-pad+dy*i/4;return <g key={i}><path d={`M64 ${y(yv)}H616 M${x(xv)} 28V208`}/><text x="55" y={y(yv)+3} textAnchor="end">{f(yv,3)}</text><text x={x(xv)} y="228" textAnchor="middle">{f(xv,2)}</text></g>;})}</g>
    <path className="opamp-chart-axis" d="M64 28V208H616"/>{series.map((s,i)=><polyline key={i} className={s.secondary?'opamp-chart-falling':'opamp-chart-line'} points={s.points.filter(pt=>Number.isFinite(pt.x)&&Number.isFinite(pt.y)).map(p=>`${x(p.x)},${y(p.y)}`).join(' ')}/>)}
    {point&&<circle className="opamp-chart-point" cx={x(point.x)} cy={y(point.y)} r="4"/>}<g className="opamp-chart-label"><text x="64" y="14">{yLabel}</text><text x="340" y="250" textAnchor="middle">{xLabel}</text></g>
  </svg>;
}
export function LibraryCharts({id,parameters:p,result:r}:{id:LibraryId;parameters?:CircuitParameters;result?:LibraryResult}) {
  if(!p||!r)return <section className="opamp-card"><header><h2><span>03</span>响应与曲线</h2></header><p className="opamp-empty">修正参数后显示响应。</p></section>;
  let content;
  if(isAC(id)) {
    const centerLog=Math.log10(p.frequency),logs=Array.from({length:151},(_,i)=>Math.max(-3,centerLog-4)+8*i/150);
    const responses=logs.flatMap(log=>{
      try {const h=libraryResponse(id,p,Math.pow(10,log));return h.every(Number.isFinite)?[{log,h}]:[];}
      catch {return [];}
    });
    const gain=responses.map(({log,h})=>({x:log,y:20*Math.log10(Math.max(1e-18,magnitude(h)))})),phase=responses.map(({log,h})=>({x:log,y:Math.atan2(h[1],h[0])*180/Math.PI}));
    const points=Array.from({length:301},(_,i)=>{const t=i/(100*p.frequency);return {x:t*1000,y:r.center+(isAudio(id)?Math.SQRT2:1)*r.amplitude*Math.sin(2*Math.PI*p.frequency*t+r.phase*Math.PI/180)};});
    content=<><h3>幅频响应</h3><Plot xLabel="log₁₀(f / Hz)" yLabel={id==='tia'||isAudio(id)?'跨阻幅值 / dBΩ':'幅值 / dB'} series={[{points:gain}]} point={{x:centerLog,y:20*Math.log10(Math.max(1e-18,r.gain))}}/><h3>相位响应</h3><Plot xLabel="log₁₀(f / Hz)" yLabel="相位 / °" series={[{points:phase}]}/><h3>当前频率的正弦稳态输出</h3><Plot xLabel="时间 / ms" yLabel="输出电压 / V" series={[{points}]}/><p>理想运放频响；未叠加 GBW、压摆率、饱和及启动暂态。{isAudio(id)?'声压和输出均以 RMS 设置，时域显示峰值 = RMS × √2。':id==='tia'?'时域采用 |Ii| 作为交流测试峰值，结果栏仍为直流输入 Ii 对应的输出。':'输出超限会提示，曲线保留理想值。'}相位按 −180° 到 180° 显示。{responses.length<logs.length?'部分采样点数值病态，已略过；请缩小参数数量级后核对曲线。':''}</p></>;
  }else if(id==='half-wave'||id==='full-wave') {
    const input=Array.from({length:601},(_,i)=>({x:i/(200*p.frequency)*1000,y:p.vin+p.amplitude*Math.sin(2*Math.PI*i/200)}));
    const out=input.map(pt=>({x:pt.x,y:rectified(id,p,pt.y)}));
    content=<><h3>输入与整流输出 · 3 个周期</h3><Plot xLabel="时间 / ms" yLabel="电压 / V" series={[{points:input,secondary:true},{points:out}]}/><div className="opamp-chart-legend"><span><i/>Vout</span><span><i className="falling"/>Vin</span></div><p>理想二极管静态响应，未计入过零瞬态。Vin 为输入直流中心，Vp 为正弦输入峰值。</p></>;
  }else if(id==='pwm'||id==='sine-osc') {
    if(!r.running)content=<p>当前参数不能维持振荡，已暂停波形。</p>;
    else{
      const time=Array.from({length:901},(_,i)=>i/300),output=time.map(v=>({x:v/r.frequency*1e6,y:id==='pwm'?(v%1<r.duty?p.vcc:p.vee):p.amplitude*Math.sin(2*Math.PI*v)}));
      // Include both sides of PWM edges to avoid slanted transitions caused by uniform sampling.
      if(id==='pwm')for(let i=0;i<3;i++)for(const edge of [i,i+r.duty])for(const offset of [-1e-10,1e-10]){const t=Math.max(0,edge+offset);output.push({x:t/r.frequency*1e6,y:t%1<r.duty?p.vcc:p.vee});}
      output.sort((a,b)=>a.x-b.x);
      const turn=(p.vref-p.vee)/(p.vcc-p.vee),triangle=time.map(t=>{const u=t%1;return {x:t/r.frequency*1e6,y:u<turn?r.triangleLow+(r.triangleHigh-r.triangleLow)*u/turn:r.triangleHigh-(r.triangleHigh-r.triangleLow)*(u-turn)/(1-turn)};});
      content=<><h3>{id==='pwm'?'PWM 输出与三角载波':'正弦稳态幅值示意'}</h3><Plot xLabel="时间 / µs" yLabel="电压 / V" series={[{points:output},...id==='pwm'?[{points:triangle,secondary:true}]:[]]}/><p>{id==='pwm'?'PWM 边沿相位作示意，频率和占空比来自平均闭环模型；无延迟、纹波或启动暂态。':'Vp 为手动幅值假设；线性起振分析不决定实际稳态幅值。'}</p></>;
    }
  }else {
    const key=id==='reference'?'alpha':id==='current-uni'||id==='current-bi'?'current':id==='howland'?'vi2':'vin';
    const center=p[key],span=Math.max(Math.abs(center)*1.5,1),start=key==='alpha'?0:center-span,end=key==='alpha'?1:center+span;
    const points=Array.from({length:81},(_,i)=>{const x=start+(end-start)*i/80;return {x,y:solveLibrary(id,{...p,[key]:x}).output*(id==='howland'?1000:1)};});
    content=<><h3>静态传输关系</h3><Plot xLabel={key==='alpha'?'滑片 α':key==='current'?'输入电流 / A':`${key==='vi2'?'Vp':'Vin'} / V`} yLabel={id==='howland'?'负载电流 / mA':'输出电压 / V'} series={[{points}]} point={{x:center,y:r.output*(id==='howland'?1000:1)}}/><p>其他参数保持当前值；曲线为理想静态解，器件摆幅限制见上方检查。</p></>;
  }
  return <section className="opamp-card opamp-dynamic-charts"><header><h2><span>03</span>响应与曲线</h2><small>已确认参数 · 理想模型</small></header><div className="opamp-chart">{content}</div></section>;
}
