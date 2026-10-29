import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {mkdtemp, readFile, rm, access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import assert from 'node:assert/strict';
import {mirrorRelease, MirrorHttp, uploadGiteeMultipart, uploadGiteeCurl, SOURCE, TARGET} from '../mirror-gitee-release.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const data = bytes => new Response(bytes);
function sourceFixture(version, keys, id) {
  const filename = `Perfboard_${version}_x64-setup.exe`;
  const bytes = Buffer.concat([Buffer.from('MZ'), randomBytes(128)]);
  const signature = sign(null, createHash('blake2b512').update(bytes).digest(), keys.privateKey);
  const comment = `timestamp:1234\tfile:${filename}\tversion:${version}`;
  const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), keys.privateKey);
  const box = `untrusted comment: synthetic key\n${Buffer.concat([Buffer.from('ED'), id, signature]).toString('base64')}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`;
  const encoded = Buffer.from(box).toString('base64');
  const manifest = {version, notes: 'Signed synthetic release ' + version, pub_date: '2026-10-29T12:00:00Z', platforms: {'windows-x86_64': {url: `https://github.com/${SOURCE}/releases/download/v${version}/${filename}`, signature: encoded}}};
  if (version !== '0.1.1') manifest.repositorySchemaVersion = 6;
  const assets = {[filename]: bytes, [filename + '.sig']: Buffer.from(encoded), 'latest.json': Buffer.from(JSON.stringify(manifest, null, 2) + '\n')};
  assets['SHA256SUMS.txt'] = Buffer.from(Object.entries(assets).map(([name, body]) => `${sha(body)}  ${name}`).join('\n') + '\n');
  const commit = createHash('sha1').update('synthetic-commit-' + version).digest('hex');
  const release = {tag_name: 'v' + version, name: 'Perfboard ' + version, body: 'Release notes ' + version, published_at: '2026-10-29T12:00:00Z', draft: false, prerelease: false, assets: Object.keys(assets).map(name => ({name, state: 'uploaded', browser_download_url: `https://github.com/${SOURCE}/releases/download/v${version}/${name}`}))};
  return {version, filename, assets, manifest, commit, release};
}

class MockRemote {
  constructor() {
    const keys = generateKeyPairSync('ed25519'), id = randomBytes(8);
    const raw = keys.publicKey.export({type: 'spki', format: 'der'}).subarray(-32);
    this.publicKey = Buffer.from(`untrusted comment: synthetic key\n${Buffer.concat([Buffer.from('Ed'), id, raw]).toString('base64')}\n`).toString('base64');
    this.sources = new Map(['0.1.1', '0.1.2'].map(version => [version, sourceFixture(version, keys, id)]));
    this.releases = new Map();
    this.attachments = new Map();
    this.calls = [];
    this.uploads = 0;
    this.patches = 0;
    this.latest = '0.1.2';
    this.nextId = 1;
  }
  fetch = async (value, options = {}) => {
    const url = new URL(value), method = options.method ?? 'GET';
    this.calls.push({url: url.href, method, headers: options.headers ?? {}});
    if (url.hostname === 'api.github.com') {
      const tag = /\/tags\/(v[\d.]+)$/.exec(url.pathname)?.[1];
      if (url.pathname.includes('/git/ref/tags/')) return json({object: {type: 'commit', sha: this.sources.get(tag.slice(1)).commit}});
      if (url.pathname.endsWith('/releases/latest')) return json(this.sources.get(this.latest).release);
      if (url.pathname.includes('/releases/tags/')) return json(this.sources.get(tag.slice(1)).release);
    }
    if (url.hostname === 'github.com') {
      const parts = url.pathname.split('/'), version = parts[5].slice(1), name = decodeURIComponent(parts[6]);
      const bytes = this.sources.get(version).assets[name];
      return data(this.corruptSource && name.endsWith('.exe') ? Buffer.concat([bytes, Buffer.from('tampered')]) : bytes);
    }
    if (url.hostname === 'foruda.gitee.com') {
      const id = Number(url.pathname.split('/').pop());
      return data(this.attachments.get(id).bytes);
    }
    if (url.hostname === 'gitee.com' && !url.pathname.startsWith('/api/')) {
      const id = Number(/\/attach_files\/(\d+)\//.exec(url.pathname)?.[1]);
      if (this.cdnRedirect) return new Response(null, {status: 302, headers: {Location: `https://foruda.gitee.com/attachments/${id}?signature=temporary&expires=1`}});
      return data(this.attachments.get(id).bytes);
    }
    if (url.hostname === 'gitee.com') {
      const endpoint = url.pathname.slice(`/api/v5/repos/${TARGET}`.length);
      if (method === 'GET' && endpoint === '/tags') return json([...this.sources].map(([version, source]) => ({name: 'v' + version, commit: {sha: this.wrongTag ? '0'.repeat(40) : source.commit}})));
      if (method === 'GET' && endpoint.startsWith('/releases/tags/')) return this.releases.has(endpoint.split('/').pop()) ? json(this.releases.get(endpoint.split('/').pop())) : json({}, 404);
      if (method === 'POST' && endpoint === '/releases') {
        const fields = Object.fromEntries(options.body);
        const release = {...fields, id: this.nextId++, prerelease: fields.prerelease === 'true'};
        this.releases.set(fields.tag_name, release);
        return json(release, 201);
      }
      const releaseId = Number(/\/releases\/(\d+)/.exec(endpoint)?.[1]);
      if (method === 'GET' && endpoint.endsWith('/attach_files')) return json([...this.attachments.values()].filter(item => item.releaseId === releaseId).map(({bytes: _bytes, releaseId: _releaseId, ...item}) => item));
      if (method === 'POST' && endpoint.endsWith('/attach_files')) {
        const file = options.body.get('file');
        if (this.failUpload === file.name) {this.failUpload = null; return json({}, 503)}
        this.uploads++;
        const id = this.nextId++, bytes = Buffer.from(await file.arrayBuffer());
        const attachment = {id, name: file.name, size: bytes.length, browser_download_url: this.temporaryCdn ? `https://foruda.gitee.com/attachments/${id}?signature=temporary` : `https://gitee.com/${TARGET}/attach_files/${id}/download/${file.name}`, bytes, releaseId};
        this.attachments.set(id, attachment);
        const {bytes: _bytes, releaseId: _releaseId, ...metadata} = attachment;
        return json(metadata, 201);
      }
      if (method === 'PATCH') {
        this.patches++;
        const release = [...this.releases.values()].find(item => item.id === releaseId);
        Object.assign(release, Object.fromEntries(options.body));
        release.prerelease = release.prerelease === 'true';
        return json(release);
      }
    }
    throw new Error('Unexpected mock HTTP request');
  };
  options(directory, tag = 'v0.1.2') {
    return {tag, updatesDirectory: directory, publicKey: this.publicKey, githubToken: 'fake-gh-token', giteeToken: 'fake-gitee-token', fetchImpl: this.fetch, uploadImpl: this.fetch};
  }
}

async function directory(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'perfboard-gitee-mirror-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('perfboard-gitee-mirror-test-'));
    await rm(folder, {recursive: true, force: true});
  });
  return folder;
}

test('mirrors signed EXE/sig and rewrites manifest/checksums only to verified stable Gitee attachment URLs', async t => {
  const folder = await directory(t), remote = new MockRemote();
  const result = await mirrorRelease(remote.options(folder));
  assert.equal(result.status, 'mirrored');
  assert.equal(remote.uploads, 4);
  assert.equal(remote.patches, 1);
  assert.equal(result.latestPromoted, true);
  const manifest = JSON.parse(await readFile(path.join(folder, 'latest.json')));
  assert.equal(manifest.version, '0.1.2');
  assert.equal(manifest.repositorySchemaVersion, 6);
  assert.equal(manifest.platforms['windows-x86_64'].signature, remote.sources.get('0.1.2').manifest.platforms['windows-x86_64'].signature);
  assert.match(manifest.platforms['windows-x86_64'].url, /^https:\/\/gitee.com\/deng-xiangjie\/perfboard\/attach_files\/\d+\/download\/Perfboard_0.1.2_x64-setup.exe$/);
  const uploadedManifest = [...remote.attachments.values()].find(item => item.name === 'latest.json');
  const checksum = [...remote.attachments.values()].find(item => item.name === 'SHA256SUMS.txt').bytes.toString();
  assert.ok(checksum.includes(`${sha(uploadedManifest.bytes)}  latest.json`));
  assert.notEqual(sha(uploadedManifest.bytes), sha(remote.sources.get('0.1.2').assets['latest.json']));
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'releases/v0.1.2.json'))), manifest);
  const versions = JSON.parse(await readFile(path.join(folder, 'versions.json')));
  assert.deepEqual(versions.map(item => item.version), ['0.1.2']);
  for (const call of remote.calls) {
    if (!call.url.startsWith('https://api.github.com/') && !call.url.startsWith('https://gitee.com/api/')) assert.equal(call.headers.Authorization, undefined);
  }
  assert.ok(remote.calls.filter(call => call.url.startsWith('https://gitee.com/api/')).every(call => call.headers.Authorization === 'Bearer fake-gitee-token'));
  assert.ok(!JSON.stringify(manifest).includes('fake-gitee-token'));
});

test('identical retries skip all uploads and do not replace existing public assets', async t => {
  const folder = await directory(t), remote = new MockRemote();
  await mirrorRelease(remote.options(folder));
  const uploads = remote.uploads, patches = remote.patches;
  await mirrorRelease(remote.options(folder));
  assert.equal(remote.uploads, uploads);
  assert.equal(remote.patches, patches);
});

test('Gitee editor CRLF body representation resumes without reuploading or changing immutable metadata', async t => {
  const folder = await directory(t), remote = new MockRemote();
  await mirrorRelease(remote.options(folder));
  const before = await readFile(path.join(folder, 'latest.json'));
  const release = remote.releases.get('v0.1.2');
  release.body = release.body.replaceAll('\n', '\r\n');
  await mirrorRelease(remote.options(folder));
  assert.equal(remote.uploads, 4);
  assert.equal(remote.patches, 1);
  assert.deepEqual(await readFile(path.join(folder, 'latest.json')), before);
});

test('release body content changes, lone CRs and removed final newlines still block resume without mutation', async t => {
  const folder = await directory(t), remote = new MockRemote();
  await mirrorRelease(remote.options(folder));
  const release = remote.releases.get('v0.1.2'), original = release.body;
  for (const changed of [original.replace('Release notes', 'Changed notes'), original.replaceAll('\n', '\r'), original.trimEnd()]) {
    release.body = changed;
    await assert.rejects(mirrorRelease(remote.options(folder)), /Existing Gitee release differs/);
    assert.equal(remote.uploads, 4);
    assert.equal(remote.patches, 1);
  }
});

test('attachment metadata switching between tag aliases and ID paths remains byte-identical and idempotent', async t => {
  const folder = await directory(t), remote = new MockRemote();
  await mirrorRelease(remote.options(folder));
  const before = await readFile(path.join(folder, 'latest.json'));
  for (const asset of remote.attachments.values()) asset.browser_download_url = `https://gitee.com/${TARGET}/releases/download/v0.1.2/${asset.name}`;
  await mirrorRelease(remote.options(folder));
  assert.deepEqual(await readFile(path.join(folder, 'latest.json')), before);
  for (const asset of remote.attachments.values()) asset.browser_download_url = `https://gitee.com/${TARGET}/attach_files/${asset.id}/download/${asset.name}`;
  await mirrorRelease(remote.options(folder));
  assert.deepEqual(await readFile(path.join(folder, 'latest.json')), before);
  assert.equal(remote.uploads, 4);
  assert.equal(remote.patches, 1);
});

test('tampered source bytes fail signature verification before any target mutation', async t => {
  const remote = new MockRemote(); remote.corruptSource = true;
  await assert.rejects(mirrorRelease(remote.options(await directory(t))), /signature verification/);
  assert.equal(remote.calls.filter(call => call.method !== 'GET').length, 0);
});

test('a different source/Gitee tag commit blocks creating a release', async t => {
  const remote = new MockRemote(); remote.wrongTag = true;
  await assert.rejects(mirrorRelease(remote.options(await directory(t))), /tag differs/);
  assert.equal(remote.calls.filter(call => call.method !== 'GET').length, 0);
});

test('an interrupted upload never emits a usable pointer and can safely resume the staging release', async t => {
  const folder = await directory(t), remote = new MockRemote();
  remote.failUpload = 'Perfboard_0.1.2_x64-setup.exe';
  await assert.rejects(mirrorRelease(remote.options(folder)), /HTTP 503/);
  assert.equal(remote.releases.get('v0.1.2').prerelease, true);
  assert.equal(remote.uploads, 1);
  assert.equal([...remote.attachments.values()][0].name, 'Perfboard_0.1.2_x64-setup.exe.sig');
  await assert.rejects(access(path.join(folder, 'latest.json')));
  await mirrorRelease(remote.options(folder));
  assert.equal(remote.uploads, 4);
  assert.equal(remote.releases.get('v0.1.2').prerelease, false);
});

test('conflicting existing asset bytes are rejected without overwriting or uploading', async t => {
  const folder = await directory(t), remote = new MockRemote();
  await mirrorRelease(remote.options(folder));
  const attachment = [...remote.attachments.values()].find(item => item.name.endsWith('.exe'));
  attachment.bytes[50] ^= 1;
  const uploads = remote.uploads;
  await assert.rejects(mirrorRelease(remote.options(folder)), /asset hash differs/);
  assert.equal(remote.uploads, uploads);
});

test('older backfill preserves the latest pointer and keeps the versions list in descending SemVer order', async t => {
  const folder = await directory(t), remote = new MockRemote();
  await mirrorRelease(remote.options(folder));
  const before = await readFile(path.join(folder, 'latest.json'));
  const result = await mirrorRelease(remote.options(folder, 'v0.1.1'));
  assert.equal(result.latestPromoted, false);
  assert.deepEqual(await readFile(path.join(folder, 'latest.json')), before);
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'versions.json'))).map(item => item.version), ['0.1.2', '0.1.1']);
  assert.equal(JSON.parse(await readFile(path.join(folder, 'releases/v0.1.1.json'))).repositorySchemaVersion, undefined);
});

test('token-free dry-run verifies source artifacts without Gitee requests, local files or invented mirror URLs', async t => {
  const folder = await directory(t), remote = new MockRemote();
  const result = await mirrorRelease({...remote.options(folder), giteeToken: undefined, dryRun: true});
  assert.equal(result.status, 'verified-dry-run');
  assert.equal(remote.calls.some(call => call.url.includes('gitee.com')), false);
  await assert.rejects(access(path.join(folder, 'latest.json')));
  assert.ok(!JSON.stringify(result).includes('https://gitee.com'));
});

test('unsigned legacy v0.1.0 is explicitly skipped without credentials or network calls', async () => {
  const result = await mirrorRelease({tag: 'v0.1.0', fetchImpl: () => {throw new Error('Network must not run')}});
  assert.equal(result.status, 'skipped');
});

test('API redirects cannot forward the Authorization header to another host', async () => {
  const calls = [];
  const http = new MirrorHttp({giteeToken: 'fake-gitee-token', fetchImpl: async (url, options) => {calls.push({url, options}); return new Response(null, {status: 302, headers: {Location: 'https://evil.invalid/steal'}})}});
  await assert.rejects(http.api('gitee', 'GET', '/releases'), /HTTP 302/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith('https://gitee.com/api/'));
});

test('temporary CDN redirects are transient and never enter manifests or indexes', async t => {
  const folder = await directory(t), remote = new MockRemote();
  remote.temporaryCdn = true; remote.cdnRedirect = true;
  const result = await mirrorRelease(remote.options(folder));
  const manifest = await readFile(path.join(folder, 'latest.json'), 'utf8');
  assert.ok(!manifest.includes('foruda') && !manifest.includes('signature=temporary'));
  assert.ok(result.assets.every(asset => asset.url.startsWith(`https://gitee.com/${TARGET}/attach_files/`)));
  assert.ok(remote.calls.filter(call => call.url.startsWith('https://foruda.')).every(call => call.headers.Authorization === undefined));
});

test('draft GitHub releases are not mirrored', async t => {
  const remote = new MockRemote(); remote.sources.get('0.1.2').release.draft = true;
  await assert.rejects(mirrorRelease(remote.options(await directory(t))), /published stable/);
  assert.equal(remote.calls.filter(call => call.method !== 'GET').length, 0);
});

test('large attachment uploads have a bounded ten-minute deadline while metadata keeps its three-minute deadline', async t => {
  const timeouts = [];
  t.mock.method(AbortSignal, 'timeout', duration => {
    timeouts.push(duration);
    return new AbortController().signal;
  });
  const http = new MirrorHttp({fetchImpl: async () => json({}), uploadImpl: async () => json({})});
  await http.api('gitee', 'GET', '/releases');
  const form = new FormData();
  form.append('file', new Blob(['synthetic installer']), 'fixture.exe');
  await http.api('gitee', 'POST', '/releases/1/attach_files', form);
  assert.deepEqual(timeouts, [180_000, 600_000]);
});

test('upload failures explain timeout or network categories without exposing raw errors or retrying ambiguous POSTs', async () => {
  const form = new FormData();
  form.append('file', new Blob(['synthetic installer']), 'fixture.exe');
  for (const [name, code, expected] of [['TimeoutError', undefined, /timed out.*request limit 600s/], ['TypeError', 'ECONNRESET', /request failed.*ECONNRESET.*request limit 600s/]]) {
    let requests = 0;
    const error = new Error('fake-gitee-token https://private.invalid/path?token=secret');
    error.name = name;
    error.cause = {code, message: 'secret Authorization: Bearer fake-gitee-token'};
    const failedTransport = async () => {requests++; throw error};
    const http = new MirrorHttp({giteeToken: 'fake-gitee-token', fetchImpl: failedTransport, uploadImpl: failedTransport});
    await assert.rejects(http.api('gitee', 'POST', '/releases/1/attach_files', form), failure => {
      assert.match(failure.message, expected);
      assert.ok(!failure.message.includes('fake-gitee-token') && !failure.message.includes('private.invalid') && !failure.message.includes('Authorization'));
      assert.equal(failure.cause, undefined);
      return true;
    });
    assert.equal(requests, 1);
  }
});

test('CLI progress can identify each upload and verified public download without credentials or temporary URLs', async t => {
  const remote = new MockRemote(), messages = [];
  const result = await mirrorRelease({...remote.options(await directory(t)), onProgress: message => messages.push(message)});
  assert.equal(messages.filter(message => message.startsWith('Uploading Gitee attachment ')).length, 4);
  assert.equal(messages.filter(message => message.startsWith('Verified Gitee attachment ')).length, 4);
  assert.ok(messages.some(message => message.includes('Perfboard_0.1.2_x64-setup.exe') && message.includes('request limit 600s')));
  assert.ok(messages.every(message => !message.includes('fake-gh-token') && !message.includes('fake-gitee-token') && !message.includes('signature=') && !message.includes('https://')));
  assert.equal(result.status, 'mirrored');
});

test('multipart credentials stay in a copied body to the fixed Gitee API and never reach GitHub or public downloads', async () => {
  const calls = [];
  const transport = async (url, options) => {calls.push({url, options}); return json({})};
  const http = new MirrorHttp({githubToken: 'fake-gh-token', giteeToken: 'fake-gitee-token', fetchImpl: transport, uploadImpl: transport});
  const form = new FormData();
  form.append('file', new Blob(['synthetic signature']), 'fixture.sig');
  await http.api('gitee', 'POST', '/releases/1/attach_files', form);
  assert.equal(calls[0].url, `https://gitee.com/api/v5/repos/${TARGET}/releases/1/attach_files`);
  assert.equal(calls[0].options.body.get('access_token'), 'fake-gitee-token');
  assert.equal(calls[0].options.body.get('file').name, 'fixture.sig');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(form.has('access_token'), false);
  await http.api('github', 'POST', '/fixture', form);
  assert.equal(calls[1].options.body.has('access_token'), false);
  await http.download(`https://gitee.com/${TARGET}/attach_files/1/download/fixture.sig`, 'gitee');
  assert.equal(calls[2].options.body, undefined);
  assert.equal(calls[2].options.headers.Authorization, undefined);
  assert.ok(calls.every(call => !call.url.includes('fake-gitee-token') && !call.url.includes('access_token') && !call.url.includes('?')));
});

test('the small signature is uploaded and verified before the installer while result and checksum order stays immutable', async t => {
  const remote = new MockRemote(), messages = [];
  const result = await mirrorRelease({...remote.options(await directory(t)), onProgress: message => messages.push(message)});
  const uploaded = [...remote.attachments.values()].map(item => item.name);
  assert.deepEqual(uploaded, ['Perfboard_0.1.2_x64-setup.exe.sig', 'Perfboard_0.1.2_x64-setup.exe', 'latest.json', 'SHA256SUMS.txt']);
  assert.ok(messages[0].startsWith('Uploading Gitee attachment Perfboard_0.1.2_x64-setup.exe.sig'));
  assert.ok(messages[2].startsWith('Verified Gitee attachment Perfboard_0.1.2_x64-setup.exe.sig'));
  assert.ok(messages[3].startsWith('Uploading Gitee attachment Perfboard_0.1.2_x64-setup.exe ('));
  assert.deepEqual(result.assets.map(item => item.name), ['Perfboard_0.1.2_x64-setup.exe', 'Perfboard_0.1.2_x64-setup.exe.sig', 'latest.json', 'SHA256SUMS.txt']);
  const checksum = [...remote.attachments.values()].find(item => item.name === 'SHA256SUMS.txt').bytes.toString();
  assert.deepEqual(checksum.trim().split('\n').map(line => line.split('  ')[1]), result.assets.slice(0, 3).map(item => item.name));
});

function nativeRequestFixture({status = 201, headers = {}, chunks = [Buffer.from('{"id":1}')], stall = false, aborted = false} = {}) {
  const calls = [];
  const requestImpl = (url, options, onResponse) => {
    const request = new EventEmitter();
    request.destroyed = false;
    request.destroy = () => {request.destroyed = true};
    const call = {url, options, request};
    calls.push(call);
    request.end = bytes => {
      call.bytes = bytes;
      queueMicrotask(() => {
        request.emit('finish');
        const response = new PassThrough();
        response.headers = headers;
        response.statusCode = status;
        call.response = response;
        options.signal.addEventListener('abort', () => {
          request.destroy(); response.destroy();
          const error = new Error('Synthetic abort'); error.name = 'AbortError';
          request.emit('error', error);
        }, {once: true});
        onResponse(response);
        if (stall || response.destroyed) return;
        if (aborted) {response.emit('aborted'); response.destroy(); return}
        for (const chunk of chunks) response.write(chunk);
        response.end();
      });
    };
    return request;
  };
  return {calls, requestImpl};
}

function nativeOptions(signal) {
  const form = new FormData();
  form.append('file', new Blob(['synthetic signed installer']), 'fixture.exe');
  form.append('access_token', 'fake-gitee-token');
  return {method: 'POST', redirect: 'manual', headers: {Authorization: 'Bearer fake-gitee-token'}, body: form, ...(signal ? {signal} : {})};
}
const uploadUrl = `https://gitee.com/api/v5/repos/${TARGET}/releases/1/attach_files`;

test('native HTTPS upload writes exact multipart bytes with known length, default TLS checks and an identity response', async () => {
  const fixture = nativeRequestFixture(), progress = [];
  const response = await uploadGiteeMultipart(uploadUrl, {...nativeOptions(), onProgress: message => progress.push(message)}, fixture);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {id: 1});
  assert.equal(fixture.calls.length, 1);
  const {url, options, bytes} = fixture.calls[0];
  assert.equal(url.href, uploadUrl);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.headers['content-length'], String(bytes.length));
  assert.equal(options.headers['accept-encoding'], 'identity');
  assert.equal(options.headers.authorization, 'Bearer fake-gitee-token');
  assert.ok(bytes.subarray(-2).equals(Buffer.from('\r\n')));
  const decoded = await new Response(bytes, {headers: {'content-type': options.headers['content-type']}}).formData();
  assert.equal(decoded.get('file').name, 'fixture.exe');
  assert.equal(await decoded.get('file').text(), 'synthetic signed installer');
  assert.equal(decoded.get('access_token'), 'fake-gitee-token');
  assert.equal(progress.length, 1);
  assert.ok(progress[0].includes('request body written') && !progress[0].includes('fake-gitee-token'));
});

test('native upload total abort signal cancels waiting for response without using fetch', async () => {
  const controller = new AbortController(), fixture = nativeRequestFixture({stall: true});
  const pending = uploadGiteeMultipart(uploadUrl, nativeOptions(controller.signal), fixture);
  const timer = setTimeout(() => controller.abort(), 15);
  try {await assert.rejects(pending, /closed before completion|Synthetic abort/)} finally {clearTimeout(timer)}
  assert.equal(fixture.calls[0].options.signal, controller.signal);
  assert.equal(fixture.calls[0].request.destroyed, true);
});

test('native upload rejects a premature response close instead of returning partial success', async () => {
  const fixture = nativeRequestFixture({aborted: true});
  await assert.rejects(uploadGiteeMultipart(uploadUrl, nativeOptions(), fixture), /interrupted|closed before completion/);
  assert.equal(fixture.calls[0].request.destroyed, true);
});

test('native upload enforces four-MiB response limits from both headers and streamed chunks', async () => {
  for (const settings of [{headers: {'content-length': String(4 * 1024 * 1024 + 1)}}, {chunks: [Buffer.alloc(4 * 1024 * 1024 + 1)]}]) {
    const fixture = nativeRequestFixture(settings);
    await assert.rejects(uploadGiteeMultipart(uploadUrl, nativeOptions(), fixture), /exceeds the allowed size/);
    assert.equal(fixture.calls[0].request.destroyed, true);
    assert.equal(fixture.calls[0].response.destroyed, true);
  }
});

test('native upload rejects other origins and API paths before opening a request, and never follows redirects', async () => {
  const fixture = nativeRequestFixture({status: 302, headers: {location: 'https://evil.invalid/steal'}});
  for (const url of ['https://evil.invalid/upload', uploadUrl + '?access_token=fake-gitee-token', uploadUrl.replace(TARGET, 'other/repo')]) {
    await assert.rejects(uploadGiteeMultipart(url, nativeOptions(), fixture), /fixed Gitee attachment API/);
  }
  assert.equal(fixture.calls.length, 0);
  const http = new MirrorHttp({giteeToken: 'fake-gitee-token', uploadImpl: (url, options) => uploadGiteeMultipart(url, options, fixture), fetchImpl: () => {throw new Error('Fetch must not handle multipart uploads')}});
  await assert.rejects(http.api('gitee', 'POST', '/releases/1/attach_files', nativeOptions().body), /HTTP 302/);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].url.origin, 'https://gitee.com');
});

function curlFixture({status = 201, body = '{"id":1}', code = 0, stderr = '', stall = false, pipeError = false} = {}) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, {pid: 12345, killed: false, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough()});
    child.kill = signal => {
      child.killed = true;
      child.killSignal = signal;
      queueMicrotask(() => child.emit('close', null));
      return true;
    };
    const call = {command, args, options, child, chunks: []};
    calls.push(call);
    child.stdin.on('data', chunk => call.chunks.push(Buffer.from(chunk)));
    child.stdin.once('finish', () => queueMicrotask(() => {
      if (child.killed || stall) return;
      if (pipeError) {
        const error = new Error('sensitive input error fake-gitee-token'); error.code = 'EPIPE';
        child.stdin.emit('error', error); return;
      }
      child.stdout.end(Buffer.concat([Buffer.from(body), Buffer.from('\nPERFBOARD_HTTP_STATUS:' + status)]));
      child.stderr.end(stderr);
      queueMicrotask(() => child.emit('close', code));
    }));
    return child;
  };
  return {calls, spawnImpl};
}

test('curl upload keeps credentials in stdin, disables config/redirects and preserves exact multipart bytes', async () => {
  const fixture = curlFixture();
  const response = await uploadGiteeCurl(uploadUrl, nativeOptions(), fixture);
  assert.deepEqual(await response.json(), {id: 1});
  assert.equal(fixture.calls.length, 1);
  const {command, args, options, chunks} = fixture.calls[0];
  assert.ok(command === 'curl' || command === 'curl.exe');
  assert.equal(args[0], '--disable');
  assert.ok(args.includes('@-') && args.includes('--data-binary'));
  assert.ok(!args.includes('-L') && !args.includes('--location') && !args.includes('--insecure'));
  assert.ok(args.includes('=https') && args.includes('600') && args.includes('30'));
  assert.equal(args[args.indexOf('--url') + 1], uploadUrl);
  assert.ok(!JSON.stringify(args).includes('fake-gitee-token') && !JSON.stringify(args).includes('Bearer') && !JSON.stringify(args).includes('access_token'));
  assert.equal(options.windowsHide, true);
  for (const key of ['GITEE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) assert.equal(options.env[key], undefined);
  const bytes = Buffer.concat(chunks);
  const contentType = args.find(value => value.startsWith('Content-Type: ')).slice('Content-Type: '.length);
  assert.ok(args.includes('Content-Length: ' + bytes.length));
  const decoded = await new Response(bytes, {headers: {'Content-Type': contentType}}).formData();
  assert.equal(decoded.get('access_token'), 'fake-gitee-token');
  assert.equal(await decoded.get('file').text(), 'synthetic signed installer');
});

test('curl upload reports HTTP redirects without following them and preserves HTTP error codes', async () => {
  for (const status of [302, 413, 502]) {
    const fixture = curlFixture({status});
    const http = new MirrorHttp({giteeToken: 'fake-gitee-token', uploadImpl: (url, options) => uploadGiteeCurl(url, options, fixture)});
    await assert.rejects(http.api('gitee', 'POST', '/releases/1/attach_files', nativeOptions().body), new RegExp('HTTP ' + status));
    assert.equal(fixture.calls.length, 1);
  }
});

test('curl timeouts and pipe errors expose only safe categories, never stderr or original error messages', async () => {
  for (const settings of [{code: 28, stderr: 'secret Authorization: Bearer fake-gitee-token'}, {pipeError: true}]) {
    const fixture = curlFixture(settings);
    const http = new MirrorHttp({giteeToken: 'fake-gitee-token', uploadImpl: (url, options) => uploadGiteeCurl(url, options, fixture)});
    await assert.rejects(http.api('gitee', 'POST', '/releases/1/attach_files', nativeOptions().body), error => {
      assert.match(error.message, settings.code === 28 ? /timed out.*CURL_EXIT_28/ : /ECONNRESET/);
      assert.ok(!error.message.includes('fake-gitee-token') && !error.message.includes('Authorization') && !error.message.includes('sensitive'));
      assert.equal(error.cause, undefined); return true;
    });
    assert.equal(fixture.calls.length, 1);
  }
});

test('curl total abort kills and reaps the process while waiting for a response', async () => {
  const fixture = curlFixture({stall: true}), controller = new AbortController();
  const pending = uploadGiteeCurl(uploadUrl, nativeOptions(controller.signal), fixture);
  const timer = setTimeout(() => controller.abort(), 15);
  try {await assert.rejects(pending, /deadline reached/)} finally {clearTimeout(timer)}
  assert.equal(fixture.calls[0].child.killed, true);
  assert.equal(fixture.calls[0].child.killSignal, 'SIGKILL');
});

test('curl bounds stdout and stderr and refuses other origins before spawning', async () => {
  for (const settings of [{body: Buffer.alloc(4 * 1024 * 1024 + 1)}, {stderr: 'x'.repeat(16 * 1024 + 1)}]) {
    const fixture = curlFixture(settings);
    await assert.rejects(uploadGiteeCurl(uploadUrl, nativeOptions(), fixture), /exceeds the allowed size|error output exceeded/);
    assert.equal(fixture.calls[0].child.killed, true);
  }
  const fixture = curlFixture();
  await assert.rejects(uploadGiteeCurl('https://evil.invalid/upload', nativeOptions(), fixture), /fixed Gitee attachment API/);
  assert.equal(fixture.calls.length, 0);
});
