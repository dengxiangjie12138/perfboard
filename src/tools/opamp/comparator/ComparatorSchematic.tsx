import { capacitanceText, numberText as f } from '../algorithm';
import { amplifier, node, schematicParts, type SchematicProps } from '../SchematicParts';

export function ComparatorSchematic(props: SchematicProps) {
  const { id, draft, result } = props, r = result?.comparator;
  const { resistor: R, signal: S, supply, editable } = schematicParts(props);
  const label = (value: string, x: number, y: number) => <text x={x} y={y}>{value}</text>;
  const rail = (x: number, y: number) => <>{node(x,y)}{label('Vee',x-12,y+22)}</>;
  const out = (x: number, y: number) => <><circle cx={x} cy={y} r="4" /><text className="opamp-signal" x={x-12} y={y-23}>Vout</text><text x={x-12} y={y+26}>{r?.oscillator ? '周期方波' : r?.boundary ? '临界 · 未定' : r ? `${f(r.output)} V` : '—'}</text></>;
  const power = (veeY=330) => <><path d={`M460 230v-52 M460 270V${veeY-6}`} />{supply('vcc',472,174)}{supply('vee',472,veeY)}</>;
  const pullup = (key: 'r3'|'r4', x=650) => <><path d={`M${x+30} 128v14m0 60v48`} />{S('vpu','Vpu',x+10,88,109)}{R(key,x,150,true)}</>;
  let drawing;
  if (id === 'comparator' || id === 'schmitt-inv') {
    const feedback = id === 'schmitt-inv' || draft.values.hysteresis === '1';
    drawing = <>
      {amplifier(420,250,`U1 · ${id==='comparator'?'TLV3201':'TLV7041'}`,true,334,590)}{power()}
      <path d="M80 230H420 M300 205v97 M300 270h120 M300 362v22 M300 126v16 M500 420H400V270" />
      <path className={feedback?'':'opamp-optional'} d="M564 420H680V250 M300 270h100" />
      <path d="M500 250h240" />{node(300,270)}{node(680,250)}
      {S('vin','Vin',44,177,199)}<circle cx="80" cy="230" r="4" />
      {S('vref','Vref',276,88,109)}{R('r1',270,150,true)}{R('r2',270,310,true)}{rail(300,384)}
      <g className={feedback?'':'opamp-disconnected'}>{R(id==='comparator'?'r3':'r4',500,420)}</g>
      {!feedback && label('R3 已断开',487,457)}{id==='schmitt-inv' && pullup('r3')}{out(740,250)}
    </>;
  } else if (id === 'schmitt-noninv') {
    drawing = <>
      {amplifier(420,250,'U1 · TLV7041',true,450,655)}{power()}{pullup('r3')}
      <path d="M250 126v16m0 60v60m0 60v62 M250 230h170 M80 360h50 M194 360h48q8-12 16 0h82V270h80 M340 360v40h250 M654 400h26V250 M500 250h240" />
      {S('vref','Vref',226,88,109)}{R('r4',220,150,true)}{R('r5',220,270,true)}{rail(250,384)}{node(250,230)}
      {S('vin','Vin',45,405,427)}<circle cx="80" cy="360" r="4" />{R('r1',130,360)}{R('r2',590,400)}{node(340,360)}{node(680,250)}{out(740,250)}
    </>;
  } else if (id === 'window') {
    drawing = <>
      {amplifier(450,220,'U2 · TLV1702',false,174,563)}{amplifier(450,380,'U1 · TLV1702',false,337,563)}
      <path d="M230 124v18m0 60v65m0 60v45m0 60v20 M230 240H365V200h85 M230 350h130v50h90 M350 300h60v-60h40 M410 300v60h40 M530 220h150v160H530 M680 300h60 M680 202v18 M680 128v14" />
      {supply('vcc',170,88)}{supply('vee',400,88)}{label('两比较器共用 Vcc / Vee',375,130)}
      {R('r3',200,150,true)}{R('r2',200,275,true)}{R('r1',200,380,true)}{rail(230,452)}{node(230,240)}{node(230,350)}{label('VH',260,228)}{label('VL',260,343)}
      {S('vin','Vin',350,276,324)}<circle cx="350" cy="300" r="4" />{node(410,300)}{node(680,300)}
      {S('vpu','Vpu',660,88,109)}{R('r4',650,150,true)}{out(740,300)}{label('开集输出共接',590,428)}
      <path d="M490 200v-20m0 60v25m0 95v-15m0 55v25" />{label('Vcc',492,181)}{label('Vee',492,280)}{label('Vcc',492,347)}{label('Vee',492,440)}
    </>;
  } else if (id === 'overvoltage' || id === 'undervoltage') {
    const under = id === 'undervoltage';
    drawing = <>
      {amplifier(420,250,under?'U1 · TLV4021R1':'U1 · TLV1805',false,335,590)}
      <path d="M110 140h140v32m0 60v60m0 60v32 M250 255h100v-25h70 M250 140h210v90 M460 270v54 M500 250h240" />
      {S('vcc',under?'VBAT = Vcc':'SUPPLY = Vcc',58,88,109)}<circle cx="110" cy="140" r="4" />{R('r1',220,180,true)}{R('r2',220,300,true)}{rail(250,384)}{node(250,255)}{supply('vee',472,330)}
      {under ? <>
        {pullup('r3')}<path d="M420 270h-30v105" /><rect className="opamp-symbol" x="327" y="375" width="245" height="78" rx="5" />
        {S('vitLow','VIT−',340,402,428)}{S('vitHigh','VIT+',463,402,428)}{label('内部参考 / 迟滞',327,474)}
      </> : <><path d="M350 365v-95h70" />{S('vref','Vref · Z1',315,410,434)}{label('理想基准',315,386)}{label('检测级输出 → 保护控制',507,411)}</>}
      {out(740,250)}
    </>;
  } else if (id === 'zero-cross') {
    drawing = <>
      {amplifier(420,250,'U1 · TLV7011',false,335,590)}{power()}
      <path d="M65 230h65 M194 230h226 M300 230v42m0 60v43h100V270h20 M370 230v62m0 48v35 M500 250h240" />
      {S('vin','Vin,DC',32,158,180)}<circle cx="65" cy="230" r="4" />{R('r1',130,230)}{R('r2',270,280,true)}{node(300,230)}{node(370,230)}{rail(300,375)}
      <path d="M358 294h24 M358 318l12-24 12 24z M370 318v22" />{label('D1',387,314)}
      {S('amplitude','Vp',65,419,441)}{S('frequency','f',220,419,441,'Hz')}{S('diodeDrop','D1 · VF',372,419,441)}{out(740,250)}
      {label('分压 + 负向钳位',65,478)}
    </>;
  } else {
    const cap = Number(draft.values.c1) * draft.units.c1;
    drawing = <>
      {amplifier(420,250,'U1 · TLV3201',true,335,590)}
      <path d="M250 126v16m0 60v90m0 60v32 M250 270h170 M500 250h240 M130 230h112q8-12 16 0h162 M130 230v65m0 37v52 M130 230H80V500h420 M564 500h116V250 M460 230v-52m0 92v54" />
      {supply('vcc',260,88)}{label('Vcc',472,174)}{supply('vee',472,330)}{R('r2',220,150,true)}{R('r3',220,300,true)}{rail(250,384)}
      <path d="M250 270h150v130h100 M564 400h116" />{R('r4',500,400)}{R('r1',500,500)}
      {editable('c1',capacitanceText(cap),75,290,118,65,<><path d="M117 304h26m-26 13h26 M130 295v9m0 13v15" /><text className="opamp-sch-number" x="150" y="305">C1</text><text x="150" y="326">{capacitanceText(cap)}</text></>)}
      {rail(130,384)}{node(130,230)}{node(250,270)}{node(680,250)}{out(740,250)}{label('Vc',137,213)}
    </>;
  }
  return <svg className="opamp-schematic opamp-comparator-schematic" viewBox={`0 60 820 ${id==='relaxation'?500:445}`} aria-label="比较器电路，双击器件、输入、基准或供电数值编辑">{drawing}</svg>;
}
