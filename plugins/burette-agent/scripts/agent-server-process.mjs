import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const stopGraceMs = 500;

async function requestServer(sessionDir, action) {
  let handle;
  try {
    handle = JSON.parse(await readFile(resolve(sessionDir, 'server.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (typeof handle.socketPath !== 'string' || typeof handle.token !== 'string') {
    throw new Error('Invalid managed browser server handle.');
  }
  return new Promise((resolveRequest, reject) => {
    const socket = connect(handle.socketPath);
    let response = '';
    socket.setEncoding('utf8');
    socket.setTimeout(3000, () => socket.destroy(new Error('Browser server control request timed out.')));
    socket.once('connect', () => socket.write(`${JSON.stringify({ action, token: handle.token })}\n`));
    socket.on('data', chunk => {
      response += chunk;
      if (response.length > 1024) socket.destroy(new Error('Invalid browser server control response.'));
    });
    socket.once('error', error => {
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) resolveRequest(null);
      else reject(error);
    });
    socket.once('end', () => {
      try {
        const result = JSON.parse(response);
        if (result.ok !== true) throw new Error('Browser server control request rejected.');
        resolveRequest(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function closeAgentServer(sessionDir) {
  const result = await requestServer(sessionDir, 'close');
  return { closed: result !== null, alreadyStopped: result === null };
}

export async function assertAgentServerAvailable(sessionDir) {
  if (await requestServer(sessionDir, 'ping')) {
    const error = new Error('The browser session already has a live managed server.');
    error.code = 'SESSION_IN_USE';
    throw error;
  }
}

export async function startAgentServer(command, args, { cwd, env, logPath, sessionDir, idleTimeoutMs }) {
  const log = await open(logPath, 'a');
  const child = spawn(process.execPath, [scriptPath, '--supervise', JSON.stringify({
    command, args, sessionDir, idleTimeoutMs,
  })], { cwd, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
  const spawned = new Promise((resolveSpawn, reject) => {
    child.once('spawn', resolveSpawn);
    child.once('error', reject);
  });
  const interrupt = signal => {
    void stopAgentServer(child).finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  child.release = () => {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  };
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    await spawned;
    return child;
  } catch (error) {
    child.release();
    throw error;
  } finally {
    await log.close();
  }
}

export async function stopAgentServer(child) {
  child.release?.();
  if (!child.pid) return;
  // The detached supervisor owns this group, including vp's Node descendants.
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code === 'ESRCH') return;
    throw error;
  }
  await new Promise(resolveStop => {
    const deadline = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') console.error(error.message);
      }
      resolveStop();
    }, stopGraceMs + 250);
    child.once('exit', () => {
      clearTimeout(deadline);
      resolveStop();
    });
  });
}

async function supervise({ command, args, sessionDir, idleTimeoutMs }) {
  const token = randomUUID();
  const socketPath = `/tmp/burette-server-${randomUUID()}.sock`;
  let stopping = false;
  let server;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server?.close();
    setTimeout(async () => {
      await unlink(socketPath).catch(() => {});
      process.kill(-process.pid, 'SIGKILL');
    }, stopGraceMs);
    process.kill(-process.pid, 'SIGTERM');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server = createServer(socket => {
    let input = '';
    socket.setEncoding('utf8');
    socket.setTimeout(3000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      input += chunk;
      if (input.length > 1024) return socket.destroy();
      if (!input.includes('\n')) return;
      socket.removeAllListeners('data');
      let request;
      try { request = JSON.parse(input); } catch { return socket.destroy(); }
      if (request.token !== token || !['ping', 'close'].includes(request.action)) {
        socket.end('{"ok":false}\n');
        return;
      }
      if (request.action === 'ping') socket.end('{"ok":true}\n');
      else {
        socket.write('{"ok":true}\n');
        shutdown();
      }
    });
  });
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolveListen);
    });
    await chmod(socketPath, 0o600);
    await writeFile(resolve(sessionDir, 'server.json'), `${JSON.stringify({
      socketPath, token, processId: process.pid, idleTimeoutMs,
    }, null, 2)}\n`, { mode: 0o600 });
    if (stopping) return;
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        BURETTE_AGENT_SERVER_PID: String(process.pid),
        BURETTE_AGENT_SERVER_IDLE_TIMEOUT_MS: String(idleTimeoutMs),
      },
    });
    child.once('error', error => { console.error(error.message); shutdown(); });
    child.once('exit', shutdown);
  } catch (error) {
    console.error(error.message);
    shutdown();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath && process.argv[2] === '--supervise') {
  await supervise(JSON.parse(process.argv[3]));
}
