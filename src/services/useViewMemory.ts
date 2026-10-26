import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { currentViewKey, readMemory, viewStorage, writeMemory, type MemoryDecoder } from './viewMemory';

/** UI preferences are scoped by WebView and optionally by repository. No writes on mount. */
export function useViewMemory<T>(feature: string, fallback: T | (() => T), repository?: string | null, decode?: MemoryDecoder<T>): [T, Dispatch<SetStateAction<T>>] {
  const key = currentViewKey(feature, repository);
  const initial = () => typeof fallback === 'function' ? (fallback as () => T)() : fallback;
  const [cell, setCell] = useState(() => ({ key, value: readMemory(viewStorage(), key, initial(), decode) }));
  let current = cell;
  if (cell.key !== key) { current = { key, value: readMemory(viewStorage(), key, initial(), decode) }; setCell(current); }
  const latest = useRef(current); latest.current = current;
  const set = useCallback<Dispatch<SetStateAction<T>>>(update => {
    const before = latest.current;
    const value = typeof update === 'function' ? (update as (previous: T) => T)(before.value) : update;
    const next = { key: before.key, value }; latest.current = next; setCell(next);
    writeMemory(viewStorage(), next.key, value);
  }, []);
  return [current.value, set];
}
