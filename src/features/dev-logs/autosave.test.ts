import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogPage, LogPageSave } from './contracts';
import { LogAutosave } from './autosave';
const page = (id='p'): LogPage => ({ id, projectId:'project', title:'Day', documentJson:'{"type":"doc","content":[{"type":"paragraph"}]}', schemaVersion:1, revision:4, position:0, deletedAt:null, createdAt:'date', updatedAt:'date' });
afterEach(() => vi.useRealTimers());
describe('revision-aware log autosave', () => {
 it('serializes rapid changes, uses each authoritative revision, and drains during flush', async () => {
  vi.useFakeTimers(); let unblock: ((value: LogPage) => void) | undefined; const writes: LogPageSave[] = [];
  const save = vi.fn((input: LogPageSave) => { writes.push(input); if (writes.length === 1) return new Promise<LogPage>(resolve => { unblock = resolve; }); return Promise.resolve({ ...page(), title:input.title, documentJson:input.documentJson, revision:input.expectedRevision+1 }); });
  const autosave = new LogAutosave(save); autosave.adopt(page()); autosave.queue({ ...page(), title:'first' });
  const draining=autosave.flush(); await Promise.resolve(); autosave.queue({ ...page(), title:'second' }); unblock!({ ...page(), title:'first',revision:5 }); await draining;
  expect(writes.map(value => [value.title,value.expectedRevision])).toEqual([['first',4],['second',5]]); expect(autosave.draft('p')?.title).toBe('second'); expect(autosave.draft('p')?.revision).toBe(6); expect(autosave.isDirty('p')).toBe(false);
 });
 it('retains a stale draft and blocks flush instead of silently adopting server content', async () => {
  vi.useFakeTimers(); const save=vi.fn(async () => { throw new Error('[revision-conflict] stale'); }); const events: string[]=[];
  const autosave=new LogAutosave(save,event => events.push(event.status)); autosave.adopt(page()); autosave.queue({...page(),title:'unsaved'});
  await expect(autosave.flush()).rejects.toThrow('revision-conflict'); expect(autosave.isDirty('p')).toBe(true); expect(autosave.adopt({...page(),title:'remote',revision:8}).title).toBe('unsaved'); expect(events.at(-1)).toBe('error'); autosave.discard('p');
 });
 it('isolates pages and flushes every pending document on close', async () => {
  vi.useFakeTimers(); const save=vi.fn(async (input:LogPageSave) => ({...page(input.id),title:input.title,revision:input.expectedRevision+1}));
  const autosave=new LogAutosave(save); autosave.adopt(page('a')); autosave.adopt({...page('b'),revision:11}); autosave.queue({...page('a'),title:'A'}); autosave.queue({...page('b'),title:'B'}); await autosave.flush();
  expect(save.mock.calls.map(([input]) => [input.id,input.expectedRevision])).toEqual([['a',4],['b',11]]); expect(autosave.isDirty('a')).toBe(false); expect(autosave.isDirty('b')).toBe(false);
 });
 it('saves at exactly 60 seconds from the first dirty edit even if typing continues', async () => {
  vi.useFakeTimers(); const save=vi.fn(async (input:LogPageSave) => ({...page(),title:input.title,revision:input.expectedRevision+1})); const autosave=new LogAutosave(save); autosave.adopt(page()); autosave.queue({...page(),title:'1'});
  await vi.advanceTimersByTimeAsync(59_000); autosave.queue({...page(),title:'2'}); await vi.advanceTimersByTimeAsync(999); expect(save).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); expect(save).toHaveBeenCalledOnce(); expect(autosave.draft('p')?.title).toBe('2');
 });
 it('cancels automatic saving when switched off, preserves dirty drafts, and still allows manual flush', async () => {
  vi.useFakeTimers(); const save=vi.fn(async (input:LogPageSave) => ({...page(),title:input.title,revision:input.expectedRevision+1})); const autosave=new LogAutosave(save); autosave.adopt(page()); autosave.queue({...page(),title:'manual'}); await vi.advanceTimersByTimeAsync(30_000); autosave.setEnabled(false);
  await vi.advanceTimersByTimeAsync(120_000); expect(save).not.toHaveBeenCalled(); expect(autosave.isDirty()).toBe(true); expect(autosave.draft('p')?.title).toBe('manual'); await autosave.flush(); expect(save).toHaveBeenCalledOnce(); expect(autosave.isDirty()).toBe(false);
 });
 it('starts a fresh 60-second interval when re-enabled with a dirty draft', async () => {
  vi.useFakeTimers(); const save=vi.fn(async (input:LogPageSave) => ({...page(),title:input.title,revision:input.expectedRevision+1})); const autosave=new LogAutosave(save); autosave.setEnabled(false); autosave.adopt(page()); autosave.queue({...page(),title:'kept'}); await vi.advanceTimersByTimeAsync(120_000); autosave.setEnabled(true);
  await vi.advanceTimersByTimeAsync(59_999); expect(save).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); expect(save).toHaveBeenCalledOnce();
 });
});
