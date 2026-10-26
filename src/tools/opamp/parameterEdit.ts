import { calculateOpAmp, isPassiveKey, type OpAmpDraft } from './algorithm';
import type { CircuitId, ParameterKey, PassiveUnit } from './metadata';

export interface ParameterDraft { value: string; unit?: PassiveUnit }
export const parameterDraft = (draft: OpAmpDraft, key: ParameterKey): ParameterDraft => ({
  value: draft.values[key], ...(isPassiveKey(key) ? { unit: draft.units[key] } : {}),
});

/** Validate a single pending edit without changing the applied circuit or its logic memory. */
export function prepareParameterEdit(id: CircuitId, applied: OpAmpDraft, key: ParameterKey, pending: ParameterDraft):
  { ok: true; draft: OpAmpDraft } | { ok: false; error: string } {
  const next = pendingParameterDraft(applied, key, pending);
  const result = calculateOpAmp(id, next);
  if (!result.ok) {
    const previous = calculateOpAmp(id, applied), oldErrors = previous.ok ? {} : previous.errors;
    const error = result.errors[key] ?? (Object.entries(result.errors) as [ParameterKey, string][]).find(([k, value]) => oldErrors[k] !== value)?.[1];
    if (error) return { ok: false, error };
  }
  return { ok: true, draft: next };
}

export function pendingParameterDraft(applied: OpAmpDraft, key: ParameterKey, pending: ParameterDraft): OpAmpDraft {
  return { ...applied, values: { ...applied.values, [key]: pending.value },
    units: isPassiveKey(key) ? { ...applied.units, [key]: pending.unit ?? applied.units[key] } : applied.units };
}
