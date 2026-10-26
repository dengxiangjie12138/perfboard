import { invoke } from '@tauri-apps/api/core';
export const openReference = (url: string) => invoke<void>('opamp_reference_open', { url });
