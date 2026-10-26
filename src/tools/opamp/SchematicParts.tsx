import type { ReactNode } from 'react';
import { capacitanceText, engineeringText, numberText, type OpAmpDraft, type OpAmpResult } from './algorithm';
import { parameterLabel, type CircuitId, type ParameterKey, type ResistanceKey, type CapacitanceKey } from './metadata';
export interface SchematicProps {
  id: CircuitId; draft: OpAmpDraft; selected: string | null; onSelect: (key: ParameterKey) => void;
  onEdit: (key: ParameterKey, anchor: Element) => void; errors?: Partial<Record<ParameterKey, string>>; result?: OpAmpResult;
}
export function schematicParts({ id, draft, selected, onSelect, onEdit, errors = {} }: SchematicProps) {
  const value = (key: ParameterKey, unit = 'V') => draft.values[key].trim() && Number.isFinite(Number(draft.values[key])) ? numberText(Number(draft.values[key])) + ' ' + unit : '—';
  function editable(key: ParameterKey, label: string, x: number, y: number, width: number, height: number, children: ReactNode) {
    const meta = parameterLabel(id, key);
    return <g className={'opamp-editable' + (selected === key ? ' selected' : '') + (errors[key] ? ' invalid' : '')} data-parameter={key} tabIndex={0} role="button" aria-pressed={selected === key} aria-label={`编辑 ${meta.symbol}，${label}`} onClick={() => onSelect(key)} onDoubleClick={event => onEdit(key, event.currentTarget)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(key, event.currentTarget); } }}>
      <title>{meta.symbol} {meta.label}：{label}，双击或按 Enter 编辑{errors[key] ? `。${errors[key]}` : ''}</title><rect className="opamp-hit" x={x} y={y} width={width} height={height} rx={6} />{children}</g>;
  }
  function resistor(key: ResistanceKey, x: number, y: number, vertical = false) {
    const raw = draft.values[key], n = raw.trim() === '' ? NaN : Number(raw) * draft.units[key], label = Number.isFinite(n) && (n > 0 || (id === 'pga' && key === 'r1' && n === 0)) ? engineeringText(n) : '—';
    return editable(key, label, x - 10, y - (vertical ? 12 : 45), vertical ? 122 : 84, vertical ? 75 : 62,
      vertical ? <><path d={`M${x + 30} ${y - 8}v12m-8 0h16v34h-16z m8 34v12`} /><text className="opamp-sch-number" x={x + 47} y={y + 15}>{parameterLabel(id,key).symbol}</text><text x={x + 47} y={y + 33}>{label}</text></> : <><path d={`M${x} ${y}h12m0 -8h40v16h-40z m40 8h12`} /><text className="opamp-sch-number" x={x + 32} y={y - 34} textAnchor="middle">{parameterLabel(id,key).symbol}</text><text x={x + 32} y={y - 18} textAnchor="middle">{label}</text></>);
  }
  function capacitor(key: CapacitanceKey, x: number, y: number) {
    const raw = draft.values[key], n = raw.trim() === '' ? NaN : Number(raw) * draft.units[key], label = Number.isFinite(n) && n >= 0 ? capacitanceText(n) : '—';
    return editable(key, label, x - 10, y - 45, 110, 64, <><path className={n === 0 ? 'opamp-optional' : ''} d={`M${x} ${y}h27m0 -13v26m10 -26v26m0 -13h27`} /><text className="opamp-sch-number" x={x + 32} y={y - 34} textAnchor="middle">{parameterLabel(id,key).symbol}</text><text x={x + 32} y={y - 18} textAnchor="middle">{n === 0 ? '0 pF · 未接入' : label}</text></>);
  }
  const supply = (key: 'vcc' | 'vee', x: number, y: number) => editable(key, value(key), x - 7, y - 16, 100, 42, <><text className="opamp-signal" x={x} y={y}>{parameterLabel(id,key).symbol}</text><text x={x} y={y + 17}>{value(key)}</text></>);
  const signal = (key: ParameterKey, symbol: string, x: number, labelY: number, valueY: number, unit = 'V') => editable(key, value(key,unit), x - 8, labelY - 17, 100, valueY - labelY + 30, <><text className="opamp-signal" x={x} y={labelY}>{symbol}</text><text x={x} y={valueY}>{value(key,unit)}</text></>);
  return { editable, resistor, capacitor, supply, signal, value };
}
export const ground = (x: number, y: number) => <path d={`M${x} ${y}v9m-12 0h24m-18 5h12m-9 5h6`} />;
export const node = (x: number, y: number) => <circle className="opamp-node" cx={x} cy={y} r="3.5" />;
export function amplifier(x: number, y: number, label: string, invertedTop = true, labelY = y - 58, labelX = x + 40) {
  return <g><polygon className="opamp-symbol" points={`${x},${y - 40} ${x},${y + 40} ${x + 80},${y}`} /><text x={x + 8} y={y - 15}>{invertedTop ? '−' : '+'}</text><text x={x + 8} y={y + 25}>{invertedTop ? '+' : '−'}</text><text x={labelX} y={labelY} textAnchor="middle">{label}</text></g>;
}
