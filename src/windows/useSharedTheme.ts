import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api, native } from '../services/api';
import type { Theme } from '../types';
export const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark' || value === 'codex';
export function useSharedTheme(): Theme {
  const [theme, setTheme] = useState<Theme>('codex');
  useEffect(() => {
    if (!native) return;
    let disposed = false, revision = 0, cleanup: (() => void) | undefined;
    void listen<Theme>('perfboard:theme-changed', event => {
      if (isTheme(event.payload)) { revision++; setTheme(event.payload); }
    }).then(async unlisten => {
      if (disposed) { unlisten(); return; }
      cleanup = unlisten; const current = revision;
      const value = await api.sharedTheme();
      if (!disposed && current === revision && isTheme(value)) setTheme(value);
    }).catch(() => {});
    return () => { disposed = true; cleanup?.(); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme;
    document.body.classList.toggle('dark', theme === 'dark'); document.body.classList.toggle('codex', theme === 'codex');
  }, [theme]);
  return theme;
}
