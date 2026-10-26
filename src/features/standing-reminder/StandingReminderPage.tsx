import {useEffect,useState} from 'react';
import { countdown, useReminder } from './reminderApi';
import './standing-reminder.css';
import '../../components/enable-switch.css';
import {ActivityLogDayTable} from './ActivityLogDayTable';
import {AttentionSettings} from './AttentionSettings';

const modeLabels = {off:'已关闭',working:'工作中',resting:'连续休息',systemRest:'锁屏 / 睡眠休息',paused:'会议暂停'};
export default function StandingReminderPage() {
  const {state,error,act,configure} = useReminder();
  const [work,setWork] = useState(45), [rest,setRest] = useState(3), [idle,setIdle] = useState(60);
  const [dirty,setDirty] = useState(false), [busy,setBusy] = useState(false);
  useEffect(()=>{
    if(state&&!dirty){setWork(state.settings.workSeconds/60);setRest(state.settings.restSeconds/60);setIdle(state.settings.idleSeconds)}
  },[state,dirty]);
  async function durations() {
    if(!state||busy)return;
    setBusy(true);
    const ok=await configure({workSeconds:Math.round(work*60),restSeconds:Math.round(rest*60),idleSeconds:Math.round(idle)});
    setBusy(false);if(ok)setDirty(false);
  }
  if(!state)return <div className="standing-page"><h2>久坐提醒</h2><p role="status">{error||'正在读取后台状态…'}</p></div>;
  const resting=state.mode==='resting'||state.mode==='systemRest';
  const enabled=state.settings.enabled;
  return <section className="standing-page" aria-label="久坐提醒">
    <header className="standing-heading"><div><h2>久坐提醒</h2><p>起身走走，让连续休息重新开启一轮工作。</p></div>
      <label className="standing-switch enable-switch"><input role="switch" type="checkbox" checked={enabled} disabled={busy} onChange={e=>{setBusy(true);void configure({enabled:e.target.checked}).finally(()=>setBusy(false));}}/>启用提醒</label>
    </header>
    {state.testMode&&<p className="standing-info">隔离测试模式：模拟输入与系统事件，不采集当前会话输入，不会真实锁屏。</p>}
    {(error||state.error)&&<p className="standing-error" role="alert">{error||state.error}</p>}
    <div className="standing-current">
      <span className="standing-state" data-testid="standing-mode">{modeLabels[state.mode]}</span>
      <div className="standing-time" data-testid="standing-countdown">{countdown(resting?state.restRemainingMs:state.workRemainingMs)}</div>
      <p>{resting?'距离连续休息完成':state.due?'本轮已到提醒时间，请开始休息':'距离下一次起身提醒'}</p>
      {state.mode==='resting'&&state.resumeConfirmationRemainingMs!==null&&<p className="standing-info" role="status">正在确认恢复工作：请持续键鼠操作，还需 {countdown(state.resumeConfirmationRemainingMs)}。确认期间继续计入休息。</p>}
      {enabled&&state.inputSourceStatus==='starting'&&<p className="standing-info" role="status">正在启动输入来源监测…</p>}
      {enabled&&state.inputSourceStatus==='unavailable'&&<p className="standing-error" role="alert">输入来源监测不可用，无法确认键鼠是否为非注入输入；休息不会自动恢复为工作。</p>}
      <div className="standing-metrics"><span>本轮工作 <b>{countdown(state.workMs)}</b></span><span>连续休息 <b>{countdown(state.restMs)}</b></span></div>
      {state.snoozeRemainingMs!==null&&<p>稍后提醒：{countdown(state.snoozeRemainingMs)}（本轮一次）</p>}
      {state.lockRemainingMs!==null&&<p className="standing-warning">自动锁屏预警 {countdown(state.lockRemainingMs)} <button onClick={()=>void act('cancelLock')}>取消本轮锁屏</button></p>}
      <div className="standing-actions">
        <button disabled={!enabled||state.mode==='paused'} onClick={()=>void act('startRest')}>开始休息</button>
        <button disabled={!enabled} onClick={()=>void act(state.mode==='paused'?'resume':'pause')}>{state.mode==='paused'?'继续计时':'暂停（会议）'}</button>
        {state.due&&<button disabled={!enabled||state.snoozeUsed} onClick={()=>void act('snooze')}>稍后 5 分钟</button>}
      </div>
    </div>
    <form className="standing-settings" onSubmit={e=>{e.preventDefault();void durations()}}>
      <h3>时长设置</h3>
      <div className="standing-fields">
        <label>工作时长 <span><input aria-label="工作时长（分钟）" type="number" min="1" max="1440" step="1" value={work} onChange={e=>{setWork(Number(e.target.value));setDirty(true)}}/>分钟</span></label>
        <label>连续休息 <span><input aria-label="连续休息（分钟）" type="number" min="1" max="120" step="1" value={rest} onChange={e=>{setRest(Number(e.target.value));setDirty(true)}}/>分钟</span></label>
        <label>无操作确认 <span><input aria-label="无操作确认（秒）" type="number" min="1" max="3600" step="1" value={idle} onChange={e=>{setIdle(Number(e.target.value));setDirty(true)}}/>秒</span></label>
      </div>
      <p>确认期仍计入工作，之后才开始连续休息。按当前设置，自动离开满 {state.settings.idleSeconds+state.settings.restSeconds} 秒可清零；短暂离开保留工作累计，零碎休息不累加。</p>
      {state.pendingDurations&&<p className="standing-info">新时长已保存，将在本轮连续休息完成后的下一轮生效。当前轮：工作 {state.activeDurations.workSeconds/60} 分钟 / 休息 {state.activeDurations.restSeconds/60} 分钟。</p>}
      <button type="submit" disabled={!dirty||busy}>{busy?'保存中…':'保存时长'}</button>
    </form>
    <div className="standing-options">
      <label><input type="checkbox" checked={state.settings.sound} onChange={e=>void configure({sound:e.target.checked})}/>提示声音</label>
      <label><input type="checkbox" checked={state.settings.autoLock} onChange={e=>void configure({autoLock:e.target.checked})}/>自动锁屏（默认关闭）</label>
      <p>提醒窗实际显示后才开始 15 秒可取消预警；收起仍继续预警。休息、暂停、稍后或关闭自动锁屏都会取消尚未发出的请求。本轮最多请求一次，失败不会循环重试。</p>
      <p>锁屏和睡眠计入连续休息；会议暂停冻结计时且不算休息。异常间隔和程序关闭期间不当作已验证休息，重启不补过期提醒。无需打开主窗口或连接仓库。</p>
      <p className="standing-info">提示不抢焦点，可显示在普通全屏窗口上方；无法保证覆盖独占全屏或 Windows 安全桌面。只处理输入标记和聚合时间，不记录键值、文本或鼠标轨迹。</p>
      <p className="standing-info">休息中连续键鼠操作满 5 秒后恢复工作，操作间隔超过 1 秒会重新确认；单次触碰不结束休息。常见软件注入输入不参与确认。非注入标记不是身份认证，虚拟硬件、驱动输入及部分远程或辅助工具无法可靠区分。Windows 可静默移除超时监测，无法保证识别所有监测丢失。</p>
    </div>
    <AttentionSettings/>
    <ActivityLogDayTable/>
  </section>;
}
export {StandingReminderPage};
