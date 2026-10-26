import { libraryValidation, solveLibrary, type LibraryResult } from './library/algorithm';
import { CIRCUITS, circuitDefinition, isComparatorCircuit, isLibraryCircuit, isDifferentialCircuit, type CircuitId, type ParameterKey, type ResistanceKey, type PassiveKey, type PassiveUnit } from './metadata';
import { dynamicResult, type DynamicResult } from './dynamic';
import { comparatorModelKeys, comparatorValidation, solveComparator, type ComparatorResult, type LogicState } from './comparator/algorithm';

export interface OpAmpDraft { values: Record<ParameterKey, string>; units: Record<PassiveKey, PassiveUnit>; memory?: LogicState }
export type CircuitParameters = Record<ParameterKey, number>;
export interface OpAmpResult {
  output: number; gain: number; vplus: number; noiseGain: number; bandwidth: number; low: number; high: number;
  k: number; q: number; aPlus: number; aMinus: number; aRef: number; commonGain: number;
  vdiff: number; vcm: number; matched: boolean; cmrr: number;
  internalOutputs: { label: string; value: number }[]; commonModes: { label: string; value: number }[]; noiseGains: number[];
  library?: LibraryResult;
  dynamic?: DynamicResult;
  comparator?: ComparatorResult;
}
export type OpAmpCalculation = { ok: true; parameters: CircuitParameters; value: OpAmpResult } | { ok: false; errors: Partial<Record<ParameterKey, string>> };
export function initialDraft(id: CircuitId): OpAmpDraft {
  const draft: OpAmpDraft = { values: { r7:'5.9',rf:'40.2',rs:'.1',rl:'100',rp:'50',rz:'1',c2:'10',c3:'10',c4:'1',c5:'1',c6:'1',ci:'6',iin:'25',current:'.5',alpha:'.75',pressure:'2',sensitivity:'-35',micZ:'2200',biasCurrent:'.5',r1: '10', r2: '10', r3: '20', r4: '20', r5: '10', r6: '10', r10: '2.21', rg: '7.87', c1: '15', cf: '0',
    vin: '.5', vi1: '.25', vi2: '1.25', vref: '0', vcc: '15', vee: '-15', headroom: '.2', gbw: '3', frequency: '1000', amplitude: '.1',
    vpu: '5', voh: '0', vol: '0', vitLow: '1.18', vitHigh: '1.2', diodeDrop: '.3', tpd: '40', hysteresis: '0', ...circuitDefinition(id).defaults },
    units: { r7:1000,rf:1000,rs:1,rl:1,rp:1000,rz:1000,c2:1e-9,c3:1e-9,c4:1e-9,c5:1e-9,c6:1e-9,ci:1e-12,r1: 1000, r2: 1000, r3: 1000, r4: 1000, r5: 1000, r6: 1000, r10: 1000, rg: 1000, c1: 1e-9, cf: 1e-12, ...circuitDefinition(id).units } };
  if (isComparatorCircuit(id)) { const initial = calculateOpAmp(id, draft); if (initial.ok) draft.memory = initial.value.comparator?.state; }
  return draft;
}
export const initialDrafts = () => Object.fromEntries(CIRCUITS.map(c => [c.id, initialDraft(c.id)])) as Record<CircuitId, OpAmpDraft>;
export function numberText(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—'; if (value === 0) return '0';
  return Math.abs(value) >= 1e7 || Math.abs(value) < 1e-4 ? value.toExponential(3) : Number(value.toFixed(digits)).toString();
}
export function engineeringText(value: number, unit = 'Ω'): string {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value) >= 1e6 ? numberText(value / 1e6) + ' M' + unit : Math.abs(value) >= 1e3 ? numberText(value / 1e3) + ' k' + unit : numberText(value) + ' ' + unit;
}
export const capacitanceText = (value: number) => value === 0 ? '0 pF（未接入）' : value >= 1e-3 ? numberText(value * 1e3) + ' mF' : value >= 1e-6 ? numberText(value * 1e6) + ' µF' : value >= 1e-9 ? numberText(value * 1e9) + ' nF' : numberText(value * 1e12) + ' pF';
export const isResistanceKey = (key: ParameterKey): key is ResistanceKey => /^r([1-7]|10|g|f|s|l|p|z)$/.test(key);
export const isPassiveKey = (key: ParameterKey): key is PassiveKey => isResistanceKey(key) || /^c([1-6]|f|i)$/.test(key);
export function calculateOpAmp(id: CircuitId, draft: OpAmpDraft): OpAmpCalculation {
  const definition = circuitDefinition(id), errors: Partial<Record<ParameterKey, string>> = {};
  const p = Object.fromEntries(Object.entries(draft.values).map(([key, value]) => [key, Number(value)])) as CircuitParameters;
  const comparator = isComparatorCircuit(id);
  const keys = [...definition.resistors.filter(key => !(id === 'comparator' && key === 'r3' && p.hysteresis === 0)), ...(definition.capacitors ?? []), ...definition.inputs, 'vcc', 'vee',
    ...(comparator ? [...comparatorModelKeys(id), ...(id === 'comparator' ? ['hysteresis'] : [])] : ['headroom', 'gbw'])] as ParameterKey[];
  for (const key of keys) {
    const raw = draft.values[key], n = Number(raw), resistance = isResistanceKey(key), passive = isPassiveKey(key);
    if (passive) p[key] = n * draft.units[key];
    if (raw.trim() === '' || !Number.isFinite(n)) errors[key] = '请输入有效数值。';
    else if (resistance && (n < 0 || (n === 0 && !(id === 'pga' && key === 'r1')) || ![1, 1000, 1000000].includes(draft.units[key]))) errors[key] = '电阻必须大于 0，并使用有效单位。';
    else if ((passive && !resistance) && ((key === 'cf' || key === 'ci' ? n < 0 : n <= 0) || ![1e-12, 1e-9, 1e-6, 1e-3].includes(draft.units[key]))) errors[key] = key === 'cf' ? 'Cf 不能为负数，并使用有效单位。' : '电容必须大于 0，并使用有效单位。';
    else if (key === 'headroom' && n < 0) errors[key] = '余量不能为负数。';
    else if (key === 'amplitude' && n < 0) errors[key] = '峰值幅度不能为负数。';
    else if ((key === 'gbw' || key === 'frequency') && n <= 0) errors[key] = '频率或 GBW 必须大于 0。';
    else if (Math.abs(p[key]) > (resistance || key === 'frequency' ? 1e12 : passive ? 1 : 1e6)) errors[key] = '数值超出本工具的计算范围。';
    else if (resistance && p[key] < 1e-6 && !(id === 'pga' && key === 'r1' && p[key] === 0)) errors[key] = '电阻最小为 1 µΩ。';
    else if ((passive && !resistance) && p[key] > 0 && p[key] < 1e-15) errors[key] = '非零电容最小为 1 fF。';
  }
  if (!errors.vcc && !errors.vee && p.vcc <= p.vee) errors.vcc = 'Vcc 必须大于 Vee。';
  if (!comparator && !errors.vcc && !errors.vee && !errors.headroom && p.headroom * 2 >= p.vcc - p.vee) errors.headroom = '两侧余量之和必须小于总供电。';
  if (comparator && !Object.keys(errors).length) Object.assign(errors, comparatorValidation(id, p));
  if (isLibraryCircuit(id) && !Object.keys(errors).length) Object.assign(errors, libraryValidation(id, p));
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, parameters: p, value: solveCircuit(id, p, draft.memory) };
}
/** Ideal negative-feedback solution. TI component numbering is preserved per topology. */
export function solveCircuit(id: CircuitId, p: CircuitParameters, memory?: LogicState): OpAmpResult {
  const r: OpAmpResult = { output: 0, gain: 1, vplus: 0, noiseGain: 1, bandwidth: 0, low: p.vee + p.headroom, high: p.vcc - p.headroom,
    k: 0, q: 0, aPlus: 0, aMinus: 0, aRef: 0, commonGain: 0, vdiff: p.vi2 - p.vi1, vcm: (p.vi1 + p.vi2) / 2, matched: true, cmrr: Infinity,
    internalOutputs: [], commonModes: [], noiseGains: [] };
  if (isLibraryCircuit(id)) {
    const library=solveLibrary(id,p);return {...r,library,output:library.output,gain:library.gain};
  }
  if (isComparatorCircuit(id)) {
    const comparator = solveComparator(id, p, memory);
    return { ...r, comparator, output: comparator.output, vplus: comparator.plus, low: comparator.low, high: comparator.high };
  }
  if (id === 'integrator' || id === 'differentiator') {
    r.dynamic = dynamicResult(id, p); r.output = r.dynamic.outputDC; r.gain = r.dynamic.magnitude; r.vplus = p.vref; r.noiseGain = r.dynamic.noiseGain;
  } else if (id === 'follower' || id === 'noninv' || id === 'inv') {
    r.gain = id === 'follower' ? 1 : id === 'noninv' ? 1 + p.r1 / p.r2 : -p.r2 / p.r1;
    r.noiseGain = id === 'inv' ? 1 + p.r2 / p.r1 : r.gain; r.output = r.gain * p.vin; r.vplus = id === 'inv' ? 0 : p.vin;
  } else if (id === 'sum') {
    r.aMinus = -p.r3 / p.r1; r.aPlus = -p.r3 / p.r2; r.gain = r.aMinus;
    r.output = r.aMinus * p.vi1 + r.aPlus * p.vi2; r.noiseGain = 1 + p.r3 / p.r1 + p.r3 / p.r2;
  } else if (id === 'ina2') {
    const k = p.r2 / p.r1, left1 = 1 + p.r3 / p.r4 + p.r3 / p.rg, left2 = -p.r3 / p.rg;
    const va = left1 * p.vi1 + left2 * p.vi2 - p.r3 / p.r4 * p.vref;
    r.k = k; r.q = p.r4 / p.r3; r.aPlus = 1 + k - k * left2 + p.r2 / p.rg; r.aMinus = -k * left1 - p.r2 / p.rg; r.aRef = k * p.r3 / p.r4;
    r.output = p.vi2 + k * (p.vi2 - va) + p.r2 / p.rg * (p.vi2 - p.vi1); r.vplus = p.vi2;
    r.internalOutputs = [{ label: 'U2 内部输出 Va', value: va }]; r.commonModes = [{ label: 'U2 输入', value: p.vi1 }, { label: 'U1 输入', value: p.vi2 }];
    r.noiseGains = [left1, 1 + k + p.r2 / p.rg];
  } else {
    const three = id === 'ina3', k = three ? p.r2 / p.r1 : p.r3 / p.r1, q = three ? p.r4 / p.r3 : p.r4 / p.r2;
    const plus = (1 + k) * q / (1 + q); r.k = k; r.q = q; r.aRef = (1 + k) / (1 + q);
    if (three) {
      const va = p.vi1 + p.r6 / p.r10 * (p.vi1 - p.vi2), vb = p.vi2 + p.r5 / p.r10 * (p.vi2 - p.vi1);
      r.aPlus = plus * (1 + p.r5 / p.r10) + k * p.r6 / p.r10;
      r.aMinus = -plus * p.r5 / p.r10 - k * (1 + p.r6 / p.r10);
      r.output = plus * vb - k * va + r.aRef * p.vref; r.vplus = (vb * p.r4 + p.vref * p.r3) / (p.r3 + p.r4);
      r.internalOutputs = [{ label: 'U3 内部输出 Va', value: va }, { label: 'U2 内部输出 Vb', value: vb }];
      r.commonModes = [{ label: 'U3 输入', value: p.vi1 }, { label: 'U2 输入', value: p.vi2 }, { label: 'U1 输入', value: r.vplus }];
      r.noiseGains = [1 + p.r6 / p.r10, 1 + p.r5 / p.r10, 1 + k];
    } else {
      r.aPlus = plus; r.aMinus = -k; r.output = plus * p.vi2 - k * p.vi1 + r.aRef * p.vref;
      r.vplus = (p.vi2 * p.r4 + p.vref * p.r2) / (p.r2 + p.r4); r.noiseGain = 1 + k;
    }
  }
  if (isDifferentialCircuit(id)) {
    r.gain = (r.aPlus - r.aMinus) / 2; r.commonGain = r.aPlus + r.aMinus;
    r.matched = Math.abs(r.k - r.q) <= Math.max(Math.abs(r.k), Math.abs(r.q)) * 1e-10;
    r.cmrr = r.matched ? Infinity : 20 * Math.log10(Math.abs(r.gain / r.commonGain));
  }
  if (r.noiseGains.length) r.noiseGain = Math.max(...r.noiseGains); else r.noiseGains = [r.noiseGain];
  if (!r.commonModes.length) r.commonModes = [{ label: '同相输入 V+', value: r.vplus }];
  r.bandwidth = p.gbw * 1e6 / r.noiseGain;
  return r;
}
export function matchingDraft(draft: OpAmpDraft): OpAmpDraft | null {
  const r1 = Number(draft.values.r1) * draft.units.r1, r2 = Number(draft.values.r2) * draft.units.r2, r3 = Number(draft.values.r3) * draft.units.r3;
  if (![r1, r2, r3].every(n => Number.isFinite(n) && n >= 1e-6 && n <= 1e12)) return null;
  const r4 = r2 * r3 / r1; if (!Number.isFinite(r4) || r4 < 1e-6 || r4 > 1e12) return null;
  return { ...draft, values: { ...draft.values, r4: String(r4 / draft.units.r4) } };
}
export function dcTransfer(id: CircuitId, p: CircuitParameters, r: OpAmpResult) {
  return isDifferentialCircuit(id) ? { input: r.vdiff, gain: r.gain, offset: r.commonGain * r.vcm + r.aRef * p.vref, label: 'Vdiff', detail: `固定 Vcm = ${numberText(r.vcm)} V、Vref = ${numberText(p.vref)} V，扫描 Vdiff。` }
    : id === 'sum' ? { input: p.vi1, gain: r.aMinus, offset: r.aPlus * p.vi2, label: 'Vi1', detail: `固定 Vi2 = ${numberText(p.vi2)} V，扫描 Vi1。` }
    : { input: p.vin, gain: r.gain, offset: 0, label: 'Vin', detail: '扫描 Vin，电阻与电源保持当前设置。' };
}
export function circuitNotices(id: CircuitId, p: CircuitParameters, r: OpAmpResult): { warning: boolean; text: string }[] {
  const c = circuitDefinition(id), a = r.dynamic?.outputAmplitude ?? 0, outLow = r.output - a, outHigh = r.output + a, clipped = outLow < r.low || outHigh > r.high;
  const notices = [{ warning: clipped, text: clipped ? `理想输出超出设定摆幅。${r.dynamic ? `稳态包络 [${numberText(outLow)}, ${numberText(outHigh)}] V` : `当前 ${numberText(r.output)} V`}；范围 [${numberText(r.low)}, ${numberText(r.high)}] V，线性公式不再代表实际输出。` : `输出位于设定范围内。${numberText(r.low)} V ≤ ${numberText(outLow)}${r.dynamic ? '…' + numberText(outHigh) : ''} V ≤ ${numberText(r.high)} V；仍需核对器件输入范围与负载条件。` }];
  if (isDifferentialCircuit(id)) notices.push({ warning: !r.matched, text: r.matched ? '电阻比例匹配。理想模型抑制共模信号；实际 CMRR 受电阻精度与运放自身性能限制。' : `两侧比例失配。共模增益 Acm = ${numberText(r.commonGain)}，已用通用节点公式重算，未自动调整电阻。` });
  for (const node of r.internalOutputs) if (node.value < r.low || node.value > r.high) notices.push({ warning: true, text: `${node.label} = ${numberText(node.value)} V 超出设定摆幅，即使最终输出未超限，整体也不能保持线性。` });
  const supply = p.vcc - p.vee;
  if (supply < c.supply[0] || supply > c.supply[1]) notices.push({ warning: true, text: `参考器件 ${c.chip} 总供电范围为 ${c.supply.join('–')} V；当前为 ${numberText(supply)} V，请重新选择电源或器件。` });
  for (const node of r.commonModes) if (node.value < p.vee + c.commonMode[0] || node.value > p.vcc + c.commonMode[1]) notices.push({ warning: true, text: `${node.label} = ${numberText(node.value)} V，超出文档共模范围估算 [${numberText(p.vee + c.commonMode[0])}, ${numberText(p.vcc + c.commonMode[1])}] V；需查数据手册核对。` });
  if (c.resistors.some(key => p[key] >= 1e6)) notices.push({ warning: true, text: '高值电阻需额外检查噪声、偏置电流误差和稳定性。' });
  if (id === 'ina2' || id === 'ina3') notices.push({ warning: false, text: '带宽显示 GBW / 最大级内噪声增益，仅作单级估算，不代表多运放整体 −3 dB 带宽。' });
  if (r.dynamic) {
    notices.push({ warning: false, text: '显示理想 RC 网络的正弦稳态，不含上电、初始电荷与饱和恢复过程；幅值为峰值，不是峰峰值。' });
    if (id === 'integrator' && p.frequency < 10 * r.dynamic.feedbackPole) notices.push({ warning: true, text: '当前频率距反馈极点不足十倍，实际响应偏离理想积分；曲线采用含 R2 的完整 RC 公式。' });
    if (id === 'differentiator' && p.frequency > Math.min(r.dynamic.inputPole,r.dynamic.feedbackPole) / 3.5) notices.push({ warning: true, text: '当前频率接近或超过 RC 高频极点，微分近似不再适用；数值和曲线仍按完整 RC 网络计算。' });
    if (p.frequency * r.noiseGain * 10 > p.gbw * 1e6) notices.push({ warning: true, text: '当前频率下运放环路增益余量不足十倍，理想 RC 幅相可能有明显误差。' });
    if (id === 'differentiator' && p.gbw * 1e6 < r.dynamic.minimumGbw) notices.push({ warning: true, text: `未满足 TI 无 Cf 时的 GBW 设计条件：需大于 ${engineeringText(r.dynamic.minimumGbw, 'Hz')}；添加 Cf 后还需单独核对稳定性。` });
  }
  return notices;
}
