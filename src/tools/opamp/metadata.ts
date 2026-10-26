import { COMPARATOR_CIRCUITS } from './comparator/metadata';
import { LIBRARY_CIRCUITS } from './library/metadata';
import { LIBRARY_IDS, type LibraryId } from './library/ids';
import { libraryParameterLabel } from './library/labels';
import { CIRCUIT_SEARCH_KEYWORDS } from './searchKeywords';
export { LIBRARY_IDS, type LibraryId } from './library/ids';
export const COMPARATOR_IDS = ['comparator', 'schmitt-inv', 'schmitt-noninv', 'window', 'zero-cross', 'overvoltage', 'undervoltage', 'relaxation'] as const;
export type ComparatorId = typeof COMPARATOR_IDS[number];
export const CIRCUIT_IDS = ['follower', 'inv', 'noninv', 'sum', 'diff', 'ina2', 'ina3', 'integrator', 'differentiator', ...LIBRARY_IDS, ...COMPARATOR_IDS] as const;
export type CircuitId = typeof CIRCUIT_IDS[number];
export type ResistanceKey = 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r10' | 'rg' | 'rf' | 'rs' | 'rl' | 'rp' | 'rz';
export type CapacitanceKey = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'ci' | 'cf';
export type PassiveKey = ResistanceKey | CapacitanceKey;
export type ParameterKey = PassiveKey | 'vin' | 'vi1' | 'vi2' | 'vref' | 'vcc' | 'vee' | 'headroom' | 'gbw' | 'frequency' | 'amplitude' | 'vpu' | 'voh' | 'vol' | 'vitLow' | 'vitHigh' | 'diodeDrop' | 'tpd' | 'hysteresis' | 'iin' | 'current' | 'alpha' | 'pressure' | 'sensitivity' | 'micZ' | 'biasCurrent';
export type ResistanceUnit = 1 | 1000 | 1000000;
export type CapacitanceUnit = 1e-12 | 1e-9 | 1e-6 | 1e-3;
export type PassiveUnit = ResistanceUnit | CapacitanceUnit;
export interface CircuitDefinition {
  id: CircuitId; title: string; description: string; keywords: readonly string[];
  document: string; url: string; chip: string; supply: readonly [number, number]; commonMode: readonly [number, number];
  resistors: readonly ResistanceKey[]; capacitors?: readonly CapacitanceKey[]; inputs: readonly ParameterKey[];
  category?: string;
  defaults?: Partial<Record<ParameterKey, string>>; units?: Partial<Record<PassiveKey, PassiveUnit>>; note?: string;
}
const circuitDefinitions: readonly CircuitDefinition[] = [
  { id: 'follower', title: '电压跟随器', description: '单位增益缓冲，高输入阻抗、低输出阻抗。', keywords: ['缓冲器', '电压缓冲', '跟随', 'voltage follower', 'buffer', 'LM7332'],
    document: 'ZHCA785B', url: 'https://www.ti.com.cn/cn/lit/pdf/ZHCA785', chip: 'LM7332', supply: [2.5, 32], commonMode: [-.1, .1], resistors: [], inputs: ['vin'], defaults: { gbw: '7.5', headroom: '1' } },
  { id: 'inv', title: '反相放大电路', description: '反相电压增益，输入阻抗由输入电阻决定。', keywords: ['反向放大', '反相放大器', 'inverting amplifier', 'TLV170'],
    document: 'CIRCUIT060020', url: 'https://www.ti.com.cn/tool/cn/CIRCUIT060020', chip: 'TLV170', supply: [2.7, 36], commonMode: [-.1, -2], resistors: ['r1', 'r2'], inputs: ['vin'], defaults: { r2: '20', gbw: '1.2' } },
  { id: 'noninv', title: '同相放大电路', description: '输入与输出同相，适合高输入阻抗的电压信号放大。', keywords: ['同相放大器', '非反相放大', '运放', 'noninverting', 'non-inverting', 'OPA171'],
    document: 'ZHCA755A', url: 'https://www.ti.com.cn/cn/lit/pdf/ZHCA755', chip: 'OPA171', supply: [2.7, 36], commonMode: [-.1, -2], resistors: ['r1', 'r2'], inputs: ['vin'], defaults: { r1: '9.09', r2: '1.01', gbw: '3' } },
  { id: 'sum', title: '反相求和电路', description: '两路电压加权相加并反相，分别计算每路增益。', keywords: ['加法器', '求和放大器', '加权求和', 'summing amplifier', 'adder', 'TLV170'],
    document: 'ZHCA786C', url: 'https://www.ti.com.cn/cn/lit/pdf/ZHCA786', chip: 'TLV170', supply: [2.7, 36], commonMode: [-.1, -2], resistors: ['r1', 'r2', 'r3'], inputs: ['vi1', 'vi2'], defaults: { r1: '20.5', r2: '2.05', r3: '20', vi1: '1', vi2: '.1', vcc: '5', vee: '-5', gbw: '1.2', headroom: '.1' } },
  { id: 'diff', title: '差分放大电路', description: '放大两个输入的差值，电阻比例匹配决定共模信号抑制能力。', keywords: ['差分放大器', '差动放大', '减法器', '运放', 'difference', 'differential', 'subtractor', 'TLV6001'],
    document: 'ZHCA759A', url: 'https://www.ti.com.cn/cn/lit/pdf/ZHCA759', chip: 'TLV6001', supply: [1.8, 5.5], commonMode: [0, 0], resistors: ['r1', 'r3', 'r2', 'r4'], inputs: ['vi1', 'vi2', 'vref'], defaults: { vcc: '2.75', vee: '-2.75', gbw: '1' } },
  { id: 'ina2', title: '双运放仪表放大电路', description: '高输入阻抗差分测量，独立调整五个电阻并检查内部输出。', keywords: ['双运放仪表放大器', '双运放仪放', '两运放', 'instrumentation amplifier', 'INA', 'TLV171'],
    document: 'ZHCA849A', url: 'https://www.ti.com.cn/cn/lit/pdf/ZHCA849', chip: 'TLV171', supply: [4.5, 36], commonMode: [-.1, -2], resistors: ['r1', 'r2', 'r3', 'r4', 'rg'], inputs: ['vi1', 'vi2', 'vref'], defaults: { r1: '5.1', r2: '20', r3: '5.1', r4: '20', rg: '7.87', vi1: '-.5', vi2: '.5', gbw: '3' } },
  { id: 'ina3', title: '三运放仪表放大电路', description: '两级输入缓冲与差分输出，支持七个电阻独立修改。', keywords: ['三运放仪表放大器', '三级运算放大器仪表', '三运放仪放', 'instrumentation amplifier', 'INA', 'TLV171'],
    document: 'ZHCA850A', url: 'https://www.ti.com.cn/cn/lit/pdf/ZHCA850', chip: 'TLV171', supply: [4.5, 36], commonMode: [-.1, -2], resistors: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r10'], inputs: ['vi1', 'vi2', 'vref'], defaults: { r1: '10', r2: '10', r3: '10', r4: '10', r5: '10', r6: '10', r10: '2.21', vi1: '-.25', vi2: '.25', gbw: '3' } },
  { id: 'integrator', title: '积分器电路', description: '带直流反馈的实用积分器，显示正弦稳态、频率响应与时间常数。', keywords: ['积分放大', '有损积分', 'integrator', 'TLV9002'],
    document: 'ZHCA760B', url: 'https://www.ti.com.cn/cn/lit/pdf/ZHCA760', chip: 'TLV9002', supply: [1.8, 5.5], commonMode: [-.1, .1], resistors: ['r1', 'r2'], capacitors: ['c1'], inputs: ['vin', 'vref', 'amplitude', 'frequency'], defaults: { r1: '100', r2: '100000', c1: '1.59', vin: '0', vcc: '2.5', vee: '-2.5', gbw: '1', headroom: '.05', amplitude: '.1', frequency: '1000' }, note: 'R2 提供直流反馈；原图失调补偿简化为可调理想 Vref，未叠加运放失调。' },
  { id: 'differentiator', title: '微分器电路', description: '含输入限流电阻的实用微分器，可增加反馈电容并查看幅相响应。', keywords: ['微分放大', 'differentiator', 'TLV9061'],
    document: 'ZHCA787C', url: 'https://www.ti.com.cn/cn/lit/pdf/ZHCA787', chip: 'TLV9061', supply: [1.8, 5.5], commonMode: [0, 0], resistors: ['r1', 'r2'], capacitors: ['c1', 'cf'], inputs: ['vin', 'vref', 'amplitude', 'frequency'], defaults: { r1: '1', r2: '499', c1: '15', cf: '0', vin: '0', vref: '2.5', vcc: '5', vee: '0', gbw: '10', headroom: '.1', amplitude: '.02', frequency: '2500' }, note: '原图 R3/R4 分压与去耦网络简化为理想 Vref；Cf=0 表示未接入文档中的可选反馈电容。' },
  ...LIBRARY_CIRCUITS, ...COMPARATOR_CIRCUITS,
];
export const CIRCUITS: readonly CircuitDefinition[] = circuitDefinitions.map(circuit => ({
  ...circuit, keywords: [...new Set([...circuit.keywords, ...CIRCUIT_SEARCH_KEYWORDS[circuit.id]])],
}));
export const isCircuitId = (value: unknown): value is CircuitId => CIRCUIT_IDS.includes(value as CircuitId);
export const circuitDefinition = (id: CircuitId) => CIRCUITS.find(circuit => circuit.id === id)!;
export const circuitNumber = (id: CircuitId) => String(CIRCUITS.findIndex(c => c.id === id) + 1).padStart(2, '0');
export const isDynamicCircuit = (id: CircuitId) => id === 'integrator' || id === 'differentiator';
export const isComparatorCircuit = (id: CircuitId): id is ComparatorId => (COMPARATOR_IDS as readonly string[]).includes(id);
export const isLibraryCircuit = (id: CircuitId): id is LibraryId => (LIBRARY_IDS as readonly string[]).includes(id);
export const circuitCategory = (id: CircuitId) => circuitDefinition(id).category ?? (isComparatorCircuit(id) ? '比较器与阈值检测' : '基础放大与运算');
export const isDifferentialCircuit = (id: CircuitId) => id === 'diff' || id === 'ina2' || id === 'ina3';
export const PARAMETER_LABELS: Record<ParameterKey, { symbol: string; label: string; unit?: string }> = {
  r7: { symbol: 'R7', label: '积分输入电阻' }, rf: { symbol: 'Rf', label: '反馈电阻' }, rs: { symbol: 'Rs', label: '分流电阻' }, rl: { symbol: 'RL', label: '负载电阻' }, rp: { symbol: 'P1', label: '电位器总阻值' }, rz: { symbol: 'RZCO', label: '零交越旁路电阻' },
  c2: { symbol: 'C2', label: '电容 C2' }, c3: { symbol: 'C3', label: '电容 C3' }, c4: { symbol: 'C4', label: '电容 C4' }, c5: { symbol: 'C5', label: '电容 C5' }, c6: { symbol: 'C6', label: '电容 C6' }, ci: { symbol: 'Ci', label: '输入总电容（稳定性检查）' },
  iin: { symbol: 'Ii', label: '输入电流（节点流向地）', unit: 'µA' }, current: { symbol: 'Ii', label: '负载电流', unit: 'A' }, alpha: { symbol: 'α', label: '滑片比例（0–1）' }, pressure: { symbol: 'p', label: '输入声压 RMS', unit: 'Pa' }, sensitivity: { symbol: 'S', label: '麦克风灵敏度（1Pa，RMS）', unit: 'dBV' }, micZ: { symbol: 'Ztest', label: '灵敏度测试负载阻抗', unit: 'Ω' }, biasCurrent: { symbol: 'Ibias', label: '麦克风静态偏置电流', unit: 'mA' },

  r1: { symbol: 'R1', label: '输入电阻' }, r2: { symbol: 'R2', label: '反馈电阻' }, r3: { symbol: 'R3', label: '反馈电阻' }, r4: { symbol: 'R4', label: '基准侧电阻' },
  r5: { symbol: 'R5', label: '下路反馈电阻' }, r6: { symbol: 'R6', label: '上路反馈电阻' }, r10: { symbol: 'R10', label: '增益电阻' }, rg: { symbol: 'Rg', label: '增益电阻' },
  c1: { symbol: 'C1', label: '信号电容' }, cf: { symbol: 'Cf', label: '可选反馈电容（0 为未接入）' },
  vin: { symbol: 'Vin', label: '输入电压', unit: 'V' }, vi1: { symbol: 'Vi1', label: '输入 1', unit: 'V' }, vi2: { symbol: 'Vi2', label: '输入 2', unit: 'V' },
  vref: { symbol: 'Vref', label: '输出基准', unit: 'V' }, vcc: { symbol: 'Vcc', label: '正电源', unit: 'V' }, vee: { symbol: 'Vee', label: '负电源', unit: 'V' },
  headroom: { symbol: 'H', label: '距两侧电源轨余量（假设）', unit: 'V' }, gbw: { symbol: 'GBW', label: '增益带宽积（可修改）', unit: 'MHz' },
  frequency: { symbol: 'f', label: '正弦输入频率', unit: 'Hz' }, amplitude: { symbol: 'Vp', label: '正弦输入幅值（峰值）', unit: 'V' },
  vpu: { symbol: 'Vpu', label: '输出上拉电源', unit: 'V' }, voh: { symbol: 'ΔVOH', label: '高电平距 Vcc 压降（假设）', unit: 'V' }, vol: { symbol: 'ΔVOL', label: '低电平高于 Vee 压降（假设）', unit: 'V' },
  vitLow: { symbol: 'VIT−', label: '集成参考下降门限（相对 Vee）', unit: 'V' }, vitHigh: { symbol: 'VIT+', label: '集成参考上升门限（相对 Vee）', unit: 'V' },
  diodeDrop: { symbol: 'VF', label: 'D1 负向钳位压降（假设）', unit: 'V' }, tpd: { symbol: 'tpd', label: '传播延迟（仅检查，不计入波形）', unit: 'ns' }, hysteresis: { symbol: '迟滞', label: '外部迟滞开关' },
};
export function parameterLabel(id: CircuitId, key: ParameterKey) {
  const labels: Partial<Record<CircuitId, Partial<Record<ParameterKey, string>>>> = {
    noninv: { r1: '反馈电阻', r2: '接地电阻', vin: '同相输入' }, diff: { r1: '反相输入电阻', r2: '同相输入电阻', vi1: '反相侧输入', vi2: '同相侧输入' },
    inv: { vin: '反相输入' }, sum: { r1: '输入 1 电阻', r2: '输入 2 电阻' },
    ina2: { r1: '级间输入电阻', r2: 'U1 反馈电阻', r3: 'U2 反馈电阻', r4: '基准输入电阻' },
    ina3: { r1: '输出级反相输入电阻', r2: '输出级反馈电阻', r3: '输出级同相输入电阻' },
    integrator: { r2: '直流反馈电阻', c1: '积分反馈电容', vin: '输入直流中心', vref: '同相参考输入' },
    differentiator: { r1: '高频限流电阻', c1: '微分输入电容', vin: '输入直流中心', vref: '外部参考输入' },
    comparator: { r1: '基准上臂电阻', r2: '基准下臂电阻', r3: '可断开正反馈电阻', vref: '分压基准电源' },
    'schmitt-inv': { r1: '基准上臂电阻', r2: '基准下臂电阻', r3: '输出上拉电阻', r4: '正反馈电阻', vref: '分压基准电源' },
    'schmitt-noninv': { r1: '输入电阻', r2: '正反馈电阻', r3: '输出上拉电阻', r4: '基准上臂电阻', r5: '基准下臂电阻', vref: '分压基准电源' },
    window: { r1: '窗口分压下臂', r2: '窗口分压中段', r3: '窗口分压上臂', r4: 'Rp 输出上拉电阻', vin: '被测电压' },
    'zero-cross': { r1: '输入限流电阻', r2: '输入分压下臂', vin: '输入直流中心', amplitude: '正弦输入峰值（非 RMS）' },
    overvoltage: { vcc: 'SUPPLY 被测电源及比较器供电', vref: 'Z1 稳压基准（理想化）', r1: '检测分压上臂', r2: '检测分压下臂' },
    undervoltage: { vcc: 'VBAT 被测电池及比较器供电', r1: '检测分压上臂', r2: '检测分压下臂', r3: '输出上拉电阻' },
    relaxation: { r1: '电容充放电电阻', r2: '阈值网络上臂', r3: '阈值网络下臂', r4: '正反馈电阻', c1: '定时电容' },
  };
  return { ...PARAMETER_LABELS[key], label: labels[id]?.[key] ?? (isLibraryCircuit(id)?libraryParameterLabel(id,key):undefined) ?? PARAMETER_LABELS[key].label };
}
