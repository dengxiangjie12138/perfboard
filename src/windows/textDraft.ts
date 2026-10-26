export interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function textDraftKey(windowLabel: string, tool: string): string {
  if (!/^(main|tool-[a-z-]+(?:-[2-9][0-9]*|-[1-9][0-9]+)?)$/.test(windowLabel) || !/^[a-z-]+$/.test(tool)) throw new Error('Invalid draft scope');
  return `perfboard.draft.v1.${windowLabel}.${tool}`;
}
export function readTextDraft(storage: DraftStorage, key: string): string {
  const value = storage.getItem(key);
  if (value === null) return '';
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 || !('raw' in parsed) || typeof parsed.raw !== 'string') throw new Error('本地草稿无法读取；原记录已保留，请先备份或明确清空。');
  return parsed.raw;
}
export function writeTextDraft(storage: DraftStorage, key: string, raw: string): void { storage.setItem(key, JSON.stringify({ version: 1, raw })); }
