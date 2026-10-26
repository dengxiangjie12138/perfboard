const KEY = 'perfboard:parts-show-lcsc-warehouse';

/** Only the exact location label is hidden; surrounding whitespace is ignored. */
export function isLcscWarehouse(location: string): boolean { return location.trim() === '立创仓库'; }
export function readShowLcscWarehousePreference(): boolean { try { return localStorage.getItem(KEY) === 'true'; } catch { return false; } }
export function writeShowLcscWarehousePreference(show: boolean): void { try { localStorage.setItem(KEY, String(show)); } catch { /* Filtering still works when browser storage is unavailable. */ } }
