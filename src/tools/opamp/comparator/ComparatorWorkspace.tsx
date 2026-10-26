import { circuitDefinition, parameterLabel, type ComparatorId, type ParameterKey } from '../metadata';
import { engineeringText as eng, numberText as f, type CircuitParameters, type OpAmpDraft } from '../algorithm';
import { BufferedParameterField } from '../BufferedParameterField';
import type { SchematicProps } from '../SchematicParts';
import { comparatorModelKeys, monitoredSupply, openDrain, type ComparatorResult } from './algorithm';
import { ComparatorSchematic } from './ComparatorSchematic';
import { ComparatorSteps } from './ComparatorSteps';
import { ComparatorCharts } from './ComparatorCharts';
export function comparatorNotices(id:ComparatorId,p:CircuitParameters,r:ComparatorResult):{warning:boolean;text:string}[] {
  const c=circuitDefinition(id), notices:{warning:boolean;text:string}[]=[];
  const add=(warning:boolean,text:string)=>notices.push({warning,text});
  if(r.oscillator)add(!r.oscillator.running,r.oscillator.running?`周期振荡：${eng(r.oscillator.frequency,'Hz')}，高电平占空比 ${f(r.oscillator.duty*100,2)}%。`:'无法形成周期振荡：需满足 VOL < VL < VH < VOH。');
  else if(r.boundary)add(true,'输入恰在比较门限：失调、噪声和器件内部迟滞可能决定输出，当前不宣称确定逻辑电平。');
  else if(r.held)add(false,`输入位于滞回区 [${f(r.lower)}, ${f(r.upper)}] V，保持原${r.state==='high'?'高':'低'}电平。可以在图内选择初始保持状态。`);
  else add(false,`${id==='window'?(r.state==='high'?'输入位于窗口内。':'输入位于窗口外。'):id==='undervoltage'?(r.state==='low'?'欠压报警有效（低电平）。':'电池电压正常，报警解除。'):id==='overvoltage'?(r.state==='high'?'过压触发，检测输出高。':'未触发过压，检测输出低。'):r.state==='high'?'当前输出高电平。':'当前输出低电平。'} Vout = ${f(r.output)} V。`);
  const supply=p.vcc-p.vee;
  if(supply<c.supply[0]||supply>c.supply[1])add(true,`参考器件 ${c.chip} 总供电范围 ${c.supply.join('–')} V；当前 ${f(supply)} V，输出逻辑与波形仅为数学示意，器件工作不保证。`);
  if(openDrain(id)) {
    add(false,`开漏 / 开集输出，当前上拉电流 ${eng(r.pullupCurrent*1e6,'µA')}；负载能力和 VOL 随电流的变化需查数据手册。`);
    const limit=id==='window'?36:id==='undervoltage'?5.5:6.5;
    if(p.vpu-p.vee>limit)add(true,`当前上拉电压差 ${f(p.vpu-p.vee)} V 超过参考输出级 ${limit} V 的核对范围，请检查器件额定值。`);
  }
  let pins=[r.plus,r.minus];
  if(id==='window')pins=[r.input,r.lower,r.upper];
  if(r.oscillator)pins=[r.lower,r.upper];
  if(id==='zero-cross')pins=[p.vee,Math.max(p.vee-p.diodeDrop,p.vee+(p.vin-p.amplitude-p.vee)*r.dividerRatio),Math.max(p.vee-p.diodeDrop,p.vee+(p.vin+p.amplitude-p.vee)*r.dividerRatio)];
  const lower=p.vee+c.commonMode[0],upper=p.vcc+c.commonMode[1];
  if(pins.some(v=>v<lower-1e-10||v>upper+1e-10))add(true,`输入引脚范围 [${f(Math.min(...pins))}, ${f(Math.max(...pins))}] V 超出保守供电轨范围 [${f(lower)}, ${f(upper)}] V。钳位并不等于满足共模规格，请核对数据手册。`);
  if(id==='zero-cross'&&p.frequency*p.tpd*1e-9>.01)add(true,'输入周期相对传播延迟较短；理想输出边沿未包含延迟。');
  if(r.oscillator?.running&&Math.min(r.oscillator.highTime,r.oscillator.lowTime)<20*p.tpd*1e-9)add(true,'充放电半周期不足传播延迟的 20 倍，实际振荡频率和占空比可能明显偏离理想结果。');
  if(id==='overvoltage'&&p.vref<=p.vee)add(true,'稳压基准未高于 Vee，当前参数不能实现原文所述的正电源过压保护。');
  if(r.high<r.low)add(true,'当前负载模型算出的高电平低于低电平，外部输入可能反向驱动输出；需要重新选择网络参数。');
  return notices;
}
export function ComparatorWorkspace({id,draft,selected,onSelect,onEdit,errors={},result,parameters:p,onChange}:{id:ComparatorId;parameters?:CircuitParameters;onChange:(draft:OpAmpDraft)=>void}&Omit<SchematicProps,'id'>) {
  const c=circuitDefinition(id),r=result?.comparator,o=r?.oscillator;
  function example() {
    const values={...draft.values};
    if(id==='relaxation')values.c1=String((Number(values.c1)||100)*2);
    else if(r) {
      const margin=Math.max(r.width*.5,.05),key=monitoredSupply(id)?'vcc':'vin';
      values[key]=String(id==='window'?(r.state==='high'?r.upper+margin:(r.upper+r.lower)/2):r.inverting?(r.state==='high'?r.upper+margin:r.lower-margin):(r.state==='high'?r.lower-margin:r.upper+margin));
    }
    onChange({...draft,values});
  }
  return <><section className="opamp-card" aria-label="电路原理图与结果"><header><h2><span>01</span>电路原理图</h2><small>{c.document} · {c.chip}</small></header>
    <div className="opamp-schematic-area opamp-comparator-area"><div className="opamp-diagram-tools">
      <div className="opamp-diagram-actions">{id==='comparator'&&<label className="opamp-hysteresis-toggle"><input type="checkbox" checked={draft.values.hysteresis==='1'} onChange={event=>onChange({...draft,values:{...draft.values,hysteresis:event.target.checked?'1':'0'}})}/>接入 R3 · 启用迟滞</label>}
        {!o&&id!=='window'&&r&&r.width>0&&<div className="opamp-memory" role="group" aria-label="滞回区初始保持状态"><span>初始 / 保持状态</span>{(['low','high'] as const).map(state=><button key={state} className="small" disabled={!r.held} aria-pressed={(draft.memory??'low')===state} title="输入在滞回区内时可选择保持状态" onClick={()=>onChange({...draft,memory:state})}>{state==='high'?'高':'低'}</button>)}</div>}
        <button className="small" onClick={example} disabled={!r}>{id==='relaxation'?'试试 2 倍电容':'试试跨越门限'}</button>
      </div><div className="opamp-model-settings" role="group" aria-label="模型参数">{comparatorModelKeys(id).map(key=><BufferedParameterField key={`${id}-${key}`} id={id} parameter={key} draft={draft} error={errors[key]} onChange={onChange}/>)}</div>
    </div><ComparatorSchematic id={id} draft={draft} selected={selected} onSelect={onSelect} onEdit={onEdit} errors={errors} result={result}/></div>
    <p className="opamp-schematic-note">双击器件、输入、基准或供电数值编辑 · Enter / 完成确认 · Esc / 空白取消<span>按 TI 信号拓扑重绘</span></p>
    <div className="opamp-results" aria-live="polite" aria-atomic="true"><div className="primary"><span>{o?'理想振荡频率':id==='zero-cross'?'直流中心处输出 · Vout':'输出状态 · Vout'}</span><strong data-testid="opamp-output">{o?o.running?eng(o.frequency,'Hz'):'无振荡':r?r.boundary?'临界未定':`${r.state==='high'?'高':'低'} · ${f(r.output)}`:'—'}{!o&&!r?.boundary&&<small>V</small>}</strong><small>{o?`高电平占空比 ${f(o.duty*100,2)}%`:r?.held?'滞回区内 · 保持状态':r?.boundary?'相等门限处不保证输出':'静态理想判决'}</small></div>
      <div><span>{id==='window'?'窗口下限 · VL':'下降门限 · VL'}</span><strong data-testid="comparator-lower">{r?f(r.lower):'—'}<small>V</small></strong><small>{id==='window'?'低于下限则输出低':'输入下降时的翻转点'}</small></div>
      <div><span>{id==='window'?'窗口上限 · VH':'上升门限 · VH'}</span><strong data-testid="comparator-upper">{r?f(r.upper):'—'}<small>V</small></strong><small>{r?`${id==='window'?'窗口':'迟滞'}宽度 ${f(r.width)} V`:'等待有效参数'}</small></div>
    </div>
    <div className="opamp-notices" role="status">{r&&p?comparatorNotices(id,p,r).map((n,i)=><p key={i} className={n.warning?'warning':''}>{n.text}</p>):<div className="opamp-invalid-summary"><p className="error">参数尚未有效，已暂停计算。点击下方参数可重新编辑。</p>{(Object.entries(errors) as [ParameterKey,string][]).map(([key,error])=><button key={key} className="small" onClick={event=>{
      const input=event.currentTarget.closest('.opamp-page')?.querySelector<HTMLInputElement>(`#opamp-${key}`);
      if(input){input.focus();input.select();}else onEdit(key,event.currentTarget);
    }}>{parameterLabel(id,key).symbol}：{error}</button>)}</div>}</div>
    <p className="opamp-model-note">ΔVOH / ΔVOL 是输出距供电轨的压降假设；tpd 只作检查，不计入曲线。{c.note}</p>
  </section><div className="opamp-bottom"><ComparatorSteps id={id} parameters={p} result={r}/><ComparatorCharts id={id} parameters={p} result={r}/></div></>;
}
