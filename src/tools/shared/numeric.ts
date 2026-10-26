export type CalculationResult<T> = { ok: true; value: T } | { ok: false; error: string };
export const positiveFinite = (value: number) => Number.isFinite(value) && value > 0;
export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
export function parseNumericInput(text: string): number { return text.trim() === '' ? NaN : Number(text); }
