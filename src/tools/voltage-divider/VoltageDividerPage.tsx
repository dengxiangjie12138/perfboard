import { useViewMemory } from '../../services/useViewMemory';
import { Heading, NumberField, ErrorMessage } from '../shared/components';
import { number } from '../shared/units';
import { calculateDivider, DIVIDER_EXAMPLE, dividerCurrent, type DividerInput, type ResistanceUnit } from './algorithm';
import { DividerSchematic } from './DividerSchematic';
import { DividerEquations } from './DividerEquations';
import '../shared/calculators.css';
import './voltage-divider.css';

export function VoltageDividerPage() {
  const [input, setInput] = useViewMemory('voltage-divider', () => ({ ...DIVIDER_EXAMPLE }));
  const result = calculateDivider(input), value = result.ok ? result.value : undefined;
  function change(patch: Partial<DividerInput>) { setInput(previous => ({ ...previous, ...patch })); }
  function reset() { setInput({ ...DIVIDER_EXAMPLE }); }
  return <div className="calculations-page divider-page">
    <Heading eyebrow="VOLTAGE DIVIDER" title="分压计算器" description="输入供电电压和上下电阻，计算中点电压与分压支路电流。" />
    <div className="divider-layout">
      <section className="card calc-card divider-input-card" aria-label="分压输入参数">
        <div className="calc-card-title"><h2>输入参数</h2><span className="tag">实时计算</span></div>
        <div>
          <NumberField label="供电电压 Vin" value={input.supply} onChange={supply => change({ supply })} unit="V" />
          {(['upper', 'lower'] as const).map(key => { const name = key === 'upper' ? '上电阻 R1' : '下电阻 R2', unitKey = `${key}Unit` as const; return <fieldset className="divider-resistor" key={key}>
            <legend>{name}</legend><div><input type="number" step="any" min="0" aria-label={`${name} 阻值`} value={input[key]} onChange={event => change({ [key]: event.target.value })} /><select aria-label={`${name} 单位`} value={input[unitKey]} onChange={event => change({ [unitKey]: event.target.value as ResistanceUnit })}><option>Ω</option><option>kΩ</option><option>MΩ</option></select></div>
          </fieldset>; })}
          <div className="divider-actions"><button type="button" onClick={reset}>恢复示例</button></div>
        </div>
        <p className="calc-note">修改数值或单位后立即更新结果。本窗口记住输入，切换工具或重新打开后恢复。</p>
      </section>
      <section className="card calc-card" aria-label="分压电路与结果">
        <div className="calc-card-title"><h2>电路与结果</h2><span className="tag">中点空载</span></div>
        <div className="divider-results" aria-live="polite">
          {value ? <dl><div><dt>中点电压 Vmid</dt><dd id="divider-midpoint">{number(value.midpointV)} <small>V</small></dd></div><div><dt>串联电流 I</dt><dd id="divider-current">{dividerCurrent(value.currentA)}</dd></div></dl> : !result.ok && <ErrorMessage text={result.error} />}
        </div>
        <DividerSchematic result={value} />
        <p className="calc-note divider-topology-note">R1 接 Vin 与中点，R2 接中点与 GND。中点无外接负载时，两颗电阻流过相同电流。</p>
      </section>
    </div>
    <section className="card calc-card divider-calculation" aria-label="分压计算过程"><div className="calc-card-title"><h2>计算过程</h2></div><DividerEquations result={value} /><p className="calc-reference">理想直流、无负载分压；未计电阻容差。中点连接负载后，需要将负载对下电阻的并联影响计入计算。</p></section>
  </div>;
}
