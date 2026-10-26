import type { Ref } from 'react';
import { isResistanceKey, isPassiveKey, type OpAmpDraft } from './algorithm';
import { parameterLabel, type CircuitId, type ParameterKey, type PassiveUnit } from './metadata';

export function ParameterField({ id, parameter, draft, error, onChange, inputRef, compact = false }: {
  id: CircuitId; parameter: ParameterKey; draft: OpAmpDraft; error?: string;
  onChange: (draft: OpAmpDraft) => void; inputRef?: Ref<HTMLInputElement>; compact?: boolean;
}) {
  const meta = parameterLabel(id, parameter), resistance = isResistanceKey(parameter), passive = isPassiveKey(parameter);
  return <div className={'opamp-field' + (compact ? ' compact' : '')}>
    <label htmlFor={`opamp-${parameter}`} title={meta.label}><b>{compact && parameter === 'headroom' ? '摆幅余量 H' : meta.symbol}</b>{!compact && <span>{meta.label}</span>}</label>
    <div className={'opamp-input' + (error ? ' invalid' : '')}>
      <input ref={inputRef} id={`opamp-${parameter}`} aria-label={`${meta.symbol} ${meta.label}`} type="number" step="any" value={draft.values[parameter]} aria-invalid={!!error} aria-describedby={error ? `opamp-error-${parameter}` : undefined}
        onChange={event => onChange({ ...draft, values: { ...draft.values, [parameter]: event.target.value } })} />
      {passive ? <select aria-label={`${meta.symbol} ${resistance ? '电阻' : '电容'}单位`} value={draft.units[parameter]} onChange={event => onChange({ ...draft, units: { ...draft.units, [parameter]: Number(event.target.value) as PassiveUnit } })}>
        {resistance ? <><option value="1">Ω</option><option value="1000">kΩ</option><option value="1000000">MΩ</option></> : <><option value="1e-12">pF</option><option value="1e-9">nF</option><option value="0.000001">µF</option><option value="0.001">mF</option></>}
      </select> : <span>{'unit' in meta ? meta.unit : ''}</span>}
    </div>
    {error && <small className="opamp-field-error" id={`opamp-error-${parameter}`}>{error}</small>}
  </div>;
}
