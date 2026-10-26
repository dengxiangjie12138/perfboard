import {invoke} from '@tauri-apps/api/core';

export interface LoginStartupStatus {supported: boolean; enabled: boolean}
export interface RepositoryStatistics {
  databaseBytes: number; walBytes: number; attachmentsBytes: number;
  attachmentFiles: number; measuredAt: string;
}
export interface AutoBackupSettings {enabled: boolean; parentDirectory: string | null; time: string}
export interface AutoBackupResult {
  day: string; attemptedAt: string; status: 'running' | 'success' | 'failed';
  backupPath: string | null; error: string | null; cleanupWarning: string | null;
}
export interface AutoBackupStatus {settings: AutoBackupSettings; lastResult: AutoBackupResult | null}
export const defaultAutoBackupSettings: AutoBackupSettings = {enabled: false, parentDirectory: null, time: '20:00'};
export const settingsApi = {
  loginStartupStatus: () => invoke<LoginStartupStatus>('login_startup_status'),
  setLoginStartup: (enabled: boolean) => invoke<LoginStartupStatus>('login_startup_set', {enabled}),
  repositoryStatistics: () => invoke<RepositoryStatistics>('repository_statistics'),
  autoBackupStatus: () => invoke<AutoBackupStatus>('auto_backup_status'),
  saveAutoBackup: (settings: AutoBackupSettings) => invoke<AutoBackupStatus>('auto_backup_save', {settings}),
};

export function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '未知';
  if (bytes < 1024) return bytes + ' B';
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) {value /= 1024; unit++}
  return value.toLocaleString('zh-CN', {maximumFractionDigits: 2}) + ' ' + units[unit];
}
export function isDailyTime(value: string): boolean {return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)}
export function autoBackupSettingsEqual(a: AutoBackupSettings, b: AutoBackupSettings): boolean {
  return a.enabled === b.enabled && a.parentDirectory === b.parentDirectory && a.time === b.time;
}
export function backupResultLabel(result: AutoBackupResult | null): string {
  if (!result) return '尚未执行自动备份';
  if (result.status === 'running') return '自动备份正在进行';
  if (result.status === 'failed') return '自动备份失败';
  return '自动备份已完成';
}
