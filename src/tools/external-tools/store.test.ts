import { describe, expect, it } from 'vitest';
import { ExternalToolsStore, selectedExternalTool, type ExternalToolsClient } from './store';
import type { ExternalTool } from '../../services/api';
const tool = (id: string, name = id): ExternalTool => ({ id, name, path: 'C:/apps/' + id + '.exe', description: 'searchable introduction ' + id, available: true, status: 'ready' });
function fixture() {
  let records: ExternalTool[] = [];
  let counter = 0;
  const calls: string[] = [];
  const client: ExternalToolsClient = {
    async list() { calls.push('list'); return records.map(record => ({ ...record })); },
    async save(input) {
      calls.push('save');
      if (input.id) {
        const index = records.findIndex(record => record.id === input.id);
        if (index < 0) throw new Error('missing');
        records[index] = { ...records[index], ...input };
      } else records.push({ ...input, id: 'tool-' + ++counter, available: true, status: 'ready' });
    },
    async remove(id) { calls.push('delete'); records = records.filter(record => record.id !== id); },
    async launch(id) { calls.push('launch'); const found = records.find(record => record.id === id); if (!found?.available) throw new Error('program missing'); },
  };
  return { store: new ExternalToolsStore(client), calls, set: (value: ExternalTool[]) => { records = value; } };
}
describe('external tools full-list store', () => {
  it('refreshes all tools after add edit delete and keeps search introductions current', async () => {
    const f = fixture();
    f.set(Array.from({ length: 45 }, (_, index) => tool(String(index))));
    await f.store.refresh();
    expect(f.store.getSnapshot().tools).toHaveLength(45);
    await f.store.save({ name: 'Added', path: 'C:/apps/new.exe', description: 'serial communication' });
    const added = f.store.getSnapshot().tools.find(record => record.name === 'Added')!;
    await f.store.save({ id: added.id, name: 'Edited', path: added.path, description: 'updated searchable introduction' });
    expect(selectedExternalTool(f.store.getSnapshot().tools, added.id)?.description).toBe('updated searchable introduction');
    await f.store.remove(added.id);
    expect(selectedExternalTool(f.store.getSnapshot().tools, added.id)).toBeUndefined();
    expect(f.store.getSnapshot().tools).toHaveLength(45);
    expect(f.calls).toEqual(['list', 'save', 'list', 'save', 'list', 'delete', 'list']);
  });
  it('serializes queued changes and reloads missing state on explicit launch failure', async () => {
    const f = fixture();
    await Promise.all([
      f.store.save({ name: 'A', path: 'C:/a.exe', description: 'application A' }),
      f.store.save({ name: 'B', path: 'C:/b.exe', description: 'application B' }),
    ]);
    expect(f.store.getSnapshot().tools.map(record => record.name)).toEqual(['A', 'B']);
    const missing = { ...f.store.getSnapshot().tools[0], available: false, status: 'missing file' };
    f.set([missing]);
    await expect(f.store.launch(missing.id)).rejects.toThrow('program missing');
    expect(f.store.getSnapshot().tools[0].available).toBe(false);
    expect(f.store.getSnapshot().error).toBe('program missing');
    expect(f.store.getSnapshot().loading).toBe(false);
    await f.store.remove(missing.id);
    expect(f.store.getSnapshot().error).toBe('');
  });
  it('never selects another tool when a requested record is deleted', () => {
    expect(selectedExternalTool([tool('other')], 'removed')).toBeUndefined();
    expect(selectedExternalTool([tool('other')])).toBeUndefined();
  });
});

describe('external tools warehouse boundaries', () => {
  it('clears old warehouse records and suppresses a stale list response', async () => {
    let complete: ((records: ExternalTool[]) => void) | undefined;
    const client: ExternalToolsClient = {
      list: () => new Promise<ExternalTool[]>(resolve => { complete = resolve; }),
      save: async () => undefined, remove: async () => undefined, launch: async () => undefined,
    };
    const store = new ExternalToolsStore(client);
    store.setRepository('warehouse-a');
    const refresh = store.refresh();
    await Promise.resolve();
    store.setRepository('warehouse-b');
    expect(store.getSnapshot().tools).toEqual([]);
    complete!([tool('old-warehouse-record')]);
    await refresh;
    expect(store.getSnapshot().tools).toEqual([]);
    expect(store.getSnapshot().loading).toBe(true);
    const currentRefresh = store.refresh(); await Promise.resolve(); await Promise.resolve();
    complete!([tool('new-warehouse-record')]); await currentRefresh;
    expect(store.getSnapshot().tools.map(record => record.id)).toEqual(['new-warehouse-record']);
    store.setRepository(null);
    expect(store.getSnapshot().tools).toEqual([]);
    expect(store.getSnapshot().loading).toBe(false);
    await expect(store.refresh()).rejects.toThrow('请先打开数据仓库');
  });
  it('cancels queued mutations when their original warehouse changes', async () => {
    let complete: ((records: ExternalTool[]) => void) | undefined;
    let writes = 0;
    const store = new ExternalToolsStore({
      list: () => new Promise<ExternalTool[]>(resolve => { complete = resolve; }),
      save: async () => { writes += 1; }, remove: async () => undefined, launch: async () => undefined,
    });
    store.setRepository('warehouse-a');
    const refresh = store.refresh();
    const save = store.save({ name: 'old draft', path: 'C:/old.exe', description: 'old warehouse draft' });
    const rejection = expect(save).rejects.toThrow('仓库已切换');
    await Promise.resolve(); store.setRepository('warehouse-b'); complete!([]);
    await refresh; await rejection;
    expect(writes).toBe(0);
    expect(store.getSnapshot().error).toBe('');
  });
  it('keeps missing records searchable and passes exact path and description to repair', async () => {
    const f = fixture();
    const missing = { ...tool('missing'), available: false, status: 'missing executable', description: '  Exact searchable description\n第二行  ' };
    f.set([missing]); f.store.setRepository('warehouse-a'); await f.store.refresh();
    expect(selectedExternalTool(f.store.getSnapshot().tools, 'missing')?.description).toBe(missing.description);
    const path = 'C:/Program Files/My App/工具.EXE';
    await f.store.save({ id: 'missing', name: missing.name, path, description: missing.description });
    expect(f.store.getSnapshot().tools[0].path).toBe(path);
    expect(f.store.getSnapshot().tools[0].description).toBe(missing.description);
    expect(f.calls).not.toContain('launch');
  });
});
