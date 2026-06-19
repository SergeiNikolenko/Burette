#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open as openFile, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const agentPreviewScript = resolve(__dirname, 'agent-preview.mjs');
const apiVersion = 'burette-agent-cli/v1';
const supportedModes = new Set(['browser-preview', 'browser-dev-shell', 'desktop-app']);

function usage() {
  console.error(`Usage:
  node scripts/burrete-agent.mjs open --mode browser-preview <file> [--port 5177] [--host 127.0.0.1]
  node scripts/burrete-agent.mjs open --mode browser-dev-shell <file> [--host 127.0.0.1]
  node scripts/burrete-agent.mjs open --mode desktop-app <file> [--app Burrete] [--session-dir /tmp/session] [--no-launch]
  node scripts/burrete-agent.mjs observe --url <tokenized-preview-url>
  node scripts/burrete-agent.mjs observe --session-dir <desktop-agent-session>
  node scripts/burrete-agent.mjs act --url <tokenized-preview-url> '<json-action>' [--wait-ms 5000]
  node scripts/burrete-agent.mjs act --session-dir <desktop-agent-session> '<json-action>' [--wait-ms 5000]
  node scripts/burrete-agent.mjs render-panel --session-dir <desktop-agent-session> --kind markdown --file /tmp/notes.md [--area right]

The CLI is the readable Burrete agent contract. Browser-preview mode uses a
tokenized localhost server. Desktop app mode uses an explicit file-backed local
session directory passed to the app at launch.`);
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
  const mode = options.mode || 'browser-preview';
  if (!supportedModes.has(mode)) fail('INVALID_ARGS', `Unsupported mode: ${mode}.`, 2);
  const file = options.rest[0];
  if (!file) fail('INVALID_ARGS', 'open requires a structure file path.', 2);
  if (mode === 'desktop-app') {
    await openDesktopApp(file, options);
    return;
  }
  if (mode === 'browser-dev-shell') {
    await openBrowserDevShell(file, options);
    return;
  }

  const childArgs = [agentPreviewScript, file];
  if (options.port) childArgs.push('--port', options.port);
  if (options.host) childArgs.push('--host', options.host);
  const child = spawn(process.execPath, childArgs, {
    cwd: repoRoot,
    stdio: 'inherit'
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

async function openBrowserDevShell(file, options) {
  const initialFile = resolve(file);
  const sessionDir = options.sessionDir ? resolve(options.sessionDir) : await mkdtemp(resolve(tmpdir(), 'burrete-agent-shell-'));
  const token = randomUUID();
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
  const host = options.host || '127.0.0.1';
  const port = options.port ? Number(options.port) : await allocatePort(host);
  if (!Number.isInteger(port) || port <= 0) fail('INVALID_ARGS', '--port must be a positive integer.', 2);
  const url = new URL(`http://${host}:${port}/`);
  url.searchParams.set('devFiles', initialFile);
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
  const agentComponentsDir = resolve(tmpdir(), 'burrete-agent-components');
  const env = {
    ...process.env,
    BURRETE_DEV_DEFAULT_FILES: initialFile,
    BURRETE_DEV_FS_ALLOW: [dirname(initialFile), agentComponentsDir].join(delimiter),
    BURRETE_AGENT_SHELL_SESSION_DIR: sessionDir,
    VITE_BURRETE_AGENT_SHELL: '1',
    VITE_BURRETE_BUILD_IDENTIFIER: 'browser-agent-shell',
    VITE_BURETTE_DEV_INSTANCE: 'agent',
  };
  const logPath = resolve(sessionDir, 'server.log');
  const logHandle = await openFile(logPath, 'a');
  const child = spawn('vp', ['dev', 'apps/desktop', '--host', host, '--port', String(port), '--strictPort', '--config', 'apps/desktop/vite.config.ts'], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ['ignore', logHandle.fd, logHandle.fd],
  });
  child.unref();
  await logHandle.close();
  child.on('error', (error) => {
    fail('BROWSER_DEV_SHELL_FAILED', `Failed to start browser-dev shell: ${error?.message || String(error)}.`, 1);
  });
  await waitForHttpReady(url, 30000);
  console.log(JSON.stringify({
    ok: true,
    apiVersion,
    result: {
      mode: 'browser-dev-shell',
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

async function allocatePort(host) {
  const server = createServer();
  await new Promise((resolveReady, rejectReady) => {
    server.once('error', rejectReady);
    server.listen(0, host, resolveReady);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise(resolveClose => server.close(resolveClose));
  if (!port) fail('PORT_UNAVAILABLE', 'Could not allocate a browser-dev shell port.', 1);
  return port;
}

async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // Vite is still booting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  fail('BROWSER_DEV_SHELL_TIMEOUT', `Timed out waiting for browser-dev shell at ${url}.`, 1);
}

async function observe(options) {
  if (options.sessionDir) {
    await observeDesktopSession(options);
    return;
  }
  if (!options.url) fail('INVALID_ARGS', 'observe requires --url with the tokenized browser-preview URL.', 2);
  const shellSessionDir = await browserShellSessionDir(options.url);
  if (shellSessionDir) {
    await observeDesktopSession({ ...options, sessionDir: shellSessionDir });
    return;
  }
  const response = await fetch(buildAgentUrl(options.url, '/__agent/observe'));
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
  const shellSessionDir = await browserShellSessionDir(options.url);
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
  const response = await fetch(buildAgentUrl(options.url, '/__agent/act'), {
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
  const observed = await waitForAction(options.url, parsed.action.id, waitMs);
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
  const item = {
    id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    action,
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
  try {
    await fetchWithTimeout(session.url, 1500);
  } catch (error) {
    fail('BROWSER_DEV_SHELL_UNAVAILABLE', `Browser-dev shell is not reachable at ${session.url}. Reopen the workspace instead of waiting for an action timeout.`, 1, { sessionDir, cause: error?.message || String(error) });
  }
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
