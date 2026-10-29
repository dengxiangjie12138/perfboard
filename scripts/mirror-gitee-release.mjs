#!/usr/bin/env node
/** Mirror verified public GitHub releases. Credentials are environment-only API headers. */
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifySignature} from './prepare-update-release.mjs';

export const SOURCE = 'dengxiangjie12138/perfboard';
export const TARGET = 'deng-xiangjie/perfboard';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GITHUB = `https://api.github.com/repos/${SOURCE}`;
const GITEE = `https://gitee.com/api/v5/repos/${TARGET}`;
const MAX_EXE = 100_000_000;
const MAX_JSON = 4 * 1024 * 1024;
const MINIMUM = [0, 1, 1];
const API_TIMEOUT_MS = 180_000;
const UPLOAD_TIMEOUT_MS = 600_000;
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);

function networkFailure(context, error, timeout) {
  // Node errors can embed full URLs, headers or credentials in their message.
  // Report only fixed error names/codes, without retaining the original cause.
  const code = [error?.code, error?.cause?.code].find(value => NETWORK_CODES.has(value));
  const name = ['TimeoutError', 'AbortError', 'TypeError', 'Error'].includes(error?.name) ? error.name : 'NetworkError';
  const timedOut = ['TimeoutError', 'AbortError'].includes(name) || code?.includes('TIMEOUT') || code === 'ETIMEDOUT';
  return new Error(`${context} ${timedOut ? 'timed out' : 'request failed'} (${name}${code ? '; ' + code : ''}; request limit ${timeout / 1000}s)`);
}

function requireValue(condition, message) {if (!condition) throw new Error(message)}
export function parseTag(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag ?? '');
  requireValue(match, 'Use a canonical stable tag such as v0.1.2');
  const parts = match.slice(1).map(Number);
  requireValue(parts.every(Number.isSafeInteger), 'Release version is too large');
  return {version: parts.join('.'), parts};
}
function compare(left, right) {
  const a = typeof left === 'string' ? parseTag('v' + left).parts : left;
  const b = typeof right === 'string' ? parseTag('v' + right).parts : right;
  for (let index = 0; index < 3; index++) {if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1}
  return 0;
}
function hash(data) {return createHash('sha256').update(data).digest('hex')}
function jsonBytes(value) {return Buffer.from(JSON.stringify(value, null, 2) + '\n')}
function validDate(value) {return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())}
function noSecrets(text, tokens) {
  requireValue(tokens.filter(Boolean).every(token => !text.includes(token) && !text.includes(encodeURIComponent(token))), 'Refusing to use content containing an API credential');
}
function httpsUrl(value) {
  let url;
  try {url = new URL(value)} catch {throw new Error('Invalid public asset URL')}
  requireValue(url.protocol === 'https:' && !url.username && !url.password, 'Asset URLs must use public HTTPS without user information');
  return url;
}
function githubAsset(tag, name, value) {
  requireValue(value === `https://github.com/${SOURCE}/releases/download/${tag}/${name}`, 'Source asset URL does not belong to the selected GitHub release');
}
function stableGiteeUrl(asset, filename) {
  requireValue(Number.isSafeInteger(asset.id) && asset.id > 0, 'Gitee returned an invalid attachment ID');
  // An API may alternate between tag aliases, ID URLs and temporary CDN URLs.
  // Use one canonical actual-attachment endpoint, and anonymously hash it before
  // publication. API representation changes must not alter an immutable manifest.
  return `https://gitee.com/${TARGET}/attach_files/${asset.id}/download/${encodeURIComponent(filename)}`;
}

async function responseBytes(response, limit) {
  const length = Number(response.headers.get('content-length'));
  requireValue(!Number.isFinite(length) || length <= limit, 'Remote response exceeds the allowed size');
  const chunks = [];
  let count = 0;
  for await (const chunk of response.body ?? []) {
    count += chunk.length;
    requireValue(count <= limit, 'Remote response exceeds the allowed size');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class MirrorHttp {
  constructor({fetchImpl = globalThis.fetch, githubToken, giteeToken, onProgress = () => {}} = {}) {
    this.fetch = fetchImpl;
    this.githubToken = githubToken;
    this.giteeToken = giteeToken;
    this.report = onProgress;
  }
  async api(provider, method, endpoint, data, allowMissing = false) {
    const base = provider === 'github' ? GITHUB : GITEE;
    const url = base + endpoint;
    const token = provider === 'github' ? this.githubToken : this.giteeToken;
    const headers = {'User-Agent': 'Perfboard-Release-Mirror', Accept: 'application/json'};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (provider === 'github') headers['X-GitHub-Api-Version'] = '2026-03-10';
    let body;
    if (data instanceof FormData) body = data;
    else if (data !== undefined) {body = new URLSearchParams(Object.entries(data).map(([key, value]) => [key, String(value)])); headers['Content-Type'] = 'application/x-www-form-urlencoded'}
    const timeout = data instanceof FormData ? UPLOAD_TIMEOUT_MS : API_TIMEOUT_MS;
    let response;
    try {response = await this.fetch(url, {method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeout)})}
    catch (error) {throw networkFailure(`${provider} API ${method}`, error, timeout)}
    if (allowMissing && response.status === 404 && method === 'GET') return null;
    requireValue(response.ok, `${provider} API ${method} failed (HTTP ${response.status})`);
    if (response.status === 204) return null;
    const bytes = await responseBytes(response, MAX_JSON);
    try {return JSON.parse(bytes.toString('utf8'))} catch {throw new Error(`${provider} returned invalid JSON`)}
  }
  async download(value, provider, limit = MAX_EXE) {
    let url = httpsUrl(value);
    noSecrets(url.href, [this.githubToken, this.giteeToken]);
    for (let redirects = 0; redirects <= 5; redirects++) {
      const host = url.hostname;
      const allowed = provider === 'github'
        ? host === 'github.com' || host.endsWith('.githubusercontent.com')
        : host === 'gitee.com' || host.endsWith('.gitee.com') || host.endsWith('.giteeusercontent.com') || host.endsWith('.aliyuncs.com');
      requireValue(allowed, 'Unexpected asset download host');
      let response;
      // API credentials are deliberately absent even on the first download hop.
      try {response = await this.fetch(url.href, {headers: {'User-Agent': 'Perfboard-Release-Mirror', 'Cache-Control': 'no-cache'}, redirect: 'manual', signal: AbortSignal.timeout(API_TIMEOUT_MS)})}
      catch (error) {throw networkFailure(`${provider} public asset download`, error, API_TIMEOUT_MS)}
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        requireValue(response.headers.has('location'), 'Asset redirect has no location');
        url = httpsUrl(new URL(response.headers.get('location'), url).href);
        noSecrets(url.href, [this.githubToken, this.giteeToken]);
        continue;
      }
      requireValue(response.ok, `${provider} public asset download failed (HTTP ${response.status})`);
      return responseBytes(response, limit);
    }
    throw new Error('Too many asset download redirects');
  }
}

async function sourceCommit(http, tag) {
  let object = (await http.api('github', 'GET', `/git/ref/tags/${tag}`)).object;
  for (let depth = 0; depth < 5; depth++) {
    if (object.type === 'commit') {requireValue(/^[0-9a-f]{40}$/.test(object.sha), 'Invalid source tag commit'); return object.sha}
    requireValue(object.type === 'tag' && /^[0-9a-f]{40}$/.test(object.sha), 'Invalid source tag object');
    object = (await http.api('github', 'GET', `/git/tags/${object.sha}`)).object;
  }
  throw new Error('Source tag nesting exceeds the verification limit');
}

async function githubRelease(http, tag, publicKey) {
  const {version} = parseTag(tag);
  const release = await http.api('github', 'GET', `/releases/tags/${tag}`);
  requireValue(release.tag_name === tag && release.draft === false && release.prerelease === false && validDate(release.published_at), 'Source must be a published stable GitHub release');
  const filename = `Perfboard_${version}_x64-setup.exe`;
  const names = [filename, filename + '.sig', 'latest.json', 'SHA256SUMS.txt'];
  const assets = {};
  for (const name of names) {
    const matches = release.assets?.filter(asset => asset.name === name) ?? [];
    requireValue(matches.length === 1 && matches[0].state === 'uploaded', `Source release is missing a complete asset: ${name}`);
    githubAsset(tag, name, matches[0].browser_download_url);
    assets[name] = await http.download(matches[0].browser_download_url, 'github', name === filename ? MAX_EXE : MAX_JSON);
  }
  let manifest;
  try {manifest = JSON.parse(assets['latest.json'].toString('utf8'))} catch {throw new Error('Source updater manifest is not valid JSON')}
  requireValue(manifest.version === version && validDate(manifest.pub_date), 'Source manifest version/date differs from release');
  requireValue(Object.keys(manifest.platforms ?? {}).join() === 'windows-x86_64', 'Only a complete Windows x64 release can be mirrored');
  const platform = manifest.platforms['windows-x86_64'];
  githubAsset(tag, filename, platform.url);
  requireValue(platform.signature === assets[filename + '.sig'].toString('utf8').trim(), 'Source manifest signature differs from its signature asset');
  const schema = manifest.repositorySchemaVersion;
  requireValue((Number.isSafeInteger(schema) && schema > 0 && (version !== '0.1.1' || schema === 6)) || (version === '0.1.1' && schema === undefined), 'Source manifest repository compatibility metadata is missing or invalid');
  verifySignature({signature: platform.signature, publicKey, digest: createHash('blake2b512').update(assets[filename]).digest(), version, filename});
  const sums = assets['SHA256SUMS.txt'].toString('utf8').trim().split(/\r?\n/);
  requireValue(sums.length === 3 && names.slice(0, 3).every(name => sums.includes(`${hash(assets[name])}  ${name}`)), 'Source checksums differ from the signed asset set');
  const commit = await sourceCommit(http, tag);
  return {release, manifest, filename, assets, version, tag, commit};
}

async function targetTag(http, source) {
  for (let page = 1; page <= 20; page++) {
    const tags = await http.api('gitee', 'GET', `/tags?per_page=100&page=${page}`);
    requireValue(Array.isArray(tags), 'Gitee tags response is invalid');
    const tag = tags.find(item => item.name === source.tag);
    if (tag) {requireValue(tag.commit?.sha === source.commit, 'Gitee tag differs from the source GitHub tag; synchronize Git first'); return}
    if (tags.length < 100) break;
  }
  throw new Error('The source tag is not present on Gitee; synchronize Git before mirroring releases');
}
async function attachmentList(http, id) {
  const attachments = [];
  for (let page = 1; page <= 20; page++) {
    const items = await http.api('gitee', 'GET', `/releases/${id}/attach_files?per_page=100&page=${page}`);
    requireValue(Array.isArray(items), 'Gitee attachment list is invalid');
    attachments.push(...items);
    if (items.length < 100) return attachments;
  }
  throw new Error('Gitee attachment pagination exceeds the verification limit');
}
function uniqueAttachments(items, names) {
  const result = new Map();
  for (const item of items) {
    requireValue(names.includes(item.name) && !result.has(item.name), 'Unexpected or duplicate Gitee release attachment; no asset was replaced');
    result.set(item.name, item);
  }
  return result;
}
async function ensureAttachment(http, release, existing, name, bytes) {
  let attachment = existing.get(name), uploaded = false;
  if (!attachment) {
    requireValue(release.prerelease === true, 'A completed Gitee mirror is missing an asset; no public release was modified');
    const form = new FormData();
    form.append('file', new Blob([bytes], {type: name.endsWith('.exe') ? 'application/vnd.microsoft.portable-executable' : name.endsWith('.json') ? 'application/json' : 'text/plain'}), name);
    http.report(`Uploading Gitee attachment ${name} (${bytes.length} bytes; request limit ${UPLOAD_TIMEOUT_MS / 1000}s)`);
    attachment = await http.api('gitee', 'POST', `/releases/${release.id}/attach_files`, form);
    requireValue(attachment.name === name, 'Gitee renamed an uploaded asset; mirror was not finalized');
    uploaded = true;
    http.report(`Uploaded Gitee attachment ${name}; verifying its public download`);
  }
  else http.report(`Reusing Gitee attachment ${name}; verifying its public download`);
  requireValue(attachment.size === bytes.length, `Gitee asset size differs: ${name}; no overwrite performed`);
  const url = stableGiteeUrl(attachment, name);
  const downloaded = await http.download(url, 'gitee', name.endsWith('.exe') ? MAX_EXE : MAX_JSON);
  requireValue(hash(downloaded) === hash(bytes), `Gitee asset hash differs: ${name}; no overwrite performed`);
  http.report(`Verified Gitee attachment ${name} (${bytes.length} bytes)`);
  return {id: attachment.id, name, bytes: bytes.length, sha256: hash(bytes), url, uploaded};
}

async function readJson(filename) {
  try {return JSON.parse(await readFile(filename, 'utf8'))} catch (error) {if (error.code === 'ENOENT') return null; throw new Error('Existing mirror index is invalid; it was not reset')}
}
async function writeJson(filename, value, immutable = false) {
  const bytes = jsonBytes(value);
  try {
    const old = await readFile(filename);
    if (old.equals(bytes)) return;
    requireValue(!immutable, 'Existing release index contains different bytes; no overwrite performed');
  } catch (error) {if (error.code !== 'ENOENT') throw error}
  await mkdir(path.dirname(filename), {recursive: true});
  const stage = filename + `.tmp-${process.pid}`;
  await writeFile(stage, bytes, {flag: 'wx'});
  await rename(stage, filename);
}
async function prepareIndexes(directory, source, manifest, latestTag, tokens) {
  requireValue(typeof directory === 'string' && directory.length > 0, 'Pass --updates-directory for the JSON-only mirror index');
  const output = path.resolve(directory);
  requireValue(output !== ROOT && output !== path.parse(output).root, 'Use a dedicated updates directory');
  const previousLatest = await readJson(path.join(output, 'latest.json'));
  const previousVersions = await readJson(path.join(output, 'versions.json')) ?? [];
  requireValue(Array.isArray(previousVersions), 'Existing versions index is not an array');
  for (const item of previousVersions) requireValue(parseTag(item.tag).version === item.version && item.installable === true, 'Existing versions index has an invalid entry');
  if (previousLatest) {
    parseTag('v' + previousLatest.version);
    requireValue(previousLatest.platforms?.['windows-x86_64']?.url?.startsWith(`https://gitee.com/${TARGET}/`), 'Existing latest pointer is not a stable project asset');
  }
  const entry = {tag: source.tag, version: source.version, notes: source.manifest.notes ?? source.release.body ?? null, pubDate: source.manifest.pub_date, installable: true};
  const previousEntry = previousVersions.find(item => item.tag === source.tag);
  requireValue(!previousEntry || JSON.stringify(previousEntry) === JSON.stringify(entry), 'Existing mirrored version metadata differs; no overwrite performed');
  const versions = [...previousVersions.filter(item => item.tag !== source.tag), entry].sort((left, right) => compare(right.version, left.version));
  const promote = source.tag === latestTag && (!previousLatest || compare(source.version, previousLatest.version) >= 0);
  for (const value of [manifest, versions, ...(promote ? [manifest] : [])]) noSecrets(JSON.stringify(value), tokens);
  // Only JSON is emitted. The caller commits all files and CAS-pushes the
  // gitee-updates branch once, after this process exits successfully.
  await writeJson(path.join(output, 'releases', source.tag + '.json'), manifest, true);
  await writeJson(path.join(output, 'versions.json'), versions);
  if (promote) await writeJson(path.join(output, 'latest.json'), manifest);
  return {directory: output, latestPromoted: promote, latestVersion: promote ? source.version : previousLatest?.version ?? null};
}

export async function mirrorRelease({tag, updatesDirectory, dryRun = false, publicKey, githubToken, giteeToken, fetchImpl, onProgress} = {}) {
  const parsed = parseTag(tag);
  if (compare(parsed.parts, MINIMUM) < 0) return {status: 'skipped', tag, reason: 'Unsigned legacy release below v0.1.1 is not mirrored'};
  requireValue(dryRun || giteeToken, 'GITEE_TOKEN is required for release mirroring; dry-run needs no Gitee credentials');
  const http = new MirrorHttp({fetchImpl, githubToken, giteeToken: dryRun ? undefined : giteeToken, onProgress});
  const source = await githubRelease(http, tag, publicKey);
  noSecrets(JSON.stringify(source.manifest), [githubToken, giteeToken]);
  const latest = await http.api('github', 'GET', '/releases/latest');
  parseTag(latest.tag_name);
  requireValue(latest.draft === false && latest.prerelease === false, 'GitHub latest release is not a published stable version');
  if (dryRun) return {status: 'verified-dry-run', tag, version: source.version, sourceCommit: source.commit, sourceLatest: latest.tag_name, assets: Object.entries(source.assets).map(([name, bytes]) => ({name, bytes: bytes.length, sha256: hash(bytes)})), note: 'No Gitee requests or files written; mirror URLs can only be finalized after real attachment uploads'};
  await targetTag(http, source);
  const body = `${source.release.body ?? ''}\n\nGitHub 来源：https://github.com/${SOURCE}/releases/tag/${tag}\n\n<!-- perfboard-mirror:v1 source=${SOURCE} tag=${tag} commit=${source.commit} -->\n`;
  noSecrets(body, [githubToken, giteeToken]);
  const name = source.release.name || `Perfboard ${tag}`;
  let release = await http.api('gitee', 'GET', `/releases/tags/${tag}`, undefined, true);
  if (release) requireValue(release.tag_name === tag && release.name === name && release.body === body && release.target_commitish === source.commit, 'Existing Gitee release differs from this exact mirror; no overwrite performed');
  else release = await http.api('gitee', 'POST', '/releases', {tag_name: tag, name, body, target_commitish: source.commit, prerelease: true});
  requireValue(Number.isSafeInteger(release.id) && release.id > 0, 'Gitee returned an invalid release ID');
  const names = [source.filename, source.filename + '.sig', 'latest.json', 'SHA256SUMS.txt'];
  const existing = uniqueAttachments(await attachmentList(http, release.id), names);
  const verified = [];
  verified.push(await ensureAttachment(http, release, existing, source.filename, source.assets[source.filename]));
  verified.push(await ensureAttachment(http, release, existing, source.filename + '.sig', source.assets[source.filename + '.sig']));
  const mirror = structuredClone(source.manifest);
  mirror.platforms['windows-x86_64'].url = verified[0].url;
  const mirrorBytes = jsonBytes(mirror);
  verified.push(await ensureAttachment(http, release, existing, 'latest.json', mirrorBytes));
  const sums = Buffer.from(verified.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
  verified.push(await ensureAttachment(http, release, existing, 'SHA256SUMS.txt', sums));
  const final = uniqueAttachments(await attachmentList(http, release.id), names);
  requireValue(final.size === 4 && verified.every(item => final.get(item.name)?.id === item.id && final.get(item.name)?.size === item.bytes), 'Gitee attachment set changed during verification; mirror was not finalized');
  if (release.prerelease) release = await http.api('gitee', 'PATCH', `/releases/${release.id}`, {tag_name: tag, name, body, prerelease: false});
  requireValue(release.prerelease === false, 'Gitee mirror remains a preview; index was not promoted');
  const indexes = await prepareIndexes(updatesDirectory, source, mirror, latest.tag_name, [githubToken, giteeToken]);
  return {status: 'mirrored', tag, version: source.version, sourceCommit: source.commit, releaseId: release.id, assets: verified, ...indexes};
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--dry-run') {options.dryRun = true; continue}
    if (name === '--help' || name === '-h') {console.log('node scripts/mirror-gitee-release.mjs --tag v0.1.2 --updates-directory <JSON directory> [--dry-run]'); return}
    const key = {'--tag': 'tag', '--updates-directory': 'updatesDirectory'}[name];
    requireValue(key && args[index + 1] && !args[index + 1].startsWith('--'), 'Unknown or incomplete mirror option');
    options[key] = args[++index];
  }
  requireValue(options.tag && (options.dryRun || options.updatesDirectory), 'Pass --tag and --updates-directory (or --dry-run)');
  const config = JSON.parse(await readFile(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  options.publicKey = config.plugins?.updater?.pubkey;
  options.githubToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  options.giteeToken = options.dryRun ? undefined : process.env.GITEE_TOKEN;
  options.onProgress = message => console.error(message);
  console.log(JSON.stringify(await mirrorRelease(options), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {console.error(`Gitee mirror failed: ${error.message}`); process.exitCode = 1});
}
