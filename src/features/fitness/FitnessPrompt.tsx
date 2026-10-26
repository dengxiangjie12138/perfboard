import { useEffect, useState } from 'react';
import { useSharedTheme } from '../../windows/useSharedTheme';
import { useFitness } from './fitnessApi';
import './fitness.css';
export function FitnessPrompt() {
  useSharedTheme();
  const { state, error, act } = useFitness();
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void act({ type: 'collapse' }); } }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [act]);
  const [busy,setBusy]=useState(false);
  const pending = state?.pending;
  const respond = async (outcome: 'complete' | 'later' | 'skip') => { if (!pending||busy)return;setBusy(true);try{await act({ type: 'respond', reminderId: pending.id, outcome });}finally{setBusy(false);} };
  async function start() {
    if (!pending || busy) return;
    setBusy(true);
    try { await act({ type: 'start', reminderId: pending.id }); } finally { setBusy(false); }
  }
  return <main className="fitness-prompt" role="dialog" aria-modal="false" aria-label="工作与健身提醒">
    <header><span className="muted">工作与健身</span><button className="icon-button" aria-label="关闭并稍后提醒" title="关闭等同于稍后提醒" onClick={() => void act({ type: 'collapse' })}>×</button></header>
    <h1>{pending?.exercise.name || '正在读取提醒…'}</h1><p>{pending?.exercise.instructions || '按自己的动作要求活动一下。'}</p>
    {(error || state?.error) && <p className="fitness-error" role="alert">{error || state?.error}</p>}
    <div className="button-row">
      <button className="primary" disabled={busy || !pending || !state?.promptVisible} onClick={() => void (pending?.started ? respond('complete') : start())}>{pending?.started ? '已完成' : '开始运动'}</button>
      <button disabled={busy || !pending || !state?.promptVisible} onClick={() => void respond('later')}>稍后 {state ? state.settings.snoozeMs / 60_000 : 2} 分钟</button>
      <button disabled={busy || !pending || !state?.promptVisible} onClick={() => void respond('skip')}>跳过</button>
    </div>
    <small className="muted">开始运动不记为完成，完成后可在工作与健身页面确认。稍后保留同一动作；关闭不清零、不算完成。</small>
  </main>;
}
