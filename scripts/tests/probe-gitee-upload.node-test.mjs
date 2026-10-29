import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeUpload, cleanupProbe, releaseMarker, SOURCE_COMMIT, SOURCE_TAG} from '../probe-gitee-upload.mjs';
import {SOURCE, TARGET} from '../mirror-gitee-release.mjs';

const TAG = 'mirror-upload-probe-123456-1-0123456789abcdef';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (value, status = 200) => new Response(JSON.stringify(value), {status});

class ProbeRemote {
  constructor() {
    const keys = generateKeyPairSync('ed25519'), id = randomBytes(8);
    const publicBytes = keys.publicKey.export({type: 'spki', format: 'der'}).subarray(-32);
    this.publicKey = Buffer.from(`untrusted comment: synthetic key\n${Buffer.concat([Buffer.from('Ed'), id, publicBytes]).toString('base64')}\n`).toString('base64');
    this.filename = 'Perfboard_0.1.2_x64-setup.exe';
    this.bytes = Buffer.concat([Buffer.from('MZ'), randomBytes(128)]);
    const signature = sign(null, createHash('blake2b512').update(this.bytes).digest(), keys.privateKey);
    const comment = `timestamp:1\tfile:${this.filename}\tversion:0.1.2`;
    const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), keys.privateKey);
    const packet = Buffer.concat([Buffer.from('ED'), id, signature]);
    const box = `untrusted comment: synthetic signature\n${packet.toString('base64')}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`;
    const encoded = Buffer.from(box).toString('base64');
    const manifest = {version: '0.1.2', pub_date: '2026-10-30T00:00:00Z', repositorySchemaVersion: 6,
      platforms: {'windows-x86_64': {url: `https://github.com/${SOURCE}/releases/download/v0.1.2/${this.filename}`, signature: encoded}}};
    this.assets = {[this.filename]: this.bytes, [this.filename + '.sig']: Buffer.from(encoded), 'latest.json': Buffer.from(JSON.stringify(manifest))};
    this.assets['SHA256SUMS.txt'] = Buffer.from(Object.entries(this.assets).map(([name, bytes]) => `${sha(bytes)}  ${name}`).join('\n') + '\n');
    this.sourceRelease = {tag_name: SOURCE_TAG, name: 'Perfboard 0.1.2', body: 'signed source',
      draft: false, prerelease: false, published_at: '2026-10-30T00:00:00Z',
      assets: Object.keys(this.assets).map(name => ({name, state: 'uploaded', browser_download_url: `https://github.com/${SOURCE}/releases/download/v0.1.2/${name}`}))};
    this.production = {id: 1, tag_name: 'v0.1.2', name: 'Production release', body: 'Never touch', target_commitish: SOURCE_COMMIT, prerelease: false};
    this.releases = new Map([['v0.1.2', this.production]]);
    this.calls = [];
  }
  fetch = async (value, options = {}) => {
    const url = new URL(value), method = options.method ?? 'GET';
    this.calls.push({url: url.href, method, options});
    if (url.hostname === 'api.github.com') {
      if (url.pathname.includes('/git/ref/tags/')) return json({object: {type: 'commit', sha: SOURCE_COMMIT}});
      return json(this.sourceRelease);
    }
    if (url.hostname === 'github.com') return new Response(this.assets[decodeURIComponent(url.pathname.split('/').pop())]);
    if (!url.pathname.startsWith('/api/')) return new Response(this.corruptDownload ? Buffer.from('tampered') : this.bytes);
    const endpoint = url.pathname.slice(`/api/v5/repos/${TARGET}`.length);
    if (method === 'GET' && endpoint === '/tags') return json([{name: TAG, commit: {sha: SOURCE_COMMIT}}]);
    if (method === 'GET' && endpoint.startsWith('/releases/tags/')) return this.releases.has(endpoint.split('/').pop()) ? json(this.releases.get(endpoint.split('/').pop())) : json({}, 404);
    if (method === 'GET' && /^\/releases\/\d+$/.test(endpoint)) {
      const release = [...this.releases.values()].find(item => item.id === Number(endpoint.split('/').pop()));
      return release ? json(release) : json({}, 404);
    }
    if (method === 'POST' && endpoint === '/releases') {
      const fields = Object.fromEntries(options.body);
      const release = {...fields, prerelease: fields.prerelease === 'true', id: 900};
      this.releases.set(fields.tag_name, release);
      if (this.unknownCreate) throw new Error('Synthetic unknown POST outcome');
      return json(release, 201);
    }
    if (method === 'POST' && endpoint === '/releases/900/attach_files') {
      this.uploadOrder = [...options.body.keys()];
      if (this.changeOwnership) this.releases.get(TAG).body = 'Different owner marker';
      if (this.uploadFailure) throw new Error('Synthetic failed upload fake-gitee-token');
      return json({id: 901, name: this.filename, size: this.bytes.length}, 201);
    }
    if (method === 'DELETE') {
      assert.equal(endpoint, '/releases/900', 'Only the exact owned probe release may be deleted');
      this.releases.delete(TAG);
      if (this.unknownDelete) throw new Error('Synthetic unknown DELETE outcome');
      return new Response(null, {status: 204});
    }
    throw new Error('Unexpected mock request');
  };
  options(resultFile) {
    return {tag: TAG, sourceCommit: SOURCE_COMMIT, resultFile, publicKey: this.publicKey,
      githubToken: 'fake-gh-token', giteeToken: 'fake-gitee-token', fetchImpl: this.fetch,
      uploadImpl: (url, options, policy) => {
        assert.deepEqual(policy, {ipv4: true, timeoutMs: 590_000, nativeMultipart: true});
        return this.fetch(url, options);
      }, expectedSha256: sha(this.bytes)};
  }
}

async function fixture(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'perfboard-probe-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('perfboard-probe-test-'));
    await rm(folder, {recursive: true, force: true});
  });
  return {folder, resultFile: path.join(folder, 'ack.json'), remote: new ProbeRemote()};
}

test('owned probe verifies token-first upload then deletes only its release and writes a precise cleanup acknowledgement', async t => {
  const {folder, resultFile, remote} = await fixture(t);
  const result = await probeUpload(remote.options(resultFile));
  assert.equal(result.uploadVerified, true);
  assert.equal(result.releaseCleanupConfirmed, true);
  assert.equal(result.releaseId, 900);
  assert.equal(result.releaseMarker, releaseMarker(TAG, SOURCE_COMMIT));
  assert.deepEqual(remote.uploadOrder, ['access_token', 'file']);
  assert.deepEqual(JSON.parse(await readFile(resultFile)), result);
  assert.deepEqual(await readdir(folder), ['ack.json']);
  assert.equal(remote.releases.has(TAG), false);
  assert.equal(remote.releases.get('v0.1.2'), remote.production);
  assert.ok(remote.calls.every(call => !call.url.includes('fake-gitee-token') && !call.url.includes('access_token')));
  assert.ok(remote.calls.filter(call => !call.url.startsWith('https://api.github.com/') && !call.url.startsWith('https://gitee.com/api/'))
    .every(call => call.options.headers?.Authorization === undefined));
});

test('a failed upload still confirms owned release cleanup without retrying the POST', async t => {
  const {resultFile, remote} = await fixture(t);
  remote.uploadFailure = true;
  const result = await probeUpload(remote.options(resultFile));
  assert.equal(result.uploadVerified, false);
  assert.equal(result.releaseCleanupConfirmed, true);
  assert.equal(remote.calls.filter(call => call.method === 'POST' && call.url.endsWith('/attach_files')).length, 1);
  assert.equal(remote.releases.has(TAG), false);
  assert.ok(!result.error.includes('fake-gitee-token'));
});

test('unknown create and delete outcomes are recovered through exact ownership readbacks', async t => {
  const {resultFile, remote} = await fixture(t);
  remote.unknownCreate = true;
  remote.unknownDelete = true;
  const result = await probeUpload(remote.options(resultFile));
  assert.equal(result.uploadVerified, false);
  assert.equal(result.releaseCleanupConfirmed, true);
  assert.equal(result.releaseId, 900);
  assert.equal(remote.calls.filter(call => call.method === 'POST' && call.url.endsWith('/releases')).length, 1);
  assert.equal(remote.releases.has(TAG), false);
});

test('ownership changes prevent deletion and prevent a cleanup acknowledgement', async t => {
  const {resultFile, remote} = await fixture(t);
  remote.changeOwnership = true; remote.uploadFailure = true;
  await assert.rejects(probeUpload(remote.options(resultFile)), /Probe cleanup failed.*ownership changed/);
  assert.equal(remote.calls.some(call => call.method === 'DELETE'), false);
  await assert.rejects(access(resultFile));
  assert.equal(remote.releases.has(TAG), true);
});

test('pre-existing releases, production tag names and a different source commit are never reused or deleted', async t => {
  const {resultFile, remote} = await fixture(t);
  remote.releases.set(TAG, {...remote.production, id: 999, tag_name: TAG});
  await assert.rejects(probeUpload(remote.options(resultFile)), /pre-existing release/);
  assert.equal(remote.calls.some(call => call.method !== 'GET'), false);
  await assert.rejects(access(resultFile));
  for (const changed of [{tag: 'v0.1.2'}, {sourceCommit: '0'.repeat(40)}]) {
    const calls = remote.calls.length;
    await assert.rejects(probeUpload({...remote.options(resultFile), ...changed}), /Only a uniquely named probe/);
    assert.equal(remote.calls.length, calls);
  }
});

test('the fixed public installer hash is enforced before any release or attachment mutation', async t => {
  const {resultFile, remote} = await fixture(t);
  const options = remote.options(resultFile); delete options.expectedSha256;
  const result = await probeUpload(options);
  assert.equal(result.uploadVerified, false);
  assert.match(result.error, /differs from the fixed public release/);
  assert.equal(remote.calls.some(call => call.method !== 'GET'), false);
  assert.equal(result.releaseId, null);
});

test('cleanup-only removes the exact owned release with zero source fetches or uploads and preserves its known ID in the acknowledgement', async t => {
  const {resultFile, remote} = await fixture(t);
  remote.releases.set(TAG, {id: 900, tag_name: TAG, name: `Perfboard upload probe ${TAG}`,
    body: releaseMarker(TAG, SOURCE_COMMIT), target_commitish: SOURCE_COMMIT, prerelease: true});
  const result = await cleanupProbe({...remote.options(resultFile), releaseId: 900});
  assert.equal(result.releaseId, 900);
  assert.equal(result.releaseCleanupConfirmed, true);
  assert.equal(result.uploadVerified, false);
  assert.ok(remote.calls.every(call => call.url.startsWith(`https://gitee.com/api/v5/repos/${TARGET}/`) && ['GET', 'DELETE'].includes(call.method)));
  assert.equal(remote.releases.get('v0.1.2'), remote.production);
  assert.equal(remote.releases.has(TAG), false);
});

test('cleanup-only refuses a wrong known ID or production tag without deletion or acknowledgement', async t => {
  const {resultFile, remote} = await fixture(t);
  remote.releases.set(TAG, {id: 900, tag_name: TAG, name: `Perfboard upload probe ${TAG}`,
    body: releaseMarker(TAG, SOURCE_COMMIT), target_commitish: SOURCE_COMMIT, prerelease: true});
  for (const changed of [{releaseId: 999}, {releaseId: 1}, {releaseId: 900, tag: 'v0.1.2'}]) {
    await assert.rejects(cleanupProbe({...remote.options(resultFile), ...changed}), /ownership changed|Only a uniquely named probe/);
    assert.equal(remote.calls.some(call => call.method === 'DELETE'), false);
    await assert.rejects(access(resultFile));
  }
  assert.equal(remote.releases.get('v0.1.2'), remote.production);
});

test('cleanup retries one read-only connection timeout without repeating DELETE or changing ownership guards', async t => {
  const {resultFile, remote} = await fixture(t);
  remote.releases.set(TAG, {id: 900, tag_name: TAG, name: `Perfboard upload probe ${TAG}`,
    body: releaseMarker(TAG, SOURCE_COMMIT), target_commitish: SOURCE_COMMIT, prerelease: true});
  let attempts = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/releases/tags/' + TAG) && attempts++ === 0) {
      const error = new TypeError('Synthetic connection timeout'); error.cause = {code: 'UND_ERR_CONNECT_TIMEOUT'}; throw error;
    }
    return remote.fetch(url, options);
  };
  const result = await cleanupProbe({...remote.options(resultFile), releaseId: 900, fetchImpl});
  assert.equal(result.releaseCleanupConfirmed, true);
  assert.equal(attempts, 3);
  assert.equal(remote.calls.filter(call => call.method === 'DELETE').length, 1);
});

test('the slow-route probe keeps a ten-minute outer deadline and a shorter curl deadline', async t => {
  const {resultFile, remote} = await fixture(t), deadlines = new WeakMap();
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.ok(milliseconds <= 600_000);
    const signal = new AbortController().signal;
    deadlines.set(signal, milliseconds);
    return signal;
  });
  const options = remote.options(resultFile), upload = options.uploadImpl;
  options.uploadImpl = (url, request, policy) => {
    assert.equal(deadlines.get(request.signal), 600_000);
    assert.equal(policy.timeoutMs, 590_000);
    return upload(url, request, policy);
  };
  assert.equal((await probeUpload(options)).uploadVerified, true);
});
