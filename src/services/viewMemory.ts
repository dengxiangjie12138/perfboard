import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { native } from './api';

export interface MemoryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type MemoryDecoder<T> = (value: unknown) => T | undefined;
export const memoryObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const memoryChoice = <T extends string | number>(values: readonly T[]): MemoryDecoder<T> => value => values.includes(value as T) ? value as T : undefined;
const MAX_BYTES = 2 * 1024 * 1024;

export function viewMemoryKey(windowLabel: string, feature: string, repository?: string | null): string {
  const scope = repository ? repository.replace(/\\/g, '/').replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '').replace(/\/+$/, '').toLowerCase() : '';
  return 'perfboard.view.v1.' + JSON.stringify([windowLabel, scope, feature]);
}
export function currentViewKey(feature: string, repository?: string | null): string {
  let label = 'main';
  try { if (native) label = getCurrentWebviewWindow().label; } catch { /* Browser/SSR development. */ }
  return viewMemoryKey(label, feature, repository);
}
/** Restore known fields only; new fields keep their defaults after an upgrade. */
export function restoreMemoryShape<T>(fallback: T, value: unknown, depth = 0): T {
  if (depth > 24 || value === undefined) return fallback;
  if (fallback === null) return (value === null ? value : fallback) as T;
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value) || value.length > 10000) return fallback;
    return (fallback.length ? value.map(item => restoreMemoryShape(fallback[0], item, depth + 1)) : value) as T;
  }
  if (memoryObject(fallback)) {
    if (!memoryObject(value)) return fallback;
    return Object.fromEntries(Object.entries(fallback).map(([key, initial]) => [key, restoreMemoryShape(initial, Object.hasOwn(value, key) ? value[key] : undefined, depth + 1)])) as T;
  }
  return typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value)) ? value as T : fallback;
}
export function readMemory<T>(storage: MemoryStorage | undefined, key: string, fallback: T, decode?: MemoryDecoder<T>): T {
  try {
    const raw = storage?.getItem(key);
    if (!raw || raw.length > MAX_BYTES) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!memoryObject(parsed) || parsed.version !== 1 || !Object.hasOwn(parsed, 'value')) return fallback;
    return decode ? decode(parsed.value) ?? fallback : restoreMemoryShape(fallback, parsed.value);
  } catch { return fallback; }
}
export function writeMemory(storage: MemoryStorage | undefined, key: string, value: unknown): boolean {
  try {
    if (!storage) return false;
    const raw = JSON.stringify({ version: 1, value });
    if (raw.length > MAX_BYTES) return false;
    storage.setItem(key, raw); return true;
  } catch { return false; }
}
export function viewStorage(): MemoryStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}
export function readViewMemory<T>(feature: string, fallback: T, repository?: string | null, decode?: MemoryDecoder<T>): T {
  return readMemory(viewStorage(), currentViewKey(feature, repository), fallback, decode);
}
export function writeViewMemory(feature: string, value: unknown, repository?: string | null): boolean {
  return writeMemory(viewStorage(), currentViewKey(feature, repository), value);
}
