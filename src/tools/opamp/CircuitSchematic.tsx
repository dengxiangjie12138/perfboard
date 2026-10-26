import type { ReactNode } from 'react';
import { engineeringText as eng, numberText as f, type OpAmpDraft, type OpAmpResult } from './algorithm';
import { parameterLabel, type CircuitId, type ParameterKey, type ResistanceKey } from './metadata';
import { BasicSchematic } from './BasicSchematic';
import { InstrumentationSchematic } from './InstrumentationSchematic';
import { DynamicSchematic } from './DynamicSchematic';
interface Props {
  id: CircuitId; draft: OpAmpDraft; selected: string | null; onSelect: (key: ParameterKey) => void;
  onEdit: (key: ParameterKey, anchor: Element) => void; errors?: Partial<Record<ParameterKey, string>>; result?: OpAmpResult;
}
export function CircuitSchematic({ id, draft, selected, onSelect, onEdit, errors = {}, result }: Props) {
  const props = { id, draft, selected, onSelect, onEdit, errors, result };
  if (id === 'ina2' || id === 'ina3') return <InstrumentationSchematic {...props} />;
  if (id === 'integrator' || id === 'differentiator') return <DynamicSchematic {...props} />;
  if (id !== 'noninv' && id !== 'diff') return <BasicSchematic {...props} />;
  const v = (key: ParameterKey) => draft.values[key].trim() && Number.isFinite(Number(draft.values[key])) ? f(Number(draft.values[key])) + ' V' : '—';
  function editable(key: ParameterKey, value: string, x: number, y: number, width: number, height: number, children: ReactNode) {
    const meta = parameterLabel(id, key);
    return <g className={'opamp-editable' + (selected === key ? ' selected' : '') + (errors[key] ? ' invalid' : '')} data-parameter={key} tabIndex={0} role="button" aria-pressed={selected === key} aria-label={`编辑 ${meta.symbol}，${value}`} onClick={() => onSelect(key)} onDoubleClick={event => onEdit(key, event.currentTarget)} onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(key, event.currentTarget); }
    }}><title>{meta.symbol} {meta.label}：{value}，双击或按 Enter 编辑{errors[key] ? `。${errors[key]}` : ''}</title><rect className="opamp-hit" x={x} y={y} width={width} height={height} rx={6} />{children}</g>;
  }
  const resistor = (key: ResistanceKey, x: number, y: number, vertical = false) => {
    const raw = draft.values[key], n = raw.trim() === '' ? NaN : Number(raw) * draft.units[key];
    const value = Number.isFinite(n) && n > 0 ? eng(n) : '—';
    return editable(key, value, x - 10, y - (vertical ? 12 : 45), vertical ? 126 : 84, vertical ? 75 : 62,
      vertical ? <><path d={`M${x + 30} ${y - 8}v12m-8 0h16v34h-16z m8 34v12`} /><text className="opamp-sch-number" x={x + 47} y={y + 15}>{key.toUpperCase()}</text><text x={x + 47} y={y + 33}>{value}</text></> : <><path d={`M${x} ${y}h12m0 -8h40v16h-40z m40 8h12`} /><text className="opamp-sch-number" x={x + 32} y={y - 34} textAnchor="middle">{key.toUpperCase()}</text><text x={x + 32} y={y - 18} textAnchor="middle">{value}</text></>);
  };
  const supply = (key: 'vcc' | 'vee', x: number, y: number) => editable(key, v(key), x - 7, y - 16, 99, 40, <><text className="opamp-signal" x={x} y={y}>{key === 'vcc' ? 'Vcc' : 'Vee'}</text><text x={x} y={y + 17}>{v(key)}</text></>);
  const signal = (key: ParameterKey, symbol: string, x: number, labelY: number, valueY: number) => editable(key, v(key), x - 8, labelY - 17, 90, valueY - labelY + 29,
    <><text className="opamp-signal" x={x} y={labelY}>{symbol}</text><text x={x} y={valueY}>{v(key)}</text></>);
  const output = result ? f(result.output) + ' V' : '—';
  return <svg className="opamp-schematic" viewBox="0 0 640 410" aria-label={`${id === 'noninv' ? '同相' : '差分'}放大电路，双击器件、输入、基准或供电数值编辑`}><g transform="translate(0 55)">
    {id === 'noninv' ? <>
      <path d="M90 143H280 M238 191H280 M238 191V73H325 M389 73H473V167H430 M430 167H561 M238 191v32 M238 275v12" />
      <polygon className="opamp-symbol" points="280,117 280,217 374,167" /><path d="M374 167H430 M327 142v-34 M327 191v35" />
      <text x="290" y="148">+</text><text x="290" y="196">−</text>{supply('vcc', 340, 110)}{supply('vee', 340, 226)}<text x="399" y="278" textAnchor="middle">U1 · OPA171</text>
      {resistor('r1', 325, 73)}{resistor('r2', 208, 231, true)}<path d="M238 287v9m-12 0h24m-18 5h12m-9 5h6" />
      <circle className="opamp-node" cx="238" cy="191" r="3.5" /><circle className="opamp-node" cx="473" cy="167" r="3.5" />
      <circle cx="90" cy="143" r="4" /><circle cx="561" cy="167" r="4" />
      {signal('vin', 'Vin', 68, 117, 171)}<text className="opamp-signal" x="524" y="140">Vout</text><text x="524" y="197">{output}</text>
    </> : <>
      <path d="M56 144H119 M183 144H281 M234 144V65H325 M389 65H479V169 M430 169H578 M56 194H119 M183 194H281 M235 194v31 M235 277v17" />
      <polygon className="opamp-symbol" points="281,119 281,219 375,169" /><path d="M375 169H430 M328 144v-35 M328 194v32" />
      <text x="291" y="150">−</text><text x="291" y="200">+</text>{supply('vcc', 341, 111)}{supply('vee', 341, 230)}<text x="405" y="278" textAnchor="middle">U1 · TLV6001</text>
      {resistor('r1', 119, 144)}{resistor('r3', 325, 65)}{resistor('r2', 119, 194)}{resistor('r4', 205, 233, true)}
      <circle className="opamp-node" cx="234" cy="144" r="3.5" /><circle className="opamp-node" cx="235" cy="194" r="3.5" /><circle className="opamp-node" cx="479" cy="169" r="3.5" />
      <circle cx="56" cy="144" r="4" /><circle cx="56" cy="194" r="4" /><circle cx="578" cy="169" r="4" /><circle cx="235" cy="294" r="4" />
      {signal('vi1', 'Vi1', 26, 118, 166)}{signal('vi2', 'Vi2', 26, 219, 239)}
      {editable('vref', v('vref'), 175, 302, 125, 33, <><text className="opamp-signal" x="183" y="322">Vref</text><text x="231" y="322">{v('vref')}</text></>)}<text className="opamp-signal" x="534" y="141">Vout</text><text x="534" y="197">{output}</text>
    </>}
  </g></svg>;
}
