export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
export interface SaveEvent { id: string; status: SaveStatus; error?: unknown }
interface Entry<T> { value: T; revision: number; savedRevision: number; firstDirtyAt: number | null; timer?: ReturnType<typeof setTimeout>; running?: Promise<void>; error?: unknown }
/** Memory-only drafts. Each key has one writer; flush drains edits made during a write. */
export class KeyedAutosave<T extends { id: string }> {
  private entries = new Map<string, Entry<T>>();
  constructor(private write: (value: T) => Promise<unknown>, private onStatus: (event: SaveEvent) => void = () => {}, private delay = 600, private maxWait = 3000) {}
  draft(id: string): T | undefined { return this.entries.get(id)?.value; }
  isDirty(id: string): boolean { const entry = this.entries.get(id); return !!entry && entry.revision > entry.savedRevision; }
  queue(value: T): void {
    let entry = this.entries.get(value.id);
    if (!entry) { entry = { value, revision: 0, savedRevision: 0, firstDirtyAt: null }; this.entries.set(value.id, entry); }
    entry.value = value;
    entry.revision++;
    entry.error = undefined;
    entry.firstDirtyAt ??= Date.now();
    if (entry.timer) clearTimeout(entry.timer);
    this.onStatus({ id: value.id, status: 'pending' });
    entry.timer = setTimeout(() => { void this.flush(value.id).catch(() => {}); }, Math.max(0, Math.min(this.delay, entry.firstDirtyAt + this.maxWait - Date.now())));
  }
  async flush(id?: string): Promise<void> {
    if (id !== undefined) { const entry = this.entries.get(id); if (entry) await this.drain(id, entry); return; }
    const results = await Promise.allSettled([...this.entries].map(([key, entry]) => this.drain(key, entry)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  private drain(id: string, entry: Entry<T>): Promise<void> {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    if (entry.running) return entry.running;
    if (entry.revision === entry.savedRevision) return Promise.resolve();
    // Schedule execution after assigning running, even when a writer throws synchronously.
    const running = Promise.resolve().then(async () => {
      while (entry.revision > entry.savedRevision) {
        const revision = entry.revision;
        const value = entry.value;
        entry.firstDirtyAt = null;
        this.onStatus({ id, status: 'saving' });
        try { await this.write(value); }
        catch (error) {
          entry.error = error;
          if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
          this.onStatus({ id, status: 'error', error });
          throw error;
        }
        entry.savedRevision = revision;
        entry.error = undefined;
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
      }
      this.onStatus({ id, status: 'saved' });
    }).finally(() => { if (entry.running === running) entry.running = undefined; });
    entry.running = running;
    return running;
  }
}