import { number as f, resistance } from '../shared/units';
import { Ground, SchematicResistor } from '../shared/hardware';

export function Tl431Schematic({ supplyV, supplyOhms, r1, r2 }: { supplyV?: number; supplyOhms?: number; r1?: number; r2?: number }) {
  return <svg className="hw-schematic" viewBox="0 0 520 330" role="img" aria-label="TL431三端符号：阴极K接输出，阳极A接地，REF水平直连R1与R2中点">
    <path d="M220 30 V51 M220 99 V120 H465 M220 120 V180 M220 220 V300 M365 120 V140 M365 188 V224 M365 272 V300 H220 M365 200 H230" />
    <SchematicResistor x={220} y={75} label="Rs" value={supplyOhms === undefined ? undefined : resistance(supplyOhms)} />
    <SchematicResistor x={365} y={164} label="R1" value={r1 === undefined ? undefined : resistance(r1)} />
    <SchematicResistor x={365} y={248} label="R2" value={r2 === undefined ? undefined : resistance(r2)} />
    <g aria-label="TL431可调并联稳压器符号">
      <path d="M200 172 V180 H240 V188" />
      <path d="M220 180 L200 220 H240 Z" style={{ fill: 'currentColor' }} />
    </g>
    <Ground x={220} y={310} />
    <circle className="hw-node" cx="220" cy="120" r="4" /><circle className="hw-node" cx="365" cy="200" r="3" /><circle className="hw-node" cx="220" cy="300" r="3" />
    <text x="235" y="30">Vin · {supplyV === undefined ? '—' : f(supplyV)} V</text><text x="400" y="107">Vo / K</text>
    <text x="124" y="210">TL431</text><text x="196" y="160">K</text><text x="281" y="190">REF</text><text x="234" y="265">A</text>
  </svg>;
}
