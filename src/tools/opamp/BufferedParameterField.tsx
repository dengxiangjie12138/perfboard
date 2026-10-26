import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { OpAmpDraft } from './algorithm';
import { parameterLabel, type CircuitId, type ParameterKey } from './metadata';
import { ParameterField } from './ParameterField';
import { parameterDraft, pendingParameterDraft, prepareParameterEdit } from './parameterEdit';

/** Compact model controls follow the same explicit-confirmation rule as diagram editors. */
export function BufferedParameterField({ id, parameter, draft, error, onChange }: {
  id: CircuitId; parameter: ParameterKey; draft: OpAmpDraft; error?: string; onChange: (draft: OpAmpDraft) => void;
}) {
  const [editing, setEditing] = useState(false), [pending, setPending] = useState(() => parameterDraft(draft, parameter));
  const input = useRef<HTMLInputElement>(null), completed = useRef(false), meta = parameterLabel(id, parameter);
  const local = editing ? pendingParameterDraft(draft, parameter, pending) : draft;
  const prepared = editing ? prepareParameterEdit(id, draft, parameter, pending) : undefined;
  const localError = editing ? prepared && !prepared.ok ? prepared.error : undefined : error;
  const dirty = editing && (pending.value !== draft.values[parameter] || pending.unit !== parameterDraft(draft, parameter).unit);
  function cancel() { setEditing(false); }
  function confirm() {
    if (!editing || !prepared?.ok || completed.current) return;
    completed.current = true;
    if (dirty) onChange(prepared.draft);
    setEditing(false);
    input.current?.blur();
  }
  return <div className="opamp-buffered-field" onFocusCapture={() => {
    if (!editing) { completed.current = false; setPending(parameterDraft(draft, parameter)); setEditing(true); }
  }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) cancel(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); input.current?.blur(); }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && !(event.target instanceof HTMLSelectElement)) { event.preventDefault(); confirm(); }
  }}>
    <ParameterField id={id} parameter={parameter} draft={local} error={localError} onChange={next => setPending(parameterDraft(next, parameter))} inputRef={input} compact />
    {dirty && <div className="opamp-field-confirm"><span>Enter 确认 · Esc 取消</span><button type="button" aria-label={`取消 ${meta.symbol} 修改`} onClick={cancel}><X size={12}/></button><button type="button" aria-label={`确认 ${meta.symbol} 修改`} disabled={!!localError} onClick={confirm}><Check size={12}/></button></div>}
  </div>;
}
