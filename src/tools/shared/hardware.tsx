import { useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { native, errorMessage } from '../../services/api';
import { Heading } from './components';
import { number } from './units';
import { useViewMemory } from '../../services/useViewMemory';
import { restoreMemoryShape } from '../../services/viewMemory';
import './calculators.css';
import './hardware.css';

export type HardwareToolId = 'tl431' | 'pullup-divider' | 'uc28-38xx' | 'pmos-switch';
export interface PassiveInput { value: string; unit: string }
const scales: Readonly<Record<string, number>> = { 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6, pF: 1e-12, nF: 1e-9, 'µF': 1e-6 };
export const passiveValue = (input: PassiveInput) => input.value.trim() === '' ? NaN : Number(input.value) * scales[input.unit];
export const resistor = (value: string, unit = 'kΩ'): PassiveInput => ({ value, unit });
export const capacitor = (value: string, unit = 'nF'): PassiveInput => ({ value, unit });
export function useHardwareDraft<T extends object>(id: HardwareToolId, initial: T, validate?: (value: T) => boolean) {
  const [draft, setDraft] = useViewMemory<T>(id, initial, undefined, value => { const restored = restoreMemoryShape(initial, value); return !validate || validate(restored) ? restored : initial; });
  function update(patch: Partial<T>) { setDraft(previous => ({ ...previous, ...patch })); }
  function reset() { setDraft(initial); }
  return { draft, update, reset };
}
export function PassiveField({ label, value, onChange, kind = 'resistor' }: { label: string; value: PassiveInput; onChange: (value: PassiveInput) => void; kind?: 'resistor' | 'capacitor' }) {
  return <fieldset className="hw-passive"><legend>{label}</legend><div><input type="number" step="any" min="0" aria-label={`${label} 数值`} value={value.value} onChange={e => onChange({ ...value, value: e.target.value })} /><select aria-label={`${label} 单位`} value={value.unit} onChange={e => onChange({ ...value, unit: e.target.value })}>{(kind === 'resistor' ? ['Ω', 'kΩ', 'MΩ'] : ['pF', 'nF', 'µF']).map(unit => <option key={unit}>{unit}</option>)}</select></div></fieldset>;
}
export function HardwareLayout({ title, description, parameters, children, equations, onReset, references, note }: { title: string; description: string; parameters: ReactNode; children: ReactNode; equations: ReactNode; onReset: () => void; references?: ReactNode; note?: ReactNode }) {
  return <div className="calculations-page hw-page"><Heading eyebrow="HARDWARE CALCULATOR" title={title} description={description} /><div className="hw-layout"><section className="card calc-card hw-input-card" aria-label={`${title}参数`}><div className="calc-card-title"><h2>输入参数</h2><span className="tag">实时计算</span></div><div>{parameters}<button type="button" className="small" onClick={onReset}>恢复示例</button></div><p className="calc-note hw-input-note">修改数值或单位后立即更新。本窗口记住输入，重新打开后恢复。</p></section><section className="card calc-card" aria-label={`${title}结果`}><div className="calc-card-title"><h2>电路与结果</h2></div>{children}</section></div><section className="card calc-card hw-equations" aria-label={`${title}计算过程`}><div className="calc-card-title"><h2>计算过程</h2></div>{equations}{note && <div className="calc-reference">{note}</div>}</section>{references && <div className="hw-references">{references}</div>}</div>;
}
export function Metrics({ items }: { items: readonly { label: string; value: ReactNode; id?: string }[] }) { return <dl className="hw-metrics" aria-live="polite">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd id={item.id}>{item.value}</dd></div>)}</dl>; }
export function HardwareReference({ tool, href, children }: { tool: HardwareToolId; href: string; children: ReactNode }) {
  const [error, setError] = useState('');
  return <span><a href={href} target="_blank" rel="noopener noreferrer" onClick={e => { if (!native) return; e.preventDefault(); setError(''); void invoke('hardware_reference_open', { toolId: tool, url: href }).catch(e => setError(errorMessage(e))); }}>{children} ↗</a>{error && <small role="alert">打开资料失败：{error}</small>}</span>;
}
export const frequencyText = (hz: number) => hz >= 1e6 ? `${number(hz / 1e6)} MHz` : hz >= 1e3 ? `${number(hz / 1e3)} kHz` : `${number(hz)} Hz`;
export const timeText = (seconds: number) => seconds >= 1e-3 ? `${number(seconds * 1e3)} ms` : seconds >= 1e-6 ? `${number(seconds * 1e6)} µs` : `${number(seconds * 1e9)} ns`;
export const currentText = (amps: number) => Math.abs(amps) >= 1 ? `${number(amps)} A` : Math.abs(amps) >= 1e-3 ? `${number(amps * 1e3)} mA` : `${number(amps * 1e6)} µA`;
export const powerText = (watts: number) => Math.abs(watts) >= 1 ? `${number(watts)} W` : `${number(watts * 1e3)} mW`;
export const capacitanceText = (farads: number) => farads >= 1e-6 ? `${number(farads * 1e6)} µF` : farads >= 1e-9 ? `${number(farads * 1e9)} nF` : `${number(farads * 1e12)} pF`;

export function Ground({ x, y }: { x: number; y: number }) { return <path d={`M${x} ${y - 10} V${y} M${x - 16} ${y} H${x + 16} M${x - 10} ${y + 7} H${x + 10} M${x - 4} ${y + 14} H${x + 4}`} />; }
export function SchematicResistor({ x, y, label, value, horizontal = false }: { x: number; y: number; label: string; value?: string; horizontal?: boolean }) { return <g><rect x={x - (horizontal ? 24 : 10)} y={y - (horizontal ? 10 : 24)} width={horizontal ? 48 : 20} height={horizontal ? 20 : 48} /><text x={horizontal ? x : x + 22} y={horizontal ? y - 29 : y - 5} textAnchor={horizontal ? 'middle' : undefined}>{label}</text>{value && <text x={horizontal ? x : x + 22} y={horizontal ? y - 13 : y + 15} textAnchor={horizontal ? 'middle' : undefined}>{value}</text>}</g>; }
