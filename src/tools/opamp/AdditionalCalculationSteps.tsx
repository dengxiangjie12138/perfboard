import { engineeringText as eng, numberText as f, type CircuitParameters, type OpAmpResult } from './algorithm';
import type { CircuitId } from './metadata';
import type { Step } from './CalculationSteps';
import { expression as e, frac, frequency, integral, num, op, paren, quantity as q, resistance as ohm, row, sym, text } from './MathFormula';
const R = (i: number | string) => sym('R',String(i)), C = (i: string) => sym('C',i), V = (i: string) => sym('V',i), A = (i: string) => sym('A',i);
const eq = () => op('='), add = () => op('+'), sub = () => op('−'), mul = () => op('×'), volt = (x: number) => q(x,'V');
const value = (label: string, name: string, x: number, unit = '') => e(label,row(text(name),eq(),unit ? q(x,unit) : num(x)));
function bandwidth(p: CircuitParameters, r: OpAmpResult, multi = false): Step {
  return { title: multi ? '各级噪声增益与单级带宽估算' : '噪声增益与小信号带宽',
    formula: e('BW ≈ GBW / NG',row(text(multi ? 'BW单级' : 'BW'),op('≈'),frac(text('GBW'),text(multi ? 'NGmax' : 'NG')))),
    lines: [e(`NG = ${r.noiseGains.map(n=>f(n)).join(', ')}`,row(text(multi ? 'NG各级' : 'NG'),eq(),text(r.noiseGains.map(n=>f(n)).join('，')))),
      e(`GBW / NGmax = ${eng(r.bandwidth,'Hz')}`,row(eq(),frac(q(p.gbw,'MHz'),num(r.noiseGain)),eq(),frequency(r.bandwidth))),
      ...(multi ? ['该值仅为最大级内噪声增益对应的单级估算，不是整个多运放电路的 −3 dB 带宽。'] : [])] };
}
function differential(p: CircuitParameters, r: OpAmpResult): Step {
  return { title:'通用差模、共模与基准分解',formula:e('Vout = Ad × Vdiff + Acm × Vcm + Aref × Vref',row(V('out'),eq(),A('d'),mul(),V('diff'),add(),A('cm'),mul(),V('cm'),add(),A('ref'),mul(),V('ref'))),
    lines:[e(`Ad = (A+ − A−)/2 = ${f(r.gain)}`,row(A('d'),eq(),frac(row(A('+'),sub(),A('−')),num(2)),eq(),num(r.gain))),
      e(`Acm = A+ + A− = ${f(r.commonGain)}`,row(A('cm'),eq(),A('+'),add(),A('−'),eq(),num(r.commonGain))),
      value(`A+ = ${f(r.aPlus)}`,'A+',r.aPlus),value(`A− = ${f(r.aMinus)}`,'A−',r.aMinus),value(`Aref = ${f(r.aRef)}`,'Aref',r.aRef),
      e(`= ${f(r.gain)} × ${f(r.vdiff)} V + ${f(r.commonGain)} × ${f(r.vcm)} V + ${f(r.aRef)} × ${f(p.vref)} V = ${f(r.output)} V`,row(eq(),num(r.gain),mul(),paren(volt(r.vdiff)),add(),num(r.commonGain),mul(),paren(volt(r.vcm)),add(),num(r.aRef),mul(),paren(volt(p.vref)),eq(),volt(r.output))),
      e('CMRR = 20 log10 |Ad / Acm|',row(text('CMRR'),eq(),num(20),text('log₁₀'),op('|'),frac(A('d'),A('cm')),op('|'),eq(),r.matched ? op('∞') : q(r.cmrr,'dB'))),
      'Vdiff = Vi2 − Vi1；Vcm = (Vi1 + Vi2)/2。CMRR 仅按名义电阻计算，未包含器件本身与电阻容差。'] };
}
export function additionalCalculationSteps(id: CircuitId, p: CircuitParameters, r: OpAmpResult): Step[] {
  if (id === 'integrator' || id === 'differentiator') return dynamicSteps(id,p,r);
  if (id === 'follower') return [
    {title:'电压跟随与闭环增益',formula:e('Vout = Vin；Av = 1',row(V('out'),eq(),V('in'),op('；'),A('v'),eq(),num(1))),lines:[e(`Vout = ${f(p.vin)} V`,row(V('out'),eq(),volt(p.vin)))]},
    {title:'负反馈与输入共模电压',formula:e('V− = V+ = Vin',row(V('−'),eq(),V('+'),eq(),V('in'))),lines:[value(`V+ = ${f(r.vplus)} V`,'V+',r.vplus,'V'),'输入电压同时决定输出与输入共模，应分别检查这两个范围。']},bandwidth(p,r),
  ];
  if (id === 'inv') return [
    {title:'反相电压增益',formula:e('Av = −R2 / R1',row(A('v'),eq(),sub(),frac(R(2),R(1)))),lines:[e(`= −${eng(p.r2)} / ${eng(p.r1)} = ${f(r.gain)} V/V`,row(eq(),sub(),frac(ohm(p.r2),ohm(p.r1)),eq(),q(r.gain,'V/V')))]},
    {title:'输出电压',formula:e('Vout = −R2 / R1 × Vin',row(V('out'),eq(),sub(),frac(R(2),R(1)),mul(),V('in'))),lines:[e(`= ${f(r.gain)} × ${f(p.vin)} V = ${f(r.output)} V`,row(eq(),num(r.gain),mul(),paren(volt(p.vin)),eq(),volt(r.output)))]},
    {title:'输入电流与输入阻抗',formula:e('Iin = Vin / R1；Zin = R1',row(sym('I','in'),eq(),frac(V('in'),R(1)),op('；'),sym('Z','in'),eq(),R(1))),lines:[value(`Iin = ${f(p.vin/p.r1*1e6)} µA`,'Iin',p.vin/p.r1*1e6,'µA'),e(`Zin = ${eng(p.r1)}`,row(sym('Z','in'),eq(),ohm(p.r1))),'同相端接地，线性假设下反相端为虚地。']},
    {title:'噪声增益',formula:e('NG = 1 + R2 / R1',row(text('NG'),eq(),num(1),add(),frac(R(2),R(1)))),lines:[value(`NG = ${f(r.noiseGain)}`,'NG',r.noiseGain)]},bandwidth(p,r),
  ];
  if (id === 'sum') return [
    {title:'两路加权反相求和',formula:e('Vout = −R3 × (Vi1 / R1 + Vi2 / R2)',row(V('out'),eq(),sub(),R(3),mul(),paren(row(frac(V('i1'),R(1)),add(),frac(V('i2'),R(2)))))),lines:[
      e(`= ${f(r.aMinus)} × ${f(p.vi1)} V + ${f(r.aPlus)} × ${f(p.vi2)} V = ${f(r.output)} V`,row(eq(),num(r.aMinus),mul(),paren(volt(p.vi1)),add(),num(r.aPlus),mul(),paren(volt(p.vi2)),eq(),volt(r.output)))]},
    {title:'每路信号增益',formula:e('A1 = −R3 / R1；A2 = −R3 / R2',row(A('1'),eq(),sub(),frac(R(3),R(1)),op('；'),A('2'),eq(),sub(),frac(R(3),R(2)))),lines:[value(`A1 = ${f(r.aMinus)} V/V`,'A1',r.aMinus,'V/V'),value(`A2 = ${f(r.aPlus)} V/V`,'A2',r.aPlus,'V/V')]},
    {title:'各输入电流与噪声增益',formula:e('NG = 1 + R3 / (R1 || R2)',row(text('NG'),eq(),num(1),add(),frac(R(3),paren(row(R(1),op('∥'),R(2)))))),lines:[
      e(`= 1 + R3/R1 + R3/R2 = ${f(r.noiseGain)}`,row(eq(),num(1),add(),frac(ohm(p.r3),ohm(p.r1)),add(),frac(ohm(p.r3),ohm(p.r2)),eq(),num(r.noiseGain))),
      value(`I1 = ${f(p.vi1/p.r1*1e6)} µA`,'I1',p.vi1/p.r1*1e6,'µA'),value(`I2 = ${f(p.vi2/p.r2*1e6)} µA`,'I2',p.vi2/p.r2*1e6,'µA')]},bandwidth(p,r),
  ];
  if (id === 'ina2') return [
    {title:'U2 内部输出 · 通用节点解',formula:e('Va = Vi1 + R3/R4 × (Vi1 − Vref) + R3/Rg × (Vi1 − Vi2)',row(V('a'),eq(),V('i1'),add(),frac(R(3),R(4)),mul(),paren(row(V('i1'),sub(),V('ref'))),add(),frac(R(3),R('g')),mul(),paren(row(V('i1'),sub(),V('i2'))))),lines:[value(`Va = ${f(r.internalOutputs[0].value)} V`,'Va',r.internalOutputs[0].value,'V')]},
    {title:'U1 输出 · 不要求电阻匹配',formula:e('Vout = Vi2 + R2/R1 × (Vi2 − Va) + R2/Rg × (Vi2 − Vi1)',row(V('out'),eq(),V('i2'),add(),frac(R(2),R(1)),mul(),paren(row(V('i2'),sub(),V('a'))),add(),frac(R(2),R('g')),mul(),paren(row(V('i2'),sub(),V('i1'))))),lines:[value(`Vout = ${f(r.output)} V`,'Vout',r.output,'V')]},
    {title:'电阻比例与匹配简式',formula:e('R2/R1 = R4/R3',row(frac(R(2),R(1)),r.matched ? eq() : op('≠'),frac(R(4),R(3)))),lines:[
      e('G = 1 + R4/R3 + 2R2/Rg',row(sym('G'),eq(),num(1),add(),frac(R(4),R(3)),add(),frac(row(num(2),R(2)),R('g')))),
      r.matched ? e(`G = ${f(r.gain)} V/V`,row(sym('G'),eq(),num(1),add(),frac(ohm(p.r4),ohm(p.r3)),add(),frac(row(num(2),ohm(p.r2)),ohm(p.rg)),eq(),q(r.gain,'V/V'))) : '当前失配，以上简式不适用；实际采用前两步的通用节点解。',
      '匹配时 Vout = G × (Vi2 − Vi1) + Vref；只有点击匹配按钮才调整 R4。']},differential(p,r),bandwidth(p,r,true),
  ];
  return [
    {title:'两路输入级内部输出',formula:e('Va = Vi1 + R6/R10 × (Vi1 − Vi2)',row(V('a'),eq(),V('i1'),add(),frac(R(6),R(10)),mul(),paren(row(V('i1'),sub(),V('i2'))))),lines:[
      e('Vb = Vi2 + R5/R10 × (Vi2 − Vi1)',row(V('b'),eq(),V('i2'),add(),frac(R(5),R(10)),mul(),paren(row(V('i2'),sub(),V('i1'))))),
      value(`Va = ${f(r.internalOutputs[0].value)} V`,'Va',r.internalOutputs[0].value,'V'),value(`Vb = ${f(r.internalOutputs[1].value)} V`,'Vb',r.internalOutputs[1].value,'V')]},
    {title:'输出级同相节点',formula:e('V+ = (Vb × R4 + Vref × R3) / (R3 + R4)',row(V('+'),eq(),frac(row(V('b'),mul(),R(4),add(),V('ref'),mul(),R(3)),row(R(3),add(),R(4))))),lines:[value(`V+ = ${f(r.vplus)} V`,'V+',r.vplus,'V')]},
    {title:'通用输出 · 七个电阻独立',formula:e('Vout = (1 + R2/R1) × V+ − R2/R1 × Va',row(V('out'),eq(),paren(row(num(1),add(),frac(R(2),R(1)))),mul(),V('+'),sub(),frac(R(2),R(1)),mul(),V('a'))),lines:[value(`Vout = ${f(r.output)} V`,'Vout',r.output,'V')]},
    {title:'输出级比例与匹配简式',formula:e('R2/R1 = R4/R3',row(frac(R(2),R(1)),r.matched ? eq() : op('≠'),frac(R(4),R(3)))),lines:[
      e('G = R2/R1 × (1 + (R5 + R6)/R10)',row(sym('G'),eq(),frac(R(2),R(1)),mul(),paren(row(num(1),add(),frac(row(R(5),add(),R(6)),R(10)))))),
      r.matched ? value(`G = ${f(r.gain)} V/V`,'G',r.gain,'V/V') : '当前输出级失配，简式不适用；采用前面通用公式。',
      '当 R5 = R6 时，前级增益因子化为 1 + 2R5/R10，与 TI 简式一致。']},differential(p,r),bandwidth(p,r,true),
  ];
}
function dynamicSteps(id: 'integrator' | 'differentiator', p: CircuitParameters, r: OpAmpResult): Step[] {
  const d = r.dynamic!, integrator = id === 'integrator', s = sym('s'), pi = sym('π'), cap = (n: number) => q(n*1e9,'nF');
  return [
    {title:'实际 RC 网络传递函数',formula:integrator
      ? e('H(s) = −(R2/R1) / (1 + s R2 C1)',row(sym('H'),paren(s),eq(),sub(),frac(frac(R(2),R(1)),row(num(1),add(),s,R(2),C('1')))))
      : e('H(s) = −s R2 C1 / ((1 + s R1 C1)(1 + s R2 Cf))',row(sym('H'),paren(s),eq(),sub(),frac(row(s,R(2),C('1')),row(paren(row(num(1),add(),s,R(1),C('1'))),paren(row(num(1),add(),s,R(2),C('f'))))))),
      lines:[e('s = j 2π f',row(s,eq(),sym('j'),num(2),pi,sym('f'))),integrator ? '保留 R2 的直流反馈，低频不再是理想积分。' : 'Cf=0 时第二个极点因子为 1；输入 R1 保留以限制高频增益。']},
    {title:integrator ? '理想积分关系 · 有效频段近似' : '理想微分关系 · 有效频段近似',formula:integrator
      ? e('Vout(t) = Vout(0) − 1/(R1 C1) ∫₀ᵗ (Vin(τ) − Vref) dτ',row(V('out'),paren(sym('t')),eq(),V('out'),paren(num(0)),sub(),frac(num(1),row(R(1),C('1'))),integral(paren(row(V('in'),paren(sym('τ')),sub(),V('ref'))))))
      : e('Vout(t) = Vref − R2 C1 dVin(t)/dt',row(V('out'),paren(sym('t')),eq(),V('ref'),sub(),R(2),C('1'),frac(row(sym('d'),V('in'),paren(sym('t'))),row(sym('d'),sym('t'))))),lines:['这是有效频段内的理想运算关系；下面数值与曲线使用第一步完整 RC 网络。']},
    {title:'时间常数与特征频率',formula:integrator
      ? e('τ = R2 C1；fp = 1/(2π R2 C1)',row(sym('τ'),eq(),R(2),C('1'),op('；'),sym('f','p'),eq(),frac(num(1),row(num(2),pi,R(2),C('1')))))
      : e('τ = R1 C1；fp,in = 1/(2π R1 C1)',row(sym('τ'),eq(),R(1),C('1'),op('；'),sym('f','p,in'),eq(),frac(num(1),row(num(2),pi,R(1),C('1'))))),lines:[
        e(`C1 = ${f(p.c1*1e9)} nF`,row(C('1'),eq(),cap(p.c1))),value(`τ = ${f(d.tau*1e3)} ms`,'τ',d.tau*1e3,'ms'),
        e(`主极点 = ${eng(integrator ? d.feedbackPole : d.inputPole,'Hz')}`,row(sym('f','p'),eq(),frequency(integrator ? d.feedbackPole : d.inputPole))),
        e(`理想单位增益频率 = ${eng(d.unityFrequency,'Hz')}`,row(sym('f','0dB,ideal'),eq(),frac(num(1),row(num(2),pi,R(integrator ? 1 : 2),C('1'))),eq(),frequency(d.unityFrequency))),
        ...(!integrator && p.cf > 0 ? [e(`反馈极点 = ${eng(d.feedbackPole,'Hz')}`,row(sym('f','p,f'),eq(),frac(num(1),row(num(2),pi,R(2),C('f'))),eq(),frequency(d.feedbackPole)))] : []),
      ]},
    {title:'当前频率的幅值与相位',formula:e('Vp,out = |H(j2πf)| × Vp,in',row(V('p,out'),eq(),op('|'),sym('H'),paren(row(sym('j'),num(2),pi,sym('f'))),op('|'),mul(),V('p,in'))),lines:[
      e(`f = ${eng(p.frequency,'Hz')}`,row(sym('f'),eq(),frequency(p.frequency))),value(`|H| = ${f(d.magnitude)} V/V`,'|H|',d.magnitude,'V/V'),value(`φ = ${f(d.phase)} °`,'φ',d.phase,'°'),
      e(`Vp,out = ${f(d.magnitude)} × ${f(p.amplitude)} V = ${f(d.outputAmplitude)} V`,row(V('p,out'),eq(),num(d.magnitude),mul(),volt(p.amplitude),eq(),volt(d.outputAmplitude))),
      value(`Re H = ${f(d.real)}`,'Re H',d.real),value(`Im H = ${f(d.imag)}`,'Im H',d.imag)]},
    {title:'直流中心与正弦稳态',formula:integrator
      ? e('Vout,DC = Vref − R2/R1 × (Vin,DC − Vref)',row(V('out,DC'),eq(),V('ref'),sub(),frac(R(2),R(1)),mul(),paren(row(V('in,DC'),sub(),V('ref')))))
      : e('Vout,DC = Vref',row(V('out,DC'),eq(),V('ref'))),lines:[value(`Vout,DC = ${f(r.output)} V`,'Vout,DC',r.output,'V'),
        e('Vout(t) = Vout,DC + Vp,out sin(2πft + φ)',row(V('out'),paren(sym('t')),eq(),V('out,DC'),add(),V('p,out'),text('sin'),paren(row(num(2),pi,sym('f'),sym('t'),add(),sym('φ'))))),
        '相位计算使用弧度，界面换算为度显示。曲线为正弦稳态，不含初始电荷、上电或饱和恢复。']},
    {title:'GBW 与近似适用条件',formula:integrator
      ? e('GBW ≥ 10 fmax',row(text('GBW'),op('≥'),num(10),sym('f','max')))
      : e('GBW > (R1 + R2) / (2π R1² C1)',row(text('GBW'),op('>'),frac(row(R(1),add(),R(2)),row(num(2),pi,R(1),R(1),C('1'))))),lines:[
        e(`TI 参考条件 = ${eng(d.minimumGbw,'Hz')}`,row(text('当前参考条件'),eq(),frequency(d.minimumGbw))),
        e(`GBW = ${f(p.gbw)} MHz`,row(text('GBW'),eq(),q(p.gbw,'MHz'))),
        integrator ? '频率还应高于反馈极点约十倍；高频需保留足够环路增益。' : '该 GBW 条件来自无 Cf 的参考设计；增加 Cf 后仍应核对实际环路稳定性。']},
  ];
}
