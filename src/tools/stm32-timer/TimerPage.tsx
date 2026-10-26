import { useViewMemory } from '../../services/useViewMemory';
import { memoryChoice } from '../../services/viewMemory';
import { TimerWave } from './components/TimerWave';
import { useState, type FormEvent } from 'react';
import { Calculator } from 'lucide-react';
import { calculateTimer, maxTimerArr, recommendTimer, type TimerBits, type TimerResult } from './algorithm';
import { parseNumericInput, type CalculationResult } from '../shared/numeric';
import { number, percent } from '../shared/units';
import { Heading, NumberField, ErrorMessage } from '../shared/components';
import '../shared/calculators.css';
function TimerContent() {
  const [clock,setClock] = useViewMemory('timer-clock', '72'), [target,setTarget] = useViewMemory('timer-target', '1000'), [bits,setBits] = useViewMemory<TimerBits>('timer-bits', 16, undefined, memoryChoice([16,32])), [psc,setPsc] = useViewMemory('timer-psc', '71'), [arr,setArr] = useViewMemory('timer-arr', '999');
  const [suggestion,setSuggestion] = useState<CalculationResult<TimerResult> | null>(null);
  const clockHz = parseNumericInput(clock) * 1e6;
  const targetHz = parseNumericInput(target);
  const manual = calculateTimer(clockHz,targetHz,parseNumericInput(psc),parseNumericInput(arr),bits);
  function suggest(event: FormEvent) {
    event.preventDefault();
    const next = recommendTimer(clockHz,targetHz,bits);
    setSuggestion(next);
    if (next.ok) { setPsc(String(next.value.psc)); setArr(String(next.value.arr)); }
  }
  return <><Heading eyebrow="STM32 TIMER" title="频率、分频与计数周期。" description="输入已知 TIM 时钟，计算常规向上计数模式的更新事件。" /><div className="calc-split"><section className="card calc-card"><div className="calc-card-title"><h2>时钟与目标</h2><span className="tag">向上计数</span></div><form onSubmit={suggest} noValidate><NumberField label="已确认的 TIM 输入时钟 Ftim" unit="MHz" value={clock} onChange={value => { setClock(value); setSuggestion(null); }} help="不推导 APB 分频、倍频或时钟树，请先确认目标芯片的定时器时钟。" /><NumberField label="目标更新频率" unit="Hz" value={target} onChange={value => { setTarget(value); setSuggestion(null); }} /><label className="calc-field"><span>ARR 寄存器位宽（按实际定时器确认）</span><select value={bits} onChange={event => { setBits(Number(event.target.value) as TimerBits); setSuggestion(null); }}><option value={16}>16 bit ARR · 0–65535</option><option value={32}>32 bit ARR · 0–4294967295</option></select></label><button type="submit" className="primary calc-full"><Calculator size={16} /> 寻找 PSC / ARR</button></form>{suggestion && !suggestion.ok && <ErrorMessage text={suggestion.error} />}{suggestion?.ok && <p className="calc-success" role="status">已填入推荐寄存器值，标称误差 {percent(suggestion.value.errorPercent)}。</p>}<p className="calc-note">搜索 PSC 0–65535，ARR 按位宽限定。比较实际频率误差；同误差时优先较大 ARR。数值示例不配置硬件。</p><div className="calc-reference">时基模型依据：ST AN4776。周期从 0 数到 ARR，包含 ARR + 1 个计数。</div></section><section className="card calc-card"><div className="calc-card-title"><h2>寄存器与周期</h2><span className="muted">可手动修改</span></div><div className="calc-formula">F = Ftim / ((PSC + 1) × (ARR + 1))</div><div className="calc-registers"><NumberField label="PSC 寄存器值（无单位）" value={psc} onChange={value => { setPsc(value); setSuggestion(null); }} integer max="65535" /><NumberField label="ARR 寄存器值（无单位）" value={arr} onChange={value => { setArr(value); setSuggestion(null); }} integer max={String(maxTimerArr(bits))} /></div><div aria-live="polite">{manual.ok ? <><div className="calc-result-value">{number(manual.value.frequencyHz)} <span>Hz</span></div><p className="calc-result-caption">实际更新频率</p><dl className="calc-results"><div><dt>更新周期</dt><dd>{number(manual.value.periodSeconds)} s</dd></div><div><dt>目标频率</dt><dd>{number(targetHz)} Hz</dd></div><div><dt>频率偏差</dt><dd>{number(manual.value.errorHz)} Hz</dd></div><div><dt>相对误差</dt><dd>{percent(manual.value.errorPercent)}</dd></div><div><dt>总分频系数</dt><dd>{(manual.value.psc+1)*(manual.value.arr+1)}</dd></div></dl><TimerWave /></> : <ErrorMessage text={manual.error} />}</div><p className="calc-note">重复计数器 RCR = 0。未涵盖中心对齐、外部时钟、门控、PWM 占空比与中断延迟。图中标记更新事件，不代表实际引脚波形。</p></section></div></>;
}
export function TimerPage() { return <div className="calculations-page"><TimerContent /></div>; }
