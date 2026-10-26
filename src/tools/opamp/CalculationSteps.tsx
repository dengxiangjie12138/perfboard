import type { ReactNode } from 'react';
import type { CircuitId } from './metadata';
import { engineeringText as eng, numberText as f, type CircuitParameters, type OpAmpResult } from './algorithm';
import { abs, expression as e, frac, frequency, MathFormula, num, op, paren, quantity as q, resistance as ohm, row, sub, sym, text, type MathExpression } from './MathFormula';
import { additionalCalculationSteps } from './AdditionalCalculationSteps';

export interface Step { title: string; formula: MathExpression; lines: (MathExpression | string)[] }
const eq = () => op('='), plus = () => op('+'), minus = () => op('−'), times = () => op('×');
const R = (index: number) => sym('R', String(index)), V = (script: string) => sym('V', script), A = (script: string) => sym('A', script);
const ng = () => text('NG'), gbw = () => text('GBW'), bw = () => text('BW');
const voltage = (value: number) => q(value, 'V');
const interval = (low: ReactNode, high: ReactNode) => row(op('['), low, op(','), high, op(']'));
function bandwidth(p: CircuitParameters, r: OpAmpResult): MathExpression {
  return e(`BW ≈ GBW / NG = ${f(p.gbw)} MHz / ${f(r.noiseGain)} = ${eng(r.bandwidth, 'Hz')}`,
    row(bw(), op('≈'), frac(gbw(), ng()), eq(), frac(q(p.gbw, 'MHz'), num(r.noiseGain)), eq(), frequency(r.bandwidth)));
}
function outputRange(r: OpAmpResult): MathExpression {
  return e(`Vout ∈ [${f(r.low)} V, ${f(r.high)} V]`, row(V('out'), op('∈'), interval(voltage(r.low), voltage(r.high))));
}
export function calculationSteps(id: CircuitId, p: CircuitParameters, r: OpAmpResult): Step[] {
  if (id !== 'noninv' && id !== 'diff') return additionalCalculationSteps(id, p, r);
  if (id === 'noninv') return [
    { title: '闭环电压增益', formula: e('Av = 1 + R1 / R2', row(A('v'), eq(), num(1), plus(), frac(R(1), R(2)))), lines: [
      e(`= 1 + ${eng(p.r1)} / ${eng(p.r2)} = ${f(r.gain)} V/V`, row(eq(), num(1), plus(), frac(ohm(p.r1), ohm(p.r2)), eq(), q(r.gain, 'V/V'))),
    ] },
    { title: '输出电压', formula: e('Vout = Vin × (1 + R1 / R2)', row(V('out'), eq(), V('in'), times(), paren(row(num(1), plus(), frac(R(1), R(2)))))), lines: [
      e(`= ${f(p.vin)} V × (1 + ${eng(p.r1)} / ${eng(p.r2)}) = ${f(r.output)} V`, row(eq(), voltage(p.vin), times(), paren(row(num(1), plus(), frac(ohm(p.r1), ohm(p.r2)))), eq(), voltage(r.output))),
    ] },
    { title: '反馈分压 · 线性工作假设', formula: e('V− = Vout × R2 / (R1 + R2)', row(V('−'), eq(), V('out'), times(), frac(R(2), row(R(1), plus(), R(2))))), lines: [
      e(`= ${f(r.output)} V × ${eng(p.r2)} / (${eng(p.r1)} + ${eng(p.r2)}) = ${f(p.vin)} V = V+`, row(eq(), voltage(r.output), times(), frac(ohm(p.r2), row(ohm(p.r1), plus(), ohm(p.r2))), eq(), voltage(p.vin), eq(), V('+'))),
    ] },
    { title: '设定摆幅与小信号带宽', formula: e('Vout ∈ [Vee + H, Vcc − H]', row(V('out'), op('∈'), interval(row(V('ee'), plus(), sym('H')), row(V('cc'), minus(), sym('H'))))), lines: [
      outputRange(r), e(`NG = Av = ${f(r.noiseGain)}`, row(ng(), eq(), A('v'), eq(), num(r.noiseGain))), bandwidth(p, r),
    ] },
  ];
  return [
    { title: '检查两侧电阻比例', formula: e('k = R3 / R1；q = R4 / R2', row(sym('k'), eq(), frac(R(3), R(1)), op('；'), sym('q'), eq(), frac(R(4), R(2)))), lines: [
      e(`k = ${eng(p.r3)} / ${eng(p.r1)} = ${f(r.k)}`, row(sym('k'), eq(), frac(ohm(p.r3), ohm(p.r1)), eq(), num(r.k))),
      e(`q = ${eng(p.r4)} / ${eng(p.r2)} = ${f(r.q)}`, row(sym('q'), eq(), frac(ohm(p.r4), ohm(p.r2)), eq(), num(r.q))),
      r.matched ? '比例匹配，可使用减法简式。' : '比例不匹配，必须使用通用公式。',
    ] },
    { title: '同相端电压 · 线性工作假设', formula: e('V+ = (Vi2 × R4 + Vref × R2) / (R2 + R4)', row(V('+'), eq(), frac(row(V('i2'), times(), R(4), plus(), V('ref'), times(), R(2)), row(R(2), plus(), R(4))))), lines: [
      e(`= (${f(p.vi2)} V × ${eng(p.r4)} + ${f(p.vref)} V × ${eng(p.r2)}) / (${eng(p.r2)} + ${eng(p.r4)}) = ${f(r.vplus)} V`, row(eq(), frac(row(voltage(p.vi2), times(), ohm(p.r4), plus(), voltage(p.vref), times(), ohm(p.r2)), row(ohm(p.r2), plus(), ohm(p.r4))), eq(), voltage(r.vplus))),
    ] },
    { title: '通用输出公式 · 任意正电阻', formula: e('Vout = −k × Vi1 + (1 + k) × V+', row(V('out'), eq(), minus(), sym('k'), times(), V('i1'), plus(), paren(row(num(1), plus(), sym('k'))), times(), V('+'))), lines: [
      e(`= −${f(r.k)} × (${f(p.vi1)} V) + ${f(r.noiseGain)} × (${f(r.vplus)} V) = ${f(r.output)} V`, row(eq(), minus(), num(r.k), times(), paren(voltage(p.vi1)), plus(), num(r.noiseGain), times(), paren(voltage(r.vplus)), eq(), voltage(r.output))),
    ] },
    { title: r.matched ? '比例匹配时的简式' : '失配时的信号分解', formula: r.matched
      ? e('Vout = k × (Vi2 − Vi1) + Vref', row(V('out'), eq(), sym('k'), times(), paren(row(V('i2'), minus(), V('i1'))), plus(), V('ref')))
      : e('Vout = Ad × Vdiff + Acm × Vcm + Aref × Vref', row(V('out'), eq(), A('d'), times(), V('diff'), plus(), A('cm'), times(), V('cm'), plus(), A('ref'), times(), V('ref'))), lines: [
        r.matched
          ? e(`= ${f(r.k)} × (${f(p.vi2)} V − ${f(p.vi1)} V) + (${f(p.vref)} V) = ${f(r.output)} V`, row(eq(), num(r.k), times(), paren(row(voltage(p.vi2), minus(), voltage(p.vi1))), plus(), paren(voltage(p.vref)), eq(), voltage(r.output)))
          : e(`= ${f(r.gain)} × (${f(r.vdiff)} V) + ${f(r.commonGain)} × (${f(r.vcm)} V) + ${f(r.aRef)} × (${f(p.vref)} V) = ${f(r.output)} V`, row(eq(), num(r.gain), times(), paren(voltage(r.vdiff)), plus(), num(r.commonGain), times(), paren(voltage(r.vcm)), plus(), num(r.aRef), times(), paren(voltage(p.vref)), eq(), voltage(r.output))),
      ] },
    { title: '差模、共模与参考电压的增益', formula: e('A+ = (1 + k) × R4 / (R2 + R4)', row(A('+'), eq(), paren(row(num(1), plus(), sym('k'))), times(), frac(R(4), row(R(2), plus(), R(4))))), lines: [
      e(`A+ = ${f(r.aPlus)}；A− = −k = ${f(r.aMinus)}`, row(A('+'), eq(), num(r.aPlus), op('；'), A('−'), eq(), minus(), sym('k'), eq(), num(r.aMinus))),
      e(`Ad = (A+ − A−) / 2 = ${f(r.gain)}`, row(A('d'), eq(), frac(row(A('+'), minus(), A('−')), num(2)), eq(), num(r.gain))),
      e(`Acm = A+ + A− = ${f(r.commonGain)}`, row(A('cm'), eq(), A('+'), plus(), A('−'), eq(), num(r.commonGain))),
      e(`Aref = (1 + k) × R2 / (R2 + R4) = ${f(r.aRef)}`, row(A('ref'), eq(), paren(row(num(1), plus(), sym('k'))), times(), frac(R(2), row(R(2), plus(), R(4))), eq(), num(r.aRef))),
      e(`Vdiff = Vi2 − Vi1 = ${f(r.vdiff)} V`, row(V('diff'), eq(), V('i2'), minus(), V('i1'), eq(), voltage(r.vdiff))),
      e(`Vcm = (Vi1 + Vi2) / 2 = ${f(r.vcm)} V`, row(V('cm'), eq(), frac(row(V('i1'), plus(), V('i2')), num(2)), eq(), voltage(r.vcm))),
      e(`CMRR = 20log₁₀|Ad/Acm| = ${r.matched ? '∞（理想匹配）' : f(r.cmrr, 2) + ' dB'}`, row(text('CMRR'), eq(), num(20), sub(text('log'), num(10)), abs(frac(A('d'), A('cm'))), eq(), r.matched ? row(op('∞'), text('（理想匹配）')) : q(r.cmrr, 'dB'))),
    ] },
    { title: '设定摆幅与小信号带宽', formula: e('NG = 1 + R3 / R1', row(ng(), eq(), num(1), plus(), frac(R(3), R(1)))), lines: [
      e(`NG = ${f(r.noiseGain)}；差模增益 Ad = ${f(r.gain)}`, row(ng(), eq(), num(r.noiseGain), op('；'), A('d'), eq(), num(r.gain))), bandwidth(p, r), outputRange(r),
    ] },
  ];
}
export function CalculationSteps({ id, parameters, result }: { id: CircuitId; parameters?: CircuitParameters; result?: OpAmpResult }) {
  return <section className="opamp-card opamp-calculations" aria-label="计算过程"><header><h2><span>02</span>计算过程</h2><small>随参数实时更新</small></header>
    {parameters && result ? <ol className="opamp-steps">{calculationSteps(id, parameters, result).map((step, i) => <li key={step.title}><span className="opamp-step-index">{String(i + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><div className="opamp-formula"><MathFormula value={step.formula} /></div><div className="opamp-substitution">{step.lines.map((line, index) => typeof line === 'string' ? <p key={index}>{line}</p> : <div key={index}><MathFormula value={line} /></div>)}</div></div></li>)}</ol> : <p className="opamp-empty">修正参数后显示计算过程。</p>}
    <div className="opamp-assumptions"><p>计算前提：理想运放、负反馈、线性工作区、零输入源阻抗。超出摆幅或共模范围时，线性计算仅代表目标值。</p><p>未计入失调、偏置电流、温漂、负载和稳定性；此页为公式计算器。</p></div></section>;
}
