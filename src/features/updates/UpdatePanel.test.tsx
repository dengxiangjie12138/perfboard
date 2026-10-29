import {expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {UpdatePanel, updateStatusLabel} from './UpdatePanel';
import {initialUpdateStatus, type UpdateStatus} from './updateApi';
import type {UpdateContextValue} from './UpdateContext';

function model(status: Partial<UpdateStatus> = {}, view: Partial<UpdateContextValue> = {}): UpdateContextValue {
  return {status: {...initialUpdateStatus(), ...status}, supported: true, loading: false, pendingAction: null,
    check: vi.fn(), setAutoCheck: vi.fn(), download: vi.fn(), install: vi.fn(), openInstaller: vi.fn(), ...view};
}
const available = {version: '0.2.0', notes: '新增功能\n修复保存问题', pubDate: '2026-10-29T00:00:00Z'};
const render = (value: UpdateContextValue) => renderToStaticMarkup(<UpdatePanel update={value}/>);

it('starts opt-in, explains the six-hour tray checks, and never offers an unfinished mirror switch', () => {
  const value = model(), html = render(value);
  expect(html).toContain('自动检查更新'); expect(html).toContain('每 6 小时'); expect(html).toContain('托盘运行也生效');
  expect(html).toContain('尚未检查更新'); expect(html).not.toContain('checked=""');
  expect(html).not.toContain('国内镜像'); expect(html).not.toContain('Gitee');
  expect(value.check).not.toHaveBeenCalled(); expect(value.setAutoCheck).not.toHaveBeenCalled();
});
it('shows a newer version and release text safely while retaining errors for retry', () => {
  const html = render(model({available: {...available, notes: '<script>unsafe</script>'}, error: '网络连接失败'}));
  expect(html).toContain('新版本 0.2.0'); expect(html).toContain('下载更新'); expect(html).toContain('role="alert"');
  expect(html).toContain('网络连接失败'); expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
  expect(html).not.toContain('<script>'); expect(html).not.toContain('已是最新版本');
});
it('disables conflicting controls while checking or downloading and supports unknown download sizes', () => {
  const checking = render(model({phase: 'checking'}));
  expect(checking).toContain('data-testid="update-check" disabled=""');
  expect(checking).toContain('data-testid="update-auto-check" disabled=""');
  const unknown = render(model({available, phase: 'downloading', downloadedBytes: 1024}));
  expect(unknown).toContain('aria-label="新版本下载进度" max="100"');
  expect(unknown).not.toContain('value="'); expect(unknown).toContain('1 KiB');
  const known = render(model({available, phase: 'downloading', downloadedBytes: 512, totalBytes: 1024}));
  expect(known).toContain('value="50"'); expect(known).toContain('50%');
});
it('requires explicit installed-app confirmation and offers the portable installer separately', () => {
  const ready = {available, phase: 'ready' as const, installerPath: 'D:\\cache\\update.exe'};
  const installed = model({...ready, installation: 'installed'}), html = render(installed);
  expect(html).toContain('data-testid="update-install"'); expect(html).toContain('保存并重启更新');
  expect(html).not.toContain('data-testid="update-open-installer"'); expect(installed.install).not.toHaveBeenCalled();
  const portable = render(model({...ready, installation: 'portable'}));
  expect(portable).toContain('data-testid="update-open-installer"'); expect(portable).toContain('当前为便携运行');
  expect(portable).not.toContain('data-testid="update-install"');
  expect(portable).toContain('保存并退出洞洞板');
});
it('offers installation when the installed app has a verified in-memory update without a file path', () => {
  const html = render(model({available, phase: 'ready', installation: 'installed', installerPath: null}));
  expect(html).toContain('data-testid="update-install"');
  expect(html).not.toContain('data-testid="update-download"');
  expect(html).not.toContain('data-testid="update-install" disabled=""');
});
it('does not call a failed check latest or enable native actions in browser preview', () => {
  const status = {...initialUpdateStatus(), lastCheckedAt: '2026-10-29T00:00:00Z', error: '连接超时'};
  expect(updateStatusLabel(status, false)).toBe('更新检查未完成');
  const html = render(model({}, {supported: false}));
  expect(html).toContain('data-testid="update-check" disabled=""');
  expect(html).toContain('请在 Perfboard Windows 应用中检查和安装更新');
});
