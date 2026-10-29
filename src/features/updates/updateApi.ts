import {invoke} from '@tauri-apps/api/core';
import {currentVersion} from '../../services/version';

export interface AvailableUpdate {version: string; notes: string | null; pubDate: string | null}
export interface UpdateStatus {
  currentVersion: string;
  autoCheckEnabled: boolean;
  lastCheckedAt: string | null;
  available: AvailableUpdate | null;
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing';
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  installation: 'installed' | 'portable';
  installerPath: string | null;
}
export function initialUpdateStatus(): UpdateStatus {
  return {currentVersion, autoCheckEnabled: false, lastCheckedAt: null, available: null,
    phase: 'idle', downloadedBytes: 0, totalBytes: null, error: null,
    installation: 'portable', installerPath: null};
}
export const updateApi = {
  status: () => invoke<UpdateStatus>('update_status'),
  setAutoCheck: (enabled: boolean) => invoke<UpdateStatus>('update_set_auto_check', {enabled}),
  check: () => invoke<UpdateStatus>('update_check'),
  download: () => invoke<UpdateStatus>('update_download'),
  install: () => invoke<UpdateStatus>('update_install'),
  openInstaller: () => invoke<void>('update_open_installer'),
};
