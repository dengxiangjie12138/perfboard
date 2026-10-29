import type {ReleaseVersion, UpdateStatus} from './updateApi';

const stableVersion = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** Formal release versions only. BigInt keeps SemVer ordering exact for every component. */
export function compareReleaseVersions(left: string, right: string): number | null {
  const a = stableVersion.exec(left), b = stableVersion.exec(right);
  if (!a || !b) return null;
  for (let index = 1; index <= 3; index++) {
    const first = BigInt(a[index]), second = BigInt(b[index]);
    if (first !== second) return first > second ? 1 : -1;
  }
  return 0;
}
export function orderedReleaseVersions(versions: readonly ReleaseVersion[]): ReleaseVersion[] {
  const seen = new Set<string>();
  return versions.filter(version => {
    if (compareReleaseVersions(version.version, version.version) === null) return false;
    const normalized = version.version.replace(/^v/, '');
    if (seen.has(normalized)) return false;
    seen.add(normalized); return true;
  }).sort((left, right) => compareReleaseVersions(right.version, left.version) ?? 0);
}
export function releaseVersionLabel(version: ReleaseVersion, current: string, latest?: string): string {
  const labels = [version.version];
  const relation = compareReleaseVersions(version.version, current);
  if (relation === 0) labels.push('当前版本');
  if (latest && compareReleaseVersions(version.version, latest) === 0) labels.push('最新版本');
  if (relation !== null && relation < 0) labels.push(version.installable ? '可回退' : '手动下载');
  else if (!version.installable) labels.push('手动下载');
  return labels.join(' · ');
}
export interface InstallConfirmation {
  currentVersion: string;
  targetVersion: string;
  portable: boolean;
  rollback: boolean;
}
export function installConfirmation(status: UpdateStatus): InstallConfirmation | null {
  const target = status.target ?? status.available;
  if (status.phase !== 'ready' || !target) return null;
  const relation = compareReleaseVersions(target.version, status.currentVersion);
  if (relation === null || relation === 0) return null;
  return {currentVersion: status.currentVersion, targetVersion: target.version,
    portable: status.installation === 'portable', rollback: relation < 0};
}
