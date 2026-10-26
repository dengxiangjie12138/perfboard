import type { ReactNode } from 'react';
import { engineeringText as eng, numberText as f, type CircuitParameters } from '../algorithm';
import type { ComparatorId } from '../metadata';
import { expression as e, frac, MathFormula, num, op, paren, quantity as q, resistance as ohm, row, sym, text, type MathExpression } from '../MathFormula';
import type { Step } from '../CalculationSteps';
import { openDrain, type ComparatorResult } from './algorithm';
const R = (n:number) => sym('R',String(n)), V = (s:string) => sym('V',s), eq = () => op('='), add = () => op('+'), sub = () => op('−'), mul = () => op('×');
const volts = (n:number) => q(n,'V'), seconds = (n:number) => q(n*1e6,'µs');
const sum = (...nodes:ReactNode[]) => row(...nodes.flatMap((n,i)=>i?[add(),n]:[n]));
const weighted = (top:ReactNode, bottom:ReactNode, output:ReactNode, rt:ReactNode, rb:ReactNode, rf:ReactNode) => frac(sum(frac(top,rt),frac(bottom,rb),frac(output,rf)),sum(frac(num(1),rt),frac(num(1),rb),frac(num(1),rf)));
const result = (symbol:ReactNode, value:number, unit='V') => e(`= ${f(value)} ${unit}`,row(symbol,eq(),q(value,unit)));
export function comparatorSteps(id:ComparatorId,p:CircuitParameters,r:ComparatorResult):Step[] {
  const steps:Step[] = [];
  const push=(title:string,label:string,formula:ReactNode,lines:(MathExpression|string)[])=>steps.push({title,formula:e(label,formula),lines});
  if(id==='comparator'||id==='schmitt-inv') {
    const rf=id==='comparator'?3:4, enabled=id!=='comparator'||p.hysteresis===1;
    push('基准分压','VB = (Vref R2 + Vee R1) / (R1 + R2)',row(V('B'),eq(),frac(sum(row(V('ref'),mul(),R(2)),row(V('ee'),mul(),R(1))),sum(R(1),R(2)))),[
      e('基准数值代入',row(eq(),frac(sum(row(volts(p.vref),mul(),ohm(p.r2)),row(volts(p.vee),mul(),ohm(p.r1))),sum(ohm(p.r1),ohm(p.r2))),eq(),volts(r.reference))),
    ]);
    if(enabled) {
      push('输入下降门限 · 输出由低转高','VL = (Vref/R1 + Vee/R2 + VOL/Rf) / (1/R1 + 1/R2 + 1/Rf)',row(V('L'),eq(),weighted(V('ref'),V('ee'),V('OL'),R(1),R(2),R(rf))),[
        e('下降门限数值代入',row(eq(),weighted(volts(p.vref),volts(p.vee),volts(r.low),ohm(p.r1),ohm(p.r2),ohm(p[`r${rf}` as 'r3'|'r4'])),eq(),volts(r.lower))),
      ]);
      const highR=id==='schmitt-inv'?sum(R(3),R(4)):R(3), highV=id==='schmitt-inv'?V('pu'):V('OH');
      push('输入上升门限 · 输出由高转低','VH = weighted reference with high-state feedback',row(V('H'),eq(),weighted(V('ref'),V('ee'),highV,R(1),R(2),highR)),[
        result(V('H'),r.upper),id==='schmitt-inv'?'开漏高态中 R3 与 R4 串联，上拉负载已计入；不把 Vout 直接设为 Vpu。':'外部反馈 R3 已接入；输出高低电平采用当前压降假设。',
      ]);
    } else push('单阈值 · 正反馈断开','VL = VH = VB',row(V('L'),eq(),V('H'),eq(),V('B')),[result(V('TH'),r.upper),'R3 已断开，不参与本次阈值计算。']);
  } else if(id==='schmitt-noninv') {
    push('反相端基准','VB = (Vref R5 + Vee R4) / (R4 + R5)',row(V('B'),eq(),frac(sum(row(V('ref'),mul(),R(5)),row(V('ee'),mul(),R(4))),sum(R(4),R(5)))),[result(V('B'),r.reference)]);
    push('输入上升门限 · 输出由低转高','VH = VB + R1/R2 (VB − VOL)',row(V('H'),eq(),V('B'),add(),frac(R(1),R(2)),mul(),paren(row(V('B'),sub(),V('OL')))),[
      e('上升门限数值代入',row(eq(),volts(r.reference),add(),frac(ohm(p.r1),ohm(p.r2)),mul(),paren(row(volts(r.reference),sub(),volts(r.low))),eq(),volts(r.upper))),
    ]);
    push('输入下降门限 · 输出由高转低','VL = VB + R1/(R2 + R3) (VB − Vpu)',row(V('L'),eq(),V('B'),add(),frac(R(1),sum(R(2),R(3))),mul(),paren(row(V('B'),sub(),V('pu')))),[
      e('下降门限数值代入',row(eq(),volts(r.reference),add(),frac(ohm(p.r1),sum(ohm(p.r2),ohm(p.r3))),mul(),paren(row(volts(r.reference),sub(),volts(p.vpu))),eq(),volts(r.lower))),
    ]);
    push('高态的输出负载','VOH = Vpu − (Vpu − Vin) R3 / (R1 + R2 + R3)',row(V('OH'),eq(),V('pu'),sub(),frac(row(paren(row(V('pu'),sub(),V('in'))),mul(),R(3)),sum(R(1),R(2),R(3)))),[result(V('OH'),r.high),'输入低阻电压源的假设下，输出高态经 R3、R2、R1 向输入形成通路。']);
  } else if(id==='window') {
    push('窗口下限','VL = Vee + (Vcc − Vee) R1 / (R1 + R2 + R3)',row(V('L'),eq(),V('ee'),add(),paren(row(V('cc'),sub(),V('ee'))),mul(),frac(R(1),sum(R(1),R(2),R(3)))),[
      e('下限数值代入',row(eq(),volts(p.vee),add(),paren(row(volts(p.vcc),sub(),volts(p.vee))),mul(),frac(ohm(p.r1),sum(ohm(p.r1),ohm(p.r2),ohm(p.r3))),eq(),volts(r.lower))),
    ]);
    push('窗口上限','VH = Vee + (Vcc − Vee) (R1 + R2) / (R1 + R2 + R3)',row(V('H'),eq(),V('ee'),add(),paren(row(V('cc'),sub(),V('ee'))),mul(),frac(sum(R(1),R(2)),sum(R(1),R(2),R(3)))),[result(V('H'),r.upper),'仅当 VL < Vin < VH，两路开集输出均释放，输出被 Rp（图中 R4）上拉。任一路拉低即输出低。']);
  } else if(id==='zero-cross'||id==='overvoltage'||id==='undervoltage') {
    push('输入分压比例','β = R2 / (R1 + R2)',row(sym('β'),eq(),frac(R(2),sum(R(1),R(2)))),[
      e('分压数值代入',row(eq(),frac(ohm(p.r2),sum(ohm(p.r1),ohm(p.r2))),eq(),num(r.dividerRatio))),
    ]);
    if(id==='undervoltage') {
      push('下降触发与上升恢复','VL = Vee + VIT− / β ; VH = Vee + VIT+ / β',row(V('L'),eq(),V('ee'),add(),frac(V('IT−'),sym('β')),op(';'),V('H'),eq(),V('ee'),add(),frac(V('IT+'),sym('β'))),[
        e('下降门限代入',row(V('L'),eq(),volts(p.vee),add(),frac(volts(p.vitLow),num(r.dividerRatio)),eq(),volts(r.lower))),
        e('上升门限代入',row(V('H'),eq(),volts(p.vee),add(),frac(volts(p.vitHigh),num(r.dividerRatio)),eq(),volts(r.upper))),
        'VBAT 下降越过 VL 触发低有效报警；上升越过 VH 恢复高。中间区域保持原状态。',
      ]);
    } else if(id==='overvoltage') {
      push('过压触发门限','Vtrip = Vee + (Vref − Vee) / β',row(V('trip'),eq(),V('ee'),add(),frac(row(V('ref'),sub(),V('ee')),sym('β'))),[
        e('过压门限代入',row(eq(),volts(p.vee),add(),frac(row(volts(p.vref),sub(),volts(p.vee)),num(r.dividerRatio)),eq(),volts(r.upper))),
        'SUPPLY 与 Vcc 为同一个节点；超过门限时检测输出为高，供原文 P 沟道 MOSFET 的关断控制使用。',
      ]);
    } else {
      push('分压与二极管负向钳位','V+ = max(Vee − VF, Vee + β (Vin − Vee))',row(V('+'),eq(),text('max'),paren(row(V('ee'),sub(),V('F'),op(','),V('ee'),add(),sym('β'),mul(),paren(row(V('in'),sub(),V('ee')))))),[
        result(V('+'),r.plus),result(V('TH'),p.vee),'反相端接 Vee，Vin 相对 Vee 由负转正时输出转高。D1 仅以固定负向压降近似。',
      ]);
      push('输入幅值与限流估算','VRMS = Vp / √2 ; Ipeak ≈ Vp / R1',row(V('RMS'),eq(),frac(V('p'),num(Math.SQRT2)),op(';'),sym('I','peak'),op('≈'),frac(V('p'),R(1))),[
        result(V('RMS'),p.amplitude/Math.SQRT2),e(`峰值限流估算 ${eng(p.amplitude/p.r1*1e6,'µA')}`,row(sym('I','peak'),op('≈'),q(p.amplitude/p.r1*1e6,'µA'))),
        '电流按 TI 的 Vp/R1 作估算；仍需按实际二极管、输入偏置、输入耐压和电阻额定值核对。',
      ]);
    }
  } else {
    const o=r.oscillator!;
    push('正反馈网络的两个门限','VT = (Vcc/R2 + Vee/R3 + Vo/R4) / (1/R2 + 1/R3 + 1/R4)',row(V('T'),eq(),weighted(V('cc'),V('ee'),V('o'),R(2),R(3),R(4))),[
      result(V('L'),r.lower),result(V('H'),r.upper),'分别代入 VOL 与 VOH，保留 R2、R3、R4 独立变化。',
    ]);
    push('指数充电与放电时间','tH = R1 C1 ln((VOH − VL)/(VOH − VH)); tL = R1 C1 ln((VH − VOL)/(VL − VOL))',row(sym('t','H'),eq(),R(1),sym('C','1'),text('ln'),paren(frac(row(V('OH'),sub(),V('L')),row(V('OH'),sub(),V('H'))))),[
      e('低电平放电时间',row(sym('t','L'),eq(),R(1),sym('C','1'),text('ln'),paren(frac(row(V('H'),sub(),V('OL')),row(V('L'),sub(),V('OL')))))),
      o.running?e('充放电时间数值',row(sym('t','H'),eq(),seconds(o.highTime),op(';'),sym('t','L'),eq(),seconds(o.lowTime))):'未满足 VOL < VL < VH < VOH，无法形成此模型的周期振荡。',
    ]);
    push('周期、频率与占空比','T = tH + tL ; f = 1/T ; D = tH/T',row(sym('T'),eq(),sym('t','H'),add(),sym('t','L'),op(';'),sym('f'),eq(),frac(num(1),sym('T')),op(';'),sym('D'),eq(),frac(sym('t','H'),sym('T'))),[
      o.running?e('周期结果',row(sym('T'),eq(),seconds(o.period),op(';'),sym('f'),eq(),q(o.frequency,'Hz'),op(';'),sym('D'),eq(),q(o.duty*100,'%'))):'当前无有效振荡周期。',
    ]);
  }
  if(id!=='relaxation') push(id==='window'?'窗口宽度':'迟滞宽度','ΔV = VH − VL',row(sym('ΔV'),eq(),V('H'),sub(),V('L')),[
    e('宽度数值代入',row(eq(),volts(r.upper),sub(),volts(r.lower),eq(),volts(r.width))),id==='window'?'窗口内外比较不具备状态记忆；边界相等处的实际输出取决于失调等条件。':r.width>0?'门限之间保留之前的输出状态；初始状态可在图内选择。':'无外部迟滞时，临界相等处的实际输出不确定。',
  ]);
  push('输出电平与模型假设',openDrain(id)?'VOL = Vee + ΔVOL ; Ipu = (Vpu − Vout) / Rpu':'VOH = Vcc − ΔVOH ; VOL = Vee + ΔVOL',openDrain(id)?row(V('OL'),eq(),V('ee'),add(),sym('ΔV','OL'),op(';'),sym('I','pu'),eq(),frac(row(V('pu'),sub(),V('out')),R(id==='window'?4:3))):row(V('OH'),eq(),V('cc'),sub(),sym('ΔV','OH'),op(';'),V('OL'),eq(),V('ee'),add(),sym('ΔV','OL')),[
    result(V('OH'),r.high),result(V('OL'),r.low),...(openDrain(id)?[e('当前上拉电流',row(sym('I','pu'),eq(),q(r.pullupCurrent*1e6,'µA')))]:[]),
    '理想静态判决与显式电平假设；不计输入失调、噪声、上升沿 RC、输出电流能力和传播延迟。',
  ]);
  return steps;
}
export function ComparatorSteps({id,parameters:p,result:r}:{id:ComparatorId;parameters?:CircuitParameters;result?:ComparatorResult}) {
  return <section className="opamp-card" aria-label="计算过程"><header><h2><span>02</span>计算过程</h2><small>公式 · 数值代入 · 状态判定</small></header>{p&&r?<ol className="opamp-steps">{comparatorSteps(id,p,r).map((step,i)=><li key={step.title}><span className="opamp-step-index">{String(i+1).padStart(2,'0')}</span><div><h3>{step.title}</h3><div className="opamp-formula"><MathFormula value={step.formula}/></div><div className="opamp-substitution">{step.lines.map((line,j)=>typeof line==='string'?<p key={j}>{line}</p>:<div key={j}><MathFormula value={line}/></div>)}</div></div></li>)}</ol>:<p className="opamp-empty">修正参数后显示计算过程。</p>}</section>;
}
