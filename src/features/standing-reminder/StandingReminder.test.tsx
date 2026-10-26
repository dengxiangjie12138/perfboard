import {beforeEach,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {StandingReminderPage} from './StandingReminderPage';
import {StandingReminderPrompt} from './StandingReminderPrompt';
import {countdown} from './reminderApi';

const fixtures=vi.hoisted(()=>({
  state:{
    settings:{enabled:false,workSeconds:2700,restSeconds:180,idleSeconds:60,sound:true,autoLock:false},
    activeDurations:{workSeconds:2700,restSeconds:180,idleSeconds:60},pendingDurations:false,
    mode:'off',workMs:0,workRemainingMs:2700000,restMs:0,restRemainingMs:180000,
    idleConfirmationRemainingMs:60000,due:false,roundId:1,promptToken:0,promptVisible:false,
    promptPresented:false,reminderCount:0,snoozeUsed:false,snoozeRemainingMs:null,
    lockRemainingMs:null as number|null,lockAttempted:false,error:null,testMode:true,
    systemMonitorAvailable:true,simulatedLockRequests:0,
    inputSourceStatus:'test',resumeConfirmationRemainingMs:null as number|null,
  },act:vi.fn(),configure:vi.fn(),
}));
vi.mock('./reminderApi',async()=>{
  const original=await vi.importActual<typeof import('./reminderApi')>('./reminderApi');
  return {...original,useReminder:()=>({state:fixtures.state,error:'',act:fixtures.act,configure:fixtures.configure})};
});
beforeEach(()=>{vi.clearAllMocks();fixtures.state.lockRemainingMs=null;fixtures.state.settings.enabled=false;fixtures.state.mode='off';fixtures.state.inputSourceStatus='test';fixtures.state.resumeConfirmationRemainingMs=null;fixtures.state.restRemainingMs=180000});
it('renders safe opt-in defaults and privacy without enabling a runtime or OS lock',()=>{
  const html=renderToStaticMarkup(<StandingReminderPage/>);
  expect(html).toContain('45:00');expect(html).toContain('无操作确认');expect(html).toContain('自动锁屏（默认关闭）');
  expect(html).toContain('不记录键值、文本或鼠标轨迹');expect(html).toContain('隔离测试模式');
  expect(fixtures.act).not.toHaveBeenCalled();expect(fixtures.configure).not.toHaveBeenCalled();
});
it('explains confirmed rest, pause, next-round durations and full-screen limitations',()=>{
  const html=renderToStaticMarkup(<StandingReminderPage/>);
  expect(html).toContain('240');expect(html).toContain('零碎休息不累加');expect(html).toContain('会议暂停');
  expect(html).toContain('独占全屏');expect(html).toContain('程序关闭期间不当作已验证休息');
});
it('renders a nonmodal small prompt with rest, once-only snooze, collapse and cancel',()=>{
  fixtures.state.settings.enabled=true;fixtures.state.mode='working';fixtures.state.lockRemainingMs=15000;
  const html=renderToStaticMarkup(<StandingReminderPrompt/>);
  expect(html).toContain('aria-modal="false"');expect(html).toContain('开始休息');expect(html).toContain('稍后 5 分钟');
  expect(html).toContain('取消本轮锁屏');expect(html).toContain('00:15');expect(html).toContain('不会锁定当前会话');
  expect(fixtures.act).not.toHaveBeenCalled();
});
it('renders rest completion without a negative countdown',()=>{
  fixtures.state.settings.enabled=true;fixtures.state.mode='resting';
  fixtures.state.restRemainingMs=0;
  const html=renderToStaticMarkup(<StandingReminderPage/>);
  expect(html).toContain('00:00');expect(html).toContain('距离连续休息完成');
});
it('ceil countdown never announces a 15-second warning as zero early',()=>{
  expect(countdown(15000)).toBe('00:15');expect(countdown(1)).toBe('00:01');
  expect(countdown(0)).toBe('00:00');expect(countdown(-1)).toBe('00:00');
});

it('shows return confirmation while continuous rest remains visible',()=>{
  fixtures.state.settings.enabled=true;fixtures.state.mode='resting';
  fixtures.state.resumeConfirmationRemainingMs=2500;
  const html=renderToStaticMarkup(<StandingReminderPage/>);
  expect(html).toContain('正在确认恢复工作');expect(html).toContain('00:03');
  expect(html).toContain('确认期间继续计入休息');expect(html).toContain('非注入标记不是身份认证');
});
it('makes unavailable input-origin monitoring explicit without a human verdict',()=>{
  fixtures.state.settings.enabled=true;fixtures.state.mode='resting';fixtures.state.inputSourceStatus='unavailable';
  const html=renderToStaticMarkup(<StandingReminderPage/>);
  expect(html).toContain('输入来源监测不可用');expect(html).toContain('休息不会自动恢复为工作');
});
