import {useEffect} from 'react';
import {countdown,reminderApi,useReminder} from './reminderApi';
import './standing-reminder.css';

export function StandingReminderPrompt() {
  const {state,error,act}=useReminder();
  useEffect(()=>{
    if(!state?.promptVisible||state.promptPresented)return;
    let second=0;
    const first=requestAnimationFrame(()=>{
      second=requestAnimationFrame(()=>{
        if(document.visibilityState==='visible'&&document.querySelector('[data-testid="standing-prompt"]')?.getBoundingClientRect().width) {
          void reminderApi.presented(state.promptToken).catch(()=>undefined);
        }
      });
    });
    return ()=>{cancelAnimationFrame(first);cancelAnimationFrame(second)};
  },[state?.promptVisible,state?.promptPresented,state?.promptToken]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();void act('dismiss')}};
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[act]);
  return <main className="standing-prompt" data-testid="standing-prompt" role="dialog" aria-label="起身休息提醒" aria-modal="false">
    <header><span className="standing-prompt-mark">起身休息</span><button aria-label="关闭并稍后 5 分钟提醒" title="关闭后 5 分钟再提醒" onClick={()=>void act('dismiss')}>×</button></header>
    <h1>{state&&state.reminderCount>1?'工作还没结束，先休息一下':'该起来走走了'}</h1>
    <p>已工作 {state?countdown(state.workMs):'…'}，连续休息 {state?state.activeDurations.restSeconds/60:3} 分钟后开启下一轮。</p>
    {state?.lockRemainingMs!==null&&state?.lockRemainingMs!==undefined&&<div className="standing-warning" role="status">
      {countdown(state.lockRemainingMs)} 后请求自动锁屏
      <button onClick={()=>void act('cancelLock')}>取消本轮锁屏</button>
    </div>}
    {state?.testMode&&<p className="standing-info">隔离测试：不会锁定当前会话</p>}
    {(error||state?.error)&&<p className="standing-error" role="alert">{error||state?.error}</p>}
    <div className="standing-actions">
      <button className="standing-primary" disabled={!state?.settings.enabled} onClick={()=>void act('startRest')}>开始休息</button>
      <button disabled={!state?.settings.enabled||state.snoozeUsed} onClick={()=>void act('snooze')}>稍后 5 分钟</button>
      <button onClick={()=>void act('skip')}>跳过本次</button>
    </div>
    <small>关闭或 Esc 会稍后提醒。开始休息后按连续休息时长计时，短休息保留工作累计。</small>
  </main>;
}
export default StandingReminderPrompt;
