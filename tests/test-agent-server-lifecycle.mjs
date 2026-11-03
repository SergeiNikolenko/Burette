#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeAgentServer, startAgentServer, stopAgentServer } from '../scripts/agent-server-process.mjs';

const root = await mkdtemp(join(tmpdir(), 'burette-server-lifecycle-'));
const fixture = join(root, 'server.mjs');
const managerUrl = pathToFileURL(resolve('scripts/agent-server-process.mjs')).href;
const idleUrl = pathToFileURL(resolve('scripts/agent-server-idle.mjs')).href;
const children = [];
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const alive = pid => {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
async function waitFor(check, message) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(25);
  }
  assert.fail(message);
}
const json = path => readFile(path, 'utf8').then(JSON.parse);
async function request(url) {
  return new Promise((resolveRequest, reject) => {
    get(url, { agent: false }, response => {
      response.resume();
      response.on('end', () => resolveRequest(response.statusCode));
    }).on('error', reject);
  });
}
async function launch(name, { idle = false, release = true } = {}) {
  const sessionDir = join(root, name);
  await mkdir(sessionDir);
  const readyPath = join(sessionDir, 'ready.json');
  const child = await startAgentServer(process.execPath, [fixture], {
    cwd: root,
    env: { ...process.env, READY_PATH: readyPath, TEST_IDLE: idle ? '1' : '0' },
    logPath: join(sessionDir, 'server.log'), sessionDir, idleTimeoutMs: idle ? 250 : 600000,
  });
  children.push(child);
  let ready;
  await waitFor(async () => {
    ready = await json(readyPath).catch(() => null);
    return ready;
  }, `${name} failed to listen: ${await readFile(join(sessionDir, 'server.log'), 'utf8')}`);
  if (release) child.release();
  return { child, sessionDir, ...ready };
}
async function assertStopped(server) {
  await waitFor(() => !alive(server.child.pid) && !alive(server.pid) && !alive(server.grandchildPid),
    'Supervisor, server, and grandchild must all exit');
  await assert.rejects(request(server.url));
}

const unrelated = createServer((_req, res) => res.end('unrelated'));
await new Promise(resolveListen => unrelated.listen(0, '127.0.0.1', resolveListen));
const unrelatedUrl = `http://127.0.0.1:${unrelated.address().port}`;
try {
  await writeFile(fixture, `
    import { spawn } from 'node:child_process';
    import { createHash } from 'node:crypto';
    import { createServer } from 'node:http';
    import { writeFile } from 'node:fs/promises';
    const grandchild = spawn(process.execPath, ['-e',
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
    const server = createServer((req, res) => {
      if (req.url === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: connected\\n\\n');
      } else {
        res.end('ready');
        if (req.url === '/exit') setTimeout(() => process.exit(0), 30);
      }
    });
    server.on('upgrade', (req, socket) => {
      const accept = createHash('sha1').update(req.headers['sec-websocket-key'] +
        '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\n' +
        'Connection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
      socket.on('end', () => socket.end());
      socket.on('error', () => {});
    });
    if (process.env.TEST_IDLE === '1') {
      const { installAgentServerIdleTimeout } = await import(${JSON.stringify(idleUrl)});
      installAgentServerIdleTimeout(server);
    }
    server.listen(0, '127.0.0.1', async () => {
      await writeFile(process.env.READY_PATH, JSON.stringify({ pid: process.pid,
        grandchildPid: grandchild.pid, url: 'http://127.0.0.1:' + server.address().port }));
    });
  `);

  const explicit = await launch('explicit');
  assert.equal(await request(explicit.url), 200);
  assert.deepEqual(await closeAgentServer(explicit.sessionDir), { closed: true, alreadyStopped: false });
  await assertStopped(explicit);
  assert.deepEqual(await closeAgentServer(explicit.sessionDir), { closed: false, alreadyStopped: true });
  assert.equal(await request(unrelatedUrl), 200, 'Closing a managed group must preserve unrelated servers');

  const signalled = await launch('signalled');
  signalled.child.kill('SIGTERM');
  await assertStopped(signalled);

  const exited = await launch('wrapper-exit');
  assert.equal(await request(`${exited.url}/exit`), 200);
  await assertStopped(exited);

  const stopped = await launch('startup-cleanup', { release: false });
  await stopAgentServer(stopped.child);
  await assertStopped(stopped);

  const failedDir = join(root, 'failed');
  await mkdir(failedDir);
  const failed = await startAgentServer(join(root, 'missing-executable'), [], {
    cwd: root, env: process.env, logPath: join(failedDir, 'server.log'), sessionDir: failedDir,
    idleTimeoutMs: 600000,
  });
  children.push(failed);
  await waitFor(() => failed.exitCode !== null || failed.signalCode !== null, 'Failed command leaked supervisor');
  failed.release();
  assert.deepEqual(await closeAgentServer(failedDir), { closed: false, alreadyStopped: true });

  const cancelledDir = join(root, 'cancelled');
  await mkdir(cancelledDir);
  const launcher = spawn(process.execPath, ['--input-type=module', '-e', `
    import { startAgentServer } from ${JSON.stringify(managerUrl)};
    const child = await startAgentServer(process.execPath, [${JSON.stringify(fixture)}], {
      cwd: ${JSON.stringify(root)}, env: { ...process.env, TEST_IDLE: '0',
        READY_PATH: ${JSON.stringify(join(cancelledDir, 'ready.json'))} },
      logPath: ${JSON.stringify(join(cancelledDir, 'server.log'))},
      sessionDir: ${JSON.stringify(cancelledDir)}, idleTimeoutMs: 600000,
    });
    setInterval(() => {}, 1000);
  `], { stdio: 'ignore' });
  children.push(launcher);
  let cancelled;
  await waitFor(async () => {
    cancelled = await json(join(cancelledDir, 'ready.json')).catch(() => null);
    return cancelled;
  }, 'Pending-startup launcher failed to become ready');
  const cancelledHandle = await json(join(cancelledDir, 'server.json'));
  launcher.kill('SIGTERM');
  await waitFor(() => launcher.exitCode !== null || launcher.signalCode !== null, 'Cancelled launcher did not exit');
  assert.equal(launcher.exitCode, 143);
  await assertStopped({ ...cancelled, child: { pid: cancelledHandle.processId } });

  if (!process.argv.includes('--lifecycle-only')) {
    const idle = await launch('idle', { idle: true });
    await assertStopped(idle);

    const health = await launch('health', { idle: true });
    const probes = setInterval(() => { void request(`${health.url}/healthz`).catch(() => {}); }, 30);
    try { await assertStopped(health); } finally { clearInterval(probes); }

    const stream = await launch('stream', { idle: true });
    let streamResponse;
    const streamRequest = get(`${stream.url}/events`, { agent: false }, response => {
      streamResponse = response;
      response.resume();
    });
    streamRequest.on('error', () => {});
    try {
      await waitFor(() => streamResponse, 'SSE connection did not open');
      await sleep(700);
      assert.equal(alive(stream.pid), true, 'A connected SSE client must prevent idle shutdown');
    } finally { streamResponse?.destroy(); streamRequest.destroy(); }
    await assertStopped(stream);

    const upgraded = await launch('websocket', { idle: true });
    const websocket = connect(Number(new URL(upgraded.url).port), '127.0.0.1');
    let handshake = '';
    websocket.on('data', chunk => { handshake += chunk; });
    websocket.on('error', () => {});
    websocket.on('connect', () => websocket.write(
      'GET /hmr HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'));
    try {
      await waitFor(() => handshake.includes('\r\n\r\n'), 'WebSocket upgrade did not complete');
      assert.match(handshake, /^HTTP\/1\.1 101 Switching Protocols\r\n/);
      await sleep(700);
      assert.equal(alive(upgraded.pid), true, 'An upgraded connection must prevent idle shutdown');
    } finally { websocket.destroy(); }
    await assertStopped(upgraded);
  }
  console.log('Agent server lifecycle integration tests passed.');
} finally {
  await Promise.all(children.map(async child => {
    child.release?.();
    if (!alive(child.pid)) return;
    if (child.release) await stopAgentServer(child);
    else child.kill('SIGTERM');
  }));
  await new Promise(resolveClose => unrelated.close(resolveClose));
  await rm(root, { recursive: true, force: true });
}
