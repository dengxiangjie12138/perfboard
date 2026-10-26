import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitnessSnapshot } from '../fitness/fitnessApi';
import type { ReminderSnapshot } from './reminderApi';

export interface AttentionSettings { enabled: boolean; delaySeconds: number }
export interface AttentionSnapshot {
  settings: AttentionSettings;
  active: boolean;
  escalated: boolean;
  standing: ReminderSnapshot | null;
  fitness: FitnessSnapshot | null;
  error: string | null;
}
export type AttentionAction =
  | { type: 'standing'; action: 'startRest' | 'later' | 'skip' | 'cancelLock' }
  | { type: 'fitness'; action: 'start' | 'complete' | 'later' | 'skip'; reminderId: number }
  | { type: 'laterAll' };
export function initialAttentionSnapshot(): AttentionSnapshot {
  return { settings: { enabled: true, delaySeconds: 300 }, active: false, escalated: false, standing: null, fitness: null, error: null };
}
export const attentionApi = {
  status: () => invoke<AttentionSnapshot>('reminder_attention_status'),
  ready: () => invoke<void>('reminder_attention_ready'),
  configure: (settings: AttentionSettings) => invoke<AttentionSnapshot>('reminder_attention_configure', { settings }),
  action: (action: AttentionAction) => invoke<AttentionSnapshot>('reminder_attention_action', { action }),
};
export function useAttention() {
  const desktop = isTauri();
  const [state, setState] = useState<AttentionSnapshot | null>(() => desktop ? null : initialAttentionSnapshot());
  const [error, setError] = useState('');
  const alive = useRef(false), revision = useRef(0);
  useEffect(() => {
    alive.current = true;
    if (!desktop) return () => { alive.current = false; };
    let disposed = false, unlisten: (() => void) | undefined;
    void listen<AttentionSnapshot>('perfboard:reminder-attention', event => {
      if (!disposed) { revision.current++; setState(event.payload); }
    }).then(async cleanup => {
      if (disposed) { cleanup(); return; }
      unlisten = cleanup;
      const before = revision.current;
      const next = await attentionApi.status();
      if (!disposed && before === revision.current) setState(next);
    }).catch(failure => { if (!disposed) setError(String(failure)); });
    return () => { disposed = true; alive.current = false; unlisten?.(); };
  }, [desktop]);
  const configure = useCallback(async (settings: AttentionSettings) => {
    if (!desktop) { setError('浏览器预览不会保存提醒设置。'); return false; }
    setError('');
    const before = revision.current;
    try {
      const next = await attentionApi.configure(settings);
      if (alive.current && before === revision.current) setState(next);
      return true;
    } catch (failure) { if (alive.current) setError(String(failure)); return false; }
  }, [desktop]);
  const act = useCallback(async (action: AttentionAction) => {
    if (!desktop) { setError('请在桌面应用中处理提醒。'); return false; }
    setError('');
    const before = revision.current;
    try {
      const next = await attentionApi.action(action);
      if (alive.current && before === revision.current) setState(next);
      return true;
    } catch (failure) { if (alive.current) setError(String(failure)); return false; }
  }, [desktop]);
  return { state, error, desktop, configure, act };
}
