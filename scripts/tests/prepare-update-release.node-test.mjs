import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRelease, writeRelease } from '../prepare-update-release.mjs';

async function fixture(t, releaseVersion = '0.1.1') {
  const base = await mkdtemp(path.join(os.tmpdir(), 'perfboard-release-test-'));
  t.after(async () => {
    const resolved = path.resolve(base);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('perfboard-release-test-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = randomBytes(8);
  const rawPublic = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const publicBox = `untrusted comment: test public key\n${Buffer.concat([Buffer.from('Ed'), keyId, rawPublic]).toString('base64')}\n`;
  const updaterKey = Buffer.from(publicBox).toString('base64');
  const installer = path.join(base, `Perfboard_${releaseVersion}_x64-setup.exe`);
  const bytes = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(126), randomBytes(200)]);
  const notesFile = path.join(base, 'notes.md');
  const config = { version: releaseVersion, bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: updaterKey, requireSignedVersion: true } } };
  await mkdir(path.join(base, 'src-tauri'));
  await mkdir(path.join(base, 'src-tauri', 'src'));
  await writeFile(path.join(base, 'src-tauri', 'src', 'repository.rs'), 'const SCHEMA_VERSION: i64 = 6;\n');
  await writeFile(path.join(base, 'package.json'), JSON.stringify({ version: releaseVersion }));
  await writeFile(path.join(base, 'src-tauri', 'tauri.conf.json'), JSON.stringify(config));
  await writeFile(path.join(base, 'src-tauri', 'Cargo.toml'), `[package]\nname = "perfboard"\nversion = "${releaseVersion}"\n\n[dependencies]\nexample = "2"\n`);
  await writeFile(installer, bytes);
  await writeFile(notesFile, '增加软件更新。\n');
  function signature({ version = releaseVersion, filename = path.basename(installer), body = bytes, key = privateKey, comment } = {}) {
    const payload = sign(null, createHash('blake2b512').update(body).digest(), key);
    const trusted = comment ?? `timestamp:1234567890\tfile:${filename}${version === null ? '' : `\tversion:${version}`}`;
    const global = sign(null, Buffer.concat([payload, Buffer.from(trusted)]), key);
    const box = `untrusted comment: synthetic test signature\n${Buffer.concat([Buffer.from('ED'), keyId, payload]).toString('base64')}\ntrusted comment: ${trusted}\n${global.toString('base64')}\n`;
    return Buffer.from(box).toString('base64');
  }
  await writeFile(`${installer}.sig`, signature());
  return { base, installer, notesFile, config, signature, bytes, options: { installer, notesFile, projectRoot: base, date: '2026-10-29T12:00:00+08:00' } };
}

test('generates correct immutable GitHub installer URL and embedded signature after real Ed25519 verification', async t => {
  const f = await fixture(t);
  const release = await prepareRelease(f.options);
  assert.equal(release.manifest.version, '0.1.1');
  assert.equal(release.manifest.pub_date, '2026-10-29T04:00:00.000Z');
  assert.equal(release.manifest.notes, '增加软件更新。');
  assert.equal(release.manifest.repositorySchemaVersion, 6);
  assert.equal(release.manifest.platforms['windows-x86_64'].url, 'https://github.com/dengxiangjie12138/perfboard/releases/download/v0.1.1/Perfboard_0.1.1_x64-setup.exe');
  assert.equal(release.manifest.platforms['windows-x86_64'].signature, (await readFile(`${f.installer}.sig`, 'utf8')).trim());
  const output = path.join(f.base, 'assets');
  assert.equal((await writeRelease(release, output)).length, 4);
  const sums = await readFile(path.join(output, 'SHA256SUMS.txt'), 'utf8');
  assert.equal(sums.trim().split('\n').length, 3);
  assert.ok(sums.includes(`${release.sha256}  ${release.filename}`));
  // An identical invocation is safe and does not replace published files.
  await writeRelease(release, output);
});

test('prepares later releases from project metadata without hardcoded 0.1.1 filenames or URLs', async t => {
  const f = await fixture(t, '0.1.2');
  const release = await prepareRelease(f.options);
  assert.equal(release.manifest.version, '0.1.2');
  assert.equal(release.filename, 'Perfboard_0.1.2_x64-setup.exe');
  assert.equal(release.manifest.repositorySchemaVersion, 6);
  assert.equal(release.manifest.platforms['windows-x86_64'].url, 'https://github.com/dengxiangjie12138/perfboard/releases/download/v0.1.2/Perfboard_0.1.2_x64-setup.exe');
});

test('reads repository compatibility metadata from the target release source', async t => {
  const f = await fixture(t, '0.1.2');
  await writeFile(path.join(f.base, 'src-tauri', 'src', 'repository.rs'), 'pub(crate) const SCHEMA_VERSION: i64 = 7;\n');
  const release = await prepareRelease(f.options);
  assert.equal(release.manifest.repositorySchemaVersion, 7);
});

test('refuses release metadata when the repository schema version is not discoverable', async t => {
  const f = await fixture(t, '0.1.2');
  await writeFile(path.join(f.base, 'src-tauri', 'src', 'repository.rs'), '// schema declaration missing\n');
  await assert.rejects(prepareRelease(f.options), /SCHEMA_VERSION/);
});

test('rejects mismatched package/Cargo/Tauri versions before generating assets', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.base, 'src-tauri', 'Cargo.toml'), '[package]\nname="perfboard"\nversion="0.1.0"\n');
  await assert.rejects(prepareRelease(f.options), /versions differ/);
});

test('rejects an installer changed after signing', async t => {
  const f = await fixture(t);
  await writeFile(f.installer, Buffer.concat([f.bytes, Buffer.from('changed')]));
  await assert.rejects(prepareRelease(f.options), /signature verification/);
});

test('rejects a signature generated using another private key even with a copied key ID', async t => {
  const f = await fixture(t);
  const { privateKey } = generateKeyPairSync('ed25519');
  await writeFile(`${f.installer}.sig`, f.signature({ key: privateKey }));
  await assert.rejects(prepareRelease(f.options), /signature verification/);
});

test('rejects a tampered trusted version even when the package signature remains valid', async t => {
  const f = await fixture(t);
  const encoded = f.signature({ version: '0.1.0' });
  const tampered = Buffer.from(encoded, 'base64').toString('utf8').replace('version:0.1.0', 'version:0.1.1');
  await writeFile(`${f.installer}.sig`, Buffer.from(tampered).toString('base64'));
  await assert.rejects(prepareRelease(f.options), /signature verification/);
});

test('rejects signatures bound to another version', async t => {
  const f = await fixture(t);
  await writeFile(`${f.installer}.sig`, f.signature({ version: '0.1.0' }));
  await assert.rejects(prepareRelease(f.options), /Signature version differs/);
});

test('rejects legacy signatures without a signed app version', async t => {
  const f = await fixture(t);
  await writeFile(`${f.installer}.sig`, f.signature({ version: null }));
  await assert.rejects(prepareRelease(f.options), /--app-version/);
});

test('rejects an authenticated but incorrectly named installer', async t => {
  const f = await fixture(t);
  await writeFile(`${f.installer}.sig`, f.signature({ filename: 'other.exe' }));
  await assert.rejects(prepareRelease(f.options), /Signature filename differs/);
});

test('rejects missing mandatory release signing configuration', async t => {
  const f = await fixture(t);
  f.config.plugins.updater.requireSignedVersion = false;
  await writeFile(path.join(f.base, 'src-tauri', 'tauri.conf.json'), JSON.stringify(f.config));
  await assert.rejects(prepareRelease(f.options), /requireSignedVersion/);
});

test('refuses overwriting an existing release asset with different bytes', async t => {
  const f = await fixture(t);
  const release = await prepareRelease(f.options), output = path.join(f.base, 'assets');
  await mkdir(output);
  await writeFile(path.join(output, release.filename), 'do not replace');
  await assert.rejects(writeRelease(release, output), /Refusing to replace/);
  assert.equal(await readFile(path.join(output, release.filename), 'utf8'), 'do not replace');
});

test('detects installer replacement between verification and asset copying', async t => {
  const f = await fixture(t), release = await prepareRelease(f.options);
  await writeFile(f.installer, Buffer.concat([f.bytes, Buffer.from('changed')]));
  await assert.rejects(writeRelease(release, path.join(f.base, 'assets')), /changed after signature verification/);
});

test('rejects malformed signature data instead of copying it into latest.json', async t => {
  const f = await fixture(t);
  await writeFile(`${f.installer}.sig`, 'not a signature');
  await assert.rejects(prepareRelease(f.options), /Invalid updater signature/);
});
