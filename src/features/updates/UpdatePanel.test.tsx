import {expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {InstallVersionDialog, UpdatePanel, confirmVersionInstall, updateStatusLabel} from './UpdatePanel';
import {initialUpdateStatus, type UpdateStatus} from './updateApi';
import type {UpdateContextValue} from './UpdateContext';
import {installConfirmation} from './releaseVersions';

vi.mock('../../state/DataContext', () => ({useData: () => ({error: null})}));

function model(status: Partial<UpdateStatus> = {}, view: Partial<UpdateContextValue> = {}): UpdateContextValue {
  return {status: {...initialUpdateStatus(), ...status}, supported: true, loading: false, pendingAction: null,
    versions: null, versionsLoading: false, versionsError: null, listVersions: vi.fn(), downloadVersion: vi.fn(), openRelease: vi.fn(),
    check: vi.fn(), setSource: vi.fn(), setAutoCheck: vi.fn(), download: vi.fn(), install: vi.fn(), openInstaller: vi.fn(), ...view};
}
const available = {version: '0.2.0', notes: '新增功能\n修复保存问题', pubDate: '2026-10-29T00:00:00Z'};
const render = (value: UpdateContextValue) => renderToStaticMarkup(<UpdatePanel update={value}/>);

it('starts opt-in with GitHub selected and explains persisted sources and six-hour tray checks', () => {
  const value = model(), html = render(value);
  expect(html).toContain('自动检查更新'); expect(html).toContain('每 6 小时'); expect(html).toContain('托盘运行也生效');
  expect(html).toContain('尚未检查更新'); expect(html).not.toContain('checked=""');
  expect(html).toContain('<option value="github" selected="">GitHub</option>');
  expect(html).toContain('<option value="gitee">Gitee 国内镜像</option>');
  expect(html).toContain('选择会保存在本机'); expect(html).toContain('aria-describedby="update-source-help"');
  expect(value.check).not.toHaveBeenCalled(); expect(value.setSource).not.toHaveBeenCalled(); expect(value.setAutoCheck).not.toHaveBeenCalled();
});
it('shows the native persisted source and its saving state without optimistically changing it', () => {
  const html = render(model({source: 'gitee'}));
  expect(html).toContain('<option value="gitee" selected="">Gitee 国内镜像</option>');
  expect(html).toContain('当前来源：Gitee 国内镜像'); expect(html).not.toContain('GitHub Releases');
  const saving = render(model({source: 'github'}, {pendingAction: 'set-source'}));
  expect(saving).toContain('正在保存更新来源…');
  expect(saving).toMatch(/data-testid="update-source"[^>]*disabled=""/);
  expect(saving).toContain('<option value="github" selected="">GitHub</option>');
  for (const view of [{loading: true}, {versionsLoading: true}, {supported: false}]) {
    expect(render(model({}, view))).toMatch(/data-testid="update-source"[^>]*disabled=""/);
  }
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
  expect(checking).toMatch(/data-testid="update-source"[^>]*disabled=""/);
  const unknown = render(model({available, phase: 'downloading', downloadedBytes: 1024}));
  expect(unknown).toContain('aria-label="版本下载进度" max="100"');
  expect(unknown).toMatch(/<progress[^>]*max="100"><\/progress>/); expect(unknown).toContain('1 KiB');
  const known = render(model({available, phase: 'downloading', downloadedBytes: 512, totalBytes: 1024}));
  expect(known).toContain('value="50"'); expect(known).toContain('50%');
});
it('invalidates installation confirmation after changing source even for the same version', async () => {
  const value = model({available, phase: 'ready', installation: 'installed'});
  const original = installConfirmation(value.status)!;
  value.status = {...value.status, source: 'gitee'};
  await confirmVersionInstall(value, original);
  expect(value.install).not.toHaveBeenCalled();
  const confirmed = installConfirmation(value.status)!;
  const html = renderToStaticMarkup(<InstallVersionDialog confirmation={confirmed} busy={false} onClose={() => {}} onConfirm={() => {}}/>);
  expect(html).toContain('更新来源：Gitee 国内镜像');
  await confirmVersionInstall(value, confirmed); expect(value.install).toHaveBeenCalledWith(false);
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
  expect(updateStatusLabel(status, false)).toBe('更新操作未完成');
  const html = render(model({}, {supported: false}));
  expect(html).toContain('data-testid="update-check" disabled=""');
  expect(html).toContain('请在 Perfboard Windows 应用中检查和安装更新');
});
it('shows a downloaded rollback target even when no newer version is available', () => {
  const value = model({currentVersion: '0.1.2', available: null,
    target: {version: '0.1.1', notes: '上一版说明', pubDate: null}, phase: 'ready', installation: 'installed'});
  const html = render(value);
  expect(html).toContain('回退目标'); expect(html).toContain('0.1.2 → 0.1.1');
  expect(html).toContain('保存并重启回退'); expect(html).not.toContain('新版本 0.1.1');
  expect(value.install).not.toHaveBeenCalled();
});
it('explains the exact rollback and compatibility before allowing explicit installation', async () => {
  const value = model({currentVersion: '0.1.2', available,
    target: {version: '0.1.1', notes: null, pubDate: null}, phase: 'ready', installation: 'installed'});
  const confirmation = installConfirmation(value.status)!;
  const html = renderToStaticMarkup(<InstallVersionDialog confirmation={confirmation} busy={false} onClose={() => {}} onConfirm={() => {}}/>);
  expect(html).toContain('确认回退版本'); expect(html).toContain('0.1.2 → 0.1.1');
  expect(html).toContain('数据库和附件会继续保留'); expect(html).toContain('兼容的当前数据格式');
  expect(value.install).not.toHaveBeenCalled();
  await confirmVersionInstall(value, confirmation);
  expect(value.install).toHaveBeenCalledWith(true);
  expect(value.openInstaller).not.toHaveBeenCalled();
});
it('requires the downloaded target to still match the confirmed version and never opts upgrades into rollback', async () => {
  const value = model({currentVersion: '0.1.2', available,
    target: {version: '0.1.1', notes: null, pubDate: null}, phase: 'ready', installation: 'installed'});
  const old = installConfirmation(value.status)!;
  value.status = {...value.status, target: {version: '0.1.0', notes: null, pubDate: null}};
  await confirmVersionInstall(value, old); expect(value.install).not.toHaveBeenCalled();
  value.status = {...value.status, target: available};
  await confirmVersionInstall(value, installConfirmation(value.status)!);
  expect(value.install).toHaveBeenCalledWith(false);
  const stale = renderToStaticMarkup(<InstallVersionDialog confirmation={old} busy={false} valid={false} onClose={() => {}} onConfirm={() => {}}/>);
  expect(stale).toContain('data-testid="update-confirm-install" disabled=""');
  expect(stale).not.toContain('<button disabled="">暂不安装');
});
