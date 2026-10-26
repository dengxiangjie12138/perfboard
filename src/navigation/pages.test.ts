import { expect, it } from 'vitest';
import { pageLabel, searchPages } from './pages';
import { TOOLS, TOOL_GROUPS, toolGroupFor } from '../tools/registry';

it('registered tools have unique routes and a known group', () => {
  expect(new Set(TOOLS.map(tool => tool.page)).size).toBe(TOOLS.length);
  for (const tool of TOOLS) {
    expect(TOOL_GROUPS.some(group => group.page === tool.group)).toBe(true);
    expect(toolGroupFor(tool.page)).toBe(tool.group);
    expect(pageLabel(tool.page)).toContain(tool.title);
    expect(searchPages(tool.title).some(result => result.page === tool.page)).toBe(true);
  }
});
it('uses tool keywords and the renamed note overview in search', () => {
  expect(searchPages('PSC').map(result => result.page)).toContain('timer');
  expect(searchPages('divider').map(result => result.page)).toContain('feedback');
  expect(searchPages('笔记概览').map(result => result.page)).toContain('notes');
});
