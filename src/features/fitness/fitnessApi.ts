import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
export interface FitnessExercise { id: string; name: string; instructions: string; selected: boolean }
export interface FitnessSettings { enabled: boolean; intervalMs: number; idleMs: number; snoozeMs: number }
export type FitnessOutcome = 'complete' | 'later' | 'skip';
export interface FitnessReminder { id: number; exercise: FitnessExercise; issuedAtMs: number; snoozeActiveRemainingMs: number; started: boolean }
export interface FitnessHistory { id: number; reminderId: number; exerciseName: string; outcome: FitnessOutcome; atMs: number; cycleActiveMs: number }
export interface FitnessSnapshot {
  version: 1; settings: FitnessSettings; pool: FitnessExercise[]; activeMs: number; totalActiveMs: number; dailyActiveMs: number; dailyActiveDay: string | null;
  pending: FitnessReminder | null; history: FitnessHistory[]; nextId: number;
  sourceAvailable: boolean; blocked: boolean; systemMonitorAvailable: boolean; promptVisible: boolean; idle:boolean; error: string | null;
}
export type FitnessAction = { type: 'respond'; reminderId: number; outcome: FitnessOutcome } | { type: 'start'; reminderId: number } | { type: 'reset' | 'show' | 'collapse' };
export interface FitnessConfigure { settings: FitnessSettings; pool: FitnessExercise[] }
export function initialFitnessSnapshot(): FitnessSnapshot {
  return { version: 1, settings: { enabled: false, intervalMs: 600_000, idleMs: 30_000, snoozeMs: 120_000 },
    pool: [{ id: 'push-ups', name: '俯卧撑', instructions: '', selected: false }, { id: 'squats', name: '深蹲', instructions: '', selected: false }, { id: 'horse-stance', name: '马步', instructions: '', selected: false }],
    activeMs: 0, totalActiveMs: 0, dailyActiveMs: 0, dailyActiveDay: null, pending: null, history: [], nextId: 1, sourceAvailable: false, blocked: true, systemMonitorAvailable: false, promptVisible: false, idle:true, error: null };
}
export const fitnessApi = {
  status: () => invoke<FitnessSnapshot>('fitness_status'),
  configure: (request: FitnessConfigure) => invoke<FitnessSnapshot>('fitness_configure', { request }),
  action: (action: FitnessAction) => invoke<FitnessSnapshot>('fitness_action', { action }),
};
export function useFitness() {
  const desktop = isTauri();
  const [state, setState] = useState<FitnessSnapshot | null>(() => desktop ? null : initialFitnessSnapshot());
  const [error, setError] = useState(''); const revision = useRef(0), alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    if (!desktop) return () => { alive.current = false; };
    let disposed = false; let cleanup: (() => void) | undefined;
    void listen<FitnessSnapshot>('perfboard:fitness', event => { if (!disposed) { revision.current++; setState(event.payload); } }).then(async unlisten => {
      if (disposed) { unlisten(); return; } cleanup = unlisten;
      const before = revision.current; const value = await fitnessApi.status();
      if (!disposed && before === revision.current) setState(value);
    }).catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; alive.current = false; cleanup?.(); };
  }, [desktop]);
  const configure = useCallback(async (request: FitnessConfigure) => {
    if (!desktop) { setError('浏览器预览不会启动计时或保存设置。'); return false; }
    setError(''); const before = revision.current;
    try { const value = await fitnessApi.configure(request); if (alive.current && before === revision.current) setState(value); return true; }
    catch (error) { if (alive.current) setError(String(error)); return false; }
  }, [desktop]);
  const act = useCallback(async (action: FitnessAction) => {
    if (!desktop) { setError('请在 Perfboard 桌面应用中处理提醒。'); return false; }
    setError(''); const before = revision.current;
    try { const value = await fitnessApi.action(action); if (alive.current && before === revision.current) setState(value); return true; }
    catch (error) { if (alive.current) setError(String(error)); return false; }
  }, [desktop]);
  return { state, error, desktop, configure, act };
}
export function fitnessDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60), seconds = total % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
