import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {VersionEntry, VersionHistoryPage} from './VersionHistoryPage';
import {versionHistory} from './versionHistory';
import {currentVersion} from '../../services/version';

it('keeps the prior release and lists update support under the new application version', () => {
  expect(versionHistory.map(entry => entry.version)).toEqual([currentVersion, '0.1.0']);
  expect(versionHistory[0].groups.find(group => group.label === '新增')?.items.join('')).toContain('每 6 小时');
  expect(versionHistory[1].groups.map(group => group.label)).toEqual(['新增', '调整', '修复', '移除']);
});
it('starts history collapsed and marks only the actual current version', () => {
  const html = renderToStaticMarkup(<VersionHistoryPage/>);
  for (const entry of versionHistory) {
    const id = 'version-changes-' + entry.version.replaceAll('.', '-');
    expect(html).toContain('data-testid="version-' + entry.version + '"');
    expect(html).toContain('aria-expanded="false" aria-controls="' + id + '"');
    expect(html).toContain('id="' + id + '" class="version-changes" hidden=""');
  }
  expect(html.match(/>当前版本</g)).toHaveLength(1);
  expect(renderToStaticMarkup(<VersionEntry entry={versionHistory[1]}/>)).not.toContain('当前版本');
  expect(html).not.toContain('版本号保持');
  expect(html).toContain('软件更新');
});
