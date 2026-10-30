import { createElement, type ReactNode } from 'react';
import { number, resistance } from '../shared/units';
import { dividerCurrent, type DividerParameter, type DividerResult } from './algorithm';

const m = (tag: string, ...children: ReactNode[]) => createElement(tag, null, ...children);
const symbol = (name: string, subscript?: string) => subscript ? m('msub', m('mi', name), m('mtext', subscript)) : m('mi', name);
const sum = (a: ReactNode, b: ReactNode) => m('mrow', a, m('mo', '+'), b);
const difference = (a: ReactNode, b: ReactNode) => m('mrow', a, m('mo', '−'), b);
const bracket = (value: ReactNode) => m('mrow', m('mo', '('), value, m('mo', ')'));
const times = (a: ReactNode, b: ReactNode) => m('mrow', a, m('mo', '×'), b);
const equation = (label: string, ...children: ReactNode[]) => createElement('math', { xmlns: 'http://www.w3.org/1998/Math/MathML', display: 'block', 'aria-label': label }, m('mrow', ...children));
const labels: Record<DividerParameter, string> = { midpoint: 'Vmid = Vin × R2 / (R1 + R2)', supply: 'Vin = Vmid × (R1 + R2) / R2', upper: 'R1 = R2 × (Vin − Vmid) / Vmid', lower: 'R2 = R1 × Vmid / (Vin − Vmid)' };

function targetEquation(target: DividerParameter, values?: DividerResult): ReactNode {
  const voltage = (key: 'supply' | 'midpoint') => values ? m('mtext', `${number(key === 'supply' ? values.supplyV : values.midpointV)} V`) : symbol('V', key === 'supply' ? 'in' : 'mid');
  const resistor = (key: 'upper' | 'lower') => values ? m('mtext', resistance(key === 'upper' ? values.upperOhms : values.lowerOhms)) : symbol('R', key === 'upper' ? '1' : '2');
  const left = target === 'supply' || target === 'midpoint' ? voltage(target) : resistor(target);
  const variable = target === 'supply' ? symbol('V', 'in') : target === 'midpoint' ? symbol('V', 'mid') : symbol('R', target === 'upper' ? '1' : '2');
  const total = sum(resistor('upper'), resistor('lower'));
  const drop = difference(voltage('supply'), voltage('midpoint'));
  const right = target === 'midpoint' ? times(voltage('supply'), m('mfrac', resistor('lower'), total))
    : target === 'supply' ? times(voltage('midpoint'), m('mfrac', total, resistor('lower')))
    : target === 'upper' ? m('mfrac', times(resistor('lower'), bracket(drop)), voltage('midpoint'))
    : m('mfrac', times(resistor('upper'), voltage('midpoint')), drop);
  return values ? equation(labels[target] + ' 数值代入', m('mo', '='), right, m('mo', '='), left)
    : equation(labels[target], variable, m('mo', '='), right);
}

export function DividerEquations({ result: r, solveFor = 'midpoint' }: { result?: DividerResult; solveFor?: DividerParameter }) {
  return <div className="divider-equations">
    <div>{targetEquation(solveFor)}{r && targetEquation(solveFor, r)}</div>
    <div>{equation('I = Vin / (R1 + R2)', symbol('I'), m('mo', '='), m('mfrac', symbol('V', 'in'), sum(symbol('R', '1'), symbol('R', '2'))))}
      {r && equation(`I = ${dividerCurrent(r.currentA)}`, m('mo', '='), m('mfrac', m('mtext', `${number(r.supplyV)} V`), sum(m('mtext', resistance(r.upperOhms)), m('mtext', resistance(r.lowerOhms)))), m('mo', '='), m('mtext', dividerCurrent(r.currentA)))}</div>
  </div>;
}
