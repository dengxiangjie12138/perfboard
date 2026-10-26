import { describe, expect, it } from 'vitest';
import { TOOL_WINDOWS, toolIdFromHash, toolWindowDefinition, windowHash, windowRouteFromHash, isWindowRoute, sameWindowRoute } from './definitions';
import { readTextDraft, textDraftKey, writeTextDraft, type DraftStorage } from './textDraft';
import { CloseRequestRunner } from './closeRequestRunner';
import type { CloseRequest, WindowRoute } from './contracts';
import capabilities from '../../src-tauri/capabilities/tool-windows.json';
function memory(): DraftStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
describe('independent local window routes and recovery', () => {
  it('supports the eight calculators plus core library and external-tools manager', () => {
    expect(new Set(TOOL_WINDOWS.map(tool => tool.id)).size).toBe(TOOL_WINDOWS.length);
    for (const id of ['feedback', 'led', 'radix', 'json', 'resistor-series', 'resistor-parallel', 'timer', 'wire-gauge', 'cores', 'external-tools']) expect(toolWindowDefinition(id)?.id).toBe(id);
    expect(toolWindowDefinition('unsupported')).toBeUndefined();
  });
  it('round trips allowlisted page/category/record routes and legacy JSON hashes', () => {
    const routes: WindowRoute[] = [{ kind: 'tool', toolId: 'json' }, { kind: 'tool', toolId: 'cores' }, { kind: 'tool', toolId: 'external-tools', externalToolId: 'external-record-2' }, { kind: 'parts', partId: 'part-123' }, { kind: 'notes' }, { kind: 'notes', category: '学习笔记', noteId: 'note-2' }, { kind: 'dev-logs', projectId: 'project-3', pageId: 'page-4' }];
    for (const route of routes) expect(windowRouteFromHash(windowHash(route))).toEqual(route);
    expect(windowRouteFromHash('#tool=json')).toEqual({ kind: 'tool', toolId: 'json' });
    expect(sameWindowRoute({ kind: 'notes', noteId: 'n' }, { noteId: 'n', kind: 'notes' })).toBe(true);
    expect(sameWindowRoute({ kind: 'notes' }, { kind: 'notes', noteId: 'n' })).toBe(false);
  });
  it('rejects malformed routes, unknown properties, URL opens and invalid categories/IDs', () => {
    for (const value of [{ kind: 'tool', toolId: 'unsupported' }, { kind: 'tool', toolId: 'json', externalToolId: 'external-record-2' }, { kind: 'tool', toolId: 'external-tools', externalToolId: '../secret' }, { kind: 'parts', url: 'https://evil' }, { kind: 'notes', category: 'unknown' }, { kind: 'notes', noteId: '../secret' }, { kind: 'dev-logs', pageId: 'https://evil' }, { kind: 'constructor' }, { kind: 'parts', partId: null }, []]) expect(isWindowRoute(value)).toBe(false);
    for (const hash of ['#window=%xx', '#window=null', '#window=[]', '#window={"kind":"evil"}', '#tool=https://evil', '#tool=json&url=evil']) expect(windowRouteFromHash(hash)).toBeUndefined();
    expect(toolIdFromHash('#tool=%6ason')).toBeUndefined();
  });
  it('keeps main and two JSON instance drafts separate and restores exact invalid/big-integer raw text', () => {
    const storage = memory(); const keys = ['main', 'tool-json', 'tool-json-2'].map(label => textDraftKey(label, 'json'));
    const values = ['{"n":18446744073709551615}', '{"unfinished":', 'second instance'];
    keys.forEach((key, i) => writeTextDraft(storage, key, values[i]));
    keys.forEach((key, i) => expect(readTextDraft(storage, key)).toBe(values[i]));
    writeTextDraft(storage, keys[2], ''); expect(readTextDraft(storage, keys[1])).toBe(values[1]);
    expect(textDraftKey('tool-json', 'json')).toBe('perfboard.draft.v1.tool-json.json');
    expect(() => textDraftKey('tool-json/evil', 'json')).toThrow();
  });
  it('preserves corrupt persisted drafts and propagates storage failures to the close barrier', () => {
    const storage = memory(), key = textDraftKey('tool-json', 'json');
    for (const original of ['broken', '{"version":2,"raw":"keep"}', '{"version":1,"raw":4}']) {
      storage.values.set(key, original); expect(() => readTextDraft(storage, key)).toThrow(); expect(storage.values.get(key)).toBe(original);
    }
    expect(() => writeTextDraft({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, key, 'still in memory')).toThrow('quota');
  });
  it('keeps tools limited to events while trusted document windows get file dialogs', () => {
    const [tools, documents, externalManager] = capabilities;
    expect(tools.permissions).toEqual(['core:event:allow-listen', 'core:event:allow-unlisten']);
    expect(tools.windows).toEqual([...TOOL_WINDOWS.map(tool => 'tool-' + tool.id), ...TOOL_WINDOWS.map(tool => 'tool-' + tool.id + '-*')]);
    expect(documents.permissions).toContain('dialog:allow-open'); expect(documents.permissions).toContain('dialog:allow-save');
    expect(documents.windows.every(label => label.startsWith('page-'))).toBe(true);
    expect(externalManager.windows).toEqual(['tool-external-tools', 'tool-external-tools-*']); expect(externalManager.permissions).toEqual(['dialog:allow-open']);
    for (const scope of capabilities) { expect(scope.windows).not.toContain('*'); expect(scope.permissions.some(permission => /create|shell|url|emit|default/.test(permission))).toBe(false); }
  });
});
describe('webview close response lifecycle', () => {
  it('deduplicates repeated requests without duplicate flushes/responses', async () => {
    const wait = deferred(); let flushes = 0; const responses: boolean[] = [];
    const runner = new CloseRequestRunner({ flush: async () => { flushes++; await wait.promise; }, respond: async (_, saved) => { responses.push(saved); }, saveFailed: () => {}, responseFailed: () => {} });
    const request: CloseRequest = { action: 'close-tool', requestId: 1 };
    const first = runner.run(request); await runner.run(request); wait.resolve(); await first; await runner.run(request);
    expect(flushes).toBe(1); expect(responses).toEqual([true]);
  });
  it('drops responses from disposed StrictMode listeners or superseded requests', async () => {
    const wait = deferred(); const responses: number[] = [];
    const runner = new CloseRequestRunner({ flush: () => wait.promise, respond: async request => { responses.push(request.requestId); }, saveFailed: () => {}, responseFailed: () => {} });
    const first = runner.run({ action: 'close-tool', requestId: 1 }); const second = runner.run({ action: 'quit', requestId: 2 }); wait.resolve(); await Promise.all([first, second]); expect(responses).toEqual([2]);
    const disposed = new CloseRequestRunner({ flush: async () => {}, respond: async request => { responses.push(request.requestId); }, saveFailed: () => {}, responseFailed: () => {} }); disposed.dispose(); await disposed.run({ action: 'quit', requestId: 3 }); expect(responses).toEqual([2]);
  });
  it('reports actual flush failure once and sends saved:false to keep windows open', async () => {
    const failures: unknown[] = []; const responses: boolean[] = [];
    const runner = new CloseRequestRunner({ flush: async () => { throw new Error('quota'); }, respond: async (_, saved) => { responses.push(saved); }, saveFailed: error => failures.push(error), responseFailed: () => {} });
    await runner.run({ action: 'flush', requestId: 4 }); expect(failures).toHaveLength(1); expect(responses).toEqual([false]);
  });
  it('keeps interaction paused through the acknowledgement and releases on failure', async () => {
    const wait = deferred(); const steps: string[] = [];
    const runner = new CloseRequestRunner({ started: () => { steps.push('paused'); }, flush: async () => { steps.push('flushed'); }, respond: async () => { await wait.promise; throw new Error('transport'); }, finished: (_, saved, responded) => { steps.push(`${saved}:${responded}`); }, saveFailed: () => {}, responseFailed: () => {} });
    const task = runner.run({ action: 'flush', requestId: 6 }); await Promise.resolve(); expect(steps).toEqual(['paused', 'flushed']); wait.resolve(); await task; expect(steps).toEqual(['paused', 'flushed', 'true:false']);
  });
  it('does not acknowledge or resume a disposed listener after an outstanding flush', async () => {
    const wait = deferred(); const steps: string[] = [];
    const runner = new CloseRequestRunner({ started: () => { steps.push('paused'); }, flush: () => wait.promise, respond: async () => { steps.push('ack'); }, finished: () => { steps.push('finished'); }, saveFailed: () => {}, responseFailed: () => {} });
    const task = runner.run({ action: 'close-tool', requestId: 7 }); runner.dispose(); wait.resolve(); await task; expect(steps).toEqual(['paused']);
  });
  it('distinguishes an acknowledgement error from a failed save', async () => {
    const saves: unknown[] = [], responses: unknown[] = [];
    const runner = new CloseRequestRunner({ flush: async () => {}, respond: async () => { throw new Error('transport'); }, saveFailed: error => saves.push(error), responseFailed: error => responses.push(error) });
    await runner.run({ action: 'quit', requestId: 5 }); expect(saves).toEqual([]); expect(responses).toHaveLength(1);
  });
});
