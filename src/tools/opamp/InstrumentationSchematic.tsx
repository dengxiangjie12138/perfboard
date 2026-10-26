import { numberText as f } from './algorithm';
import { circuitDefinition } from './metadata';
import { amplifier, node, schematicParts, type SchematicProps } from './SchematicParts';
export function InstrumentationSchematic(props: SchematicProps) {
  const { id, result } = props, c = circuitDefinition(id), { resistor, signal, supply } = schematicParts(props), three = id === 'ina3';
  return <svg className="opamp-schematic opamp-schematic-ina" viewBox={three ? '0 0 940 620' : '0 0 880 510'} aria-label={`${c.title}，双击电阻、输入、基准或共用供电编辑`}>
    {three ? <>
      {amplifier(230,220,'U3 · TLV171',false,140)}{amplifier(230,420,'U2 · TLV171',true,510)}{amplifier(670,320,'U1 · TLV171',true,470)}
      <path d="M60 200H230 M60 440H230 M230 240H180V285 M180 347V400H230 M180 240V290H260 M324 290H360V220H310 M180 400V350H260 M324 350H360V420H310 M310 220H420 M484 220H690 M754 220H820V320 M580 220V300H670 M310 420H420 M484 420H690 M754 420H820 M580 420V340H670 M750 320H880" />
      {resistor('r6',260,290)}{resistor('r5',260,350)}{resistor('r10',150,293,true)}{resistor('r1',420,220)}{resistor('r2',690,220)}{resistor('r3',420,420)}{resistor('r4',690,420)}
      {signal('vi1','Vi1',30,172,228)}{signal('vi2','Vi2',30,413,469)}{signal('vref','Vref',800,451,472)}
      {node(180,240)}{node(180,400)}{node(360,220)}{node(360,420)}{node(580,220)}{node(580,420)}{node(820,320)}
      <text x="354" y="184">Va {result ? f(result.internalOutputs[0]?.value ?? 0) + ' V' : '—'}</text><text x="354" y="461">Vb {result ? f(result.internalOutputs[1]?.value ?? 0) + ' V' : '—'}</text>
      <path d="M270 200v-33 M270 240v28 M270 400v-30 M270 440v30 M710 300v-34 M710 340v30" />
      <text x="282" y="176">Vcc</text><text x="329" y="268">Vee</text><text x="281" y="382">Vcc</text><text x="281" y="481">Vee</text><text x="725" y="272">Vcc</text><text x="725" y="374">Vee</text>
      {supply('vcc',585,518)}{supply('vee',725,518)}<text x="585" y="572">三颗运放共用供电，双击电源数值修改</text>
      <text className="opamp-signal" x="848" y="292">Vout</text><text x="848" y="353">{result ? f(result.output) + ' V' : '—'}</text>
    </> : <>
      {amplifier(240,310,'U2 · TLV171',true,430)}{amplifier(630,310,'U1 · TLV171',true,445)}
      <path d="M35 290H85 M149 290H240 M180 290V200H220 M284 200H360V310H320 M180 290V120H390 M454 120H550V290H630 M320 310H440 M504 310H550V290 M550 290V200H630 M694 200H760V310 M710 310H820 M180 390V330H240 M550 390V330H630" />
      {resistor('r4',85,290)}{resistor('r3',220,200)}{resistor('rg',390,120)}{resistor('r1',440,310)}{resistor('r2',630,200)}
      {signal('vref','Vref',18,332,352)}{signal('vi1','Vi1',145,422,443)}{signal('vi2','Vi2',517,422,443)}
      {node(180,290)}{node(360,310)}{node(550,290)}{node(760,310)}
      <text x="355" y="354">Va {result ? f(result.internalOutputs[0]?.value ?? 0) + ' V' : '—'}</text>
      <path d="M280 290v-35 M280 330v35 M670 290v-35 M670 330v35" /><text x="290" y="258">Vcc</text><text x="290" y="383">Vee</text>
      {supply('vcc',684,255)}{supply('vee',684,384)}<text x="425" y="482">两颗运放共用供电</text>
      <text className="opamp-signal" x="786" y="282">Vout</text><text x="786" y="342">{result ? f(result.output) + ' V' : '—'}</text>
    </>}
  </svg>;
}
