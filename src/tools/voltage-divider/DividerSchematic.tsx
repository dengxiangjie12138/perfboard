import { number, resistance } from '../shared/units';
import { dividerCurrent, type DividerParameter, type DividerResult } from './algorithm';

export function DividerSchematic({ result, solveFor = 'midpoint' }: { result?: DividerResult; solveFor?: DividerParameter }) {
  return <svg className="calc-schematic divider-schematic" viewBox="0 0 500 300" role="img" aria-label="分压电路：Vin 经上电阻 R1 到中点 Vmid，下电阻 R2 从中点接地，电流 I 流过 R1 和 R2">
    <path d="M200 36 V70 M200 116 V170 M200 216 V258 M184 258 H216 M189 265 H211 M195 272 H205 M200 143 H382 M125 62 V218 M119 209 L125 218 L131 209" />
    <rect x="188" y="70" width="24" height="46" /><rect x="188" y="170" width="24" height="46" />
    <circle cx="200" cy="36" r="3" /><circle cx="200" cy="143" r="4" /><circle cx="382" cy="143" r="3" />
    <text x="218" y="38" className={solveFor === 'supply' ? 'divider-computed-label' : undefined}>Vin{result ? ` · ${number(result.supplyV)} V` : ''}</text>
    <text x="231" y="88">R1 · 上电阻</text><text x="231" y="108" className={solveFor === 'upper' ? 'divider-computed-label' : undefined}>{result ? resistance(result.upperOhms) : '—'}</text>
    <text x="231" y="190">R2 · 下电阻</text><text x="231" y="210" className={solveFor === 'lower' ? 'divider-computed-label' : undefined}>{result ? resistance(result.lowerOhms) : '—'}</text>
    <text x="330" y="126" className={solveFor === 'midpoint' ? 'divider-computed-label' : undefined}>Vmid{result ? ` · ${number(result.midpointV)} V` : ''}</text>
    <text x="218" y="265">GND · 0 V</text><text x="22" y="132">I</text><text x="22" y="154">{result ? dividerCurrent(result.currentA) : '—'}</text>
  </svg>;
}
