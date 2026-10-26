import { numberText } from './algorithm';
import { circuitDefinition } from './metadata';
import { amplifier, ground, node, schematicParts, type SchematicProps } from './SchematicParts';
export function BasicSchematic(props: SchematicProps) {
  const { id, result } = props, c = circuitDefinition(id), { resistor, signal, supply } = schematicParts(props), follower = id === 'follower', sum = id === 'sum';
  return <svg className="opamp-schematic opamp-schematic-basic" viewBox="0 0 760 465" aria-label={`${c.title}，双击器件、输入或供电数值编辑`}>
    {amplifier(370,260,'U1 · ' + c.chip,true,400,535)}<path d="M450 260H660 M410 240V205 M410 280v57" />{supply('vcc',427,201)}{supply('vee',427,352)}
    {follower ? <><path d="M70 280H370 M370 240H300V150H550V260" />{signal('vin','Vin',45,254,311)}</> : <>
      <path d="M70 240H180 M244 240H370 M300 240V150H390 M454 150H550V260 M370 280H335V330" />{ground(335,330)}
      {resistor('r1',180,240)}{resistor(sum ? 'r3' : 'r2',390,150)}{signal(sum ? 'vi1' : 'vin',sum ? 'Vi1' : 'Vin',45,212,269)}{node(300,240)}
      {sum && <><path d="M70 365H180 M244 365H300V240" />{resistor('r2',180,365)}{signal('vi2','Vi2',45,338,393)}{node(300,365)}</>}
    </>}{node(550,260)}<circle cx="70" cy={follower ? 280 : 240} r="4" />{sum && <circle cx="70" cy="365" r="4" />}<circle cx="660" cy="260" r="4" />
    <text className="opamp-signal" x="623" y="233">Vout</text><text x="623" y="291">{result ? numberText(result.output) + ' V' : '—'}</text>
  </svg>;
}
