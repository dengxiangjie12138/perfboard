import { useSyncExternalStore } from 'react';
import type { Theme, ThemePreference } from '../types';
import { resolveTheme } from './theme';

const query = '(prefers-color-scheme: dark)';
const systemDark = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** Keep the saved preference separate from the concrete theme shared with child windows. */
export function useResolvedTheme(preference: ThemePreference): Theme {
  return resolveTheme(preference, useSyncExternalStore(subscribe, systemDark, () => false));
}
