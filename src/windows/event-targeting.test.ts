/// <reference types="vite/client" />
import hook from './useWindowClose.ts?raw';
import native from '../../src-tauri/src/tool_windows.rs?raw';
import { describe, expect, it } from 'vitest';

describe('close-request event targeting regression', () => {
  it('binds close requests to the current webview and never broadcasts native save requests', () => {
    // Tauri Any listeners receive labeled emissions even in unrelated webviews.
    expect(hook).toContain("getCurrentWebviewWindow().listen<CloseRequest>('perfboard:close-request'");
    expect(hook).not.toMatch(/(?<!\.)\blisten<CloseRequest>\('perfboard:close-request'/);
    expect(native).not.toMatch(/\.emit\(\s*"perfboard:close-request"/);
    expect(native).toMatch(/app\.emit_to\(\s*label,\s*"perfboard:close-request"/);
  });
});
