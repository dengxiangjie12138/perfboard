import { describe, expect, it } from 'vitest';
import { calculateOpAmp, initialDraft, type OpAmpDraft } from './algorithm';
import { parameterDraft, prepareParameterEdit } from './parameterEdit';
const logic = (id: Parameters<typeof initialDraft>[0], draft: OpAmpDraft) => {
  const result = calculateOpAmp(id, draft); if (!result.ok) throw Error(JSON.stringify(result.errors));
  return result.value.comparator!;
};
describe('explicit parameter confirmation and comparator history', () => {
  it('keeps a low inverting comparator low when typing 2.5 through the temporary value 2', () => {
    const applied = initialDraft('comparator'); Object.assign(applied.values, { hysteresis: '1', vin: '2.8' }); applied.memory = 'low';
    const before = JSON.stringify(applied);
    for (const value of ['', '2', '2.', '2.5']) {
      prepareParameterEdit('comparator', applied, 'vin', { value });
      expect(JSON.stringify(applied)).toBe(before);
      expect(logic('comparator', applied).state).toBe('low');
    }
    const confirmed = prepareParameterEdit('comparator', applied, 'vin', { value: '2.5' });
    if (!confirmed.ok) throw Error(confirmed.error);
    expect(logic('comparator', confirmed.draft)).toMatchObject({ state: 'low', held: true });
    const crossing = prepareParameterEdit('comparator', applied, 'vin', { value: '2' });
    if (!crossing.ok) throw Error(crossing.error);
    expect(logic('comparator', crossing.draft).state).toBe('high');
  });
  it('keeps a high non-inverting comparator high when entering a value inside its hysteresis band', () => {
    const applied = initialDraft('schmitt-noninv'); applied.values.vin = '2'; applied.memory = 'high';
    const temporary = prepareParameterEdit('schmitt-noninv', applied, 'vin', { value: '1' });
    expect(temporary.ok && logic('schmitt-noninv', temporary.draft).state).toBe('low');
    const confirmed = prepareParameterEdit('schmitt-noninv', applied, 'vin', { value: '1.5' });
    expect(confirmed.ok && logic('schmitt-noninv', confirmed.draft).state).toBe('high');
    expect(applied.values.vin).toBe('2'); expect(applied.memory).toBe('high');
  });
  it('applies only the edited field and uses the latest circuit memory and other parameters', () => {
    const applied = initialDraft('schmitt-inv'), pending = parameterDraft(applied, 'vin');
    pending.value = '2.3';
    const latest = { ...applied, memory: 'high' as const, values: { ...applied.values, r1: '112' } };
    const confirmed = prepareParameterEdit('schmitt-inv', latest, 'vin', pending);
    if (!confirmed.ok) throw Error(confirmed.error);
    expect(confirmed.draft.values).toEqual({ ...latest.values, vin: '2.3' });
    expect(confirmed.draft.memory).toBe('high');
    expect(applied.values.r1).toBe('132');
  });
  it('stages resistance value and unit together without modifying the applied gain', () => {
    const applied = initialDraft('noninv'), before = JSON.stringify(applied);
    const confirmed = prepareParameterEdit('noninv', applied, 'r1', { value: '19.19', unit: 1000 });
    expect(JSON.stringify(applied)).toBe(before);
    if (!confirmed.ok) throw Error(confirmed.error);
    const result = calculateOpAmp('noninv', confirmed.draft);
    expect(result.ok && result.value.gain).toBeCloseTo(20);
    const units = prepareParameterEdit('noninv', applied, 'r1', { value: '.01919', unit: 1000000 });
    expect(units.ok && calculateOpAmp('noninv', units.draft)).toEqual(result);
  });
  it.each(['', '0', '-1', 'Infinity'])('rejects invalid resistance %s while keeping the old circuit valid', value => {
    const applied = initialDraft('noninv'), before = JSON.stringify(applied);
    expect(prepareParameterEdit('noninv', applied, 'r1', { value, unit: 1000 }).ok).toBe(false);
    expect(JSON.stringify(applied)).toBe(before); expect(calculateOpAmp('noninv', applied).ok).toBe(true);
  });
  it('blocks cross-field supply and reference conflicts before they reach the circuit', () => {
    expect(prepareParameterEdit('schmitt-inv', initialDraft('schmitt-inv'), 'vee', { value: '4' })).toMatchObject({ ok: false });
    expect(prepareParameterEdit('undervoltage', initialDraft('undervoltage'), 'vitHigh', { value: '1' })).toMatchObject({ ok: false });
  });
  it('keeps the RC output running while an invalid model edit is pending', () => {
    const applied = initialDraft('relaxation'), initial = logic('relaxation', applied).oscillator!;
    expect(prepareParameterEdit('relaxation', applied, 'voh', { value: '5' }).ok).toBe(false);
    expect(logic('relaxation', applied).oscillator).toEqual(initial);
    const confirmed = prepareParameterEdit('relaxation', applied, 'voh', { value: '3' });
    expect(confirmed.ok && logic('relaxation', confirmed.draft).oscillator!.running).toBe(false);
  });
  it('allows repairing one existing invalid field without locking out unrelated repairs', () => {
    const applied = initialDraft('noninv'); Object.assign(applied.values, { r1: '0', r2: '0' });
    const first = prepareParameterEdit('noninv', applied, 'r1', { value: '10', unit: 1000 });
    if (!first.ok) throw Error(first.error);
    const second = prepareParameterEdit('noninv', first.draft, 'r2', { value: '10', unit: 1000 });
    expect(second.ok && calculateOpAmp('noninv', second.draft).ok).toBe(true);
  });
});
