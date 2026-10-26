import { createElement, type ReactNode } from 'react';
import { number, resistance } from '../shared/units';
import { dividerCurrent, type DividerResult } from './algorithm';

const m = (tag: string, ...children: ReactNode[]) => createElement(tag, null, ...children);
const symbol = (name: string, subscript?: string) => subscript ? m('msub', m('mi', name), m('mtext', subscript)) : m('mi', name);
const sum = (a: ReactNode, b: ReactNode) => m('mrow', a, m('mo', '+'), b);
const equation = (label: string, ...children: ReactNode[]) => createElement('math', { xmlns: 'http://www.w3.org/1998/Math/MathML', display: 'block', 'aria-label': label }, m('mrow', ...children));

export function DividerEquations({ result: r }: { result?: DividerResult }) {
  const denominator = r && sum(m('mtext', resistance(r.upperOhms)), m('mtext', resistance(r.lowerOhms)));
  return <div className="divider-equations">
    <div>{equation('Vmid = Vin × R2 / (R1 + R2)', symbol('V', 'mid'), m('mo', '='), symbol('V', 'in'), m('mo', '×'), m('mfrac', symbol('R', '2'), sum(symbol('R', '1'), symbol('R', '2'))))}
      {r && equation(`Vmid = ${number(r.midpointV)} V`, m('mo', '='), m('mtext', `${number(r.supplyV)} V`), m('mo', '×'), m('mfrac', m('mtext', resistance(r.lowerOhms)), denominator), m('mo', '='), m('mtext', `${number(r.midpointV)} V`))}</div>
    <div>{equation('I = Vin / (R1 + R2)', symbol('I'), m('mo', '='), m('mfrac', symbol('V', 'in'), sum(symbol('R', '1'), symbol('R', '2'))))}
      {r && equation(`I = ${dividerCurrent(r.currentA)}`, m('mo', '='), m('mfrac', m('mtext', `${number(r.supplyV)} V`), denominator), m('mo', '='), m('mtext', dividerCurrent(r.currentA)))}</div>
  </div>;
}
