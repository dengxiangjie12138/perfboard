import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export interface ReminderSettings {
  enabled: boolean; workSeconds: number; restSeconds: number; idleSeconds: number;
  sound: boolean; autoLock: boolean;
}
export type ReminderAction = 'startRest'|'snooze'|'dismiss'|'collapse'|'skip'|'cancelLock'|'pause'|'resume';
export interface ReminderSnapshot {
  settings: ReminderSettings; activeDurations: Pick<ReminderSettings,'workSeconds'|'restSeconds'|'idleSeconds'>;
  pendingDurations: boolean; mode: 'off'|'working'|'resting'|'systemRest'|'paused';
  workMs: number; workRemainingMs: number; restMs: number; restRemainingMs: number;
  idleConfirmationRemainingMs: number; due: boolean; roundId: number; promptToken: number;
  promptVisible: boolean; promptPresented: boolean; reminderCount: number; snoozeUsed: boolean;
  snoozeRemainingMs: number|null; lockRemainingMs: number|null; lockAttempted: boolean;
  inputSourceStatus: 'inactive'|'starting'|'filtered'|'unavailable'|'test';
  resumeConfirmationRemainingMs: number|null;
  error: string|null; testMode: boolean; systemMonitorAvailable: boolean; simulatedLockRequests: number;
}
export const reminderApi = {
  status: () => invoke<ReminderSnapshot>('standing_reminder_status'),
  configure: (settings: Partial<ReminderSettings>) => invoke<ReminderSnapshot>('standing_reminder_configure',{settings}),
  action: (action: ReminderAction) => invoke<ReminderSnapshot>('standing_reminder_action',{action}),
  presented: (token: number) => invoke<ReminderSnapshot>('standing_reminder_prompt_presented',{token}),
};
export function useReminder() {
  const [state,setState] = useState<ReminderSnapshot|null>(null);
  const [error,setError] = useState('');
  useEffect(() => {
    let alive = true; let stop: (()=>void)|undefined;
    if (!isTauri()) { setError('久坐提醒需要 Windows 桌面应用的后台服务；浏览器预览不会采集输入或计时。'); return; }
    void reminderApi.status().then(s=>{if(alive)setState(s)}).catch(e=>{if(alive)setError(String(e))});
    void listen<ReminderSnapshot>('perfboard:standing-reminder',event=>{if(alive)setState(event.payload)})
      .then(unlisten=>{if(alive)stop=unlisten;else unlisten()})
      .catch(e=>{if(alive)setError(String(e))});
    return ()=>{alive=false;stop?.()};
  },[]);
  async function act(action: ReminderAction) {
    setError('');
    try { setState(await reminderApi.action(action)); } catch(e) { setError(String(e)); }
  }
  async function configure(settings: Partial<ReminderSettings>) {
    setError('');
    try { setState(await reminderApi.configure(settings)); return true; } catch(e) { setError(String(e)); return false; }
  }
  return {state,error,act,configure};
}
export function countdown(milliseconds: number) {
  const seconds = Math.max(0,Math.ceil(milliseconds/1000));
  return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
}
