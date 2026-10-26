const KEY = 'perfboard:dev-logs-autosave';
export function readLogAutosavePreference(): boolean { try { return localStorage.getItem(KEY) !== 'false'; } catch { return true; } }
export function writeLogAutosavePreference(enabled: boolean): void { localStorage.setItem(KEY, String(enabled)); }
export function observeLogAutosavePreference(update: (enabled: boolean) => void): () => void {
 const listener = (event: StorageEvent) => { if (event.storageArea === localStorage && (event.key === KEY || event.key === null)) update(readLogAutosavePreference()); };
 window.addEventListener('storage', listener); return () => window.removeEventListener('storage', listener);
}
