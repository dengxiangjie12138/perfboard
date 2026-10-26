import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialFitnessSnapshot, useFitness, type FitnessSnapshot } from './fitnessApi';

// Exercise the hook's real listener and command callbacks without a browser DOM.
const hook = vi.hoisted(() => ({
  values: [] as unknown[],
  effects: [] as Array<() => unknown>,
  listener: undefined as undefined | ((event: { payload: unknown }) => void),
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: hook.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_name: string, callback: typeof hook.listener) => {
    hook.listener = callback;
    return Promise.resolve(() => undefined);
  }),
}));
vi.mock('react', () => ({
  useState: <T>(initial: T | (() => T)) => {
    const index = hook.values.length;
    hook.values.push(typeof initial === 'function' ? (initial as () => T)() : initial);
    return [hook.values[index], (value: T) => { hook.values[index] = value; }];
  },
  useEffect: (effect: () => unknown) => { hook.effects.push(effect); },
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(callback: T) => callback,
}));
async function mount() {
  const api = useFitness();
  hook.effects.forEach(effect => effect());
  await Promise.resolve();
  await Promise.resolve();
  return api;
}
beforeEach(() => {
  hook.values = [];
  hook.effects = [];
  hook.listener = undefined;
  hook.invoke.mockReset();
  hook.invoke.mockResolvedValue(initialFitnessSnapshot());
});
describe('fitness status and action feedback', () => {
  it('keeps a failed command visible across periodic status events', async () => {
    const api = await mount();
    hook.invoke.mockRejectedValueOnce(new Error('数据库忙，记录尚未保存'));
    expect(await api.act({ type: 'start', reminderId: 17 })).toBe(false);
    expect(hook.values[1]).toContain('数据库忙');
    const refreshed: FitnessSnapshot = { ...initialFitnessSnapshot(), activeMs: 500 };
    hook.listener?.({ payload: refreshed });
    hook.listener?.({ payload: { ...refreshed, activeMs: 1000 } });
    expect((hook.values[0] as FitnessSnapshot).activeMs).toBe(1000);
    expect(hook.values[1]).toContain('数据库忙');
  });
  it('clears a prior action error when the user explicitly retries successfully', async () => {
    const api = await mount();
    hook.invoke.mockRejectedValueOnce(new Error('保存失败'));
    await api.act({ type: 'collapse' });
    expect(hook.values[1]).toContain('保存失败');
    expect(await api.act({ type: 'collapse' })).toBe(true);
    expect(hook.values[1]).toBe('');
  });
  it('does not replace a newer pushed state with an older command response', async () => {
    const api = await mount();
    let resolveAction: ((value: FitnessSnapshot) => void) | undefined;
    hook.invoke.mockImplementationOnce(() => new Promise<FitnessSnapshot>(resolve => { resolveAction = resolve; }));
    const action = api.act({ type: 'show' });
    hook.listener?.({ payload: { ...initialFitnessSnapshot(), activeMs: 1000 } });
    resolveAction?.({ ...initialFitnessSnapshot(), activeMs: 500 });
    await action;
    expect((hook.values[0] as FitnessSnapshot).activeMs).toBe(1000);
  });
});
