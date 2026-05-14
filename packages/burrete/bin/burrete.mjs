#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const OWNER = 'SergeiNikolenko';
const REPO = 'Burrete';
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const APP_NAME = 'Burrete.app';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (process.platform !== 'darwin') {
    fail('Burrete is a macOS app. This installer only runs on macOS.');
  }

  if (command === 'latest') {
    const release = await fetchLatestRelease();
    const asset = findZipAsset(release);
    console.log(`${release.tag_name} ${asset.browser_download_url}`);
    return;
  }

  if (command === 'install') {
    await install(args.slice(1));
    return;
  }

  fail(`Unknown command: ${command}`);
}

async function install(args) {
  const system = args.includes('--system');
  const installDir = system ? '/Applications' : path.join(homedir(), 'Applications');
  const release = await fetchLatestRelease();
  const asset = findZipAsset(release);
  const workDir = path.join(tmpdir(), `burrete-${process.pid}`);
  const zipPath = path.join(workDir, asset.name);
  const extractDir = path.join(workDir, 'extract');

  await mkdir(extractDir, { recursive: true });
  await download(asset.browser_download_url, zipPath);
  await verifyDigest(zipPath, asset.digest);

  run('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], 'Failed to unzip Burrete release.');
  await mkdir(installDir, { recursive: true });

  const sourceApp = path.join(extractDir, APP_NAME);
  await ensureExists(sourceApp, `Release archive does not contain ${APP_NAME}.`);
  const targetApp = path.join(installDir, APP_NAME);
  await rm(targetApp, { recursive: true, force: true });
  run('/usr/bin/ditto', [sourceApp, targetApp], 'Failed to install Burrete.app.');
  run('/usr/bin/qlmanage', ['-r'], 'Installed Burrete, but Quick Look refresh failed.', { allowFailure: true });
  await rm(workDir, { recursive: true, force: true });

  console.log(`Installed ${APP_NAME} ${release.tag_name} to ${targetApp}`);
  console.log('Open Burrete once so macOS registers the Quick Look extension.');
}

async function fetchLatestRelease() {
  const response = await fetch(API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'burrete-npm-installer',
    },
  });
  if (!response.ok) {
    fail(`Could not fetch latest Burrete release: HTTP ${response.status}`);
  }
  return response.json();
}

function findZipAsset(release) {
  const asset = release.assets?.find(item => /^Burrete-.+\.zip$/.test(item.name));
  if (!asset) {
    fail(`Release ${release.tag_name || 'unknown'} does not include a Burrete zip asset.`);
  }
  return asset;
}

async function download(url, targetPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'burrete-npm-installer',
    },
  });
  if (!response.ok || !response.body) {
    fail(`Could not download Burrete release: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(targetPath));
}

async function verifyDigest(filePath, digest) {
  if (!digest) return;

  const match = /^sha256:(?<expected>[a-f0-9]{64})$/i.exec(digest);
  if (!match) return;

  const actual = await sha256(filePath);
  if (actual !== match.groups.expected.toLowerCase()) {
    fail(`Downloaded release checksum mismatch: expected ${match.groups.expected}, got ${actual}`);
  }
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function ensureExists(filePath, message) {
  try {
    await stat(filePath);
  } catch {
    fail(message);
  }
}

function run(command, args, errorMessage, options = {}) {
  const result = spawnSync(command, args, { stdio: options.allowFailure ? 'pipe' : 'inherit' });
  if (result.status !== 0 && !options.allowFailure) {
    fail(errorMessage);
  }
}

function printHelp() {
  console.log(`Burrete installer

Usage:
  burrete install [--system]
  burrete latest

Commands:
  install   Download the latest Burrete release and install Burrete.app.
  latest    Print the latest release tag and zip URL.

Options:
  --system  Install to /Applications instead of ~/Applications.
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

main().catch(error => fail(error?.message || String(error)));
