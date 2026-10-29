import {beforeEach, expect, it, vi} from 'vitest';
import {initialUpdateStatus, updateApi} from './updateApi';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({invoke: (...args: unknown[]) => invoke(...args)}));
beforeEach(() => {invoke.mockReset()});

it('uses the native update commands without passing user-controlled URLs or paths', async () => {
  const status = initialUpdateStatus(); invoke.mockResolvedValue(status);
  expect(await updateApi.status()).toBe(status);
  await updateApi.setAutoCheck(true); await updateApi.check(); await updateApi.download();
  await updateApi.install(); await updateApi.openInstaller();
  expect(invoke.mock.calls).toEqual([['update_status'], ['update_set_auto_check', {enabled: true}],
    ['update_check'], ['update_download'], ['update_install'], ['update_open_installer']]);
});
it('propagates failures rather than manufacturing a no-update response', async () => {
  invoke.mockRejectedValue(new Error('signature mismatch'));
  await expect(updateApi.download()).rejects.toThrow('signature mismatch');
});
