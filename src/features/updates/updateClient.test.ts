import {describe, expect, it, vi} from 'vitest';
import {initialUpdateStatus, type UpdateStatus} from './updateApi';
import {UpdateClient} from './updateClient';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no});
  return {promise, resolve, reject};
}
const available: UpdateStatus = {...initialUpdateStatus(), autoCheckEnabled: true,
  lastCheckedAt: '2026-10-29T08:00:00Z', available: {version: '0.2.0', notes: '更新说明', pubDate: null}};
function setup(initial = initialUpdateStatus()) {
  let receive!: (status: UpdateStatus) => void;
  const stop = vi.fn(), status = vi.fn(async () => initial);
  const listen = vi.fn(async (listener: typeof receive) => {receive = listener; return stop});
  const client = new UpdateClient({status, listen}, true);
  return {client, status, listen, stop, emit: (value: UpdateStatus) => receive(value)};
}

describe('native update state subscription', () => {
  it('does not contact native APIs in browser previews', async () => {
    const status = vi.fn(), listen = vi.fn(), operation = vi.fn();
    const client = new UpdateClient({status, listen}, false);
    await client.start(); await client.perform('check', operation);
    expect(status).not.toHaveBeenCalled(); expect(listen).not.toHaveBeenCalled(); expect(operation).not.toHaveBeenCalled();
    expect(client.getSnapshot().loading).toBe(false);
  });
  it('subscribes before the initial read and does not overwrite a newer event with a late snapshot', async () => {
    const state = setup(), read = deferred<UpdateStatus>();
    state.status.mockImplementation(() => read.promise);
    const task = state.client.start();
    await Promise.resolve();
    expect(state.listen).toHaveBeenCalledOnce(); expect(state.status).toHaveBeenCalledOnce();
    state.emit(available);
    read.resolve(initialUpdateStatus()); await task;
    expect(state.client.getSnapshot().status).toEqual(available);
    expect(state.client.getSnapshot().loading).toBe(false);
  });
  it('does not clear a known update when a check fails or automatic checking is disabled', async () => {
    const state = setup(available); await state.client.start();
    await state.client.perform('check', async () => {throw new Error('GitHub 无法连接')});
    expect(state.client.getSnapshot().status.available).toEqual(available.available);
    expect(state.client.getSnapshot().status.error).toBe('GitHub 无法连接');
    state.emit({...available, autoCheckEnabled: false});
    expect(state.client.getSnapshot().status.autoCheckEnabled).toBe(false);
    expect(state.client.getSnapshot().status.available?.version).toBe('0.2.0');
  });
  it('keeps a completed command newer than an initial snapshot still in flight', async () => {
    const read = deferred<UpdateStatus>();
    const client = new UpdateClient({status: () => read.promise,
      listen: async receive => {receive(initialUpdateStatus()); return () => {}},
    }, true);
    const task = client.start(); await Promise.resolve();
    await client.perform('check', async () => available);
    read.resolve(initialUpdateStatus()); await task;
    expect(client.getSnapshot().status).toEqual(available);
  });
  it('deduplicates a pending action and keeps progress newer than a delayed command result', async () => {
    const state = setup(available); await state.client.start();
    const download = deferred<UpdateStatus>(), duplicate = vi.fn();
    const task = state.client.perform('download', () => download.promise);
    await state.client.perform('download', duplicate);
    expect(duplicate).not.toHaveBeenCalled();
    const progress: UpdateStatus = {...available, phase: 'downloading', downloadedBytes: 256, totalBytes: 1024};
    state.emit(progress); download.resolve(available); await task;
    expect(state.client.getSnapshot().status).toEqual(progress);
    expect(state.client.getSnapshot().pendingAction).toBeNull();
  });
  it('releases a subscription that finishes mounting after unmount and can restart under StrictMode', async () => {
    const delayed = deferred<() => void>(), cleanup = vi.fn(), status = vi.fn(async () => available);
    const client = new UpdateClient({status, listen: () => delayed.promise}, true);
    const task = client.start(); client.stop(); delayed.resolve(cleanup); await task;
    expect(cleanup).toHaveBeenCalledOnce(); expect(status).not.toHaveBeenCalled();
    await client.start();
    expect(status).toHaveBeenCalledOnce(); expect(client.getSnapshot().status).toEqual(available);
    client.stop(); expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it('ignores stale events and command results after the provider has stopped', async () => {
    const state = setup(); await state.client.start();
    const check = deferred<UpdateStatus>(), task = state.client.perform('check', () => check.promise);
    state.client.stop(); state.emit(available); check.resolve(available); await task;
    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.client.getSnapshot().status.available).toBeNull();
    expect(state.client.getSnapshot().pendingAction).toBeNull();
  });
  it('loads the formal version catalog only on demand without changing the latest update or download target', async () => {
    const state = setup(available); await state.client.start();
    expect(state.client.getSnapshot().versions).toBeNull();
    await state.client.listVersions(async () => [
      {tag: 'v0.1.0', version: '0.1.0', notes: null, pubDate: null, installable: false},
      {tag: 'v0.1.1', version: '0.1.1', notes: null, pubDate: null, installable: true},
    ]);
    expect(state.client.getSnapshot().versions?.map(version => version.version)).toEqual(['0.1.1', '0.1.0']);
    expect(state.client.getSnapshot().status.available).toEqual(available.available);
    expect(state.client.getSnapshot().status.target).toBeNull();
    await state.client.listVersions(async () => {throw new Error('catalog unavailable')});
    expect(state.client.getSnapshot().versions).toHaveLength(2);
    expect(state.client.getSnapshot().versionsError).toBe('catalog unavailable');
    expect(state.client.getSnapshot().status.error).toBeNull();
    expect(state.client.getSnapshot().status.available).toEqual(available.available);
  });
  it('keeps a rollback target independent of a newer-version event and ignores a stopped catalog request', async () => {
    const state = setup(available); await state.client.start();
    const target = {version: '0.1.1', notes: null, pubDate: null};
    state.emit({...available, target, phase: 'ready'});
    expect(state.client.getSnapshot().status.available?.version).toBe('0.2.0');
    expect(state.client.getSnapshot().status.target?.version).toBe('0.1.1');
    const pending = deferred<[]>(); const task = state.client.listVersions(() => pending.promise);
    state.client.stop(); pending.resolve([]); await task;
    expect(state.client.getSnapshot().versions).toBeNull();
    expect(state.client.getSnapshot().versionsLoading).toBe(false);
  });
});
