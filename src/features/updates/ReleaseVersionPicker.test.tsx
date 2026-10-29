import {expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReleaseVersionPicker} from './ReleaseVersionPicker';
import {initialUpdateStatus, type ReleaseVersion, type UpdateStatus} from './updateApi';
import type {UpdateContextValue} from './UpdateContext';

const release = (version: string, installable = true): ReleaseVersion => ({tag: 'v' + version, version, installable,
  notes: version + ' 的版本说明', pubDate: null});
const versions = [release('0.1.0', false), release('0.1.2'), release('0.1.1')];
function model(status: Partial<UpdateStatus> = {}, view: Partial<UpdateContextValue> = {}): UpdateContextValue {
  return {status: {...initialUpdateStatus(), currentVersion: '0.1.2', ...status}, supported: true, loading: false, pendingAction: null,
    versions: null, versionsLoading: false, versionsError: null, listVersions: vi.fn(), downloadVersion: vi.fn(), openRelease: vi.fn(),
    check: vi.fn(), setSource: vi.fn(), setAutoCheck: vi.fn(), download: vi.fn(), install: vi.fn(), openInstaller: vi.fn(), ...view};
}
const render = (update: UpdateContextValue) => renderToStaticMarkup(<ReleaseVersionPicker update={update}/>);

it('only offers a load action on first open and never fetches or downloads on render', () => {
  const update = model(), html = render(update);
  expect(html).toContain('载入版本列表'); expect(html).not.toContain('data-testid="update-version-select"');
  expect(update.listVersions).not.toHaveBeenCalled(); expect(update.downloadVersion).not.toHaveBeenCalled();
});
it('names the selected source while loading its version catalog', () => {
  const html = render(model({source: 'gitee'}, {versionsLoading: true}));
  expect(html).toContain('正在读取 Gitee 国内镜像 正式版本…');
  expect(html).not.toContain('正在读取 GitHub');
});
it('lists stable versions in descending order with current/latest/rollback labels', () => {
  const html = render(model({}, {versions}));
  expect(html.indexOf('value="v0.1.2"')).toBeLessThan(html.indexOf('value="v0.1.1"'));
  expect(html.indexOf('value="v0.1.1"')).toBeLessThan(html.indexOf('value="v0.1.0"'));
  expect(html).toContain('当前版本 · 最新版本'); expect(html).toContain('0.1.1 · 可回退');
  expect(html).toContain('这是当前正在运行的版本，无需下载');
  expect(html).not.toContain('data-testid="update-download-version"');
});
it('shows the selected signed rollback separately from newer update availability', () => {
  const target = {version: '0.1.1', notes: null, pubDate: null};
  const update = model({target, available: {version: '0.2.0', notes: null, pubDate: null}}, {versions});
  const html = render(update);
  expect(html).toContain('所选版本 0.1.1'); expect(html).toContain('0.1.1 的版本说明');
  expect(html).toContain('下载回退版本'); expect(html).toContain('下载不会立即回退');
  expect(update.status.available?.version).toBe('0.2.0'); expect(update.install).not.toHaveBeenCalled();
});
it('only offers a manual release-page link for an unsigned historical installer', () => {
  const html = render(model({target: {version: '0.1.0', notes: null, pubDate: null}}, {versions}));
  expect(html).toContain('此版本缺少应用内更新签名'); expect(html).toContain('data-testid="update-open-release"');
  expect(html).not.toContain('data-testid="update-download-version"');
});
it('preserves a loaded list when refreshing fails and reports the separate catalog error', () => {
  const html = render(model({}, {versions, versionsError: 'GitHub 连接超时'}));
  expect(html).toContain('data-testid="update-version-select"'); expect(html).toContain('版本列表读取失败：GitHub 连接超时');
});
