#!/usr/bin/env node
/** One isolated, owned upload probe. Never writes production releases or update indexes. */
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {MirrorHttp, SOURCE, TARGET, readVerifiedGithubRelease, verifyGiteeTag, uploadGiteeCurl} from './mirror-gitee-release.mjs';
import {verifySignature} from './prepare-update-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_TAG = 'v0.1.2';
export const SOURCE_COMMIT = '82a1c0af8c1ff950604a8b293093e71abd7ae920';
export const SOURCE_SHA256 = '937702f9ef7746c4cb9448c0363ea19653dce83586527e6fae3b1945d76b2021';
const TAG = /^mirror-upload-probe-[1-9]\d*-[1-9]\d*-[0-9a-f]{16}$/;
const PROBE_TRANSFER_TIMEOUT_MS = 600_000;
const PROBE_CURL_TIMEOUT_MS = 590_000;
function requireValue(value, message) {if (!value) throw new Error(message)}
export function releaseMarker(tag, sourceCommit) {
  requireValue(TAG.test(tag) && sourceCommit === SOURCE_COMMIT, 'Only a uniquely named probe of the fixed source release is allowed');
  return `<!-- perfboard-upload-probe:v1 tag=${tag} source=${SOURCE} commit=${sourceCommit} -->`;
}
function safeMessage(error, tokens) {
  let message = String(error?.message ?? 'Upload probe failed');
  for (const token of tokens.filter(Boolean)) message = message.replaceAll(token, '[redacted]').replaceAll(encodeURIComponent(token), '[redacted]');
  return message.slice(0, 600);
}
function ownRelease(release, expected, id = null) {
  requireValue(release && Number.isSafeInteger(release.id) && release.id > 0
    && (id === null || release.id === id) && release.tag_name === expected.tag
    && release.name === expected.name && release.body === expected.marker
    && release.target_commitish === expected.sourceCommit && release.prerelease === true,
  'Probe release ownership changed; refusing to modify or delete it');
  return release.id;
}

async function readRelease(http, endpoint) {
  // MirrorHttp centrally bounds safe GET connect retries under one deadline.
  return http.api('gitee', 'GET', endpoint, undefined, true);
}

async function cleanupRelease(http, expected, id, attempted) {
  const byTag = await readRelease(http, `/releases/tags/${expected.tag}`);
  if (byTag) {
    requireValue(attempted, 'A pre-existing release is not owned by this probe; cleanup refused');
    id = ownRelease(byTag, expected, id);
  }
  const byId = id === null ? null : await readRelease(http, `/releases/${id}`);
  if (byId) {
    requireValue(attempted, 'A pre-existing release is not owned by this probe; cleanup refused');
    ownRelease(byId, expected, id);
    // A timed-out DELETE may have succeeded. Read back the exact owned ID/tag
    // afterwards rather than broadening deletion or assuming an outcome.
    try {await http.api('gitee', 'DELETE', `/releases/${id}`)} catch { /* Read back below. */ }
  }
  const [remainingTag, remainingId] = await Promise.all([
    readRelease(http, `/releases/tags/${expected.tag}`),
    id === null ? null : readRelease(http, `/releases/${id}`),
  ]);
  requireValue(remainingTag === null && remainingId === null, 'Probe release cleanup is unconfirmed; keep its owned tag for inspection');
  return id;
}

/** Recover only a previously created probe; never creates tags, releases or files on Gitee. */
export async function cleanupProbe({tag, sourceCommit, releaseId, resultFile, giteeToken, fetchImpl, onProgress = () => {}} = {}) {
  const marker = releaseMarker(tag, sourceCommit);
  requireValue(Number.isSafeInteger(releaseId) && releaseId > 0, 'Cleanup requires the exact known positive probe release ID');
  requireValue(giteeToken && typeof resultFile === 'string' && resultFile.length > 0, 'Cleanup requires configured credentials and a dedicated result file');
  const expected = {tag, sourceCommit, marker, name: `Perfboard upload probe ${tag}`};
  const http = new MirrorHttp({fetchImpl, giteeToken, onProgress});
  try {await cleanupRelease(http, expected, releaseId, true)}
  catch (error) {throw new Error(`Probe cleanup failed (owned tag ${tag}; release ${releaseId}): ${safeMessage(error, [giteeToken])}`)}
  const result = {schemaVersion: 1, tag, sourceCommit, sourceTag: SOURCE_TAG, releaseId,
    releaseMarker: marker, releaseCleanupConfirmed: true, uploadVerified: false};
  await writeFile(resultFile, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  return result;
}

export async function probeUpload({tag, sourceCommit, resultFile, publicKey, githubToken, giteeToken,
  fetchImpl, uploadImpl, onProgress = () => {}, expectedSha256 = SOURCE_SHA256} = {}) {
  const marker = releaseMarker(tag, sourceCommit);
  requireValue(giteeToken && typeof resultFile === 'string' && resultFile.length > 0, 'Probe requires configured credentials and a dedicated result file');
  const expected = {tag, sourceCommit, marker, name: `Perfboard upload probe ${tag}`};
  const boundedUpload = (url, options) => (uploadImpl ?? uploadGiteeCurl)(url,
    {...options, signal: AbortSignal.timeout(PROBE_TRANSFER_TIMEOUT_MS)}, {ipv4: true, timeoutMs: PROBE_CURL_TIMEOUT_MS, nativeMultipart: true});
  const http = new MirrorHttp({fetchImpl, uploadImpl: boundedUpload, githubToken, giteeToken, onProgress,
    uploadTimeoutMs: PROBE_TRANSFER_TIMEOUT_MS});
  let id = null, attempted = false, uploadVerified = false, failure = null;
  try {
    const existing = await http.api('gitee', 'GET', `/releases/tags/${tag}`, undefined, true);
    requireValue(existing === null, 'A pre-existing release is not owned by this probe; refusing to reuse it');
    const source = await readVerifiedGithubRelease(http, SOURCE_TAG, publicKey);
    requireValue(source.commit === sourceCommit, 'Source release commit changed; refusing the upload probe');
    const installer = source.assets[source.filename];
    requireValue(createHash('sha256').update(installer).digest('hex') === expectedSha256, 'Source installer differs from the fixed public release');
    await verifyGiteeTag(http, {tag, commit: sourceCommit});
    attempted = true;
    onProgress(`Creating isolated Gitee upload probe ${tag}`);
    const release = await http.api('gitee', 'POST', '/releases', {tag_name: tag, name: expected.name,
      body: marker, target_commitish: sourceCommit, prerelease: true});
    id = ownRelease(release, expected);
    const form = new FormData();
    // This experiment intentionally tests token-first multipart and IPv4.
    form.append('access_token', giteeToken);
    form.append('file', new Blob([installer], {type: 'application/vnd.microsoft.portable-executable'}), source.filename);
    onProgress(`Uploading fixed signed installer to isolated probe ${id} (IPv4; ${PROBE_TRANSFER_TIMEOUT_MS / 1000}s total limit)`);
    const attachment = await http.api('gitee', 'POST', `/releases/${id}/attach_files`, form);
    requireValue(attachment.name === source.filename && attachment.size === installer.length
      && Number.isSafeInteger(attachment.id) && attachment.id > 0, 'Probe upload returned different attachment metadata');
    const url = `https://gitee.com/${TARGET}/attach_files/${attachment.id}/download/${encodeURIComponent(source.filename)}`;
    const downloaded = await http.download(url, 'gitee');
    requireValue(createHash('sha256').update(downloaded).digest('hex') === expectedSha256, 'Probe public download hash differs from the source installer');
    verifySignature({signature: source.manifest.platforms['windows-x86_64'].signature, publicKey,
      digest: createHash('blake2b512').update(downloaded).digest(), version: source.version, filename: source.filename});
    uploadVerified = true;
  } catch (error) {failure = safeMessage(error, [githubToken, giteeToken])}
  try {
    id = await cleanupRelease(http, expected, id, attempted);
  } catch (error) {
    throw new Error(`Probe cleanup failed (owned tag ${tag}; release ${id ?? 'unknown'}): ${safeMessage(error, [githubToken, giteeToken])}`);
  }
  const result = {schemaVersion: 1, tag, sourceCommit, sourceTag: SOURCE_TAG, releaseId: id,
    releaseMarker: marker, releaseCleanupConfirmed: true, uploadVerified, ...(failure ? {error: failure} : {})};
  await writeFile(resultFile, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  return result;
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--cleanup-only') {options.cleanupOnly = true; continue}
    const key = {'--tag': 'tag', '--source-commit': 'sourceCommit', '--result-file': 'resultFile', '--release-id': 'releaseId'}[args[index]];
    requireValue(key && args[index + 1] && !args[index + 1].startsWith('--'), 'Invalid upload probe option');
    options[key] = args[++index];
  }
  if (options.releaseId !== undefined) {
    requireValue(/^[1-9]\d*$/.test(options.releaseId) && Number.isSafeInteger(Number(options.releaseId)), 'Invalid positive probe release ID');
    options.releaseId = Number(options.releaseId);
  }
  requireValue(options.cleanupOnly || options.releaseId === undefined, 'A known release ID is only accepted for cleanup');
  if (!options.cleanupOnly) {
    const config = JSON.parse(await readFile(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));
    options.publicKey = config.plugins?.updater?.pubkey;
    options.githubToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  }
  options.giteeToken = process.env.GITEE_TOKEN;
  options.onProgress = message => console.error(message);
  const result = await (options.cleanupOnly ? cleanupProbe : probeUpload)(options);
  console.log(JSON.stringify(result, null, 2));
  if (!options.cleanupOnly && !result.uploadVerified) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {console.error(`Gitee upload probe failed: ${error.message}`); process.exitCode = 1});
}
