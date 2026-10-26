import { circuitDefinition, parameterLabel, type LibraryId, type ParameterKey } from '../metadata';
import { numberText as f, type CircuitParameters, type OpAmpDraft } from '../algorithm';
import { BufferedParameterField } from '../BufferedParameterField';
import type { SchematicProps } from '../SchematicParts';
import { LibrarySchematic } from './LibrarySchematic';
import { LibrarySteps } from './LibrarySteps';
import { LibraryCharts } from './LibraryCharts';
import { isAC, isAudio, type LibraryResult } from './algorithm';
import { libraryNetwork } from './networks';
import { magnitude } from './network';
export function libraryNotices(id:LibraryId,p:CircuitParameters,r:LibraryResult) {
  const c=circuitDefinition(id),notices=[...r.notices],low=p.vee+p.headroom,high=p.vcc-p.headroom,supply=p.vcc-p.vee;
  if(supply<c.supply[0]||supply>c.supply[1])notices.push({warning:true,text:`参考器件 ${c.chip} 供电核对范围 ${c.supply.join('–')} V；当前总供电 ${f(supply)} V，请核对器件规格。`});
  if(r.dcNodes&&Object.keys(r.dcNodes).length) {
    const network=libraryNetwork(id,p),amplitude=isAudio(id)?Math.pow(10,p.sensitivity/20)/p.micZ*p.pressure*Math.SQRT2:id==='tia'?Math.abs(p.iin)*1e-6:p.amplitude;
    for(const a of network.amps) {
      const center=r.dcNodes[a.out]?.[0]??0,peak=isAC(id)?magnitude(r.acNodes[a.out]??[0,0])*amplitude:0;
      if(center-peak<low||center+peak>high)notices.push({warning:true,text:`内部输出 ${a.out} 需要 [${f(center-peak)}, ${f(center+peak)}] V，超出设定摆幅 [${f(low)}, ${f(high)}] V；理想结果不能保证实现。`});
      const input=r.dcNodes[a.plus]?.[0]??0,inputPeak=isAC(id)?magnitude(r.acNodes[a.plus]??[0,0])*amplitude:0;
      if(input-inputPeak<p.vee+c.commonMode[0]||input+inputPeak>p.vcc+c.commonMode[1])notices.push({warning:true,text:`${a.out} 级输入共模超出供电轨核对范围；请检查输入共模规格。`});
    }
  }else if(!['pwm','sine-osc'].includes(id)) {
    const peak=id==='hv-driver'?r.amplitude:id==='half-wave'?Math.max(0,-(p.vin-p.amplitude))*p.r4/p.r1:Math.max(Math.max(0,p.vin+p.amplitude),Math.max(0,-p.vin+p.amplitude)*p.r2/p.r1);
    if(id==='hv-driver'?r.output-peak<low||r.output+peak>high:peak>high||0<low)notices.push({warning:true,text:`理想输出超出设定摆幅 [${f(low)}, ${f(high)}] V；实际会受限，图示未模拟饱和。`});
  }
  if(isAudio(id)&&r.dcNodes.mic[0]<=0)notices.push({warning:true,text:'当前偏置电流与 R1 使麦克风偏置电压不为正，线性麦克风模型不再适用。'});
  if(id==='sine-osc'&&p.amplitude>Math.min(high,-low))notices.push({warning:true,text:'正弦幅值假设超出设定输出摆幅，实际无法保持该幅度的零中心正弦波。'});
  if(id==='pwm'&&r.frequency>p.gbw*1e6*.1)notices.push({warning:true,text:'载波频率接近积分运放 GBW，理想充放电周期不再可靠，请核对压摆率与比较器传播延迟。'});
  if(isAC(id)||id==='sine-osc') {
    const f0=id==='sine-osc'?r.frequency:p.frequency;
    if(f0>p.gbw*1e6/Math.max(1,id==='pga'?1+p.r2/(p.r1+p.r3):r.gain)*.1)notices.push({warning:true,text:'当前信号频率接近运放闭环带宽；理想传递曲线可能明显偏离实际，需用器件模型核对。'});
  }
  if(!notices.some(n=>n.warning))notices.unshift({warning:false,text:'当前工作点未触发供电与摆幅检查；结果采用理想电路模型，器件输入范围、负载和稳定性仍需核对。'});
  return notices;
}
export function LibraryWorkspace({id,draft,selected,onSelect,onEdit,errors={},result,parameters:p,onChange}:{id:LibraryId;parameters?:CircuitParameters;onChange:(draft:OpAmpDraft)=>void}&Omit<SchematicProps,'id'>) {
  const c=circuitDefinition(id),r=result?.library,current=id==='howland',osc=id==='sine-osc',audio=isAudio(id),ac=isAC(id);
  return <><section className="opamp-card" aria-label="电路原理图与结果"><header><h2><span>01</span>电路原理图</h2><small>{c.document} · {c.chip}</small></header>
    <div className="opamp-schematic-area opamp-comparator-area"><div className="opamp-diagram-tools"><div className="opamp-diagram-actions"><span className="opamp-model-note">电路及信号参数均可双击修改</span></div><div className="opamp-model-settings" role="group" aria-label="模型参数">{(['headroom','gbw'] as const).map(key=><BufferedParameterField key={`${id}-${key}`} id={id} parameter={key} draft={draft} error={errors[key]} onChange={onChange}/>)}</div></div>
      <LibrarySchematic id={id} draft={draft} selected={selected} onSelect={onSelect} onEdit={onEdit} errors={errors} result={result}/></div>
    <p className="opamp-schematic-note">双击器件、输入、基准或供电数值编辑 · Enter / 完成确认 · Esc / 空白取消<span>按 TI 信号拓扑重绘</span></p>
    <div className="opamp-results" aria-live="polite" aria-atomic="true"><div className="primary"><span>{current?'负载电流 · Iload':osc?'理想振荡频率':audio?'交流输出 · Vrms':id==='pwm'?'PWM 平均电压':ac?'输出直流中心 · Vout,DC':'理想静态输出 · Vout'}</span><strong data-testid="opamp-output">{r?f(r.output*(current?1000:1)):'—'}<small>{current?'mA':osc?'Hz':audio?'Vrms':'V'}</small></strong><small>{osc?r?.running?'已满足线性环路增益条件':'环路增益不足':'确认参数后重算'}</small></div>
      <div><span>{id==='pwm'?'占空比':osc?'环路增益幅值':ac?'当前频率增益幅值':'静态输入增益幅值'}</span><strong data-testid="opamp-gain">{r?f(id==='pwm'?r.duty*100:r.gain*(current?1000:1)):'—'}<small>{id==='pwm'?'%':id==='tia'||audio||id==='current-uni'||id==='current-bi'?'V/A':current?'mA/V':osc?'':'V/V'}</small></strong><small>{ac?`相位 ${r?f(r.phase,2):'—'}°`:'理想关系，见计算过程'}</small></div>
      <div><span>{id==='pwm'?'载波频率':osc?'幅值示意假设':audio?'交流输出峰值':ac?'输出正弦峰值':'已确认的输出'}</span><strong data-testid="opamp-third-result">{r?f(id==='pwm'?r.frequency:osc?r.amplitude:audio?r.amplitude*Math.SQRT2:ac?r.amplitude:r.output*(current?1000:1)):'—'}<small>{id==='pwm'?'Hz':current?'mA':'V'}</small></strong><small>{osc?'手动设置，非稳态幅度预测':audio?'RMS × √2':'理想模型'}</small></div></div>
    <div className="opamp-notices" role="status">{r&&p?libraryNotices(id,p,r).map((n,i)=><p key={i} className={n.warning?'warning':''}>{n.text}</p>):<div className="opamp-invalid-summary"><p className="error">参数尚未有效，已暂停计算。</p>{(Object.entries(errors) as [ParameterKey,string][]).map(([key,error])=><button className="small" key={key} onClick={event=>onEdit(key,event.currentTarget)}>{parameterLabel(id,key).symbol}：{error}</button>)}</div>}</div>
    <p className="opamp-model-note">{c.note} H 为手动摆幅余量；GBW 用于适用频率提示。</p>
  </section><div className="opamp-bottom"><LibrarySteps id={id} parameters={p} result={r}/><LibraryCharts id={id} parameters={p} result={r}/></div></>;
}
