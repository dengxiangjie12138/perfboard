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
    ['update_check'], ['update_download'], ['update_install', {allowRollback: false}], ['update_open_installer', {allowRollback: false}]]);
});
it('uses version tags for catalog operations and only opts into rollback when explicitly requested', async () => {
  invoke.mockResolvedValue(initialUpdateStatus());
  await updateApi.listVersions(); await updateApi.downloadVersion('v0.1.1'); await updateApi.openRelease('v0.1.0');
  await updateApi.install(true); await updateApi.openInstaller(true);
  expect(invoke.mock.calls).toEqual([['update_list_versions'], ['update_download_version', {tag: 'v0.1.1'}],
    ['update_open_release', {tag: 'v0.1.0'}], ['update_install', {allowRollback: true}], ['update_open_installer', {allowRollback: true}]]);
});
it('propagates failures rather than manufacturing a no-update response', async () => {
  invoke.mockRejectedValue(new Error('signature mismatch'));
  await expect(updateApi.download()).rejects.toThrow('signature mismatch');
});
