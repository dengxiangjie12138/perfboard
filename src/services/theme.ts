import type { Theme, ThemePreference } from '../types';

export function themePreference(value: unknown): ThemePreference | undefined {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'codex' ? value : undefined;
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}
