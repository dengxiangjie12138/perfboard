import { useCallback, useRef, useState } from 'react';
import { autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift, useDismiss, useFloating, useInteractions, useRole } from '@floating-ui/react';
import { Check, X } from 'lucide-react';
import type { OpAmpDraft } from './algorithm';
import { parameterLabel, type CircuitId, type ParameterKey } from './metadata';
import { ParameterField } from './ParameterField';
import { parameterDraft, pendingParameterDraft, prepareParameterEdit } from './parameterEdit';

export interface ParameterEdit { parameter: ParameterKey; anchor: Element }
export function InlineParameterEditor({ id, edit, draft, onChange, onClose }: {
  id: CircuitId; edit: ParameterEdit; draft: OpAmpDraft;
  onChange: (draft: OpAmpDraft) => void; onClose: () => void;
}) {
  const [pending, setPending] = useState(() => parameterDraft(draft, edit.parameter));
  const completed = useRef(false), prepared = prepareParameterEdit(id, draft, edit.parameter, pending);
  const error = prepared.ok ? undefined : prepared.error;
  const { refs, floatingStyles, context } = useFloating({
    open: true, onOpenChange: open => { if (!open) onClose(); }, placement: 'top', strategy: 'fixed',
    elements: { reference: edit.anchor }, middleware: [offset(10), flip({ padding: 12 }), shift({ padding: 12 })], whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { escapeKey: false }), role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);
  const focusInput = useCallback((element: HTMLInputElement | null) => {
    if (element) { element.focus({ preventScroll: true }); element.select(); }
  }, []);
  const meta = parameterLabel(id, edit.parameter);
  function confirm() {
    if (!prepared.ok || completed.current) return;
    completed.current = true;
    onChange(prepared.draft);
    onClose();
  }
  return <FloatingPortal><FloatingFocusManager context={context} initialFocus={-1} modal={false} returnFocus={false}>
    <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="opamp-editor" aria-label={`编辑 ${meta.symbol}`} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && !(event.target instanceof HTMLSelectElement)) { event.preventDefault(); confirm(); }
    }}>
      <header><strong>编辑 {meta.symbol}</strong><button className="icon-button" aria-label="取消本次编辑" onClick={onClose}><X size={14} /></button></header>
      <ParameterField id={id} parameter={edit.parameter} draft={pendingParameterDraft(draft, edit.parameter, pending)} error={error} onChange={next => setPending(parameterDraft(next, edit.parameter))} inputRef={focusInput} />
      <footer><span>确认后生效 · Esc / 外点取消</span><button className="small" disabled={!!error} onClick={confirm}><Check size={13} />完成</button></footer>
    </div>
  </FloatingFocusManager></FloatingPortal>;
}
