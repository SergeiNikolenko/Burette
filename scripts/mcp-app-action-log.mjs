import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const uuid = /^[0-9a-f-]{36}$/u;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const paths = (dir, id) => {
  if (!uuid.test(id || '')) fail('INVALID_ACTION', 'Invalid action ID.');
  return { active: join(dir, 'actions', `${id}.json`), final: join(dir, 'actions', 'history', `${id}.json`) };
};
async function read(path, id) {
  try {
    if ((await stat(path)).size > 4 * 1024 * 1024) fail('ACTION_LOG_INVALID', 'Action record exceeds 4 MiB; record preserved.');
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.actionId !== id || !['queued', 'completed', 'failed'].includes(value.status)
      || !/^\d{1,32}$/u.test(value.queuedAt || '') || typeof value.action?.type !== 'string') {
      fail('ACTION_LOG_INVALID', 'Invalid action record; record preserved.');
    }
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function readMcpAction(dir, id) {
  const p = paths(dir, id);
  const readFinal = async () => {
    const result = await read(p.final, id);
    if (result?.status === 'queued') fail('ACTION_LOG_INVALID', 'History contains a nonterminal record; record preserved.');
    return result;
  };
  const final = await readFinal();
  if (final) return final;
  const active = await read(p.active, id);
  // Publication may occur between either read and the removal of active.
  return await readFinal() ?? active;
}

export async function completeMcpAction(dir, record) {
  if (!['completed', 'failed'].includes(record.status)) fail('INVALID_ACTION', 'Completion must be terminal.');
  const p = paths(dir, record.actionId);
  await mkdir(join(dir, 'actions', 'history'), { recursive: true, mode: 0o700 });
  const temporary = `${p.final}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    try { await link(temporary, p.final); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const committed = await read(p.final, record.actionId);
    if (!committed || committed.status === 'queued') fail('ACTION_LOG_INVALID', 'Invalid completion record; active preserved.');
    await unlink(p.active).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return committed;
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function pendingMcpActions(dir) {
  const records = [];
  // History is intentionally never enumerated or loaded by a heartbeat.
  for (const name of await readdir(join(dir, 'actions'))) {
    if (!name.endsWith('.json') || !uuid.test(name.slice(0, -5))) continue;
    const id = name.slice(0, -5);
    const record = await readMcpAction(dir, id);
    if (!record) continue;
    if (record.status !== 'queued') await completeMcpAction(dir, record);
    else records.push(record);
  }
  return records.sort((a, b) => BigInt(a.queuedAt) < BigInt(b.queuedAt) ? -1 : 1);
}

// Serializes admission across CLI processes. Never steal locks by age: a slow
// live writer must retain ownership. A crashed owner needs explicit recovery.
export async function withMcpAdmission(dir, operation) {
  const lock = join(dir, 'actions', '.admission.lock');
  const deadline = Date.now() + 2000;
  for (;;) {
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) fail('QUEUE_BUSY', 'Action queue is busy or an admission was interrupted; session and history are preserved.');
      await delay(25);
    }
  }
  try { return await operation(); }
  finally { await rmdir(lock); }
}

export async function enqueueMcpAction(dir, prepare) {
  return withMcpAdmission(dir, async () => {
    if ((await pendingMcpActions(dir)).length >= 128) fail('QUEUE_FULL', '128 actions are pending; wait for their completion in this session.');
    const record = await prepare();
    const p = paths(dir, record.actionId);
    const temporary = `${p.active}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      await link(temporary, p.active);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return record;
  });
}
