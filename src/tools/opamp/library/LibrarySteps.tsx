import { Children, cloneElement, createElement, isValidElement, type ReactNode } from 'react';
import type { CircuitParameters } from '../algorithm';
import { capacitanceText, engineeringText, numberText as f } from '../algorithm';
import { circuitDefinition, parameterLabel, type LibraryId, type ParameterKey } from '../metadata';
import { MathFormula, expression, frac, row, sym, op, num, power, paren, quantity, resistance, text, type MathExpression } from '../MathFormula';
import { isAC, isAudio, type LibraryResult } from './algorithm';
const R=(s:string)=>sym('R',s),C=(s:string)=>sym('C',s),V=(s:string)=>sym('V',s),H=()=>row(sym('H'),paren(sym('s')));
const plus=(...v:ReactNode[])=>row(...v.flatMap((n,i)=>i?[op('+'),n]:[n]));
const times=(...v:ReactNode[])=>row(...v.flatMap((n,i)=>i?[op('×'),n]:[n]));
const minus=(a:ReactNode,b:ReactNode)=>row(a,op('−'),b),eq=(a:ReactNode,b:ReactNode)=>row(a,op('='),b),negative=(a:ReactNode)=>row(op('−'),a);
const one=num(1),s=sym('s'),pi=sym('π');
const sqrt=(v:ReactNode)=>createElement('msqrt',null,v);
const poly=(a:ReactNode,b:ReactNode)=>plus(power(s,num(2)),times(s,a),b);
const pole=(r:ReactNode,c:ReactNode)=>frac(one,times(num(2),pi,r,c));
const entry=(label:string,value:ReactNode)=>expression(label,value);
/** Native MathML for equations; diagrams and the numerical solver use the same TI numbering. */
export function libraryEquations(id:LibraryId):MathExpression[] {
  const ratio=frac(R('2'),R('1')),ng=plus(one,ratio);
  const bias=eq(V('b'),times(V('ref'),frac(R('3'),plus(R('2'),R('3')))));
  switch(id) {
    case 'ac-inv':return [entry('Vb = Vref R3 / (R2 + R3)',bias),entry('H(s) = −s R4 C1 / (1 + s R1 C1)',eq(H(),negative(frac(times(s,R('4'),C('1')),plus(one,times(s,R('1'),C('1'))))))),entry('fL = 1 / (2πR1C1)',eq(sym('f','L'),pole(R('1'),C('1'))))];
    case 'ac-noninv':return [entry('Vb = Vref R3 / (R2 + R3)',bias),entry('H(s) = s Req C2 / (1 + s Req C2) × [1 + s R4 C1 / (1 + s R1 C1)]',eq(H(),times(frac(times(s,R('eq'),C('2')),plus(one,times(s,R('eq'),C('2')))),paren(plus(one,frac(times(s,R('4'),C('1')),plus(one,times(s,R('1'),C('1'))))))))),entry('Req = R2 R3 / (R2 + R3)',eq(R('eq'),frac(times(R('2'),R('3')),plus(R('2'),R('3')))))];
    case 'lowpass-inv':return [entry('H(s) = −(R2/R1) / (1 + s R2 C1)',eq(H(),negative(frac(ratio,plus(one,times(s,R('2'),C('1'))))))),entry('fp = 1 / (2πR2C1)',eq(sym('f','p'),pole(R('2'),C('1'))))];
    case 'sk-lowpass':case 'sk-highpass': {
      const a0=frac(one,times(R('1'),R('2'),C('1'),C('2'))),a1=id==='sk-lowpass'?plus(frac(one,times(R('1'),C('1'))),frac(one,times(R('2'),C('1')))):plus(frac(one,times(R('2'),C('1'))),frac(one,times(R('2'),C('2'))));
      return [entry('H(s) = numerator / (s² + a1 s + a0)',eq(H(),frac(id==='sk-lowpass'?sym('a','0'):power(s,num(2)),poly(sym('a','1'),sym('a','0'))))),entry('a0 = 1 / (R1 R2 C1 C2)',eq(sym('a','0'),a0)),entry('a1 from the actual Sallen-Key components',eq(sym('a','1'),a1)),entry('f0 = sqrt(a0) / 2π; Q = sqrt(a0) / a1',row(eq(sym('f','0'),frac(sqrt(sym('a','0')),times(num(2),pi))),op(','),eq(sym('Q'),frac(sqrt(sym('a','0')),sym('a','1')))))];
    }
    case 'mfb-bandpass': {
      const lpB=times(s,C('2'),paren(plus(R('1'),R('2'),frac(times(R('1'),R('2')),R('3')))));
      const lpA=times(power(s,num(2)),R('1'),R('2'),C('1'),C('2'));
      const hpB=times(s,R('4'),paren(plus(C('4'),C('5'),C('6'))));
      const hpA=times(power(s,num(2)),R('4'),R('5'),C('5'),C('6'));
      return [entry('H = HLP × HHP',eq(H(),times(sym('H','LP'),sym('H','HP')))),
        entry('HLP = −(R1/R3) / [1+sC2(R1+R2+R1R2/R3)+s²R1R2C1C2]',eq(sym('H','LP'),negative(frac(frac(R('1'),R('3')),plus(one,lpB,lpA))))),
        entry('HHP = −s²R4R5C4C5 / [1+sR4(C4+C5+C6)+s²R4R5C5C6]',eq(sym('H','HP'),negative(frac(times(power(s,num(2)),R('4'),R('5'),C('4'),C('5')),plus(one,hpB,hpA)))))];
    }
    case 'tia':return [entry('Vout = Vref + Ii R1',eq(V('out'),plus(V('ref'),times(sym('I','i'),R('1'))))),entry('ZT(s) = R1 / (1+sR1C1)',eq(sym('Z','T'),frac(R('1'),plus(one,times(s,R('1'),C('1')))))),entry('GBWmin = (Ci+C1)/(2πR1C1²)',eq(text('GBWmin'),frac(plus(C('i'),C('1')),times(num(2),pi,R('1'),power(C('1'),num(2))))))];
    case 'current-uni':return [entry('Vout = Ii R1 (1+R3/R2)',eq(V('out'),times(sym('I','i'),R('1'),paren(plus(one,frac(R('3'),R('2'))))))),entry('Pshunt = Ii² R1',eq(sym('P','shunt'),times(power(sym('I','i'),num(2)),R('1'))))];
    case 'current-bi':return [entry('Vref = Vcc R6/(R5+R6)',eq(V('ref'),times(V('cc'),frac(R('6'),plus(R('5'),R('6')))))),entry('Vplus = Vref R3/(R3+R4)',eq(V('+'),times(V('ref'),frac(R('3'),plus(R('3'),R('4')))))),entry('Vshunt = Rs(Vplus−Ii R1)/(R1+Rs), including input branch loading',eq(V('shunt'),frac(times(R('s'),paren(minus(V('+'),times(sym('I','i'),R('1'))))),plus(R('1'),R('s'))))),entry('Vout = (1+R2/R1)Vplus − (R2/R1)Vshunt',eq(V('out'),minus(times(ng,V('+')),times(ratio,V('shunt')))))];
    case 'howland':return [entry('Vcm = (Vn R2 + Vdrive R1)/(R1+R2)',eq(V('cm'),frac(plus(times(V('n'),R('2')),times(V('drive'),R('1'))),plus(R('1'),R('2'))))),entry('(Vp−Vcm)/R3 + (Vload−Vcm)/R4 = 0',eq(plus(frac(minus(V('p'),V('cm')),R('3')),frac(minus(V('load'),V('cm')),R('4'))),num(0))),entry('(Vdrive−Vload)/Rs = (Vload−Vtermination)/RL + (Vload−Vcm)/R4',eq(frac(minus(V('drive'),V('load')),R('s')),plus(frac(minus(V('load'),V('termination')),R('L')),frac(minus(V('load'),V('cm')),R('4'))))),entry('Iload = (Vload−Vtermination)/RL',eq(sym('I','load'),frac(minus(V('load'),V('termination')),R('L'))))];
    case 'reference':return [entry('Vout = Vin [−R2/R1 + α(1+R2/R1)]',eq(V('out'),times(V('in'),paren(plus(negative(ratio),times(sym('α'),ng)))))),entry('IP1 = Vin/P1',eq(sym('I','P1'),frac(V('in'),sym('P','1'))))];
    case 'pwm':return [entry('Vb = Vref R2/(R1+R2)',eq(V('b'),times(V('ref'),frac(R('2'),plus(R('1'),R('2')))))),entry('Vavg = (1+R4/R3)Vb − (R4/R3)Vin',eq(V('avg'),minus(times(plus(one,frac(R('4'),R('3'))),V('b')),times(frac(R('4'),R('3')),V('in'))))),entry('D = (Vavg−Vee)/(Vcc−Vee), bounded to [0,1]',eq(sym('D'),frac(minus(V('avg'),V('ee')),minus(V('cc'),V('ee'))))),entry('ft = R6 / (4 R7 R5 C3), for midpoint reference',eq(sym('f','t'),frac(R('6'),times(num(4),R('7'),R('5'),C('3')))))];
    case 'sine-osc': {
      const tau=(i:number)=>sym('τ',String(i)),omega=sym('ω','0');
      const required=times(...[1,2,3].map(i=>sqrt(plus(one,power(paren(times(omega,tau(i))),num(2))))));
      return [entry('τ1=R3 C1; τ2=R4 C2; τ3=R5 C3',row(...[1,2,3].flatMap(i=>[eq(tau(i),times(R(String(i+2)),C(String(i)))),op(';')]))),
        entry('ω0 = sqrt((τ1+τ2+τ3)/(τ1τ2τ3))',eq(omega,sqrt(frac(plus(tau(1),tau(2),tau(3)),times(tau(1),tau(2),tau(3)))))),
        entry('f0 = ω0/(2π)',eq(sym('f','0'),frac(omega,times(num(2),pi)))),
        entry('Arequired = product sqrt(1+(ω0τi)²)',eq(sym('A','required'),required)),
        entry('R2/R1 ≥ Arequired',row(ratio,op('≥'),sym('A','required')))];
    }
    case 'hv-driver': {
      const impedance=frac(frac(R('f'),R('g')),plus(one,times(s,R('f'),C('f'))));
      return [entry('H(s) = 1 + (Rf/Rg)/(1+sRfCf)',eq(H(),plus(one,impedance))),
        entry('Ipk = Vout,pk/RL',eq(sym('I','pk'),frac(V('out,pk'),R('L')))),
        entry('Pload,AC = Vout,pk²/(2RL)',eq(sym('P','AC'),frac(power(V('out,pk'),num(2)),times(num(2),R('L'))))),
        entry('VGS,N = Vcc R3/(R2+R3)',eq(V('GS,N'),times(V('cc'),frac(R('3'),plus(R('2'),R('3'))))))];
    }
    case 'half-wave':return [entry('Vin < 0: Vout = −Vin R4/R1',row(V('in'),op('<'),num(0),op(':'),eq(V('out'),negative(times(V('in'),frac(R('4'),R('1'))))))),entry('Vin ≥ 0: Vout = 0',row(V('in'),op('≥'),num(0),op(':'),eq(V('out'),frac(num(0),num(1)))))];
    case 'full-wave':return [entry('Vin ≥ 0: Vout = Vin',row(V('in'),op('≥'),num(0),op(':'),eq(V('out'),V('in')))),entry('Vin < 0: Vout = −Vin R2/R1',row(V('in'),op('<'),num(0),op(':'),eq(V('out'),negative(times(V('in'),ratio))))),entry('R1 = R2: Vout = |Vin|',row(eq(R('1'),R('2')),op(':'),eq(V('out'),row(op('|'),V('in'),op('|'))),op(','),eq(sym('I','R3'),frac(V('+'),R('3')))))];
    case 'single-diff':return [entry('Vo+ = Vin; Vb = Vref R4/(R3+R4)',row(eq(V('o+'),V('in')),op(','),eq(V('b'),times(V('ref'),frac(R('4'),plus(R('3'),R('4'))))))),entry('Vo− = (1+R2/R1)Vb − (R2/R1)Vin',eq(V('o−'),minus(times(ng,V('b')),times(ratio,V('in'))))),entry('Vdiff = Vo+ − Vo−',eq(V('diff'),minus(V('o+'),V('o−'))))];
    case 'level-shift':return [entry('Vplus = (Vin R4 + Vref R3)/(R3+R4)',eq(V('+'),frac(plus(times(V('in'),R('4')),times(V('ref'),R('3'))),plus(R('3'),R('4'))))),entry('Vout = Vplus (1+R1/R2)',eq(V('out'),times(V('+'),paren(plus(one,frac(R('1'),R('2')))))))];
    case 'pga': {
      const denominator=times(paren(plus(R('1'),R('3'))),paren(plus(one,times(s,R('2'),C('1')))));
      return [entry('H(s) = 1 + R2/[(R1+R3)(1+sR2C1)]',eq(H(),plus(one,frac(R('2'),denominator)))),entry('fp = 1/(2πR2C1)',eq(sym('f','p'),pole(R('2'),C('1'))))];
    }
    case 'mic-noninv':case 'mic-tia':return [entry('Imic,rms = p × 10^(S/20) / Ztest',eq(sym('I','mic,rms'),times(sym('p'),frac(power(num(10),frac(sym('S'),num(20))),sym('Z','test'))))),entry('Vmic,DC = Vcc − Ibias R1',eq(V('mic,DC'),minus(V('cc'),times(sym('I','bias'),R('1'))))),entry(id==='mic-tia'?'Midband transimpedance ≈ R4':'Midband transimpedance ≈ [R1 ∥ (R2 ∥ R3)] (1+R5/R4)',eq(sym('Z','mid'),id==='mic-tia'?R('4'):times(paren(row(R('1'),op('∥'),paren(row(R('2'),op('∥'),R('3'))))),paren(plus(one,frac(R('5'),R('4'))))))),entry('Vout,rms = |ZT(j2πf)| Imic,rms',eq(V('out,rms'),times(row(op('|'),sym('Z','T'),paren(times(sym('j'),num(2),pi,sym('f'))),op('|')),sym('I','mic,rms'))))];
  }
}
function substituted(node:ReactNode,id:LibraryId,p:CircuitParameters,r:LibraryResult):ReactNode {
  if(Array.isArray(node))return Children.map(node,n=>substituted(n,id,p,r));
  if(!isValidElement<{children?:ReactNode}>(node))return node;
  const children=node.props.children;
  if(node.type==='msup'&&Array.isArray(children)&&isValidElement<{children?:ReactNode}>(children[0])&&children[0].type==='mi'&&children[0].props.children==='s')return power(paren(substituted(children[0],id,p,r)),substituted(children[1],id,p,r));
  if(node.type==='msub'&&Array.isArray(children)) {
    const content=(value:ReactNode):string=>isValidElement<{children?:ReactNode}>(value)?content(value.props.children):Array.isArray(value)?value.map(content).join(''):String(value??'');
    const base=content(children[0]),script=content(children[1]),key=(base+script).toLowerCase() as ParameterKey;
    if(base==='τ'&&['1','2','3'].includes(script))return quantity([p.r3*p.c1,p.r4*p.c2,p.r5*p.c3][Number(script)-1],'s');
    if(base==='ω'&&script==='0'&&id==='sine-osc')return quantity(2*Math.PI*r.frequency,'rad/s');
    if(base==='R'&&p[key]!==undefined)return resistance(p[key]);
    if(base==='C'&&p[key]!==undefined)return p[key]>=1e-6?quantity(p[key]*1e6,'µF'):p[key]>=1e-9?quantity(p[key]*1e9,'nF'):quantity(p[key]*1e12,'pF');
    if(base==='V') {
      const values:Record<string,number>={in:p.vin,ref:id==='current-bi'?r.dcNodes.buffer[0]:p.vref,cc:p.vcc,ee:p.vee,out:r.output,'out,rms':r.output,'out,pk':r.amplitude,drive:r.dcNodes.drive?.[0],load:r.dcNodes.load?.[0],termination:p.vref,cm:r.dcNodes.plus?.[0],p:p.vi2,n:p.vi1,'o+':r.dcNodes.positive?.[0],'o−':r.dcNodes.negative?.[0],'+':r.dcNodes.plus?.[0],b:r.dcNodes.plus?.[0],shunt:r.dcNodes.shunt?.[0]};
      if(Number.isFinite(values[script]))return quantity(values[script],'V');
    }
    if(base==='I'&&script==='i')return quantity(id==='tia'?p.iin*1e-6:p.current,'A');
  }
  if(node.type==='mi'&&children==='α')return num(p.alpha);
  if(node.type==='mi'&&children==='s')return times(sym('j'),quantity(2*Math.PI*p.frequency,'s⁻¹'));
  return cloneElement(node,undefined,substituted(children,id,p,r));
}
export function LibrarySteps({id,parameters:p,result:r}:{id:LibraryId;parameters?:CircuitParameters;result?:LibraryResult}) {
  const c=circuitDefinition(id);
  return <section className="opamp-card opamp-calculation"><header><h2><span>02</span>计算过程</h2><small>原生数学排版 · 确认参数后重算</small></header>{p&&r?<ol className="opamp-steps opamp-library-steps">
    <li><h3>传递关系与设计方程</h3>{libraryEquations(id).map((value,i)=><div key={i}><div className="opamp-formula"><MathFormula value={value}/></div><div className="opamp-formula opamp-numeric-formula"><MathFormula value={expression('当前数值代入：'+value.label,substituted(value.expression,id,p,r))}/></div></div>)}</li>
    <li><h3>代入当前已确认的参数</h3><div className="opamp-substitution">{[...c.resistors,...c.capacitors??[],...c.inputs].map(key=><span key={key}>{parameterLabel(id,key).symbol} = {c.resistors.includes(key as ResistanceKeyForList)?engineeringText(p[key]):c.capacitors?.includes(key as CapacitanceKeyForList)?capacitanceText(p[key]):`${f(p[key])} ${parameterLabel(id,key).unit??''}`}</span>)}</div>
      {isAC(id)&&<><div className="opamp-formula"><MathFormula value={entry(`At ${f(p.frequency)} Hz, magnitude = ${f(r.gain)}, phase = ${f(r.phase)} deg`,row(eq(sym('f'),quantity(p.frequency,'Hz')),op(','),eq(row(op('|'),H(),op('|')),num(r.gain)),op(','),eq(sym('φ'),quantity(r.phase,'°'))))}/></div><p>电容采用 Yc = j2πfC，各未知节点满足 KCL，各运放在线性假设下 V+ = V−；曲线不叠加有限开环增益。</p></>}
      <div className="opamp-formula"><MathFormula value={entry(`Result = ${f(r.output)} ${id==='howland'?'A':id==='sine-osc'?'Hz':'V'}`,eq(id==='howland'?sym('I','load'):id==='sine-osc'?sym('f','osc'):V(isAudio(id)?'out,rms':'out'),quantity(r.output,id==='howland'?'A':id==='sine-osc'?'Hz':'V')))}/></div>
    </li><li><h3>中间结果与设计检查</h3><dl className="opamp-mini-results">{r.metrics.map((m,i)=><div key={i}><dt>{m.label}</dt><dd>{f(m.value)} {m.unit}</dd></div>)}</dl></li>
  </ol>:<p className="opamp-empty">修正参数后显示计算过程。</p>}</section>;
}
type ResistanceKeyForList=CircuitDefinitionForList['resistors'][number];
type CapacitanceKeyForList=NonNullable<CircuitDefinitionForList['capacitors']>[number];
type CircuitDefinitionForList=ReturnType<typeof circuitDefinition>;
