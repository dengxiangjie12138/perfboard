import {useEffect, useRef, type RefObject} from 'react';
import {registerSaveShortcut, type SaveShortcutOptions} from './saveShortcut';

/** The ref may appear conditionally (for example an editor dialog).
 * Re-register after each commit so the scope and its callback always agree. */
export function useSaveShortcut(scope: RefObject<HTMLElement | null>, onSave: () => unknown, options: SaveShortcutOptions = {}): void {
  const state = useRef({running: false});
  useEffect(() => {
    if (!scope.current) return;
    return registerSaveShortcut(scope.current, onSave, options, state.current);
  });
}
