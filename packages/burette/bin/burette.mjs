#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const OWNER = 'SergeiNikolenko';
const REPO = 'Burette';
const RELEASES_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
const APP_NAME = 'Burette.app';
const QUICK_LOOK_EXTENSION_NAME = 'BurettePreview.appex';
const QUICK_LOOK_EXTENSION_ID = 'com.local.BuretteV10.Preview';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const UPDATE_CHANNELS = new Set(['stable', 'beta']);

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (process.platform !== 'darwin') {
    fail('Burette is a macOS app. This installer only runs on macOS.');
  }

  if (command === 'latest') {
    const { channel } = parseOptions(args.slice(1));
    const release = await fetchLatestRelease(channel);
    const asset = findZipAsset(release);
    console.log(`${release.tag_name} ${asset.browser_download_url}`);
    return;
  }

  if (command === 'install') {
    await install(parseOptions(args.slice(1)));
    return;
  }

  if (command === 'doctor') {
    const { system } = parseOptions(args.slice(1));
    const report = await buildDoctorReport({ system });
    printDoctorReport(report);
    if (report.some(item => !item.ok)) {
      process.exit(1);
    }
    return;
  }

  fail(`Unknown command: ${command}`);
}

async function install({ system, channel }) {
  const installDir = system ? '/Applications' : path.join(homedir(), 'Applications');
  const installScope = system ? 'system-wide' : 'current-user';
  const release = await fetchLatestRelease(channel);
  const asset = findZipAsset(release);
  const workDir = path.join(tmpdir(), `burette-${process.pid}`);
  const zipPath = path.join(workDir, asset.name);
  const extractDir = path.join(workDir, 'extract');

  logStep(`Installing ${release.tag_name} from the ${channel} channel.`);
  logStep(`Install scope: ${installScope} (${installDir}).`);
  await mkdir(extractDir, { recursive: true });
  logStep(`Downloading ${asset.name}.`);
  await download(asset.browser_download_url, zipPath);
  logStep(asset.digest ? 'Verifying release checksum.' : 'No GitHub checksum was provided; skipping checksum verification.');
  await verifyDigest(zipPath, asset.digest);

  logStep('Unpacking release archive.');
  run('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], 'Failed to unzip Burette release.');
  await mkdir(installDir, { recursive: true });

  const sourceApp = path.join(extractDir, APP_NAME);
  await ensureExists(sourceApp, `Release archive does not contain ${APP_NAME}.`);
  const targetApp = path.join(installDir, APP_NAME);
  try {
    logStep(`Replacing ${targetApp}.`);
    await replaceInstalledApp({ sourceApp, targetApp });
  } catch (error) {
    fail(`Failed to install Burette.app. The previous app was preserved when possible. ${error?.message || String(error)}`);
  }
  logStep('Registering LaunchServices and Quick Look.');
  registerInstalledApp(targetApp);
  await rm(workDir, { recursive: true, force: true });

  console.log(`Installed ${APP_NAME} ${release.tag_name} to ${targetApp}`);
  console.log('Next steps:');
  console.log('  1. Open Burette once so macOS registers the Quick Look extension.');
  console.log('  2. Select a supported molecule file in Finder and press Space.');
  console.log('  3. Run `burette doctor` if Finder previews do not appear.');
}

function registerInstalledApp(targetApp) {
  const quickLookExtension = path.join(targetApp, 'Contents', 'PlugIns', QUICK_LOOK_EXTENSION_NAME);
  run(LSREGISTER, ['-f', '-R', targetApp], 'Installed Burette, but LaunchServices registration failed.', { allowFailure: true });
  run('/usr/bin/pluginkit', ['-a', quickLookExtension], 'Installed Burette, but Quick Look extension registration failed.', { allowFailure: true });
  run('/usr/bin/pluginkit', ['-e', 'use', '-i', QUICK_LOOK_EXTENSION_ID], 'Installed Burette, but Quick Look extension enablement failed.', { allowFailure: true });
  run('/usr/bin/qlmanage', ['-r'], 'Installed Burette, but Quick Look refresh failed.', { allowFailure: true });
  run('/usr/bin/qlmanage', ['-r', 'cache'], 'Installed Burette, but Quick Look cache refresh failed.', { allowFailure: true });
  run('/usr/bin/killall', ['quicklookd'], 'Installed Burette, but quicklookd restart failed.', { allowFailure: true });
}

function parseOptions(args) {
  let system = false;
  let channel = null;
  const setChannel = (value) => {
    if (!UPDATE_CHANNELS.has(value)) {
      fail(`Unknown update channel: ${value}`);
    }
    if (channel && channel !== value) {
      fail(`Conflicting update channels: ${channel} and ${value}`);
    }
    channel = value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--system') {
      system = true;
      continue;
    }
    if (arg === '--beta') {
      setChannel('beta');
      continue;
    }
    if (arg === '--channel') {
      const value = args[index + 1];
      if (!value) {
        fail('Missing value for --channel.');
      }
      setChannel(value);
      index += 1;
      continue;
    }
    fail(`Unknown option: ${arg}`);
  }
  return { system, channel: channel || 'stable' };
}

export async function fetchLatestRelease(channel) {
  const response = await fetch(RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'burette-cli-installer',
    },
  });
  if (!response.ok) {
    fail(`Could not fetch latest Burette release: HTTP ${response.status}`);
  }
  try {
    return selectRelease(await response.json(), channel);
  } catch (error) {
    fail(`Could not select a ${channel} Burette release: ${error?.message || String(error)}`);
  }
}

export function selectRelease(releases, channel) {
  const release = releases
    .filter(item => item && item.draft !== true)
    .filter(item => channel === 'beta' || item.prerelease !== true)
    .filter(item => item.tag_name && findZipAsset(item, false))
    .sort((left, right) => compareVersions(right.tag_name, left.tag_name))[0];
  if (!release) {
    fail(`Could not find a ${channel} Burette release with a zip asset.`);
  }
  return release;
}

export function findZipAsset(release, required = true) {
  const asset = release.assets?.find(item => /^Burette-.+\.zip$/.test(item.name));
  if (!asset && required) {
    fail(`Release ${release.tag_name || 'unknown'} does not include a Burette zip asset.`);
  }
  return asset || null;
}

async function download(url, targetPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'burette-cli-installer',
    },
  });
  if (!response.ok || !response.body) {
    fail(`Could not download Burette release: HTTP ${response.status}`);
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

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeTree(filePath) {
  await rm(filePath, { recursive: true, force: true });
}

function copyAppBundle(sourceApp, stageApp) {
  run('/usr/bin/ditto', [sourceApp, stageApp], 'Failed to stage Burette.app for installation.');
}

export async function replaceInstalledApp({
  sourceApp,
  targetApp,
  copyApp = copyAppBundle,
  movePath = rename,
  removePath = removeTree,
  exists = pathExists,
}) {
  const installDir = path.dirname(targetApp);
  const stageApp = path.join(installDir, `${APP_NAME}.updating`);
  const backupApp = path.join(installDir, `${APP_NAME}.previous`);
  await removePath(stageApp);
  await removePath(backupApp);
  await copyApp(sourceApp, stageApp);
  let movedCurrentApp = false;
  try {
    if (await exists(targetApp)) {
      await movePath(targetApp, backupApp);
      movedCurrentApp = true;
    }
    await movePath(stageApp, targetApp);
    await removePath(backupApp);
  } catch (error) {
    await removePath(stageApp);
    if (movedCurrentApp) {
      if (await exists(targetApp)) {
        await removePath(targetApp);
      }
      await movePath(backupApp, targetApp);
    }
    throw error;
  }
}

export async function buildDoctorReport({
  system = false,
  exists = pathExists,
  runCommand = spawnSync,
} = {}) {
  const installDir = system ? '/Applications' : path.join(homedir(), 'Applications');
  const appPath = path.join(installDir, APP_NAME);
  const quickLookPath = path.join(appPath, 'Contents', 'PlugIns', QUICK_LOOK_EXTENSION_NAME);
  const appInstalled = await exists(appPath);
  const quickLookInstalled = await exists(quickLookPath);
  const qlmanageAvailable = await exists('/usr/bin/qlmanage');
  const version = appInstalled ? readAppVersion(appPath, runCommand) : null;
  return [
    {
      ok: appInstalled,
      label: 'Burette app',
      detail: appInstalled ? appPath : `Not found at ${appPath}`,
    },
    {
      ok: quickLookInstalled,
      label: 'Quick Look extension',
      detail: quickLookInstalled ? quickLookPath : `Not found at ${quickLookPath}`,
    },
    {
      ok: qlmanageAvailable,
      label: 'Quick Look reset tool',
      detail: qlmanageAvailable ? '/usr/bin/qlmanage' : 'qlmanage was not found at /usr/bin/qlmanage',
    },
    {
      ok: Boolean(version),
      label: 'App version',
      detail: version || 'Version unavailable because the app is missing or Info.plist could not be read',
    },
  ];
}

function printDoctorReport(report) {
  console.log('Burette doctor');
  for (const item of report) {
    console.log(`${item.ok ? 'ok' : 'fail'} - ${item.label}: ${item.detail}`);
  }
}

function readAppVersion(appPath, runCommand = spawnSync) {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  const result = runCommand('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleShortVersionString', plistPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export function compareVersions(left, right) {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  const coreComparison = compareNumericParts(leftVersion.core, rightVersion.core);
  if (coreComparison !== 0) return coreComparison;
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function parseVersion(raw) {
  const trimmed = raw.trim().replace(/^v/i, '');
  const [withoutBuildMetadata] = trimmed.split('+', 1);
  const separatorIndex = withoutBuildMetadata.indexOf('-');
  const corePart =
    separatorIndex >= 0 ? withoutBuildMetadata.slice(0, separatorIndex) : withoutBuildMetadata;
  const prereleasePart =
    separatorIndex >= 0 ? withoutBuildMetadata.slice(separatorIndex + 1) : '';
  return {
    core: corePart.split('.').map(parseNumericPart),
    prerelease: prereleasePart
      ? prereleasePart.split('.').filter(Boolean).map(parseIdentifier)
      : [],
  };
}

function parseNumericPart(value) {
  return /^\d+$/.test(value) ? Number.parseInt(value, 10) : 0;
}

function parseIdentifier(value) {
  if (/^\d+$/.test(value)) {
    return { kind: 'numeric', value: Number.parseInt(value, 10) };
  }
  return { kind: 'text', value };
}

function compareNumericParts(left, right) {
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a) return -1;
    if (!b) return 1;
    if (a.kind === 'numeric' && b.kind === 'numeric') {
      if (a.value !== b.value) return a.value > b.value ? 1 : -1;
      continue;
    }
    if (a.kind === 'numeric') return -1;
    if (b.kind === 'numeric') return 1;
    if (a.value !== b.value) return a.value > b.value ? 1 : -1;
  }
  return 0;
}

function run(command, args, errorMessage, options = {}) {
  const result = spawnSync(command, args, { stdio: options.allowFailure ? 'pipe' : 'inherit' });
  if (result.status !== 0 && !options.allowFailure) {
    fail(errorMessage);
  }
}

function logStep(message) {
  console.log(`- ${message}`);
}

function printHelp() {
  console.log(`Burette installer

Usage:
  burette install [--system] [--beta|--channel stable|beta]
  burette latest [--beta|--channel stable|beta]
  burette doctor [--system]

Commands:
  install   Download the latest Burette release and install Burette.app.
  latest    Print the latest release tag and zip URL.
  doctor    Check app installation, Quick Look extension, qlmanage, and version.

Options:
  --system           Use /Applications instead of ~/Applications for install or doctor.
  --beta             Select the beta update channel.
  --channel <name>   Select stable or beta releases explicitly.

Launch registration:
  For registration-only app launches, use BURETTE_LAUNCH_MODE=register with
  Burette.app. The installer itself registers LaunchServices and Quick Look
  without launching the full app.
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => fail(error?.message || String(error)));
}
