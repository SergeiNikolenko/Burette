import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setPriority } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { molecularJobPaths, molecularProcessAlive, molecularTerminalStatuses, readMolecularJson, writeMolecularJson } from './molecular-jobs.mjs';

const ownFile = fileURLToPath(import.meta.url);
const [mode, argument] = process.argv.slice(2);
const remove = path => unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
const errorResult = (code, message) => ({ status: 'failed', error: { code, message } });
const ps = promisify(execFile);

async function orphanIdentity(pid, recordPath) {
  if (!molecularProcessAlive(pid)) return 'dead';
  try {
    const { stdout } = await ps('/bin/ps', ['-p', String(pid), '-o', 'stat=', '-o', 'command='], { timeout: 1000, maxBuffer: 8192 });
    if (!stdout.trim() || /^\s*Z/u.test(stdout)) return 'dead';
    return stdout.includes(`${ownFile} compute ${recordPath}`) ? 'owned' : 'unknown';
  } catch { return molecularProcessAlive(pid) ? 'unknown' : 'dead'; }
}

async function acquire(root) {
  const path = join(root, 'supervisor.json'), identity = { pid: process.pid, token: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(identity)); } finally { await handle.close(); }
      return async () => { if ((await readMolecularJson(path))?.token === identity.token) await remove(path); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = await readMolecularJson(path); } catch { return null; }
      if (!owner || !Number.isSafeInteger(owner.pid) || molecularProcessAlive(owner.pid)) return null;
      // Only a positively dead owner can be recovered; a live or malformed
      // ownership file is preserved rather than stealing its execution slot.
      const recovery = `${path}.recovery`;
      let handle;
      try { handle = await open(recovery, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') return null; throw error; }
      try { if ((await readMolecularJson(path))?.token === owner.token) await remove(path); }
      finally { await handle.close(); await remove(recovery); }
    }
  }
  return null;
}

function stopTask(child, signal = 'SIGTERM') {
  if (!Number.isSafeInteger(child.pid)) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function execute(record, recordPath) {
  const paths = molecularJobPaths(record.sessionDir, record.requestId);
  const orphan = record.status === 'running';
  if (orphan) {
    const identity = await orphanIdentity(record.workerPid, recordPath);
    if (identity === 'unknown') return null;
    if (identity === 'dead') {
      return await readMolecularJson(paths.outcome) ?? { status: 'interrupted', error: { code: 'WORKER_INTERRUPTED', message: 'Worker stopped without an outcome; inputs are preserved.' } };
    }
  } else if (await readMolecularJson(paths.cancel)) return { status: 'cancelled' };
  const heapMiB = record.action.type === 'render' ? 1024 : 512;
  const child = orphan ? { pid: record.workerPid } : spawn(process.execPath, [`--max-old-space-size=${heapMiB}`, ownFile, 'compute', recordPath], {
    detached: true, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1', UV_THREADPOOL_SIZE: '1' },
  });
  try { if (!orphan && child.pid) setPriority(child.pid, 10); } catch {}
  let ended = false, spawnError;
  const exit = orphan ? null : new Promise(resolve => {
    child.once('error', error => { spawnError = error; ended = true; resolve(); });
    child.once('exit', () => { ended = true; resolve(); });
  });
  const started = orphan ? Date.parse(record.startedAt) : Date.now();
  record = { ...record, status: 'running', supervisorPid: process.pid, workerPid: child.pid, startedAt: new Date(started).toISOString(), heapLimitMiB: heapMiB };
  await writeMolecularJson(recordPath, record);
  let stopped;
  while (!ended) {
    if (orphan && await orphanIdentity(child.pid, recordPath) === 'dead') break;
    if (await readMolecularJson(paths.cancel)) stopped = 'cancelled';
    else if (Date.now() - started >= record.timeoutMs) stopped = 'timeout';
    if (stopped) {
      stopTask(child);
      if (orphan) {
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline && await orphanIdentity(child.pid, recordPath) === 'owned') await delay(50);
      } else await Promise.race([exit, delay(1500)]);
      stopTask(child, 'SIGKILL');
      if (orphan) {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline && await orphanIdentity(child.pid, recordPath) === 'owned') await delay(25);
        if (await orphanIdentity(child.pid, recordPath) !== 'dead') return null;
      } else await exit;
      break;
    }
    if (orphan) await delay(100);
    else await Promise.race([exit, delay(50)]);
  }
  // An adopted process was verified against its unique job command before
  // signalling. Keep the global execution slot until it has actually stopped.
  stopTask(child, 'SIGKILL');
  if (stopped === 'cancelled') return { status: 'cancelled' };
  if (stopped === 'timeout') return errorResult('TIMEOUT', `Molecular operation exceeded ${record.timeoutMs} ms.`);
  if (spawnError) return errorResult('WORKER_START_FAILED', spawnError.message);
  return await readMolecularJson(paths.outcome) ?? errorResult('WORKER_EXITED', 'Molecular worker exited without an outcome, possibly because its heap budget was exceeded.');
}

async function supervise(root) {
  await mkdir(join(root, 'queue'), { recursive: true, mode: 0o700 });
  const release = await acquire(root);
  if (!release) return;
  let orphanRunning = false;
  try {
    for (;;) {
      const names = (await readdir(join(root, 'queue'))).filter(name => /^[a-f0-9]{64}\.json$/u.test(name));
      if (!names.length) break;
      const entries = await Promise.all(names.map(async name => {
        const pointer = await readMolecularJson(join(root, 'queue', name));
        const record = pointer && await readMolecularJson(pointer.recordPath);
        return { name, pointer, record };
      }));
      entries.sort((a, b) => String(a.record?.queuedAt).localeCompare(String(b.record?.queuedAt)));
      let processed = false;
      for (const { name, pointer, record } of entries) {
        if (!record || molecularTerminalStatuses.has(record.status)) { await remove(join(root, 'queue', name)); processed = true; continue; }
        const outcome = await execute(record, pointer.recordPath);
        if (!outcome) { orphanRunning = true; break; }
        const current = await readMolecularJson(pointer.recordPath);
        await writeMolecularJson(pointer.recordPath, { ...current, ...outcome, supervisorPid: process.pid, completedAt: outcome.completedAt ?? new Date().toISOString() });
        await remove(join(root, 'queue', name));
        processed = true;
      }
      // An orphan compute process is left alone. Its own outcome can be
      // recovered on the next status read without duplicate execution.
      if (orphanRunning || !processed) break;
    }
  } finally { await release(); }
  // Close the submit-versus-idle-exit race without an idle timer or daemon.
  if (!orphanRunning && (await readdir(join(root, 'queue'))).some(name => /^[a-f0-9]{64}\.json$/u.test(name))) {
    const entries = await Promise.all((await readdir(join(root, 'queue'))).filter(name => name.endsWith('.json')).map(async name => {
      const pointer = await readMolecularJson(join(root, 'queue', name));
      return pointer && readMolecularJson(pointer.recordPath);
    }));
    if (entries.some(record => record?.status === 'queued')) return supervise(root);
  }
}

async function compute(recordPath) {
  const record = await readMolecularJson(recordPath);
  const paths = molecularJobPaths(record.sessionDir, record.requestId);
  const started = performance.now();
  const controller = new AbortController();
  const cancel = () => controller.abort(Object.assign(new Error('Molecular task was cancelled.'), { code: 'CANCELLED' }));
  process.once('SIGTERM', cancel);
  let outcome;
  try {
    const run = record.action.type === 'render'
      ? (await import('./molecular-render.mjs')).runMolecularRender
      : (await import('./molecular-analysis.mjs')).runMolecularAnalysis;
    const result = await run({ documents: record.documents, action: record.action, signal: controller.signal });
    outcome = { status: 'completed', result };
  } catch (error) { outcome = errorResult(error.code || 'MOLECULAR_OPERATION_FAILED', String(error.message || error).slice(0, 2000)); }
  const usage = process.resourceUsage();
  outcome.metrics = { wallMs: Math.round(performance.now() - started), cpuUserMs: usage.userCPUTime / 1000,
    cpuSystemMs: usage.systemCPUTime / 1000, maxRssKiB: usage.maxRSS, heapLimitMiB: record.heapLimitMiB ?? (record.action.type === 'render' ? 1024 : 512) };
  await writeMolecularJson(paths.outcome, { ...outcome, completedAt: new Date().toISOString() });
  process.removeListener('SIGTERM', cancel);
}

try {
  if (mode === 'supervise') await supervise(argument);
  else if (mode === 'compute') await compute(argument);
  else throw new Error('Unknown molecular worker mode.');
} catch (error) {
  if (mode === 'supervise') await writeMolecularJson(join(argument, 'supervisor-error.json'), {
    at: new Date().toISOString(), message: String(error.message || error).slice(0, 2000),
  }).catch(() => {});
  process.exitCode = 1;
}
