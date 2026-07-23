#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open as openFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const agentPreviewScript = resolve(__dirname, 'agent-preview.mjs');
const agentShellServerScript = resolve(__dirname, 'agent-shell-server.mjs');
const agentShellDistDir = process.env.BURRETE_AGENT_SHELL_DIST_DIR
  ? resolve(process.env.BURRETE_AGENT_SHELL_DIST_DIR)
  : defaultAgentShellDistDir();
const browserDevGeneratedFilesRoot = process.env.BURRETE_BROWSER_DEV_GENERATED_FILES_ROOT
  ? resolve(process.env.BURRETE_BROWSER_DEV_GENERATED_FILES_ROOT)
  : resolve(homedir(), 'Desktop', 'Burrete Generated Files');
const apiVersion = 'burette-agent-cli/v1';
const supportedModes = new Set(['auto', 'browser-preview', 'browser-agent-shell', 'browser-dev-shell', 'desktop-app']);

function usage() {
  console.error(`Usage:
  node scripts/burrete-agent.mjs open --mode auto <file> [--host 127.0.0.1]
  node scripts/burrete-agent.mjs open --mode browser-preview <file> [--port 5177] [--host 127.0.0.1]
  node scripts/burrete-agent.mjs open --mode browser-agent-shell <file> [--host 127.0.0.1]
  node scripts/burrete-agent.mjs open --mode desktop-app <file> [--app Burrete] [--session-dir /tmp/session] [--no-launch]
  node scripts/burrete-agent.mjs observe --url <tokenized-preview-url>
  node scripts/burrete-agent.mjs observe --session-dir <desktop-agent-session>
  node scripts/burrete-agent.mjs act --url <tokenized-preview-url> '<json-action>' [--wait-ms 5000]
  node scripts/burrete-agent.mjs act --session-dir <desktop-agent-session> '<json-action>' [--wait-ms 5000]
  node scripts/burrete-agent.mjs render-panel --session-dir <desktop-agent-session> --kind markdown --file /tmp/notes.md [--area right]

The CLI is the readable Burrete agent contract. Auto mode starts the full
browser-agent-shell when available and falls back to browser-preview when the
shell cannot start. Browser-preview mode uses a tokenized localhost server.
Browser-agent-shell mode starts an agent-owned full Browser workspace shell.
Desktop app mode uses an explicit file-backed local session directory passed to
the app at launch.`);
}

function parseOptions(args) {
  const out = { rest: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--mode') {
      out.mode = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--port') {
      out.port = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--host') {
      out.host = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--url') {
      out.url = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--session-dir') {
      out.sessionDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--app') {
      out.app = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--kind') {
      out.kind = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--scene') {
      out.scene = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--file') {
      out.file = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--area') {
      out.area = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--wait-ms') {
      out.waitMs = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--no-launch') {
      out.noLaunch = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    out.rest.push(arg);
  }
  return out;
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value) fail('INVALID_ARGS', `Missing value for ${flag}.`, 2);
  return value;
}

function fail(code, message, exitCode = 1, details) {
  console.error(JSON.stringify({
    ok: false,
    apiVersion,
    error: { code, message, details }
  }, null, 2));
  process.exit(exitCode);
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (command === 'help' || options.help) {
    usage();
    return;
  }
  if (command === 'open') {
    await open(options);
    return;
  }
  if (command === 'observe') {
    await observe(options);
    return;
  }
  if (command === 'act') {
    await act(options);
    return;
  }
  if (command === 'render-panel') {
    await renderPanel(options);
    return;
  }
  fail('UNKNOWN_COMMAND', `Unknown command: ${command}.`, 2);
}

async function open(options) {
  const mode = canonicalMode(options.mode || 'browser-preview');
  if (!supportedModes.has(mode)) fail('INVALID_ARGS', `Unsupported mode: ${mode}.`, 2);
  const file = options.rest[0];
  if (!file) fail('INVALID_ARGS', 'open requires a structure file path.', 2);
  if (mode === 'auto') {
    await openAuto(file, options);
    return;
  }
  if (mode === 'desktop-app') {
    await openDesktopApp(file, options);
    return;
  }
  if (mode === 'browser-agent-shell') {
    await openBrowserAgentShell(file, options);
    return;
  }

  await openBrowserPreview(file, options);
}

async function openAuto(file, options) {
  try {
    await openBrowserAgentShell(file, { ...options, recover: true });
  } catch (error) {
    if (!error?.burreteAgentError) throw error;
    await openBrowserPreview(file, options, {
      from: 'browser-agent-shell',
      reason: errorPayload(error),
    });
  }
}

async function openBrowserPreview(file, options, fallback = null) {
  const initialFile = resolve(file);
  const host = requireLocalHost(options.host);
  const port = options.port ? Number(options.port) : await allocatePort(host);
  if (!Number.isInteger(port) || port <= 0) fail('INVALID_ARGS', '--port must be a positive integer.', 2);
  const token = randomUUID();
  const url = `http://${hostForUrl(host)}:${port}/index.html?token=${encodeURIComponent(token)}`;
  const sessionDir = options.sessionDir ? resolve(options.sessionDir) : await mkdtemp(resolve(tmpdir(), 'burrete-agent-preview-'));
  await mkdir(sessionDir, { recursive: true });
  const logPath = resolve(sessionDir, 'server.log');
  const logHandle = await openFile(logPath, 'a');
  let childExit = null;
  const childArgs = [agentPreviewScript, initialFile, '--host', host, '--port', String(port), '--token', token];
  const child = spawn(process.execPath, childArgs, {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', logHandle.fd, logHandle.fd]
  });
  await logHandle.close();
  child.once('error', (error) => {
    childExit = { error };
  });
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
  });
  try {
    await waitForHttpReady(new URL(`http://${host}:${port}/healthz`), 10000, {
      childExit: () => childExit || (child.exitCode !== null || child.signalCode ? { code: child.exitCode, signal: child.signalCode } : null),
      logPath,
      failureCode: 'BROWSER_PREVIEW_FAILED',
      timeoutCode: 'BROWSER_PREVIEW_TIMEOUT',
      label: 'Browser preview',
    });
  } catch (error) {
    if (error?.burreteAgentError) fail(error.code, error.message, 1, error.details);
    throw error;
  }
  child.unref();
  console.log(JSON.stringify({
    ok: true,
    apiVersion,
    result: {
      mode: 'browser-preview',
      transport: 'http-local-token',
      url,
      token,
      host,
      port,
      launched: false,
      sessionDir,
      logPath,
      initialPaths: [initialFile],
      processId: child.pid,
      fallback,
    },
  }, null, 2));
}

function canonicalMode(mode) {
  return mode === 'browser-dev-shell' ? 'browser-agent-shell' : mode;
}

const SCENE_STRUCTURE_EXTENSIONS = new Set([
  'pdb', 'ent', 'pdbqt', 'pqr', 'xpdb',
  'cif', 'mmcif', 'mcif', 'bcif', 'mmtf',
  'sdf', 'sd', 'mol', 'mol2', 'xyz', 'gro',
]);

function sceneModeOption(options) {
  const mode = String(options.scene ?? '').trim();
  if (!mode) return null;
  if (mode === 'structureAll' || mode === 'structurePoses') return mode;
  fail('INVALID_ARGS', '--scene must be structureAll or structurePoses.', 2);
  return null;
}

const SCENE_MAX_FILES = 64;

async function sceneFilesFor(target, options) {
  const info = await stat(target).catch(() => null);
  if (info?.isDirectory()) {
    const names = await readdir(target);
    const files = names
      .filter(name => SCENE_STRUCTURE_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() ?? ''))
      .sort()
      .map(name => resolve(target, name));
    if (files.length < 2) fail('INVALID_ARGS', `--scene needs at least two structure files in ${target}.`, 2);
    if (files.length > SCENE_MAX_FILES) fail('INVALID_ARGS', `--scene folder holds ${files.length} structure files; the limit is ${SCENE_MAX_FILES}. Point --scene at a smaller folder or pass an explicit file list.`, 2);
    return files;
  }
  const files = options.rest.map(path => resolve(path));
  if (files.length < 2) fail('INVALID_ARGS', '--scene needs a folder or at least two structure files.', 2);
  if (files.length > SCENE_MAX_FILES) fail('INVALID_ARGS', `--scene received ${files.length} files; the limit is ${SCENE_MAX_FILES}.`, 2);
  return files;
}

async function openBrowserAgentShell(file, options) {
  const sceneMode = sceneModeOption(options);
  const sceneFiles = sceneMode ? await sceneFilesFor(resolve(file), options) : null;
  const initialFile = sceneFiles ? sceneFiles[0] : resolve(file);
  const sessionDir = options.sessionDir ? resolve(options.sessionDir) : await mkdtemp(resolve(tmpdir(), 'burrete-agent-shell-'));
  const token = randomUUID();
  if (options.sessionDir) await assertBrowserSessionDirectoryAvailable(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await writeJsonFile(resolve(sessionDir, 'session.json'), {
    apiVersion,
    mode: 'browser-dev-shell',
    token,
    createdAt: new Date().toISOString(),
    initialPaths: [initialFile],
  });
  await writeJsonFile(resolve(sessionDir, 'actions.json'), {
    apiVersion: 'burette-agent-control/v1',
    actions: [],
  });
  const host = requireLocalHost(options.host);
  const port = options.port ? Number(options.port) : await allocatePort(host);
  if (!Number.isInteger(port) || port <= 0) fail('INVALID_ARGS', '--port must be a positive integer.', 2);
  const url = new URL(`http://${hostForUrl(host)}:${port}/`);
  if (sceneFiles) {
    url.searchParams.set('devDocking', sceneFiles.join('\n'));
    url.searchParams.set('devScene', sceneMode);
  } else {
    url.searchParams.set('devFiles', initialFile);
  }
  url.searchParams.set('agentLayout', 'focus');
  await writeJsonFile(resolve(sessionDir, 'session.json'), {
    apiVersion,
    mode: 'browser-dev-shell',
    token,
    createdAt: new Date().toISOString(),
    initialPaths: [initialFile],
    sessionDir,
    host,
    port,
    url: url.toString(),
  });
  const env = {
    ...process.env,
    BURRETE_DEV_DEFAULT_FILES: initialFile,
    BURRETE_DEV_FS_ALLOW: browserDevFsAllowRoots(initialFile, sceneFiles ?? []).join(delimiter),
    BURRETE_BROWSER_DEV_GENERATED_FILES_ROOT: browserDevGeneratedFilesRoot,
    BURRETE_AGENT_SHELL_SESSION_DIR: sessionDir,
    VITE_BURRETE_AGENT_SHELL: '1',
    VITE_BURRETE_BUILD_IDENTIFIER: 'browser-agent-shell',
    VITE_BURETTE_DEV_INSTANCE: 'agent',
  };
  const logPath = resolve(sessionDir, 'server.log');
  if (hasPrebuiltAgentShell() && process.env.BURRETE_AGENT_SHELL_FORCE_VP !== '1') {
    await openPrebuiltBrowserAgentShell({
      initialFile,
      sceneFiles,
      sessionDir,
      host,
      port,
      url,
      logPath,
      options,
    });
    return;
  }
  const logHandle = await openFile(logPath, 'a');
  let childExit = null;
  const child = spawn('vp', ['dev', 'apps/desktop', '--host', host, '--port', String(port), '--strictPort', '--config', 'apps/desktop/vite.config.ts'], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ['ignore', logHandle.fd, logHandle.fd],
  });
  await logHandle.close();
  child.once('error', (error) => {
    childExit = { error };
  });
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
  });
  try {
    await waitForHttpReady(url, 30000, {
      childExit: () => childExit || (child.exitCode !== null || child.signalCode ? { code: child.exitCode, signal: child.signalCode } : null),
      logPath,
      failureCode: 'BROWSER_AGENT_SHELL_FAILED',
      timeoutCode: 'BROWSER_AGENT_SHELL_TIMEOUT',
      label: 'Browser agent shell',
    });
  } catch (error) {
    if (options.recover && error?.burreteAgentError) throw error;
    if (error?.burreteAgentError) fail(error.code, error.message, 1, error.details);
    throw error;
  }
  child.unref();
  console.log(JSON.stringify({
    ok: true,
    apiVersion,
    result: {
      mode: 'browser-agent-shell',
      legacyMode: 'browser-dev-shell',
      runtime: 'vite-dev',
      url: url.toString(),
      host,
      port,
      launched: false,
      sessionDir,
      logPath,
      initialPaths: [initialFile],
      processId: child.pid,
      browser: 'Codex in-app Browser',
      observe: `node scripts/burrete-agent.mjs observe --session-dir ${JSON.stringify(sessionDir)}`,
      act: `node scripts/burrete-agent.mjs act --session-dir ${JSON.stringify(sessionDir)} '<json-action>'`,
    },
  }, null, 2));
}

function hasPrebuiltAgentShell() {
  return existsSync(resolve(agentShellDistDir, 'index.html')) && existsSync(agentShellServerScript);
}

function defaultAgentShellDistDir() {
  const pluginDist = resolve(repoRoot, 'browser-shell-dist');
  if (existsSync(resolve(pluginDist, 'index.html'))) return pluginDist;
  return resolve(repoRoot, 'apps/desktop/dist');
}

async function openPrebuiltBrowserAgentShell({ initialFile, sceneFiles, sessionDir, host, port, url, logPath, options }) {
  const logHandle = await openFile(logPath, 'a');
  let childExit = null;
  const child = spawn(process.execPath, [
    agentShellServerScript,
    '--dist', agentShellDistDir,
    '--session-dir', sessionDir,
    ...browserDevFsAllowRoots(initialFile, sceneFiles ?? []).flatMap((root) => ['--allow', root]),
    '--host', host,
    '--port', String(port),
  ], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', logHandle.fd, logHandle.fd],
  });
  await logHandle.close();
  child.once('error', (error) => {
    childExit = { error };
  });
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
  });
  try {
    await waitForHttpReady(url, 10000, {
      childExit: () => childExit,
      logPath,
      failureCode: 'BROWSER_AGENT_SHELL_FAILED',
      timeoutCode: 'BROWSER_AGENT_SHELL_TIMEOUT',
      label: 'Browser agent shell',
    });
  } catch (error) {
    if (options.recover && error?.burreteAgentError) throw error;
    if (error?.burreteAgentError) fail(error.code, error.message, 1, error.details);
    throw error;
  }
  child.unref();
  console.log(JSON.stringify({
    ok: true,
    apiVersion,
    result: {
      mode: 'browser-agent-shell',
      legacyMode: 'browser-dev-shell',
      runtime: 'prebuilt-static',
      url: url.toString(),
      host,
      port,
      launched: false,
      sessionDir,
      logPath,
      initialPaths: [initialFile],
      processId: child.pid,
      browser: 'Codex in-app Browser',
      observe: `node scripts/burrete-agent.mjs observe --session-dir ${JSON.stringify(sessionDir)}`,
      act: `node scripts/burrete-agent.mjs act --session-dir ${JSON.stringify(sessionDir)} '<json-action>'`,
    },
  }, null, 2));
}

function browserDevFsAllowRoots(initialFile, extraFiles = []) {
  const explicitRoots = (process.env.BURRETE_DEV_FS_ALLOW ?? "").split(delimiter).filter(Boolean);
  const fileRoots = [initialFile, ...extraFiles].filter(Boolean).map(path => dirname(path));
  const roots = explicitRoots.length > 0 ? explicitRoots : fileRoots;
  return Array.from(new Set([...roots, browserDevGeneratedFilesRoot]));
}

async function allocatePort(host) {
  const server = createServer();
  await new Promise((resolveReady, rejectReady) => {
    server.once('error', rejectReady);
    server.listen(0, host, resolveReady);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise(resolveClose => server.close(resolveClose));
  if (!port) fail('PORT_UNAVAILABLE', 'Could not allocate a browser agent shell port.', 1);
  return port;
}

async function waitForHttpReady(url, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const childExit = options.childExit?.();
    if (childExit) {
      const logTail = await readLogTail(options.logPath);
      const cause = childExit.error
        ? { message: childExit.error?.message || String(childExit.error) }
        : { code: childExit.code, signal: childExit.signal };
      throw agentError(
        options.failureCode || 'BROWSER_PROCESS_FAILED',
        `${options.label || 'Browser process'} exited before ${url} became ready.`,
        { url: url.toString(), logPath: options.logPath, logTail, cause },
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // Vite is still booting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw agentError(
    options.timeoutCode || 'BROWSER_PROCESS_TIMEOUT',
    `Timed out waiting for ${options.label || 'browser process'} at ${url}.`,
    { url: url.toString(), logPath: options.logPath, logTail: await readLogTail(options.logPath) },
  );
}

function agentError(code, message, details = null) {
  const error = new Error(message);
  error.burreteAgentError = true;
  error.code = code;
  error.details = details;
  return error;
}

function errorPayload(error) {
  return {
    code: error?.code || 'BROWSER_PROCESS_FAILED',
    message: error?.message || String(error),
    details: error?.details || null,
  };
}

async function readLogTail(logPath) {
  if (!logPath) return null;
  try {
    const text = await readFile(logPath, 'utf8');
    return text.split(/\r?\n/u).slice(-80).join('\n');
  } catch (error) {
    return `Could not read log file ${logPath}: ${error?.message || String(error)}`;
  }
}

async function observe(options) {
  if (options.sessionDir) {
    await observeDesktopSession(options);
    return;
  }
  if (!options.url) fail('INVALID_ARGS', 'observe requires --url with the tokenized browser-preview URL.', 2);
  const localUrl = requireLocalAgentUrl(options.url, 'INVALID_URL');
  const shellSessionDir = await browserShellSessionDir(localUrl.toString());
  if (shellSessionDir) {
    await observeDesktopSession({ ...options, sessionDir: shellSessionDir });
    return;
  }
  const response = await fetch(buildAgentUrl(localUrl, '/__agent/observe'));
  const body = await response.text();
  if (!response.ok) {
    fail('OBSERVE_FAILED', `Observe request failed with HTTP ${response.status}.`, 1, body);
  }
  try {
    const parsed = JSON.parse(body);
    console.log(JSON.stringify({
      ok: true,
      apiVersion,
      result: parsed
    }, null, 2));
  } catch (error) {
    fail('INVALID_RESPONSE', 'Observe response was not JSON.', 1, { message: error?.message, body });
  }
}

async function act(options) {
  if (options.sessionDir) {
    await actDesktopSession(options);
    return;
  }
  if (!options.url) fail('INVALID_ARGS', 'act requires --url with the tokenized browser-preview URL.', 2);
  const localUrl = requireLocalAgentUrl(options.url, 'INVALID_URL');
  const shellSessionDir = await browserShellSessionDir(localUrl.toString());
  if (shellSessionDir) {
    await actDesktopSession({ ...options, sessionDir: shellSessionDir });
    return;
  }
  const actionText = options.rest[0];
  if (!actionText) fail('INVALID_ARGS', 'act requires a JSON action argument.', 2);
  let action;
  try {
    action = JSON.parse(actionText);
  } catch (error) {
    fail('INVALID_ARGS', `Action is not valid JSON: ${error?.message || String(error)}.`, 2);
  }
  const response = await fetch(buildAgentUrl(localUrl, '/__agent/act'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action)
  });
  const body = await response.text();
  if (!response.ok) {
    fail('ACT_FAILED', `Action request failed with HTTP ${response.status}.`, 1, body);
  }
  const parsed = parseJsonBody(body, 'Action response was not JSON.');
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 0;
  if (!waitMs || !parsed.action?.id) {
    console.log(JSON.stringify({ ok: true, apiVersion, result: parsed }, null, 2));
    return;
  }
  const observed = await waitForAction(localUrl, parsed.action.id, waitMs);
  console.log(JSON.stringify({ ok: true, apiVersion, result: observed }, null, 2));
}

async function renderPanel(options) {
  if (!options.kind) fail('INVALID_ARGS', 'render-panel requires --kind markdown, table, or chart.', 2);
  if (!['markdown', 'table', 'chart'].includes(String(options.kind))) {
    fail('INVALID_ARGS', 'render-panel --kind must be markdown, table, or chart.', 2);
  }
  if (!options.file) fail('INVALID_ARGS', 'render-panel requires --file.', 2);
  if (options.area && !['right', 'bottom'].includes(String(options.area))) {
    fail('INVALID_ARGS', 'render-panel --area must be right or bottom.', 2);
  }
  options.rest = [JSON.stringify({
    type: 'render_panel',
    kind: options.kind,
    file: resolve(options.file),
    area: options.area || 'right'
  })];
  await act(options);
}

async function openDesktopApp(file, options) {
  const sessionDir = options.sessionDir ? resolve(options.sessionDir) : await mkdtemp(resolve(tmpdir(), 'burrete-agent-'));
  await mkdir(sessionDir, { recursive: true });
  const token = randomUUID();
  await writeJsonFile(resolve(sessionDir, 'session.json'), {
    apiVersion,
    mode: 'desktop-app',
    token,
    createdAt: new Date().toISOString(),
    initialPaths: [resolve(file)]
  });
  await writeJsonFile(resolve(sessionDir, 'actions.json'), {
    apiVersion: 'burette-agent-control/v1',
    actions: []
  });
  if (!options.noLaunch) {
    const app = options.app || 'Burrete';
    const child = spawn('open', desktopOpenArgs(app, sessionDir, resolve(file)), {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  }
  console.log(JSON.stringify({
    ok: true,
    apiVersion,
    result: {
      mode: 'desktop-app',
      sessionDir,
      launched: !options.noLaunch,
      initialPaths: [resolve(file)],
      observe: `node scripts/burrete-agent.mjs observe --session-dir ${JSON.stringify(sessionDir)}`,
      act: `node scripts/burrete-agent.mjs act --session-dir ${JSON.stringify(sessionDir)} '<json-action>'`
    }
  }, null, 2));
}

function desktopOpenArgs(app, sessionDir, file) {
  const agentArgs = ['--args', '--burrete-agent-session', sessionDir, file];
  if (String(app).includes('/') || String(app).endsWith('.app')) {
    return ['-n', app, ...agentArgs];
  }
  return ['-n', '-a', app, ...agentArgs];
}

async function observeDesktopSession(options) {
  const observed = await readJsonFile(resolve(options.sessionDir, 'observe.json'), null);
  if (!observed) {
    fail('OBSERVE_UNAVAILABLE', 'Desktop app has not reported observe.json for this session yet.', 1);
  }
  console.log(JSON.stringify({
    ok: true,
    apiVersion,
    result: observed
  }, null, 2));
}

async function actDesktopSession(options) {
  await assertSessionResponsive(options.sessionDir);
  const actionText = options.rest[0];
  if (!actionText) fail('INVALID_ARGS', 'act requires a JSON action argument.', 2);
  let action;
  try {
    action = JSON.parse(actionText);
  } catch (error) {
    fail('INVALID_ARGS', `Action is not valid JSON: ${error?.message || String(error)}.`, 2);
  }
  const actionsPath = resolve(options.sessionDir, 'actions.json');
  const actionsFile = await readJsonFile(actionsPath, { apiVersion: 'burette-agent-control/v1', actions: [] });
  const itemId = `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const item = {
    id: itemId,
    action: action?.type === 'control_ketcher' && !action.actionId
      ? { ...action, actionId: itemId }
      : action,
    status: 'queued',
    createdAt: new Date().toISOString()
  };
  const actions = Array.isArray(actionsFile.actions) ? actionsFile.actions : [];
  actions.push(item);
  await writeJsonFile(actionsPath, { apiVersion: 'burette-agent-control/v1', actions });
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 0;
  if (!waitMs) {
    console.log(JSON.stringify({ ok: true, apiVersion, result: { ok: true, action: publicDesktopAction(item) } }, null, 2));
    return;
  }
  const result = await waitForDesktopAction(actionsPath, item.id, waitMs);
  console.log(JSON.stringify({ ok: true, apiVersion, result }, null, 2));
}

async function assertSessionResponsive(sessionDir) {
  const session = await readJsonFile(resolve(sessionDir, 'session.json'), null);
  if (!session || session.mode !== 'browser-dev-shell' || typeof session.url !== 'string') return;
  const sessionUrl = requireLocalAgentUrl(session.url, 'INVALID_SESSION_URL', { sessionDir });
  try {
    await fetchWithTimeout(sessionUrl, 1500);
  } catch (error) {
    fail('BROWSER_AGENT_SHELL_UNAVAILABLE', `Browser agent shell is not reachable at ${session.url}. Reopen the workspace instead of waiting for an action timeout.`, 1, { sessionDir, cause: error?.message || String(error) });
  }
}

async function assertBrowserSessionDirectoryAvailable(sessionDir) {
  const session = await readJsonFile(resolve(sessionDir, 'session.json'), null);
  if (!session || session.mode !== 'browser-dev-shell' || typeof session.url !== 'string') return;
  const sessionUrl = requireLocalAgentUrl(session.url, 'INVALID_SESSION_URL', { sessionDir });
  let response;
  try {
    response = await fetchWithTimeout(new URL('/healthz', sessionUrl).toString(), 1500);
  } catch (_) {
    return;
  }
  if (!response.ok) return;
  fail(
    'SESSION_IN_USE',
    `Browser agent session directory is already owned by a live workspace at ${session.url}. Use its URL/sessionDir or open a new workspace without reusing --session-dir.`,
    1,
    { sessionDir, url: session.url },
  );
}

function requireLocalAgentUrl(value, code, details = null) {
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    fail(code, `Burrete agent URL is invalid: ${String(value)}.`, 1, details);
  }
  const port = Number.parseInt(url.port, 10);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname.toLowerCase()) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    fail(code, 'Burrete agent URLs must use http://127.0.0.1:<port>, http://localhost:<port>, or http://[::1]:<port>.', 1, {
      ...details,
      url: url.toString(),
    });
  }
  return url;
}

function requireLocalHost(value) {
  const host = String(value || '127.0.0.1').trim().toLowerCase();
  if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    return host === '[::1]' ? '::1' : host;
  }
  fail('INVALID_HOST', '--host must be 127.0.0.1, localhost, or ::1 for a local Burrete agent workspace.', 2, { host });
}

function hostForUrl(host) {
  return host.includes(':') ? `[${host}]` : host;
}

async function browserShellSessionDir(urlText) {
  if (!urlText) return null;
  let url;
  try {
    url = new URL(urlText);
  } catch (_) {
    return null;
  }
  if (url.searchParams.has('token')) return null;
  try {
    const sessionUrl = new URL('/__burette/agent-session/session.json', url);
    const response = await fetchWithTimeout(sessionUrl.toString(), 1500);
    if (!response.ok) return null;
    const session = await response.json();
    return typeof session?.sessionDir === 'string' && session.sessionDir.trim() ? session.sessionDir : null;
  } catch (_) {
    return null;
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForDesktopAction(actionsPath, actionId, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    const actionsFile = await readJsonFile(actionsPath, { actions: [] });
    const action = (Array.isArray(actionsFile.actions) ? actionsFile.actions : []).find(item => item.id === actionId);
    if (action && ['completed', 'failed'].includes(action.status)) {
      return { ok: action.status === 'completed', action: publicDesktopAction(action) };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  fail('ACTION_TIMEOUT', `Timed out waiting for action ${actionId}.`, 1);
}

function publicDesktopAction(action) {
  return {
    id: action.id,
    type: action.action?.type || null,
    status: action.status,
    createdAt: action.createdAt || null,
    dispatchedAt: action.dispatchedAt || null,
    completedAt: action.completedAt || null,
    result: action.result || null
  };
}

async function waitForAction(url, actionId, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    const response = await fetch(buildAgentUrl(url, '/__agent/observe'));
    const body = await response.text();
    if (!response.ok) {
      fail('OBSERVE_FAILED', `Observe request failed with HTTP ${response.status}.`, 1, body);
    }
    const observed = parseJsonBody(body, 'Observe response was not JSON.');
    const action = (observed.actions?.recent || []).find(item => item.id === actionId) || observed.actions?.last;
    if (action?.id === actionId && ['completed', 'failed'].includes(action.status)) {
      return observed;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  fail('ACTION_TIMEOUT', `Timed out waiting for action ${actionId}.`, 1);
}

function parseJsonBody(body, message) {
  try {
    return JSON.parse(body);
  } catch (error) {
    fail('INVALID_RESPONSE', message, 1, { message: error?.message, body });
  }
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    fail('READ_FAILED', `${path}: ${error?.message || String(error)}`, 1);
  }
}

async function writeJsonFile(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function buildAgentUrl(input, pathname) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch (error) {
    fail('INVALID_ARGS', `Invalid --url value: ${error?.message || String(error)}.`, 2);
  }
  const token = parsed.searchParams.get('token');
  parsed.pathname = pathname;
  parsed.search = '';
  if (token) parsed.searchParams.set('token', token);
  return parsed;
}

main().catch(error => {
  fail('UNHANDLED_ERROR', error?.message || String(error), 1, error?.stack);
});
