#!/usr/bin/env node
/** Prepare a verified, local GitHub Release asset set. Never uploads or reads a private key. */
import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPOSITORY = 'dengxiangjie12138/perfboard';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function decodeBase64(value, label) {
  const text = value.trim();
  if (!text || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error(`Invalid ${label}: expected canonical base64`);
  }
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64') !== text) throw new Error(`Invalid ${label}`);
  return bytes;
}

function textBox(encoded, label, count) {
  const text = decodeBase64(encoded, label).toString('utf8');
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length !== count || !lines[0].startsWith('untrusted comment: ')) {
    throw new Error(`Invalid ${label}: unexpected Minisign format`);
  }
  return lines;
}

/** Tauri's .sig and configured pubkey are base64-wrapped Minisign text boxes. */
export function verifySignature({ signature, publicKey, digest, version, filename }) {
  const keyLines = textBox(publicKey, 'updater public key', 2);
  const keyPacket = decodeBase64(keyLines[1], 'public key packet');
  const lines = textBox(signature, 'updater signature', 4);
  const packet = decodeBase64(lines[1], 'signature packet');
  const globalSignature = decodeBase64(lines[3], 'global signature');
  if (keyPacket.length !== 42 || keyPacket.subarray(0, 2).toString('ascii') !== 'Ed') {
    throw new Error('Unsupported updater public key');
  }
  if (packet.length !== 74 || packet.subarray(0, 2).toString('ascii') !== 'ED' || globalSignature.length !== 64) {
    throw new Error('Expected a modern, prehashed Minisign updater signature');
  }
  if (!timingSafeEqual(keyPacket.subarray(2, 10), packet.subarray(2, 10))) {
    throw new Error('Updater signature uses a different key');
  }
  const prefix = 'trusted comment: ';
  if (!lines[2].startsWith(prefix)) throw new Error('Missing signed trusted comment');
  const comment = lines[2].slice(prefix.length);
  const versionFields = comment.split('\t').filter(field => field.startsWith('version:'));
  const filenameFields = comment.split('\t').filter(field => field.startsWith('file:'));
  if (versionFields.length !== 1 || versionFields[0] !== `version:${version}`) {
    throw new Error('Signature version differs from release version; sign with --app-version');
  }
  if (filenameFields.length !== 1 || filenameFields[0] !== `file:${filename}`) {
    throw new Error('Signature filename differs from release installer name');
  }
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), keyPacket.subarray(10)]),
    format: 'der', type: 'spki',
  });
  const bodySignature = packet.subarray(10);
  if (!verify(null, digest, key, bodySignature)
      || !verify(null, Buffer.concat([bodySignature, Buffer.from(comment)]), key, globalSignature)) {
    throw new Error('Installer or signed metadata failed signature verification');
  }
}

async function fileHashes(file) {
  const digest = createHash('blake2b512'), sha = createHash('sha256');
  let size = 0;
  let header = Buffer.alloc(0);
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk); sha.update(chunk); size += chunk.length;
    if (header.length < 64) header = Buffer.concat([header, chunk]).subarray(0, 64);
  }
  if (size < 64 || header[0] !== 0x4d || header[1] !== 0x5a) throw new Error('Installer is not a Windows EXE');
  return { digest: digest.digest(), sha256: sha.digest('hex'), size };
}

export async function prepareRelease({ installer, notesFile, projectRoot = ROOT, date = new Date() }) {
  const [packageJson, config, cargo, signature, notes, repositorySource] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'src-tauri', 'Cargo.toml'), 'utf8'),
    readFile(`${installer}.sig`, 'utf8'),
    readFile(notesFile, 'utf8'),
    readFile(path.join(projectRoot, 'src-tauri', 'src', 'repository.rs'), 'utf8'),
  ]);
  const packageSection = cargo.match(/^\[package\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const cargoVersion = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const version = packageJson.version;
  if (!STABLE_VERSION.test(version ?? '')) throw new Error('Release version must be a stable SemVer without a v prefix');
  if (config.version !== version || cargoVersion !== version) throw new Error('package.json, Cargo.toml and tauri.conf.json versions differ');
  const repositorySchemaVersion = Number(repositorySource.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?const\s+SCHEMA_VERSION\s*:\s*\w+\s*=\s*(\d+)\s*;/m)?.[1]);
  if (!Number.isSafeInteger(repositorySchemaVersion) || repositorySchemaVersion < 1) throw new Error('Cannot determine repository SCHEMA_VERSION for release compatibility metadata');
  if (!config.bundle?.createUpdaterArtifacts || !config.plugins?.updater?.requireSignedVersion) {
    throw new Error('Enable createUpdaterArtifacts and updater.requireSignedVersion before releasing');
  }
  const filename = `Perfboard_${version}_x64-setup.exe`;
  if (path.basename(installer) !== filename) throw new Error(`Installer must be named ${filename}`);
  if (!notes.trim()) throw new Error('Release notes must not be empty');
  const published = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(published.getTime())) throw new Error('Invalid publication date');
  const hashes = await fileHashes(installer);
  verifySignature({ signature, publicKey: config.plugins.updater.pubkey, digest: hashes.digest, version, filename });
  const manifest = {
    version, notes: notes.trim(), pub_date: published.toISOString(), repositorySchemaVersion,
    platforms: {
      'windows-x86_64': {
        signature: signature.trim(),
        url: `https://github.com/${REPOSITORY}/releases/download/v${version}/${encodeURIComponent(filename)}`,
      },
    },
  };
  return { manifest, filename, installer: path.resolve(installer), signature: signature.trim(), sha256: hashes.sha256, size: hashes.size };
}

async function writeChecked(destination, bytes) {
  try {
    const existing = await readFile(destination);
    if (!existing.equals(bytes)) throw new Error(`Refusing to replace a different existing asset: ${destination}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(destination, bytes, { flag: 'wx' });
  }
}

export async function writeRelease(release, output) {
  const directory = path.resolve(output);
  await mkdir(directory, { recursive: true });
  const assets = new Map([
    [release.filename, await readFile(release.installer)],
    [`${release.filename}.sig`, Buffer.from(release.signature)],
    ['latest.json', Buffer.from(`${JSON.stringify(release.manifest, null, 2)}\n`)],
  ]);
  // Detect source replacement after verification before copying a publishable asset.
  if (createHash('sha256').update(assets.get(release.filename)).digest('hex') !== release.sha256) {
    throw new Error('Installer changed after signature verification');
  }
  const checksums = [...assets].map(([name, bytes]) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}`).join('\n') + '\n';
  for (const [name, bytes] of assets) await writeChecked(path.join(directory, name), bytes);
  await writeChecked(path.join(directory, 'SHA256SUMS.txt'), Buffer.from(checksums));
  return [...assets.keys(), 'SHA256SUMS.txt'].map(name => path.join(directory, name));
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--verify-only') { options.verifyOnly = true; continue; }
    if (name === '--help' || name === '-h') {
      console.log('node scripts/prepare-update-release.mjs --installer <EXE> --notes <Markdown> --output <directory> [--date <ISO>] [--project <root>] [--verify-only]');
      return;
    }
    const key = { '--installer': 'installer', '--notes': 'notesFile', '--output': 'output', '--date': 'date', '--project': 'projectRoot' }[name];
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${name}`);
    options[key] = args[++index];
  }
  if (!options.installer || !options.notesFile || (!options.verifyOnly && !options.output)) throw new Error('Pass --installer, --notes and --output (or --verify-only)');
  const release = await prepareRelease(options);
  const files = options.verifyOnly ? [] : await writeRelease(release, options.output);
  console.log(JSON.stringify({ version: release.manifest.version, repository: REPOSITORY, installerBytes: release.size, installerSha256: release.sha256, verified: true, files }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`Update release preparation failed: ${error.message}`); process.exitCode = 1; });
}
