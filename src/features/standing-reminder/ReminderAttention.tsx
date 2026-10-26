import { useCallback, useEffect, useRef, useState } from 'react';
import { useSharedTheme } from '../../windows/useSharedTheme';
import { countdown } from './reminderApi';
import { attentionApi, useAttention, type AttentionAction, type AttentionSnapshot } from './attentionApi';
import './reminder-attention.css';

interface AttentionPanelProps {
  state: AttentionSnapshot | null;
  error: string;
  busy: boolean;
  backdrop?: boolean;
  onAction: (action: AttentionAction) => void;
}
export function AttentionPanel({ state, error, busy, backdrop = false, onAction }: AttentionPanelProps) {
  const standing = state?.standing, fitness = state?.fitness, pending = fitness?.pending;
  const overlay = backdrop || Boolean(state?.escalated);
  const errors = [...new Set([error, state?.error, standing?.error, fitness?.error].filter(Boolean))];
  const close = <button type="button" className="attention-exit" data-attention-close aria-label="关闭并稍后提醒全部" onClick={() => onAction({ type: 'laterAll' })}>
    {overlay ? '关闭遮罩' : '关闭提醒'} · 稍后全部 <kbd>Esc</kbd>
  </button>;
  if (backdrop) return <main className="reminder-attention attention-backdrop" aria-label="活动提醒遮罩" data-testid="reminder-attention-backdrop">
    {close}
    <p className="attention-backdrop-note">活动提醒在主提醒窗口中。按 Esc 或关闭可稍后处理全部提醒。</p>
    {errors.length > 0 && <div className="attention-backdrop-error" role="alert">{errors.join('；')}</div>}
  </main>;
  return <main className={`reminder-attention ${overlay ? 'attention-overlay' : 'attention-compact'}`} role="dialog" aria-modal={overlay} aria-label="活动提醒" data-testid="reminder-attention">
    {close}
    <section className="attention-panel">
      <header>
        <span className="attention-eyebrow">活动提醒</span>
        <h1>{pending?.started ? '运动进行中' : overlay ? '给自己一段休息时间' : '该活动一下了'}</h1>
        <p>{pending?.started ? '按自己的节奏完成动作，再确认完成。' : '久坐与健身提醒在这里一起处理。'}</p>
      </header>
      {!state && <p role="status">正在读取提醒…</p>}
      {state && !state.active && <p role="status">提醒已处理，正在关闭提醒…</p>}
      {errors.length > 0 && <div className="attention-error" role="alert">{errors.map(message => <p key={message}>{message}</p>)}<p>可重试操作；关闭或 Esc 始终可用。</p></div>}
      {busy && <p className="attention-pending" role="status">正在处理… 需要离开时可直接关闭或按 Esc。</p>}
      {standing && <article className="attention-card" aria-label="久坐休息">
        <div className="attention-card-heading"><span className="attention-kind">久坐提醒</span><span>已工作 {countdown(standing.workMs)}</span></div>
        <h2>起来走走</h2><p>连续休息 {standing.activeDurations.restSeconds / 60} 分钟后开启下一轮。</p>
        {standing.lockRemainingMs !== null && <div className="attention-lock" role="status">
          <span>{countdown(standing.lockRemainingMs)} 后请求自动锁屏</span>
          <button type="button" onClick={() => onAction({ type: 'standing', action: 'cancelLock' })}>取消本轮锁屏</button>
        </div>}
        <div className="attention-actions">
          <button type="button" className="primary" disabled={busy || !state?.active} onClick={() => onAction({ type: 'standing', action: 'startRest' })}>开始休息</button>
          <button type="button" disabled={busy || !state?.active} onClick={() => onAction({ type: 'standing', action: 'later' })}>稍后 5 分钟</button>
          <button type="button" disabled={busy || !state?.active} onClick={() => onAction({ type: 'standing', action: 'skip' })}>跳过本次</button>
        </div>
      </article>}
      {fitness && pending && <article className={`attention-card${pending.started ? ' attention-exercise-started' : ''}`} aria-label="健身活动">
        <div className="attention-card-heading"><span className="attention-kind">工作与健身</span><span>{pending.started ? '进行中 · 等待确认完成' : '本轮随机动作'}</span></div>
        <h2>{pending.exercise.name}</h2><p>{pending.exercise.instructions || '按自己的动作要求活动一下。'}</p>
        {pending.started && <p className="attention-progress" role="status">已开始运动，完成后点击“已完成”。</p>}
        <div className="attention-actions">
          <button type="button" className="primary" disabled={busy || !state?.active} onClick={() => onAction({ type: 'fitness', action: pending.started ? 'complete' : 'start', reminderId: pending.id })}>{pending.started ? '已完成' : '开始运动'}</button>
          <button type="button" disabled={busy || !state?.active} onClick={() => onAction({ type: 'fitness', action: 'later', reminderId: pending.id })}>稍后 {fitness.settings.snoozeMs / 60_000} 分钟</button>
          <button type="button" disabled={busy || !state?.active} onClick={() => onAction({ type: 'fitness', action: 'skip', reminderId: pending.id })}>跳过本次</button>
        </div>
      </article>}
      <footer>关闭或 Esc 会稍后提醒，不记为完成。{overlay && '系统快捷键仍可使用。'}</footer>
    </section>
  </main>;
}
export function ReminderAttention({ backdrop = false }: { backdrop?: boolean }) {
  useSharedTheme();
  const { state, error, act } = useAttention();
  const [busy, setBusy] = useState(false);
  const [readyError, setReadyError] = useState('');
  const inFlight = useRef(0);
  const readySent = useRef(false);
  useEffect(() => {
    if (!state?.active || readySent.current) return;
    let disposed = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const checkReady = () => {
      if (disposed || readySent.current) return;
      attempts++;
      const close = document.querySelector<HTMLButtonElement>('[data-attention-close]');
      if (!close || close.disabled || close.getBoundingClientRect().width <= 0) {
        if (attempts < 20) retry = setTimeout(checkReady, 100);
        return;
      }
      // Hidden native webviews can measure their DOM but may pause animation frames.
      readySent.current = true;
      void attentionApi.ready().then(() => {
        if (!disposed) setReadyError('');
      }).catch(failure => {
        readySent.current = false;
        if (disposed) return;
        setReadyError(`提醒显示确认失败：${String(failure)}`);
        if (attempts < 20) retry = setTimeout(checkReady, 100);
      });
    };
    checkReady();
    return () => { disposed = true; if (retry) clearTimeout(retry); };
  }, [state?.active]);
  const run = useCallback(async (action: AttentionAction) => {
    // Closing and cancelling a lock stay available while a different action is pending.
    const immediate = action.type === 'laterAll' || (action.type === 'standing' && action.action === 'cancelLock');
    if (inFlight.current && !immediate) return;
    inFlight.current++; setBusy(true);
    try { await act(action); } finally { inFlight.current--; setBusy(inFlight.current > 0); }
  }, [act]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); void run({ type: 'laterAll' }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [run]);
  return <AttentionPanel state={state} error={error || readyError} busy={busy} backdrop={backdrop} onAction={action => { void run(action); }} />;
}
