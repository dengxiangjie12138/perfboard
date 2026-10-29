import {invoke} from '@tauri-apps/api/core';
import {currentVersion} from '../../services/version';

export interface AvailableUpdate {version: string; notes: string | null; pubDate: string | null}
export interface ReleaseVersion extends AvailableUpdate {tag: string; installable: boolean}
export interface UpdateStatus {
  currentVersion: string;
  autoCheckEnabled: boolean;
  lastCheckedAt: string | null;
  available: AvailableUpdate | null;
  target: AvailableUpdate | null;
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing';
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  installation: 'installed' | 'portable';
  installerPath: string | null;
}
export function initialUpdateStatus(): UpdateStatus {
  return {currentVersion, autoCheckEnabled: false, lastCheckedAt: null, available: null, target: null,
    phase: 'idle', downloadedBytes: 0, totalBytes: null, error: null,
    installation: 'portable', installerPath: null};
}
export const updateApi = {
  status: () => invoke<UpdateStatus>('update_status'),
  setAutoCheck: (enabled: boolean) => invoke<UpdateStatus>('update_set_auto_check', {enabled}),
  check: () => invoke<UpdateStatus>('update_check'),
  download: () => invoke<UpdateStatus>('update_download'),
  install: (allowRollback = false) => invoke<UpdateStatus>('update_install', {allowRollback}),
  openInstaller: (allowRollback = false) => invoke<void>('update_open_installer', {allowRollback}),
  listVersions: () => invoke<ReleaseVersion[]>('update_list_versions'),
  downloadVersion: (tag: string) => invoke<UpdateStatus>('update_download_version', {tag}),
  openRelease: (tag: string) => invoke<void>('update_open_release', {tag}),
};
