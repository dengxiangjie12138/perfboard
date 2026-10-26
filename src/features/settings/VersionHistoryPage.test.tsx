import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {VersionHistoryPage} from './VersionHistoryPage';
import {versionHistory} from './versionHistory';
import packageJson from '../../../package.json';

it('merges small updates under the actual current version without invented historical releases', () => {
  expect(versionHistory.map(entry => entry.version)).toEqual([packageJson.version]);
  expect(packageJson.version).toBe('0.1.0');
  expect(versionHistory[0].groups.map(group => group.label)).toEqual(['新增', '调整', '修复', '移除']);
  expect(versionHistory[0].groups.every(group => group.items.length > 0)).toBe(true);
});
it('starts collapsed and provides an accessible clickable version control with concise grouped changes', () => {
  const html = renderToStaticMarkup(<VersionHistoryPage/>);
  expect(html).toContain('data-testid="version-0.1.0"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-controls="version-changes-0-1-0"');
  expect(html).toContain('id="version-changes-0-1-0" class="version-changes" hidden=""');
  for (const label of ['新增', '调整', '修复', '移除']) {
    expect(html).toContain('<h3 id="version-changes-0-1-0-' + label + '">' + label + '</h3>');
    expect(html).toContain('class="version-change-scroll" role="region" aria-labelledby="version-changes-0-1-0-' + label + '" tabindex="0"');
  }
  expect(html.match(/data-testid="version-/g)).toHaveLength(1);
});
