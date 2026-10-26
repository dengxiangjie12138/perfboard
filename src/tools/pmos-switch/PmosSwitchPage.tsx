import { NumberField, ErrorMessage } from '../shared/components';
import { parseNumericInput as n } from '../shared/numeric';
import { number as f, resistance } from '../shared/units';
import { HardwareLayout, Metrics, HardwareReference, Ground, SchematicResistor, useHardwareDraft, powerText } from '../shared/hardware';
import { Equation, frac, row, sym, op } from '../shared/math';
import { calculatePmos } from './algorithm';
const initial = { vin: '12', vsg: '5', current: '500', maxVgs: '20' };
export function PmosSwitchPage() {
  const { draft: d, update, reset } = useHardwareDraft('pmos-switch', initial), p = { vin: n(d.vin), vsg: n(d.vsg), currentA: n(d.current) * 1e-6, maxVgs: n(d.maxVgs) }, result = calculatePmos(p), r = result.ok ? result.value : undefined;
  return <HardwareLayout title="PMOS 开关电阻计算" description="按源极上拉 R1 与下拉支路 R2，反算目标栅源电压所需的两个电阻。" onReset={reset} parameters={<>
    <NumberField label="输入电压 Vin" value={d.vin} onChange={vin => update({ vin })} unit="V" /><NumberField label="目标开启电压 |VGS|" value={d.vsg} onChange={vsg => update({ vsg })} unit="V" help="使用满足目标负载下 RDS(on) 的驱动电压；VGS(th) 仅表示开始导通，不能保证充分开启。" /><NumberField label="开启时分压支路电流 Idiv" value={d.current} onChange={current => update({ current })} unit="µA" help="对应截图 Iopen；这是 R1/R2 电流，不是 MOS 负载电流或持续栅极电流。" />
    <details className="hw-details"><summary>栅源额定值检查</summary><NumberField label="|VGS| 绝对最大额定值" value={d.maxVgs} onChange={maxVgs => update({ maxVgs })} unit="V" help="示例 20 V；必须按实际 PMOS 规格书修改。" /></details>
  </>} references={<HardwareReference tool="pmos-switch" href="https://www.ti.com.cn/cn/lit/pdf/ZHCAEO9">TI 中文 MOSFET 选型与栅极驱动说明</HardwareReference>} equations={<>
    <Equation label="R1 = |VGS| / Idiv" substitution={r ? `${f(p.vsg)} V / ${f(p.currentA * 1e6)} µA = ${resistance(r.r1)}` : undefined}>{row(sym('R', '1'), op('='), frac(sym('V', 'SG'), sym('I', 'div')))}</Equation>
    <Equation label="R2 = (Vin − |VGS|) / Idiv" substitution={r ? `(${f(p.vin)} − ${f(p.vsg)}) V / ${f(p.currentA * 1e6)} µA = ${resistance(r.r2)}` : undefined}>{row(sym('R', '2'), op('='), frac(row(sym('V', 'in'), op('−'), sym('V', 'SG')), sym('I', 'div')))}</Equation>
    <Equation label="VGS = −Vin × R1 / (R1 + R2)" substitution={r ? `开启：Vg = ${f(r.gateV)} V，VGS = −${f(p.vsg)} V；关断：Vg ≈ Vin，VGS ≈ 0 V。` : undefined}>{row(sym('V', 'GS'), op('='), op('−'), sym('V', 'in'), op('×'), frac(sym('R', '1'), row(sym('R', '1'), op('+'), sym('R', '2'))))}</Equation>
  </>} note="按 PMOS 源极接 Vin、下拉 NMOS 导通后近似接地、栅极直流电流近似为 0 计算。结果为理论阻值，未计 MOS 栅电荷、开关速度、下拉管压降及电阻容差；只有这三个输入无法计算负载电流能力或动态栅极驱动电阻。">
    {!result.ok && <ErrorMessage text={result.error} />}{r && <Metrics items={[{ label: 'R1 · 源极到栅极', value: resistance(r.r1), id: 'pmos-r1' }, { label: 'R2 · 栅极到下拉管', value: resistance(r.r2), id: 'pmos-r2' }, { label: '开启时 VGS', value: `−${f(p.vsg)} V` }, { label: '分压静态功耗', value: powerText(r.totalPower) }]} />}
    <svg className="hw-schematic" viewBox="0 0 520 340" role="img" aria-label="PMOS源极接Vin；R1从源极接栅极，R2从栅极接下拉NMOS，NMOS源极接地"><path d="M70 45 H270 M320 45 H455 M175 45 V81 M175 129 V155 H285 M285 155 V185 M285 233 V258 M285 306 V318 M285 120 V155 M270 45 V83 M320 45 V83 M270 83 H320 M270 94 H320 M285 94 V120 M225 282 H270 M270 265 V298 M285 258 V270 M285 295 V306 M285 270 H278 M285 295 H278 M278 270 V295" /><SchematicResistor x={175} y={105} label="R1" value={r ? resistance(r.r1) : undefined} /><SchematicResistor x={285} y={209} label="R2" value={r ? resistance(r.r2) : undefined} /><circle className="hw-node" cx="175" cy="45" r="3" /><circle className="hw-node" cx="285" cy="155" r="3" /><Ground x={285} y={322} /><text x="40" y="30">Vin · {result.ok ? f(p.vin) : '—'} V</text><text x="333" y="30">Vout</text><text x="337" y="87">Qp · PMOS</text><text x="310" y="158">G · {r ? f(r.gateV) : '—'} V</text><text x="75" y="285">控制 · ON</text><text x="310" y="288">Qn · NMOS</text><text x="253" y="62">S</text><text x="325" y="62">D</text></svg>
    {r && <><p className="hw-muted">R1 功耗 {powerText(r.power1)}；R2 功耗 {powerText(r.power2)}。关断时 R1 将栅极拉回源极。</p>{r.exceedsVgs && <p className="hw-notice">目标 |VGS| 已达到或超过输入的栅源绝对额定值。应降低目标驱动电压并保留裕量，或采用适当的栅源钳位。</p>}</>}
  </HardwareLayout>;
}
