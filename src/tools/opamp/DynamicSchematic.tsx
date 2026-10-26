import { numberText as f } from './algorithm';
import { circuitDefinition } from './metadata';
import { amplifier, node, schematicParts, type SchematicProps } from './SchematicParts';
export function DynamicSchematic(props: SchematicProps) {
  const { id, result } = props, c = circuitDefinition(id), { resistor, capacitor, signal, supply } = schematicParts(props), integral = id === 'integrator';
  return <svg className="opamp-schematic opamp-schematic-dynamic" viewBox="0 0 760 495" aria-label={`${c.title}，双击电阻、电容、信号、频率、基准或供电编辑`}>
    {amplifier(370,280,'U1 · ' + c.chip,true,385,545)}<path d="M450 280H665 M410 260V225 M410 300v35 M370 300H330V392" />
    {supply('vcc',428,221)}{supply('vee',428,350)}{signal('vref','Vref',300,412,434)}
    {integral ? <><path d="M60 260H180 M244 260H370 M300 260V130H390 M454 130H550V280 M300 185H390 M454 185H550" />{resistor('r1',180,260)}{resistor('r2',390,130)}{capacitor('c1',390,185)}{node(300,185)}{node(550,185)}</> : <>
      <path d="M60 260H125 M189 260H220 M284 260H370 M310 260V165H390 M454 165H550V280 M310 165V110H390 M454 110H550V165" />
      {capacitor('c1',125,260)}{resistor('r1',220,260)}{resistor('r2',390,165)}{capacitor('cf',390,110)}{node(310,165)}{node(550,165)}
    </>}
    {signal('vin','Vin,DC',25,230,293)}{signal('amplitude','Vp',35,385,406)}{signal('frequency','f',140,385,406,'Hz')}{node(integral ? 300 : 310,260)}{node(550,280)}
    <circle cx="60" cy="260" r="4" /><circle cx="330" cy="392" r="4" /><circle cx="665" cy="280" r="4" />
    <text className="opamp-signal" x="590" y="251">Vout</text><text x="590" y="311">{result?.dynamic ? `${f(result.output)} V ± ${f(result.dynamic.outputAmplitude)} V` : '—'}</text>
    <text x="35" y="463">Vin(t) = Vin,DC + Vp × sin(2πft) · 显示正弦稳态</text>
  </svg>;
}
