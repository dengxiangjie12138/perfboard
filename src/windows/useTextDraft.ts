import { useEffect, useRef, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { native, errorMessage } from '../services/api';
import { registerFlush } from '../services/saveRegistry';
import { readTextDraft, textDraftKey, writeTextDraft } from './textDraft';
export function useTextDraft(tool: string): [string, (value: string) => void, string] {
  const [initial] = useState(() => {
    const key = textDraftKey(native ? getCurrentWebviewWindow().label : 'main', tool);
    try { return { key, raw: readTextDraft(window.localStorage, key), error: '' }; }
    catch (error) { return { key, raw: '', error: errorMessage(error) }; }
  });
  const [raw, setRaw] = useState(initial.raw), [notice, setNotice] = useState(initial.error);
  const latest = useRef(raw), unreadable = useRef(initial.error);
  function save(value: string) { writeTextDraft(window.localStorage, initial.key, value); }
  function edit(value: string) {
    latest.current = value; unreadable.current = ''; setRaw(value);
    try { save(value); setNotice('原文已保存到本窗口的本地草稿；关闭、刷新或重新打开后恢复。'); }
    catch (error) { setNotice('草稿保存失败，关闭或退出将被阻止：' + errorMessage(error)); }
  }
  useEffect(() => {
    const flush = async () => { if (unreadable.current) throw new Error(unreadable.current); save(latest.current); };
    const cleanup = registerFlush(flush);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      try { if (unreadable.current) throw new Error(unreadable.current); save(latest.current); }
      catch { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { cleanup(); window.removeEventListener('beforeunload', beforeUnload); };
  // The per-webview storage key is fixed for this component lifetime.
  }, [initial.key]);
  return [raw, edit, notice];
}
