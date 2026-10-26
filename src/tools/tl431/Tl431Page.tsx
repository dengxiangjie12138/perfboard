import { NumberField, ErrorMessage } from '../shared/components';
import { parseNumericInput as n } from '../shared/numeric';
import { number as f, resistance } from '../shared/units';
import { HardwareLayout, PassiveField, Metrics, HardwareReference, useHardwareDraft, passiveValue, resistor, currentText, powerText } from '../shared/hardware';
import { Equation, frac, row, sym, op, paren, text } from '../shared/math';
import { calculateTl431 } from './algorithm';
import { Tl431Schematic } from './Tl431Schematic';
const initial = { mode: 'voltage' as 'voltage' | 'r1', r1: resistor('10'), r2: resistor('10'), target: '5', vref: '2.495', iref: '2', supply: '12', supplyR: resistor('1'), load: '0' };
export function Tl431Page() {
  const { draft: d, update, reset } = useHardwareDraft('tl431', initial);
  const p = { mode: d.mode, r1: passiveValue(d.r1), r2: passiveValue(d.r2), target: n(d.target), vref: n(d.vref), irefA: n(d.iref) * 1e-6, supplyV: n(d.supply), supplyOhms: passiveValue(d.supplyR), loadA: n(d.load) * 1e-3 }, result = calculateTl431(p), r = result.ok ? result.value : undefined;
  return <HardwareLayout title="TL431 基准电压计算" description="按分压电阻计算稳压设定值，或由目标电压反算上电阻，并检查阴极偏置电流。" onReset={reset} parameters={<>
    <label className="calc-field"><span>计算方式</span><select aria-label="TL431计算方式" value={d.mode} onChange={e => update({ mode: e.target.value as typeof d.mode })}><option value="voltage">已知电阻，计算输出电压</option><option value="r1">目标电压，反算 R1</option></select></label>
    {d.mode === 'voltage' ? <PassiveField label="上电阻 R1 · K 到 REF" value={d.r1} onChange={r1 => update({ r1 })} /> : <NumberField label="目标输出电压" value={d.target} onChange={target => update({ target })} unit="V" />}
    <PassiveField label="下电阻 R2 · REF 到 A" value={d.r2} onChange={r2 => update({ r2 })} /><NumberField label="内部基准 Vref" value={d.vref} onChange={vref => update({ vref })} unit="V" />
    <details className="hw-details"><summary>REF 电流与供电校核</summary><NumberField label="REF 输入电流 Iref" value={d.iref} onChange={iref => update({ iref })} unit="µA" help="流入 REF 为正；2 µA 为典型值。填 0 查看忽略偏置电流的理想公式。" /><NumberField label="供电电压 Vin" value={d.supply} onChange={supply => update({ supply })} unit="V" /><PassiveField label="供电限流电阻 Rs" value={d.supplyR} onChange={supplyR => update({ supplyR })} /><NumberField label="输出负载电流 IL" value={d.load} onChange={load => update({ load })} unit="mA" /></details>
  </>} references={<><HardwareReference tool="tl431" href="https://www.ti.com.cn/cn/lit/gpn/TL431">TL431 官方中文规格书</HardwareReference><HardwareReference tool="tl431" href="https://www.ti.com.cn/product/cn/TL431">TI 中文产品资料页</HardwareReference></>} equations={<>
    <Equation label="Vo = Vref × (1 + R1/R2) + Iref × R1" substitution={r ? `${f(p.vref)} V × (1 + ${resistance(r.r1)} / ${resistance(p.r2)}) + ${currentText(p.irefA)} × ${resistance(r.r1)} = ${f(r.outputV)} V` : undefined}>{row(sym('V', 'o'), op('='), sym('V', 'ref'), op('×'), paren(text('1'), op('+'), frac(sym('R', '1'), sym('R', '2'))), op('+'), sym('I', 'ref'), op('×'), sym('R', '1'))}</Equation>
    <Equation label="R1 = (Vtarget − Vref) / (Vref/R2 + Iref)" substitution={d.mode === 'r1' && r ? `目标 ${f(p.target)} V，反算 R1 = ${resistance(r.r1)}` : undefined}>{row(sym('R', '1'), op('='), frac(row(sym('V', 'target'), op('−'), sym('V', 'ref')), row(frac(sym('V', 'ref'), sym('R', '2')), op('+'), sym('I', 'ref'))))}</Equation>
    <Equation label="Ik = (Vin − Vo)/Rs − IL − (Vref/R2 + Iref)" substitution={r ? `供电支路 ${currentText(r.supplyCurrent)} − 负载 ${currentText(p.loadA)} − 分压上臂 ${currentText(r.upperCurrent)} = ${currentText(r.cathodeCurrent)}` : undefined}>{row(sym('I', 'K'), op('='), frac(row(sym('V', 'in'), op('−'), sym('V', 'o')), sym('R', 's')), op('−'), sym('I', 'L'), op('−'), paren(frac(sym('V', 'ref'), sym('R', '2')), op('+'), sym('I', 'ref')))}</Equation>
  </>} note="输出按 REF 节点 KCL 估算，忽略动态阻抗、温漂和电阻容差；Iref=0 为常见理想简式。供电校核按通用 TL431 保守取 Ik≥1 mA、Ik≤100 mA、Vo≤36 V。电流不足时只显示理论设定值，不能当作实际稳压输出；功耗还需按所选封装降额核对，未计算环路或容性负载稳定性。">
    {!result.ok && <ErrorMessage text={result.error} />}{r && <><Metrics items={[{ label: '理论设定电压 Vo', value: `${f(r.outputV)} V`, id: 'tl431-output' }, { label: '上电阻 R1', value: resistance(r.r1), id: 'tl431-r1' }, { label: '可用阴极电流 Ik', value: currentText(r.cathodeCurrent), id: 'tl431-ik' }, { label: '阴极功耗（满足偏置时）', value: r.cathodePower === null ? '—' : powerText(r.cathodePower) }]} /><p className="hw-notice" id="tl431-bias">{r.regulated ? '偏置电流与工作电压范围满足当前静态校核。' : `当前不能保证稳压：${r.issues.join('；')}。上方 Vo 仅为理论设定值。`}</p></>}
    <Tl431Schematic supplyV={result.ok ? p.supplyV : undefined} supplyOhms={result.ok ? p.supplyOhms : undefined} r1={r?.r1} r2={result.ok ? p.r2 : undefined} />
    {r?.maxSupplyOhms !== null && r?.maxSupplyOhms !== undefined && <p className="hw-muted">在当前 Vin 与负载下，Rs 不大于约 {resistance(r.maxSupplyOhms)}，才能留出 1 mA 阴极电流；还需同时检查最大电流与功耗。</p>}
  </HardwareLayout>;
}
