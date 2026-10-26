import {beforeEach, expect, it, vi} from 'vitest';
import {autoBackupSettingsEqual, backupResultLabel, defaultAutoBackupSettings, formatBytes, isDailyTime, settingsApi} from './settingsApi';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({invoke: (...args: unknown[]) => invoke(...args)}));
beforeEach(() => invoke.mockReset());

it.each([[0, '0 B'], [31, '31 B'], [1024, '1 KiB'], [1048576, '1 MiB'], [1536, '1.5 KiB']])('formats %d measured bytes with binary units', (bytes, label) => {
  expect(formatBytes(bytes)).toBe(label);
});
it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('does not pretend invalid byte sizes are zero (%s)', value => {
  expect(formatBytes(value)).toBe('未知');
});
it('has disabled default automatic backup and validates strict local daily time', () => {
  expect(defaultAutoBackupSettings).toEqual({enabled: false, parentDirectory: null, time: '20:00'});
  for (const time of ['00:00', '09:30', '23:59']) expect(isDailyTime(time)).toBe(true);
  for (const time of ['24:00', '9:30', '12:60', '', ' 09:30', '09:30:00']) expect(isDailyTime(time)).toBe(false);
});
it('marks changed drafts while preserving actual saved settings', () => {
  const saved = {...defaultAutoBackupSettings};
  expect(autoBackupSettingsEqual(saved, {...saved})).toBe(true);
  for (const draft of [{...saved, enabled: true}, {...saved, parentDirectory: 'D:\\isolated'}, {...saved, time: '09:00'}]) {
    expect(autoBackupSettingsEqual(draft, saved)).toBe(false);
  }
  expect(saved.enabled).toBe(false);
});
it('labels real backup outcomes without treating errors or running status as success', () => {
  const result = {day: '2026-10-03', attemptedAt: '2026-10-03T20:00:00Z', status: 'failed' as const, backupPath: null, error: 'Injected failure', cleanupWarning: null};
  expect(backupResultLabel(null)).toBe('尚未执行自动备份');
  expect(backupResultLabel(result)).toBe('自动备份失败');
  expect(backupResultLabel({...result, status: 'running'})).toBe('自动备份正在进行');
  expect(backupResultLabel({...result, status: 'success'})).toBe('自动备份已完成');
});
it('reads startup status without calling a setter', async () => {
  const actual = {supported: true, enabled: false};
  invoke.mockResolvedValue(actual);
  expect(await settingsApi.loginStartupStatus()).toBe(actual);
  expect(invoke.mock.calls).toEqual([['login_startup_status']]);
});
it('returns only actual command responses and propagates registration failures', async () => {
  const actual = {supported: true, enabled: true};
  invoke.mockResolvedValueOnce(actual).mockRejectedValueOnce(new Error('Registration unavailable'));
  expect(await settingsApi.setLoginStartup(true)).toBe(actual);
  await expect(settingsApi.setLoginStartup(false)).rejects.toThrow('Registration unavailable');
  expect(invoke.mock.calls).toEqual([['login_startup_set', {enabled: true}], ['login_startup_set', {enabled: false}]]);
});
it('uses typed statistics and auto-backup command contracts', async () => {
  const settings = {...defaultAutoBackupSettings, parentDirectory: 'D:\\isolated', time: '09:30'};
  const actual = {settings, lastResult: null};
  invoke.mockResolvedValue(actual);
  expect(await settingsApi.saveAutoBackup(settings)).toBe(actual);
  await settingsApi.autoBackupStatus();
  await settingsApi.repositoryStatistics();
  expect(invoke.mock.calls).toEqual([['auto_backup_save', {settings}], ['auto_backup_status'], ['repository_statistics']]);
});
