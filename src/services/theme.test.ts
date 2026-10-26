import { expect, it } from 'vitest';
import { resolveTheme, themePreference } from './theme';
import { readMemory, writeMemory } from './viewMemory';

it('resolves both system appearances while preserving every manual theme', () => {
  expect(resolveTheme('system', false)).toBe('light');
  expect(resolveTheme('system', true)).toBe('dark');
  for (const theme of ['light', 'dark', 'codex'] as const) {
    expect(resolveTheme(theme, false)).toBe(theme);
    expect(resolveTheme(theme, true)).toBe(theme);
  }
});

it('restores the system preference rather than saving the current resolved color', () => {
  let raw: string | null = null;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  writeMemory(storage, 'theme', 'system');
  expect(readMemory(storage, 'theme', 'codex', themePreference)).toBe('system');
  for (const invalid of [null, {}, 'auto', 'sepia', 1]) expect(themePreference(invalid)).toBeUndefined();
  for (const theme of ['light', 'dark', 'codex', 'system']) expect(themePreference(theme)).toBe(theme);
});
