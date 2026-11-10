import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { withMcpAdmission } from './mcp-app-action-log.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
export const molecularTerminalStatuses = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
export const defaultMolecularRuntimeRoot = join(homedir(), '.burette', 'molecular-runtime');
function molecularWorkerPath() {
  const candidates = ['./molecular-worker.mjs', '../../scripts/molecular-worker.mjs'].map(path => fileURLToPath(new URL(path, import.meta.url)));
  const worker = candidates.find(existsSync);
  if (!worker) fail('WORKER_UNAVAILABLE', 'Packaged molecular worker is missing. Rebuild the Burette plugin.');
  return worker;
}
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export async function readMolecularJson(path) {
  try {
    if ((await stat(path)).size > 4 * 1024 * 1024) fail('RESULT_TOO_LARGE', 'Molecular job record exceeds 4 MiB.');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function writeMolecularJson(path, value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) fail('RESULT_TOO_LARGE', 'Molecular job result exceeds 4 MiB.');
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export function molecularProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

export function molecularJobPaths(sessionDir, requestId) {
  if (!uuid.test(requestId || '')) fail('INVALID_REQUEST_ID', 'Molecular requestId must be a UUID.');
  const directory = join(resolve(sessionDir), 'molecular-jobs', requestId.toLowerCase());
  return { directory, record: join(directory, 'job.json'), outcome: join(directory, 'outcome.json'), cancel: join(directory, 'cancel.json') };
}

function publicJob(record) {
  const { documents, action, fingerprint, sessionDir, runtimeRoot, ...value } = record;
  return value;
}

export async function startMolecularSupervisor(runtimeRoot) {
  const owner = await readMolecularJson(join(runtimeRoot, 'supervisor.json')).catch(() => ({ pid: process.pid }));
  if (owner && molecularProcessAlive(owner.pid)) return;
  const child = spawn(process.execPath, [molecularWorkerPath(), 'supervise', runtimeRoot], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

export async function runMolecularJob({ sessionDir, sessionId, documents, action, requestId, waitMs = 0, timeoutMs = 60_000, runtimeRoot = defaultMolecularRuntimeRoot }) {
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30_000) fail('INVALID_WAIT', 'waitMs must be between 0 and 30000.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) fail('INVALID_TIMEOUT', 'timeoutMs must be between 100 and 120000.');
  const paths = molecularJobPaths(sessionDir, requestId);
  runtimeRoot = resolve(runtimeRoot);
  const fingerprint = createHash('sha256').update(JSON.stringify({ sessionId, documents, action, timeoutMs })).digest('hex');
  await mkdir(join(runtimeRoot, 'queue'), { recursive: true, mode: 0o700 });
  await mkdir(join(runtimeRoot, 'actions'), { recursive: true, mode: 0o700 });
  const record = await withMcpAdmission(runtimeRoot, async () => {
    if ((await readdir(join(runtimeRoot, 'queue'))).filter(name => name.endsWith('.json')).length >= 128
      && !await readMolecularJson(paths.record)) fail('QUEUE_FULL', '128 molecular jobs are already pending.');
    await mkdir(join(resolve(sessionDir), 'molecular-jobs'), { recursive: true, mode: 0o700 });
    let created = false;
    try { await mkdir(paths.directory, { mode: 0o700 }); created = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    let record;
    if (created) {
      record = { requestId: requestId.toLowerCase(), sessionId, sessionDir: resolve(sessionDir), runtimeRoot, documents, action,
        fingerprint, timeoutMs, status: 'queued', queuedAt: new Date().toISOString() };
      await writeMolecularJson(paths.record, record);
    } else {
      for (let attempt = 0; attempt < 20 && !record; attempt++) {
        record = await readMolecularJson(paths.record);
        if (!record) await delay(25);
      }
      if (!record) fail('JOB_INITIALIZATION_INTERRUPTED', 'Job initialization is incomplete; the request is preserved.');
      if (record.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', 'requestId is already bound to different molecular inputs.');
    }
    if (!molecularTerminalStatuses.has(record.status)) {
      const queueId = createHash('sha256').update(paths.record).digest('hex');
      await writeMolecularJson(join(runtimeRoot, 'queue', `${queueId}.json`), { recordPath: paths.record });
    }
    return record;
  });
  if (!molecularTerminalStatuses.has(record.status)) await startMolecularSupervisor(runtimeRoot);
  const deadline = Date.now() + waitMs;
  for (;;) {
    const current = await getMolecularJob({ sessionDir, requestId, runtimeRoot, start: false });
    if (molecularTerminalStatuses.has(current.status) || Date.now() >= deadline) return current;
    await delay(Math.min(50, deadline - Date.now()));
  }
}

export async function getMolecularJob({ sessionDir, requestId, runtimeRoot = defaultMolecularRuntimeRoot, start = true }) {
  const paths = molecularJobPaths(sessionDir, requestId);
  let record = await readMolecularJson(paths.record);
  if (!record) fail('JOB_NOT_FOUND', 'Molecular job was not found in this session.');
  // A compute process publishes its own outcome before exiting. Recovering it
  // does not execute the scientific operation a second time.
  if (!molecularTerminalStatuses.has(record.status) && !molecularProcessAlive(record.supervisorPid)) {
    const outcome = await readMolecularJson(paths.outcome);
    if (outcome && !molecularProcessAlive(record.workerPid)) {
      record = { ...record, ...outcome, completedAt: outcome.completedAt ?? new Date().toISOString() };
      await writeMolecularJson(paths.record, record);
      if (start) await startMolecularSupervisor(resolve(runtimeRoot));
    } else if (record.status === 'running' && !molecularProcessAlive(record.workerPid)) {
      record = { ...record, status: 'interrupted', completedAt: new Date().toISOString(), error: { code: 'WORKER_INTERRUPTED', message: 'The molecular worker stopped before publishing an outcome; inputs are preserved.' } };
      await writeMolecularJson(paths.record, record);
    } else if (start && ['queued', 'running'].includes(record.status)) await startMolecularSupervisor(resolve(runtimeRoot));
  }
  return publicJob(record);
}

export async function cancelMolecularJob({ sessionDir, requestId, runtimeRoot = defaultMolecularRuntimeRoot }) {
  const paths = molecularJobPaths(sessionDir, requestId);
  const record = await readMolecularJson(paths.record);
  if (!record) fail('JOB_NOT_FOUND', 'Molecular job was not found in this session.');
  if (!molecularTerminalStatuses.has(record.status)) {
    await writeMolecularJson(paths.cancel, { requestedAt: new Date().toISOString() });
    await startMolecularSupervisor(resolve(runtimeRoot));
  }
  return getMolecularJob({ sessionDir, requestId, runtimeRoot });
}
