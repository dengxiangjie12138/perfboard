import { createElement, type ReactNode } from 'react';
export const mathNode = (tag: string, ...children: ReactNode[]) => createElement(tag, null, ...children);
export const row = (...children: ReactNode[]) => mathNode('mrow', ...children);
export const text = (value: string) => mathNode('mtext', value);
export const op = (value: string) => mathNode('mo', value);
export const sym = (base: string, sub?: string) => sub ? mathNode('msub', mathNode('mi', base), /^\d+$/.test(sub) ? mathNode('mn', sub) : text(sub)) : mathNode('mi', base);
export const frac = (a: ReactNode, b: ReactNode) => mathNode('mfrac', a, b);
export const paren = (...children: ReactNode[]) => row(op('('), ...children, op(')'));
export function Equation({ label, children, substitution }: { label: string; children: ReactNode; substitution?: string }) { return <div className="hw-equation">{createElement('math', { xmlns: 'http://www.w3.org/1998/Math/MathML', display: 'block', 'aria-label': label }, children)}{substitution && <p>{substitution}</p>}</div>; }
