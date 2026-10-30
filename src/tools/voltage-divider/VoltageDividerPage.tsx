import { useId } from 'react';
import { useViewMemory } from '../../services/useViewMemory';
import { Heading, ErrorMessage } from '../shared/components';
import { number } from '../shared/units';
import { calculateDivider, changeDividerInput, DIVIDER_EXAMPLE, DIVIDER_LABELS, DIVIDER_PARAMETERS, dividerCurrent, dividerResultValue, restoreDividerInput, selectDividerTarget, type DividerInput, type DividerParameter, type DividerResult, type ResistanceUnit } from './algorithm';
import { DividerSchematic } from './DividerSchematic';
import { DividerEquations } from './DividerEquations';
import '../shared/calculators.css';
import './voltage-divider.css';

function valueUnit(key: DividerParameter, input: DividerInput): string {
  return key === 'upper' ? input.upperUnit : key === 'lower' ? input.lowerUnit : 'V';
}

export function DividerFields({ input, result, onChange, onSelect }: {
  input: DividerInput; result?: DividerResult; onChange: (patch: Partial<DividerInput>) => void; onSelect: (target: DividerParameter) => void;
}) {
  const group = useId();
  return <div role="radiogroup" aria-label="选择求解参数" className="divider-parameters">
    {DIVIDER_PARAMETERS.map(key => {
      const computed = input.solveFor === key, resistor = key === 'upper' || key === 'lower';
      const id = `${group}-${key}`, label = DIVIDER_LABELS[key];
      return <div className={`divider-parameter${computed ? ' divider-parameter-computed' : ''}`} key={key}>
        <div className="divider-parameter-heading"><label htmlFor={id}>{label}</label>
          <label className="divider-solve-choice"><input type="radio" name={group} value={key}
            checked={computed} aria-label={`求解${label}`} data-testid={`divider-solve-${key}`}
            onChange={event => { if (event.currentTarget.checked) onSelect(key); }} /><span>求解此项</span></label></div>
        <div className={`divider-parameter-value${resistor ? ' divider-parameter-resistor' : ''}`}>
          <input id={id} type="number" min="0" step="any" aria-label={`${label}${resistor ? ' 阻值' : ''}`}
            readOnly={computed} aria-describedby={computed ? 'divider-solve-help' : undefined}
            placeholder={computed ? '等待有效输入' : undefined} data-testid={`divider-input-${key}`}
            value={computed ? result ? number(dividerResultValue(key, result, input)) : '' : input[key]}
            onChange={event => { if (!computed) onChange({ [key]: event.currentTarget.value }); }} />
          {resistor ? <select aria-label={`${label} 单位`} value={valueUnit(key, input)}
            onChange={event => onChange({ [`${key}Unit`]: event.currentTarget.value as ResistanceUnit })}>
            <option>Ω</option><option>kΩ</option><option>MΩ</option>
          </select> : <span className="divider-voltage-unit">V</span>}
        </div>
      </div>;
    })}
  </div>;
}

export function VoltageDividerPage() {
  const [input, setInput] = useViewMemory<DividerInput>('voltage-divider', () => ({ ...DIVIDER_EXAMPLE }), undefined, restoreDividerInput);
  const result = calculateDivider(input), value = result.ok ? result.value : undefined;
  function change(patch: Partial<DividerInput>) { setInput(previous => changeDividerInput(previous, patch)); }
  function select(target: DividerParameter) { setInput(previous => selectDividerTarget(previous, target)); }
  function reset() { setInput({ ...DIVIDER_EXAMPLE }); }
  return <div className="calculations-page divider-page">
    <Heading eyebrow="VOLTAGE DIVIDER" title="分压计算器" description="选择一个求解项，输入另外三个参数，计算分压电路的电压、电阻与支路电流。" />
    <div className="divider-layout">
      <section className="card calc-card divider-input-card" aria-label="分压输入参数">
        <div className="calc-card-title"><h2>参数与求解</h2><span className="tag">实时计算</span></div>
        <p id="divider-solve-help" className="calc-note divider-solve-help">四项中选择一个求解项，另外三项可输入；计算项只读，切换后保留已有数值。</p>
        <DividerFields input={input} result={value} onChange={change} onSelect={select} />
        <div className="divider-actions"><button type="button" onClick={reset}>恢复示例</button></div>
        <p className="calc-note">修改数值或单位后立即更新结果。本窗口记住求解项、输入与单位，切换工具或重新打开后恢复。</p>
      </section>
      <section className="card calc-card" aria-label="分压电路与结果">
        <div className="calc-card-title"><h2>电路与结果</h2><span className="tag">中点空载</span></div>
        <div className="divider-results" aria-live="polite">
          {value ? <dl><div><dt>{DIVIDER_LABELS[input.solveFor]} · 计算结果</dt><dd id={`divider-${input.solveFor}`}>
            {number(dividerResultValue(input.solveFor, value, input))} <small>{valueUnit(input.solveFor, input)}</small></dd></div>
            <div><dt>串联电流 I</dt><dd id="divider-current">{dividerCurrent(value.currentA)}</dd></div></dl> : !result.ok && <ErrorMessage text={result.error} />}
        </div>
        <DividerSchematic result={value} solveFor={input.solveFor} />
        <p className="calc-note divider-topology-note">R1 接 Vin 与中点，R2 接中点与 GND。中点无外接负载时，两颗电阻流过相同电流。</p>
      </section>
    </div>
    <section className="card calc-card divider-calculation" aria-label="分压计算过程"><div className="calc-card-title"><h2>计算过程</h2></div><DividerEquations result={value} solveFor={input.solveFor} /><p className="calc-reference">理想直流、无负载分压；未计电阻容差。中点连接负载后，需要将负载对下电阻的并联影响计入计算。</p></section>
  </div>;
}
