import { useEffect, useId, useRef, useState } from 'react';

export interface InlineRenameInputProps {
 initialValue: string;
 label: string;
 maxLength?: number;
 onCommit: (trimmed: string) => Promise<void>;
 onCancel: () => void;
}

/** The caller leaves editing mode after a successful commit. Blur cancels. */
export function InlineRenameInput({ initialValue, label, maxLength = 200, onCommit, onCancel }: InlineRenameInputProps) {
 const [value, setValue] = useState(initialValue);
 const [saving, setSaving] = useState(false);
 const [error, setError] = useState('');
 const input = useRef<HTMLInputElement>(null);
 const composing = useRef(false);
 const pending = useRef(false);
 const finished = useRef(false);
 const mounted = useRef(false);
 const errorId = useId();

 useEffect(() => {
  mounted.current = true;
  input.current?.focus();
  input.current?.select();
  return () => { mounted.current = false; };
 }, []);
 useEffect(() => {
  // Refocus after a failed submission re-enables the input, without selecting
  // over the user's draft. Disabling during submission can itself cause blur.
  if (error && !saving) input.current?.focus();
 }, [error, saving]);

 const cancel = () => {
  if (pending.current || finished.current) return;
  finished.current = true;
  onCancel();
 };
 const commit = async () => {
  if (pending.current || finished.current) return;
  const trimmed = value.trim();
  if (!trimmed) {
   setError('名称不能为空');
   return;
  }
  // The ref closes the gap before React renders the disabled input.
  pending.current = true;
  setSaving(true);
  setError('');
  try {
   await onCommit(trimmed);
   finished.current = true;
  } catch (failure) {
   if (mounted.current) {
    const reason = failure instanceof Error ? failure.message : typeof failure === 'string' ? failure : '';
    setError(reason.trim() || '保存失败，请重试');
   }
  } finally {
   pending.current = false;
   if (mounted.current) setSaving(false);
  }
 };

 return <span className="inline-rename" aria-busy={saving}>
  <input ref={input} type="text" className="inline-rename-input" aria-label={label} maxLength={maxLength} value={value} disabled={saving} autoComplete="off" spellCheck={false} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
   onChange={event => { if (!pending.current && !finished.current) { setValue(event.currentTarget.value); setError(''); } }}
   onCompositionStart={() => { composing.current = true; }}
   onCompositionEnd={() => { composing.current = false; }}
   onKeyDown={event => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.stopPropagation();
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (event.key === 'Escape') cancel();
    else void commit();
   }}
   onBlur={cancel}/>
  {error && <span id={errorId} className="inline-rename-error" role="alert">{error}</span>}
 </span>;
}
