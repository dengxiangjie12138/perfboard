import { createElement, type ReactNode } from 'react';
import { numberText } from './algorithm';

// Native MathML keeps fractions and scripts readable offline without a typesetting runtime.
const element = (tag: string, ...children: ReactNode[]) => createElement(tag, null, ...children);
export const row = (...children: ReactNode[]) => element('mrow', ...children);
export const op = (value: string) => element('mo', value);
export const text = (value: string) => element('mtext', value);
export const sub = (base: ReactNode, script: ReactNode) => element('msub', base, script);
export const sym = (base: string, script?: string) => script ? sub(element('mi', base), /^\d+$/.test(script) ? element('mn', script) : text(script)) : element('mi', base);
export const frac = (numerator: ReactNode, denominator: ReactNode) => element('mfrac', numerator, denominator);
export const paren = (value: ReactNode) => row(op('('), value, op(')'));
export const abs = (value: ReactNode) => row(op('|'), value, op('|'));
export const power = (base: ReactNode, exponent: ReactNode) => element('msup', base, exponent);
export const integral = (value: ReactNode) => row(element('msubsup', op('∫'), element('mn','0'), element('mi','t')), value, element('mi','d'), element('mi','τ'));
export function num(value: number, digits = 4): ReactNode {
  const formatted = numberText(value, digits), match = /^(-?[\d.]+)e([+-]?\d+)$/.exec(formatted);
  return match ? row(element('mn', match[1]), op('×'), element('msup', element('mn', '10'), element('mn', String(Number(match[2]))))) : element('mn', formatted);
}
export const quantity = (value: number, unit: string) => row(num(value), createElement('mspace', { width: '0.2em' }), text(unit));
export const resistance = (value: number) => Math.abs(value) >= 1e6 ? quantity(value / 1e6, 'MΩ') : Math.abs(value) >= 1e3 ? quantity(value / 1e3, 'kΩ') : quantity(value, 'Ω');
export const frequency = (value: number) => Math.abs(value) >= 1e6 ? quantity(value / 1e6, 'MHz') : Math.abs(value) >= 1e3 ? quantity(value / 1e3, 'kHz') : quantity(value, 'Hz');
export interface MathExpression { label: string; expression: ReactNode }
export const expression = (label: string, value: ReactNode): MathExpression => ({ label, expression: value });
export function MathFormula({ value }: { value: MathExpression }) {
  return createElement('math', { xmlns: 'http://www.w3.org/1998/Math/MathML', display: 'block', 'aria-label': value.label }, value.expression);
}
