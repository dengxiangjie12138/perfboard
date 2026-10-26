import {expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AutomaticBackupForm, RepositorySizeBadge} from './RepositoryPage';
import {defaultAutoBackupSettings, type AutoBackupStatus, type RepositoryStatistics} from './settingsApi';
vi.mock('../../services/api', () => ({native: true, api: {}, errorMessage: (error: unknown) => String(error)}));
const statistics: RepositoryStatistics = {databaseBytes: 1024, walBytes: 512, attachmentsBytes: 4096, attachmentFiles: 2, measuredAt: '2026-10-03T20:00:00Z'};
const handlers = {onDraft: vi.fn(), onChoose: vi.fn(), onSave: vi.fn(), onRetry: vi.fn()};
function form(status: AutoBackupStatus | null, draft = {...defaultAutoBackupSettings}, error: string | null = null) {
  return renderToStaticMarkup(<AutomaticBackupForm status={status} draft={draft} loading={false} busy={false} error={error} {...handlers}/>);
}
it('the colored database badge reports real SQLite bytes and separates its scope', () => {
  const html = renderToStaticMarkup(<RepositorySizeBadge statistics={statistics} loading={false} error={null}/>);
  expect(html).toContain('repository-byte-badge');
  expect(html).toContain('数据库 1 KiB');
  expect(html).toContain('1,024 字节；WAL 和附件另计');
  expect(html).not.toContain('progress');
  expect(html).not.toContain('%');
  expect(html).not.toContain('4 KiB');
});
it('a failed statistics read shows failure instead of cached bytes', () => {
  const html = renderToStaticMarkup(<RepositorySizeBadge statistics={statistics} loading={false} error="Injected failure"/>);
  expect(html).toContain('大小读取失败');
  expect(html).not.toContain('数据库 1 KiB');
});
it('unknown or loading sizes never display a fictional zero', () => {
  for (const loading of [true, false]) {
    const html = renderToStaticMarkup(<RepositorySizeBadge statistics={null} loading={loading} error={null}/>);
    expect(html).not.toContain('0 B');
    expect(html).not.toContain('repository-byte-badge');
  }
});
it('renders the saved disabled default, explicit save, running requirement and retention scope', () => {
  const html = form({settings: {...defaultAutoBackupSettings}, lastResult: null});
  expect(html).toContain('已关闭');
  expect(html).not.toContain('checked=""');
  expect(html).toContain('data-testid="auto-backup-save" disabled=""');
  expect(html).toContain('最近 5 份自动备份');
  expect(html).toContain('手动备份保留原样');
  expect(html).toContain('关闭应用后不运行');
  expect(html).toContain('尚未执行自动备份');
});
it('marks draft enablement as unsaved while showing the actual saved disabled status', () => {
  const html = form({settings: {...defaultAutoBackupSettings}, lastResult: null}, {
    enabled: true, parentDirectory: 'D:\\isolated', time: '09:30',
  });
  expect(html).toContain('有未保存的修改');
  expect(html).toContain('已保存：关闭');
  expect(html).toContain('已关闭');
  expect(html).toContain('checked=""');
  expect(html).not.toContain('已开启');
  expect(html).not.toContain('data-testid="auto-backup-save" disabled=""');
});
it('prevents enabling without a parent directory or valid daily time', () => {
  const status = {settings: {...defaultAutoBackupSettings}, lastResult: null};
  for (const draft of [
    {enabled: true, parentDirectory: null, time: '09:30'},
    {enabled: true, parentDirectory: 'D:\\isolated', time: '24:00'},
  ]) {
    const html = form(status, draft);
    expect(html).toContain('data-testid="auto-backup-save" disabled=""');
  }
});
it('blocks saving after an initial read failure and reports the actual error', () => {
  const html = form(null, {...defaultAutoBackupSettings}, 'Settings unreadable');
  expect(html).toContain('Settings unreadable');
  expect(html).toContain('data-testid="auto-backup-save" disabled=""');
  expect(html).not.toContain('当前设置已保存');
});
it('failed backup and cleanup warnings stay visible without success text', () => {
  const status: AutoBackupStatus = {
    settings: {...defaultAutoBackupSettings},
    lastResult: {day: '2026-10-03', attemptedAt: statistics.measuredAt, status: 'failed', backupPath: null,
      error: 'Destination unavailable', cleanupWarning: 'Unmanaged directory preserved'},
  };
  const html = form(status);
  expect(html).toContain('自动备份失败');
  expect(html).toContain('Destination unavailable');
  expect(html).toContain('Unmanaged directory preserved');
  expect(html).not.toContain('自动备份已完成');
});
it('running backup is shown as running until the backend reports success', () => {
  const status: AutoBackupStatus = {
    settings: {...defaultAutoBackupSettings},
    lastResult: {day: '2026-10-03', attemptedAt: statistics.measuredAt, status: 'running', backupPath: null, error: null, cleanupWarning: null},
  };
  expect(form(status)).toContain('自动备份正在进行');
  expect(form(status)).not.toContain('自动备份已完成');
});
