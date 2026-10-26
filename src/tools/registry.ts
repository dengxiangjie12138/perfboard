import type { ComponentType } from 'react';
import { Binary, Braces, Cable, Calculator, Cpu, Timer, Lightbulb, Armchair, Dumbbell, Triangle, type LucideIcon } from 'lucide-react';
import type { Page } from '../types';
import { FeedbackPage } from './feedback';
import { TransformerDesignPage } from './TransformerDesignPage';
import { FitnessPage } from '../features/fitness/FitnessPage';
import { StandingReminderPage } from '../features/standing-reminder/StandingReminderPage';
import { TimerPage } from './stm32-timer';
import { RadixPage } from './radix';
import { JsonPage } from './json';
import { ExternalToolsPage } from './external-tools';
import { WireGaugePage } from './wire-gauge';
import { LedResistorPage } from './led-resistor';
import { ResistorSeriesPage } from './resistor-series';
import { ResistorParallelPage } from './resistor-parallel';
import { OpAmpPage } from './opamp';
import { VoltageDividerPage } from './voltage-divider';
import { Tl431Page } from './tl431';
import { PullupDividerPage } from './pullup-divider';
import { PwmControllerPage } from './uc28-38xx';
import { PmosSwitchPage } from './pmos-switch';

export type ToolGroupId = 'hardware' | 'stm32' | 'utilities';
export const TOOL_SECTIONS = [{ id: 'tools', title: '工具' }] as const;
export interface ToolDefinition {
  page: Page;
  group: ToolGroupId;
  title: string;
  description: string;
  keywords: readonly string[];
  icon: LucideIcon;
  component: ComponentType<{ selectedId?: string; selectionRequest?: object }>;
  requiresRepository?: boolean;
}
export const TOOL_GROUPS = [
  { section: 'tools', page: 'hardware' as const, title: '硬件计算选型', eyebrow: 'HARDWARE TOOLS', description: '根据目标参数选择元件，再与手边的库存核对。', icon: Calculator },
  { section: 'tools', page: 'stm32' as const, title: 'STM32 计算', eyebrow: 'STM32 TOOLS', description: '从时钟和目标频率，计算可用的定时器寄存器值。', icon: Cpu },
  { section: 'tools', page: 'utilities' as const, title: '常用小工具', eyebrow: '常用小工具', description: '进制与位运算、JSON 解析、久坐提醒、工作与健身和本机外部应用管理。', icon: Binary },
];
export const TOOLS: readonly ToolDefinition[] = [
  { page: 'opamp', group: 'hardware', title: '运放选型计算', description: '38 种 TI 电路，涵盖放大、滤波、比较、整流与驱动；双击编辑，确认后联动计算。', keywords: ['运算放大器', '运放', '放大电路', '比较器', '滞回', '迟滞', '施密特', 'op amp', 'opamp', 'amplifier', 'comparator', '滤波', '电流检测', '跨阻', 'PWM', '麦克风', '整流', 'Howland'], icon: Triangle, component: OpAmpPage, requiresRepository: false },
  { page: 'transformer-design', group: 'hardware', title: '变压器设计记录', description: '保存磁芯与骨架快照、绕制工艺和验收条件，导出中文制造图。', keywords: ['变压器', '设计记录', '绕组', '绕线', '骨架', '制造图', 'transformer', 'PDF'], icon: Cable, component: TransformerDesignPage, requiresRepository: true },
  { page: 'standing-reminder', group: 'utilities', title: '久坐提醒', description: '按键鼠活动提醒起身休息，计时与设置独立于资料仓库。', keywords: ['久坐', '站立', '休息', '健康提醒', 'standing', 'break', 'meeting', '暂停'], icon: Armchair, component: StandingReminderPage, requiresRepository: false },
  { page: 'fitness', group: 'utilities', title: '工作与健身', description: '累计键鼠活动，从勾选动作中随机提醒健身；独立于资料仓库。', keywords: ['工作与健身','健身','活动','俯卧撑','深蹲','马步','随机','fitness','exercise'], icon: Dumbbell, component: FitnessPage, requiresRepository: false },
  { page: 'feedback', group: 'hardware', title: '反馈电阻', description: '标准阻值与库存候选，按分压电流硬上限筛选。', keywords: ['电源', '分压', 'divider', 'feedback', 'E24', 'E96'], icon: Calculator, component: FeedbackPage },
  { page: 'voltage-divider', group: 'hardware', title: '分压计算器', description: '输入供电电压和上下电阻，计算空载中点电压与串联电流。', keywords: ['电阻分压', '分压计算', '电压分压', '电阻分压器', '中点电压', '分压电流', '串联分压', 'voltage divider', 'resistive divider'], icon: Calculator, component: VoltageDividerPage, requiresRepository: false },
  { page: 'tl431', group: 'hardware', title: 'TL431 基准电压计算', description: '分压电阻、目标电压反算与阴极偏置电流校核。', keywords: ['TL431', '431', '基准电压', '可调基准', '并联稳压', '稳压参考', 'shunt reference'], icon: Calculator, component: Tl431Page, requiresRepository: false },
  { page: 'pullup-divider', group: 'hardware', title: '带上拉分压计算', description: '三电阻分压，比较正常、未接入与反接，区分 0 V 与支路断开。', keywords: ['上拉分压', '带上拉分压', '偏置分压', '三电阻分压', '端口反接检测', '反接检查', '开路检测', '连接状态', '悬空', '断开', '0V', 'pull up divider', 'biased divider'], icon: Calculator, component: PullupDividerPage, requiresRepository: false },
  { page: 'uc28-38xx', group: 'hardware', title: 'UC28/38xx 计算', description: 'TI 控制器型号、启动门限、RT/CT 频率、CS 采样电阻与 RC 滤波。', keywords: ['UCC28C40', 'UCC28C41', 'UCC28C42', 'UCC28C43', 'UCC28C44', 'UCC28C45', 'UCC38C40', 'UCC38C41', 'UCC38C42', 'UCC38C43', 'UCC38C44', 'UCC38C45', 'UC3841', 'UC3842', 'UC3843', 'UC3844', 'UC3845', 'UC28', 'UC38', 'PWM', '电流模式', '启动电压', 'CS采样', 'RC滤波', '开关频率', 'RT CT'], icon: Calculator, component: PwmControllerPage, requiresRepository: false },
  { page: 'pmos-switch', group: 'hardware', title: 'PMOS 开关电阻计算', description: '按输入电压、开启栅压与分压支路电流反算 R1、R2。', keywords: ['PMOS', 'P沟道', 'P管', 'MOS开关', '高边开关', '高端开关', '栅极分压', '开启电阻', 'MOS电阻', 'MOSFET', 'gate divider', 'high side switch'], icon: Calculator, component: PmosSwitchPage, requiresRepository: false },
  { page: 'timer', group: 'stm32', title: '定时器计算', description: 'STM32 定时器频率、周期、PSC 与 ARR。', keywords: ['STM32', 'timer', 'PSC', 'ARR', '时钟'], icon: Timer, component: TimerPage },
  { page: 'radix', group: 'utilities', title: '进制转换', description: '二、八、十、十六进制整数联动与位运算。', keywords: ['二进制', '八进制', '十进制', '十六进制', 'BIN', 'OCT', 'DEC', 'HEX', 'AND', 'OR', 'XOR', 'NOT', '位运算', '移位'], icon: Binary, component: RadixPage, requiresRepository: false },
  { page: 'led', group: 'hardware', title: 'LED限流计算', description: '计算发光二极管串联限流电阻与功耗。', keywords: ['LED', '发光二极管', '限流', '串联电阻'], icon: Lightbulb, component: LedResistorPage, requiresRepository: true },
  { page: 'resistor-series', group: 'hardware', title: '电阻串联计算', description: '计算串联电阻的等效阻值与功耗。', keywords: ['串联', '等效电阻', '额定功率'], icon: Calculator, component: ResistorSeriesPage, requiresRepository: false },
  { page: 'resistor-parallel', group: 'hardware', title: '电阻并联计算', description: '计算并联电阻的等效阻值与功耗。', keywords: ['并联', '等效电阻', '额定功率'], icon: Calculator, component: ResistorParallelPage, requiresRepository: false },
  { page: 'json', group: 'utilities', title: 'JSON解析', description: '本地解析、格式化、压缩与字符串转义。', keywords: ['JSON', 'JSON解析', '解析', '格式化', '压缩', '转义', '反转义'], icon: Braces, component: JsonPage, requiresRepository: false },
  { page: 'external-tools', group: 'utilities', title: '外部工具', description: '管理本机应用入口，选择记录后手动启动。', keywords: ['外部工具', '应用'], icon: Cable, component: ExternalToolsPage, requiresRepository: false },
  { page: 'wire-gauge', group: 'hardware', title: '线径计算', description: '查看线规、线径与截面积对照表，按期望电流查找参考线径。', keywords: ['AWG', '线规', '线径', '电流', '截面积', '期望电流'], icon: Cable, component: WireGaugePage, requiresRepository: false },
];
export function toolGroupFor(page: Page): ToolGroupId | undefined {
  return TOOL_GROUPS.find(group => group.page === page)?.page ?? TOOLS.find(tool => tool.page === page)?.group;
}
