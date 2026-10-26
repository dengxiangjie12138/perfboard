import type { LogPage, LogPageSave, SaveStatus } from './contracts';
export const LOG_AUTOSAVE_INTERVAL_MS = 60_000;
export interface LogSaveEvent { id: string; status: SaveStatus; error?: unknown; page?: LogPage }
interface Entry { draft: LogPage; revision: number; sequence: number; savedSequence: number; dirtySince?: number; timer?: ReturnType<typeof setTimeout>; running?: Promise<void> }
/** Fixed 60 seconds from the first unsaved edit; later edits do not postpone saving. */
export class LogAutosave {
 private entries = new Map<string, Entry>();
 private automatic = true;
 constructor(private write: (input: LogPageSave) => Promise<LogPage>, private emit: (event: LogSaveEvent) => void = () => {}) {}
 get enabled(): boolean { return this.automatic; }
 setEnabled(enabled: boolean): void {
  if (this.automatic === enabled) return;
  this.automatic = enabled;
  for (const [id, entry] of this.entries) {
   this.cancelTimer(entry);
   if (enabled && this.isDirty(id)) { entry.dirtySince = Date.now(); this.schedule(id, entry); }
  }
 }
 adopt(page: LogPage): LogPage { const old = this.entries.get(page.id); if (old && this.isDirty(page.id)) return old.draft; if (old) this.cancelTimer(old); this.entries.set(page.id, { draft: page, revision: page.revision, sequence: 0, savedSequence: 0 }); return page; }
 draft(id: string): LogPage | undefined { return this.entries.get(id)?.draft; }
 isDirty(id?: string): boolean { if (id === undefined) return [...this.entries.values()].some(entry => entry.sequence > entry.savedSequence); const entry = this.entries.get(id); return !!entry && entry.sequence > entry.savedSequence; }
 queue(page: LogPage): void {
  let entry = this.entries.get(page.id); if (!entry) { this.adopt(page); entry = this.entries.get(page.id)!; }
  entry.draft = { ...page, revision: entry.revision }; entry.sequence++; entry.dirtySince ??= Date.now();
  this.emit({ id: page.id, status: 'pending' }); this.schedule(page.id, entry);
 }
 async flush(id?: string): Promise<void> {
  if (id !== undefined) { const entry = this.entries.get(id); if (entry) await this.drain(id, entry); return; }
  const results = await Promise.allSettled([...this.entries].map(([key, entry]) => this.drain(key, entry)));
  const failure = results.find((value): value is PromiseRejectedResult => value.status === 'rejected'); if (failure) throw failure.reason;
 }
 discard(id: string): void { const entry = this.entries.get(id); if (entry?.running) throw new Error('请等待当前保存完成'); if (entry) this.cancelTimer(entry); this.entries.delete(id); }
 private cancelTimer(entry: Entry): void { if (entry.timer !== undefined) clearTimeout(entry.timer); entry.timer = undefined; }
 private schedule(id: string, entry: Entry): void {
  if (!this.automatic || entry.timer !== undefined || entry.running || !this.isDirty(id)) return;
  entry.timer = setTimeout(() => { entry.timer = undefined; if (this.automatic) void this.flush(id).catch(() => {}); }, Math.max(0, (entry.dirtySince ?? Date.now()) + LOG_AUTOSAVE_INTERVAL_MS - Date.now()));
 }
 private drain(id: string, entry: Entry): Promise<void> {
  this.cancelTimer(entry);
  if (entry.running) return entry.running;
  if (!this.isDirty(id)) return Promise.resolve();
  const running = Promise.resolve().then(async () => {
   while (entry.sequence > entry.savedSequence) {
    const sequence = entry.sequence; const draft = entry.draft; entry.dirtySince = undefined; this.emit({ id, status: 'saving' });
    let saved: LogPage;
    try { saved = await this.write({ id, expectedRevision: entry.revision, title: draft.title.trim() || '未命名页面', documentJson: draft.documentJson, schemaVersion: draft.schemaVersion }); }
    catch (error) { this.cancelTimer(entry); this.emit({ id, status: 'error', error }); throw error; }
    entry.revision = saved.revision; entry.savedSequence = sequence;
    entry.draft = sequence === entry.sequence ? saved : { ...entry.draft, revision: saved.revision, updatedAt: saved.updatedAt };
    this.emit({ id, status: 'saving', page: saved }); this.cancelTimer(entry);
   }
   this.emit({ id, status: 'saved', page: entry.draft });
  }).finally(() => { if (entry.running === running) entry.running = undefined; });
  entry.running = running; return running;
 }
}
