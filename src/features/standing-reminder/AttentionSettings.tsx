import { useEffect, useRef, useState } from 'react';
import { registerFlush } from '../../services/saveRegistry';
import { useAttention, type AttentionSettings as Settings } from './attentionApi';
import './reminder-attention.css';

/** Shared native setting: changing it on either tool page updates both reminders. */
export function AttentionSettings() {
  const { state, error, desktop, configure } = useAttention();
  const [settings, setSettings] = useState<Settings>({ enabled: true, delaySeconds: 300 });
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const latest = useRef({ dirty, settings });
  latest.current = { dirty, settings };
  useEffect(() => { if (state && !dirty) setSettings({ ...state.settings }); }, [state, dirty]);
  const saving = useRef<Promise<boolean> | null>(null);
  async function save() {
    if (saving.current) return saving.current;
    const current = latest.current;
    if (!current.dirty) return true;
    setBusy(true);
    const task = configure(current.settings).then(ok => { if (ok) setDirty(false); return ok; });
    saving.current = task;
    try { return await task; } finally { saving.current = null; setBusy(false); }
  }
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => registerFlush(async () => {
    if (desktop && latest.current.dirty && !await saveRef.current()) throw new Error('增强提醒设置保存失败，请重试后再离开。');
  }), [desktop]);
  return <section className="attention-settings" aria-label="增强提醒设置">
    <h3>未处理时增强提醒</h3>
    <p>久坐和健身共用此设置与一个活动提醒窗口。未处理时，当前窗口会扩展为大提醒，副屏只显示半透明遮罩和退出入口。</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="attention-setting-switch"><input type="checkbox" checked={settings.enabled} disabled={!desktop || busy || !state} onChange={event => { setSettings(current => ({ ...current, enabled: event.target.checked })); setDirty(true); }} />启用增强提醒</label>
      <label className="attention-delay">未处理等待 <input aria-label="增强提醒等待（分钟）" type="number" required min="1" max="60" step="1" value={settings.delaySeconds / 60} disabled={!desktop || busy || !state || !settings.enabled} onChange={event => { setSettings(current => ({ ...current, delaySeconds: Math.round(Number(event.target.value) * 60) })); setDirty(true); }} /> 分钟</label>
      <button type="submit" disabled={!desktop || !dirty || busy}>{busy ? '保存中…' : '保存增强提醒设置'}</button>
      {dirty && <button type="button" disabled={busy} onClick={() => setDirty(false)}>撤销</button>}
    </form>
    <p>可用“稍后全部”、Esc 或关闭窗口解除提醒；开始运动后在当前窗口确认完成。锁屏、睡眠时暂停打扰。</p>
    {(error || state?.error) && <p className="attention-error" role="alert">{error || state?.error}</p>}
  </section>;
}
