import {expect, it} from 'vitest';
import {compareReleaseVersions, installConfirmation, orderedReleaseVersions, releaseVersionLabel} from './releaseVersions';
import {initialUpdateStatus, type ReleaseVersion} from './updateApi';

const release = (version: string, installable = true): ReleaseVersion => ({tag: 'v' + version, version, installable, notes: null, pubDate: null});

it('orders stable semantic versions rather than release dates or lexical text', () => {
  const ordered = orderedReleaseVersions([release('0.1.0'), release('0.1.10'), release('0.1.2'), release('0.1.2-rc.1'),
    release('0.1.1'), release('01.1.1'), release('0.1.2')]);
  expect(ordered.map(version => version.version)).toEqual(['0.1.10', '0.1.2', '0.1.1', '0.1.0']);
  expect(compareReleaseVersions('v0.1.2', '0.1.2')).toBe(0);
  expect(compareReleaseVersions('99999999999999999999.0.0', '99999999999999999998.0.0')).toBe(1);
});
it('distinguishes current, latest, signed rollback, and unsigned manual releases', () => {
  expect(releaseVersionLabel(release('0.1.2'), '0.1.2', '0.1.2')).toBe('0.1.2 · 当前版本 · 最新版本');
  expect(releaseVersionLabel(release('0.1.1'), '0.1.2', '0.1.2')).toBe('0.1.1 · 可回退');
  expect(releaseVersionLabel(release('0.1.0', false), '0.1.2', '0.1.2')).toBe('0.1.0 · 手动下载');
});
it('uses the verified target rather than the latest release when deciding rollback confirmation', () => {
  const status = {...initialUpdateStatus(), currentVersion: '0.1.2', phase: 'ready' as const,
    available: {version: '0.2.0', notes: null, pubDate: null}, target: {version: '0.1.1', notes: null, pubDate: null}};
  expect(installConfirmation(status)).toMatchObject({currentVersion: '0.1.2', targetVersion: '0.1.1', rollback: true});
  expect(installConfirmation({...status, phase: 'downloading'})).toBeNull();
  expect(installConfirmation({...status, target: {...status.target, version: '0.1.2'}})).toBeNull();
  expect(installConfirmation({...status, target: {...status.target, version: 'bad-version'}})).toBeNull();
});
