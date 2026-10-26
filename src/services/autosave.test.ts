import { describe, expect, it, vi, afterEach } from 'vitest';
import { KeyedAutosave } from './autosave';
const deferred = () => { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
afterEach(() => vi.useRealTimers());
describe('KeyedAutosave', () => {
  it('debounces edits and saves the latest revision under the original note ID', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_draft: { id: string; text: string }) => {});
    const queue = new KeyedAutosave(write);
    queue.queue({ id: 'A', text: 'old' });
    await vi.advanceTimersByTimeAsync(400);
    queue.queue({ id: 'A', text: 'latest' });
    queue.queue({ id: 'B', text: 'other' });
    await vi.advanceTimersByTimeAsync(599);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write.mock.calls.map(([draft]) => draft)).toEqual([{ id: 'A', text: 'latest' }, { id: 'B', text: 'other' }]);
  });
  it('writes during continuous edits within the maximum three second wait', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_draft: { id: string; text: string }) => {});
    const queue = new KeyedAutosave(write);
    queue.queue({ id: 'A', text: '0' });
    for (let index = 1; index <= 5; index++) { await vi.advanceTimersByTimeAsync(500); queue.queue({ id: 'A', text: String(index) }); }
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledWith({ id: 'A', text: '5' });
  });
  it('serializes writes and drains edits arriving during an in-flight save', async () => {
    const first = deferred(), second = deferred();
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const queue = new KeyedAutosave<{ id: string; text: string }>(write);
    queue.queue({ id: 'A', text: 'first' });
    const flushing = queue.flush('A');
    await Promise.resolve();
    queue.queue({ id: 'A', text: 'second' });
    const concurrent = queue.flush('A');
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(2);
    expect(queue.isDirty('A')).toBe(true);
    second.resolve();
    await Promise.all([flushing, concurrent]);
    expect(queue.isDirty('A')).toBe(false);
    expect(write.mock.calls.map(([draft]) => draft.text)).toEqual(['first', 'second']);
  });
  it('retains the latest draft on failure, rejects flush, and retries explicitly', async () => {
    const first = deferred();
    const failure = new Error('disk full');
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const events = vi.fn();
    const queue = new KeyedAutosave<{ id: string; text: string }>(write, events);
    queue.queue({ id: 'A', text: 'first' });
    const flushing = queue.flush();
    await Promise.resolve();
    queue.queue({ id: 'A', text: 'newer' });
    first.reject(failure);
    await expect(flushing).rejects.toThrow('disk full');
    expect(queue.draft('A')).toEqual({ id: 'A', text: 'newer' });
    expect(queue.isDirty('A')).toBe(true);
    expect(events).toHaveBeenLastCalledWith({ id: 'A', status: 'error', error: failure });
    await queue.flush();
    expect(write).toHaveBeenLastCalledWith({ id: 'A', text: 'newer' });
    expect(queue.isDirty('A')).toBe(false);
  });
  it('waits for other active notes before reporting any failed flush', async () => {
    const other = deferred();
    const queue = new KeyedAutosave<{ id: string }>(draft => draft.id === 'A' ? Promise.reject(new Error('failure')) : other.promise);
    queue.queue({ id: 'A' }); queue.queue({ id: 'B' });
    let settled = false;
    const flushing = queue.flush().catch(error => { settled = true; throw error; });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    other.resolve();
    await expect(flushing).rejects.toThrow('failure');
  });
});