import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { cancelMolecularJob, getMolecularJob, molecularProcessAlive, molecularTerminalStatuses, runMolecularJob } from '../scripts/molecular-jobs.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'burette-job-test-'));
  const sessionDir = join(root, 'session'), runtimeRoot = join(root, 'runtime');
  await mkdir(sessionDir);
  const path = new URL('../samples/mini.pdb', import.meta.url).pathname;
  const bytes = await readFile(path);
  const input = { sessionDir, runtimeRoot, sessionId: randomUUID(), requestId: randomUUID(),
    documents: [{ id: 'primary', path, format: 'pdb', sha256: createHash('sha256').update(bytes).digest('hex') }], action: { type: 'inspect' } };
  t.after(async () => {
    const supervisor = await readFile(join(runtimeRoot, 'supervisor.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (supervisor && supervisor.pid !== process.pid && molecularProcessAlive(supervisor.pid)) process.kill(supervisor.pid, 'SIGTERM');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return input;
}

async function until(check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for molecular job lifecycle.');
    await delay(20);
  }
}

test('real detached computation completes without a viewer and releases its supervisor', async t => {
  const input = await fixture(t);
  const result = await runMolecularJob({ ...input, waitMs: 15_000 });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.ok(result.result);
  assert.ok(result.metrics.wallMs >= 0);
  assert.ok(result.metrics.maxRssKiB > 0);
  assert.equal(result.metrics.heapLimitMiB, 512);
  assert.deepEqual(await runMolecularJob(input), result);
  await assert.rejects(runMolecularJob({ ...input, action: { type: 'contacts' } }), { code: 'REQUEST_CONFLICT' });
  await until(async () => !molecularProcessAlive(result.supervisorPid));
  assert.deepEqual(await readdir(join(input.runtimeRoot, 'queue')), []);
});

test('queued cancellation does not start a scientific worker', async t => {
  const input = await fixture(t);
  await mkdir(join(input.runtimeRoot, 'queue'), { recursive: true });
  const lock = join(input.runtimeRoot, 'supervisor.json');
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: randomUUID() }));
  assert.equal((await runMolecularJob(input)).status, 'queued');
  await cancelMolecularJob(input);
  await unlink(lock);
  const result = await until(async () => {
    const value = await getMolecularJob(input);
    return molecularTerminalStatuses.has(value.status) && value;
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.workerPid, undefined);
  await until(async () => !molecularProcessAlive(result.supervisorPid));
});

test('two sessions share one execution slot and survive submitting process exit', async t => {
  const first = await fixture(t);
  const second = { ...first, sessionId: randomUUID(), requestId: randomUUID(), sessionDir: join(first.sessionDir, 'second') };
  await mkdir(second.sessionDir);
  const url = new URL('../scripts/molecular-jobs.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {runMolecularJob} from ${JSON.stringify(url)}; await runMolecularJob(${JSON.stringify(first)});`], { stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 0, stderr);
  await runMolecularJob(second);
  const completed = await Promise.all([first, second].map(input => until(async () => {
    const result = await getMolecularJob(input);
    return molecularTerminalStatuses.has(result.status) && result;
  })));
  assert.deepEqual(completed.map(item => item.status), ['completed', 'completed']);
  const ordered = completed.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  assert.ok(Date.parse(ordered[1].startedAt) >= Date.parse(ordered[0].completedAt));
});

test('worker failure is terminal and cannot be silently retried with the same request', async t => {
  const input = await fixture(t);
  const broken = { ...input, documents: [{ ...input.documents[0], path: join(input.sessionDir, 'missing-source') }] };
  const result = await runMolecularJob({ ...broken, waitMs: 15_000 });
  assert.equal(result.status, 'failed');
  assert.ok(result.error.message);
  assert.deepEqual(await runMolecularJob(broken), result);
});

test('deadline stops the task process group and records a terminal timeout', async t => {
  const input = await fixture(t);
  const path = new URL('../samples/structures/proteins/1htb.pdb', import.meta.url).pathname;
  const bytes = await readFile(path);
  const result = await runMolecularJob({ ...input, timeoutMs: 100, waitMs: 15_000,
    documents: [{ ...input.documents[0], path, sha256: createHash('sha256').update(bytes).digest('hex') }],
    action: { type: 'buried_area', selection: { documentId: 'primary', chain: 'A' }, target: { documentId: 'primary', chain: 'B' }, samples: 240 } });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'TIMEOUT');
  await until(async () => !molecularProcessAlive(result.workerPid));
  await until(async () => !molecularProcessAlive(result.supervisorPid));
});

test('a supervisor crash recovers the worker outcome without duplicate execution', async t => {
  const input = await fixture(t);
  await runMolecularJob(input);
  const running = await until(async () => {
    const value = await getMolecularJob({ ...input, start: false });
    return value.status === 'running' && value;
  });
  process.kill(running.supervisorPid, 'SIGKILL');
  const result = await until(async () => {
    const value = await getMolecularJob(input);
    return molecularTerminalStatuses.has(value.status) && value;
  });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.workerPid, running.workerPid);
  assert.equal(result.startedAt, running.startedAt);
  await until(async () => {
    const files = await readdir(join(input.runtimeRoot, 'queue'));
    return files.length === 0;
  });
});

test('cancelling a stopped orphan kills its worker before releasing the shared slot', async t => {
  const input = await fixture(t);
  await runMolecularJob(input);
  const running = await until(async () => {
    const value = await getMolecularJob({ ...input, start: false });
    return value.status === 'running' && value;
  });
  process.kill(running.workerPid, 'SIGSTOP');
  process.kill(running.supervisorPid, 'SIGKILL');
  t.after(() => { try { process.kill(-running.workerPid, 'SIGKILL'); } catch {} });
  await cancelMolecularJob(input);
  const result = await until(async () => {
    const value = await getMolecularJob(input);
    return molecularTerminalStatuses.has(value.status) && value;
  });
  assert.equal(result.status, 'cancelled');
  await until(async () => !molecularProcessAlive(running.workerPid));
  assert.notEqual(result.supervisorPid, running.supervisorPid);
  await until(async () => !molecularProcessAlive(result.supervisorPid));
});

test('concurrent admissions keep the global queue within its bound', async t => {
  const input = await fixture(t);
  await mkdir(join(input.runtimeRoot, 'queue'), { recursive: true });
  const lock = join(input.runtimeRoot, 'supervisor.json');
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: randomUUID() }));
  const results = await Promise.allSettled(Array.from({ length: 130 }, () => runMolecularJob({ ...input, requestId: randomUUID() })));
  const accepted = results.filter(value => value.status === 'fulfilled').length;
  assert.ok(accepted <= 128);
  assert.equal((await readdir(join(input.runtimeRoot, 'queue'))).length, accepted);
  assert.ok(results.filter(value => value.status === 'rejected').every(value => ['QUEUE_FULL', 'QUEUE_BUSY'].includes(value.reason.code)));
});
