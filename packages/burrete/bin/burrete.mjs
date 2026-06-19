#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWNER = 'SergeiNikolenko';
const REPO = 'Burrete';
const RELEASES_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
const APP_NAME = 'Burrete.app';
const QUICK_LOOK_EXTENSION_NAME = 'BurretePreview.appex';
const QUICK_LOOK_EXTENSION_ID = 'com.local.BurreteV10.Preview';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const UPDATE_CHANNELS = new Set(['stable', 'beta']);
const PLUGIN_RELATIVE_PATH = 'plugins/burette-agent';
const CODEX_PLUGIN_ID = 'burrete';
const DEFAULT_PLUGIN_NAMESPACE = 'nikolenko-local';
const CODEX_PLUGIN_CACHE = path.join(homedir(), '.codex', 'plugins', 'cache');
const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PACKAGE_ROOT = path.resolve(CLI_DIR, '..');
const REPO_ROOT_FROM_CLI = path.resolve(CLI_PACKAGE_ROOT, '..', '..');

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

  if (command === 'plugin') {
    await handlePluginCommand(args.slice(1));
    return;
  }

  fail(`Unknown command: ${command}`);
}

async function handlePluginCommand(args) {
  const subcommand = args[0] || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printPluginHelp();
    return;
  }
  const options = parsePluginOptions(args.slice(1));
  if (subcommand === 'status') {
    printPluginStatus(await buildPluginStatus(options));
    return;
  }
  if (subcommand === 'install' || subcommand === 'update') {
    const result = await installCodexPlugin(options);
    printPluginInstallResult(result);
    return;
  }
  fail(`Unknown plugin command: ${subcommand}`);
}

async function install({ system, channel }) {
  const installDir = system ? '/Applications' : path.join(homedir(), 'Applications');
  const installScope = system ? 'system-wide' : 'current-user';
  const release = await fetchLatestRelease(channel);
  const asset = findZipAsset(release);
  const workDir = path.join(tmpdir(), `burrete-${process.pid}`);
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
  run('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], 'Failed to unzip Burrete release.');
  await mkdir(installDir, { recursive: true });

  const sourceApp = path.join(extractDir, APP_NAME);
  await ensureExists(sourceApp, `Release archive does not contain ${APP_NAME}.`);
  const targetApp = path.join(installDir, APP_NAME);
  try {
    logStep(`Replacing ${targetApp}.`);
    await replaceInstalledApp({ sourceApp, targetApp });
  } catch (error) {
    fail(`Failed to install Burrete.app. The previous app was preserved when possible. ${error?.message || String(error)}`);
  }
  logStep('Registering LaunchServices and Quick Look.');
  registerInstalledApp(targetApp);
  await rm(workDir, { recursive: true, force: true });

  console.log(`Installed ${APP_NAME} ${release.tag_name} to ${targetApp}`);
  console.log('Next steps:');
  console.log('  1. Open Burrete once so macOS registers the Quick Look extension.');
  console.log('  2. Select a supported molecule file in Finder and press Space.');
  console.log('  3. Run `burrete doctor` if Finder previews do not appear.');
}

export async function buildPluginStatus({
  sourcePath = null,
  cacheDir = CODEX_PLUGIN_CACHE,
  namespace = null,
  system = false,
  exists = pathExists,
} = {}) {
  const source = await resolveBundledPluginPath({ sourcePath, system, exists });
  const manifest = source ? await readPluginManifest(source) : null;
  const installedPlugin = await findInstalledPlugin({ cacheDir, namespace, name: manifest?.name ?? CODEX_PLUGIN_ID });
  const effectiveNamespace = namespace || installedPlugin?.namespace || DEFAULT_PLUGIN_NAMESPACE;
  const target = manifest ? pluginInstallPath({ cacheDir, namespace: effectiveNamespace, name: manifest.name, version: manifest.version }) : null;
  const installed = target ? await exists(target) : false;
  return {
    source,
    sourceOk: Boolean(source && manifest),
    target,
    installed,
    installedPath: installedPlugin?.path ?? null,
    installedVersion: installedPlugin?.manifest.version ?? null,
    namespace: effectiveNamespace,
    name: manifest?.name ?? CODEX_PLUGIN_ID,
    version: manifest?.version ?? null,
  };
}

export async function installCodexPlugin({
  sourcePath = null,
  cacheDir = CODEX_PLUGIN_CACHE,
  namespace = null,
  system = false,
  installDeps = true,
  exists = pathExists,
  copyPath = copyPluginBundle,
  movePath = rename,
  removePath = removeTree,
  runCommand = spawnSync,
  now = () => new Date(),
} = {}) {
  const source = await resolveBundledPluginPath({ sourcePath, system, exists });
  if (!source) {
    fail([
      'Could not find the bundled Burrete Codex plugin.',
      `Pass --path /absolute/path/to/${PLUGIN_RELATIVE_PATH}, install Burrete.app first, or run this command from a Burrete source checkout.`,
    ].join(' '));
  }

  const manifest = await readPluginManifest(source);
  const installedPlugin = await findInstalledPlugin({ cacheDir, namespace, name: manifest.name });
  const effectiveNamespace = namespace || installedPlugin?.namespace || DEFAULT_PLUGIN_NAMESPACE;
  const target = pluginInstallPath({ cacheDir, namespace: effectiveNamespace, name: manifest.name, version: manifest.version });
  const pluginBase = path.dirname(target);
  const stage = path.join(pluginBase, `.${manifest.version}.updating-${process.pid}`);
  const backup = path.join(pluginBase, `.${manifest.version}.previous-${process.pid}`);
  await mkdir(pluginBase, { recursive: true });
  await removePath(stage);
  await removePath(backup);
  await copyPath(source, stage);
  await writePluginInstallMetadata(stage, {
    plugin: {
      name: manifest.name,
      version: manifest.version,
    },
    namespace: effectiveNamespace,
    source,
    installedAt: now().toISOString(),
  });

  if (installDeps) {
    const result = runCommand('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: stage,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
      await removePath(stage);
      fail(`Could not install plugin dependencies with npm. ${commandOutputText(result.stdout, result.stderr)}`);
    }
  }

  const hadExistingInstall = await exists(target);
  try {
    if (hadExistingInstall) {
      await movePath(target, backup);
    }
    await movePath(stage, target);
    await removePath(backup);
  } catch (error) {
    await removePath(stage);
    if (hadExistingInstall) {
      if (await exists(target)) {
        await removePath(target);
      }
      await movePath(backup, target);
    }
    throw error;
  }

  return {
    action: installedPlugin ? 'updated' : 'installed',
    source,
    target,
    namespace: effectiveNamespace,
    name: manifest.name,
    version: manifest.version,
    depsInstalled: installDeps,
  };
}

function printPluginStatus(status) {
  console.log('Burrete Codex plugin');
  console.log(`${status.sourceOk ? 'ok' : 'fail'} - Bundle: ${status.source || 'not found'}`);
  console.log(`${status.installed ? 'ok' : 'missing'} - Installed: ${status.target || 'target unavailable'}`);
  console.log(`info - Plugin: ${status.name}${status.version ? ` v${status.version}` : ''}`);
  console.log(`info - Namespace: ${status.namespace}`);
}

function printPluginInstallResult(result) {
  console.log(`${result.action === 'updated' ? 'Updated' : 'Installed'} Codex plugin ${result.name} v${result.version}`);
  console.log(`Source: ${result.source}`);
  console.log(`Target: ${result.target}`);
  console.log(`Dependencies: ${result.depsInstalled ? 'installed' : 'skipped'}`);
  console.log('Restart Codex or refresh plugin discovery if the new tools are not visible yet.');
}

async function resolveBundledPluginPath({ sourcePath = null, system = false, exists = pathExists } = {}) {
  const candidates = [];
  if (sourcePath) candidates.push(sourcePath);
  candidates.push(path.join(process.cwd(), PLUGIN_RELATIVE_PATH));
  candidates.push(path.join(REPO_ROOT_FROM_CLI, PLUGIN_RELATIVE_PATH));
  const appDirs = system ? ['/Applications'] : [path.join(homedir(), 'Applications'), '/Applications'];
  for (const appDir of appDirs) {
    candidates.push(path.join(appDir, APP_NAME, 'Contents', 'Resources', PLUGIN_RELATIVE_PATH));
    candidates.push(path.join(appDir, APP_NAME, 'Contents', 'Resources', 'plugins', 'burrete-agent'));
  }
  for (const candidate of uniquePaths(candidates)) {
    if (await exists(path.join(candidate, '.codex-plugin', 'plugin.json'))) {
      return candidate;
    }
  }
  return null;
}

async function readPluginManifest(pluginRoot) {
  const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    fail(`Could not read Burrete plugin manifest at ${manifestPath}. ${error?.message || String(error)}`);
  }
  if (manifest.name !== CODEX_PLUGIN_ID) {
    fail(`Expected plugin id ${CODEX_PLUGIN_ID}, found ${manifest.name || 'unknown'}.`);
  }
  if (!manifest.version) {
    fail(`Plugin manifest at ${manifestPath} does not declare a version.`);
  }
  return manifest;
}

function pluginInstallPath({ cacheDir, namespace, name, version }) {
  return path.join(cacheDir, namespace, name, version);
}

async function findInstalledPlugin({ cacheDir, namespace = null, name }) {
  const roots = namespace ? [path.join(cacheDir, namespace)] : [cacheDir];
  const matches = [];
  for (const root of roots) {
    const queue = [root];
    let visited = 0;
    while (queue.length > 0) {
      const directory = queue.shift();
      visited += 1;
      if (visited > 2000) break;
      const manifest = await readOptionalPluginManifest(directory);
      if (manifest?.name === name) {
        matches.push({
          path: directory,
          namespace: pluginNamespace(cacheDir, directory),
          manifest,
        });
        continue;
      }
      let entries = [];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          queue.push(path.join(directory, entry.name));
        }
      }
    }
  }
  matches.sort((left, right) => compareVersions(right.manifest.version || '0.0.0', left.manifest.version || '0.0.0'));
  return matches[0] || null;
}

async function readOptionalPluginManifest(pluginRoot) {
  try {
    return JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  } catch {
    return null;
  }
}

function pluginNamespace(cacheDir, pluginRoot) {
  const [namespace] = path.relative(cacheDir, pluginRoot).split(path.sep);
  return namespace || DEFAULT_PLUGIN_NAMESPACE;
}

function copyPluginBundle(source, target) {
  return cp(source, target, {
    recursive: true,
    filter: (candidate) => {
      const relative = path.relative(source, candidate);
      return !relative.split(path.sep).includes('.git');
    },
  });
}

async function writePluginInstallMetadata(pluginRoot, metadata) {
  await writeFile(
    path.join(pluginRoot, '.burette-agent-install.json'),
    `${JSON.stringify({ schema: 'burette_agent_install.v1', ...metadata }, null, 2)}\n`,
  );
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map(item => path.resolve(item)))];
}

function registerInstalledApp(targetApp) {
  const quickLookExtension = path.join(targetApp, 'Contents', 'PlugIns', QUICK_LOOK_EXTENSION_NAME);
  run(LSREGISTER, ['-f', '-R', targetApp], 'Installed Burrete, but LaunchServices registration failed.', { allowFailure: true });
  run('/usr/bin/pluginkit', ['-a', quickLookExtension], 'Installed Burrete, but Quick Look extension registration failed.', { allowFailure: true });
  run('/usr/bin/pluginkit', ['-e', 'use', '-i', QUICK_LOOK_EXTENSION_ID], 'Installed Burrete, but Quick Look extension enablement failed.', { allowFailure: true });
  run('/usr/bin/qlmanage', ['-r'], 'Installed Burrete, but Quick Look refresh failed.', { allowFailure: true });
  run('/usr/bin/qlmanage', ['-r', 'cache'], 'Installed Burrete, but Quick Look cache refresh failed.', { allowFailure: true });
  run('/usr/bin/killall', ['quicklookd'], 'Installed Burrete, but quicklookd restart failed.', { allowFailure: true });
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

function parsePluginOptions(args) {
  let sourcePath = null;
  let cacheDir = CODEX_PLUGIN_CACHE;
  let namespace = null;
  let system = false;
  let installDeps = true;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--path') {
      sourcePath = requireOptionValue(args, index, '--path');
      index += 1;
      continue;
    }
    if (arg === '--cache-dir') {
      cacheDir = requireOptionValue(args, index, '--cache-dir');
      index += 1;
      continue;
    }
    if (arg === '--namespace') {
      namespace = requireOptionValue(args, index, '--namespace');
      index += 1;
      continue;
    }
    if (arg === '--system') {
      system = true;
      continue;
    }
    if (arg === '--skip-deps') {
      installDeps = false;
      continue;
    }
    fail(`Unknown plugin option: ${arg}`);
  }
  if (namespace && !/^[a-zA-Z0-9._-]+$/.test(namespace)) {
    fail(`Invalid plugin namespace: ${namespace}`);
  }
  return {
    sourcePath: sourcePath ? path.resolve(sourcePath) : null,
    cacheDir: path.resolve(cacheDir),
    namespace,
    system,
    installDeps,
  };
}

function requireOptionValue(args, index, label) {
  const value = args[index + 1];
  if (!value) {
    fail(`Missing value for ${label}.`);
  }
  return value;
}

export async function fetchLatestRelease(channel) {
  const response = await fetch(RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'burrete-cli-installer',
    },
  });
  if (!response.ok) {
    fail(`Could not fetch latest Burrete release: HTTP ${response.status}`);
  }
  try {
    return selectRelease(await response.json(), channel);
  } catch (error) {
    fail(`Could not select a ${channel} Burrete release: ${error?.message || String(error)}`);
  }
}

export function selectRelease(releases, channel) {
  const release = releases
    .filter(item => item && item.draft !== true)
    .filter(item => channel === 'beta' || item.prerelease !== true)
    .filter(item => item.tag_name && findZipAsset(item, false))
    .sort((left, right) => compareVersions(right.tag_name, left.tag_name))[0];
  if (!release) {
    fail(`Could not find a ${channel} Burrete release with a zip asset.`);
  }
  return release;
}

export function findZipAsset(release, required = true) {
  const asset = release.assets?.find(item => /^Burrete-.+\.zip$/.test(item.name));
  if (!asset && required) {
    fail(`Release ${release.tag_name || 'unknown'} does not include a Burrete zip asset.`);
  }
  return asset || null;
}

async function download(url, targetPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'burrete-cli-installer',
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
  run('/usr/bin/ditto', [sourceApp, stageApp], 'Failed to stage Burrete.app for installation.');
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
      label: 'Burrete app',
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
  console.log('Burrete doctor');
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

function commandOutputText(stdout, stderr) {
  return [stdout, stderr]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join('\n');
}

function logStep(message) {
  console.log(`- ${message}`);
}

function printHelp() {
  console.log(`Burrete installer

Usage:
  burrete install [--system] [--beta|--channel stable|beta]
  burrete latest [--beta|--channel stable|beta]
  burrete doctor [--system]
  burrete plugin install [--path <dir>] [--namespace <name>] [--skip-deps]
  burrete plugin update [--path <dir>] [--namespace <name>] [--skip-deps]
  burrete plugin status [--path <dir>] [--namespace <name>]

Commands:
  install   Download the latest Burrete release and install Burrete.app.
  latest    Print the latest release tag and zip URL.
  doctor    Check app installation, Quick Look extension, qlmanage, and version.
  plugin    Install, update, or inspect the bundled local Codex plugin.

Options:
  --system           Use /Applications instead of ~/Applications for install or doctor.
  --beta             Select the beta update channel.
  --channel <name>   Select stable or beta releases explicitly.

Launch registration:
  For registration-only app launches, use BURRETE_LAUNCH_MODE=register with
  Burrete.app. The installer itself registers LaunchServices and Quick Look
  without launching the full app.
`);
}

function printPluginHelp() {
  console.log(`Burrete Codex plugin

Usage:
  burrete plugin install [--path <dir>] [--namespace <name>] [--skip-deps]
  burrete plugin update [--path <dir>] [--namespace <name>] [--skip-deps]
  burrete plugin status [--path <dir>] [--namespace <name>]

Options:
  --path <dir>        Explicit plugins/burette-agent directory.
  --namespace <name>  Codex plugin cache namespace. Defaults to an existing
                      Burrete namespace, then nikolenko-local.
  --cache-dir <dir>   Override the Codex plugin cache root.
  --skip-deps         Copy the plugin without running npm install.
  --system            Prefer /Applications/Burrete.app when auto-detecting.
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => fail(error?.message || String(error)));
}
