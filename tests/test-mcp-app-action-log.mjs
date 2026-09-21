import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { completeMcpAction, enqueueMcpAction, pendingMcpActions, readMcpAction, withMcpAdmission } from '../scripts/mcp-app-action-log.mjs';
const execute = promisify(execFile);
const queued = () => ({ actionId: randomUUID(), action: { type: 'reset_camera' }, status: 'queued', queuedAt: process.hrtime.bigint().toString() });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'burette-action-log-test-'));
  await mkdir(join(dir, 'actions'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('200 completed actions preserve immutable history without exhausting the queue', async t => {
  const dir = await fixture(t);
  for (let index = 0; index < 200; index++) {
    const action = await enqueueMcpAction(dir, queued);
    const done = { ...action, status: 'completed', result: { index } };
    await completeMcpAction(dir, done);
    await completeMcpAction(dir, { ...done, result: 'conflicting retry' });
    assert.deepEqual(await readMcpAction(dir, action.actionId), done);
  }
  assert.deepEqual(await pendingMcpActions(dir), []);
  assert.deepEqual(await readdir(join(dir, 'actions')), ['history']);
  assert.equal((await readdir(join(dir, 'actions/history'))).length, 200);
  // Heartbeats never parse unrelated archived payloads, even large/corrupt ones.
  await writeFile(join(dir, 'actions/history', `${randomUUID()}.json`), 'not JSON');
  assert.deepEqual(await pendingMcpActions(dir), []);
});

test('concurrent processes cannot admit more than 128 pending actions', async t => {
  const dir = await fixture(t);
  const module = new URL('../scripts/mcp-app-action-log.mjs', import.meta.url).href;
  const code = `import {enqueueMcpAction} from ${JSON.stringify(module)};
    import {randomUUID} from 'node:crypto';
    const results=[];
    for(let i=0;i<50;i++) { try { await enqueueMcpAction(process.argv[1],()=>({actionId:randomUUID(),action:{type:'reset_camera'},status:'queued',queuedAt:process.hrtime.bigint().toString()})); results.push('ok'); }
      catch(e) { if(!['QUEUE_FULL','QUEUE_BUSY'].includes(e.code)) throw e; results.push(e.code); } }
    console.log(JSON.stringify(results));`;
  const children = await Promise.all(Array.from({ length: 4 }, () => execute(process.execPath, ['--input-type=module', '-e', code, dir])));
  const results = children.flatMap(child => JSON.parse(child.stdout));
  assert.equal(results.filter(result => result === 'ok').length, 128);
  assert.equal((await pendingMcpActions(dir)).length, 128);
  let prepared = false;
  await assert.rejects(enqueueMcpAction(dir, () => { prepared = true; return queued(); }), { code: 'QUEUE_FULL' });
  assert.equal(prepared, false, 'No file-admission side effects when queue is full');
});

test('legacy records migrate and a published completion suppresses crash-left active copies', async t => {
  const dir = await fixture(t);
  const active = queued(), done = { ...queued(), status: 'completed', result: 42 };
  const path = id => join(dir, 'actions', `${id}.json`);
  await writeFile(path(active.actionId), JSON.stringify(active));
  await writeFile(path(done.actionId), JSON.stringify(done));
  assert.deepEqual(await pendingMcpActions(dir), [active]);
  assert.deepEqual(await readMcpAction(dir, done.actionId), done);
  const winner = { ...active, status: 'completed', result: 'first' };
  const temp = join(dir, 'prepared');
  await writeFile(temp, JSON.stringify(winner));
  await link(temp, join(dir, 'actions/history', `${active.actionId}.json`));
  // Simulates death after final link but before active unlink.
  assert.deepEqual(await pendingMcpActions(dir), []);
  assert.deepEqual(await readMcpAction(dir, active.actionId), winner);
  const broken = queued();
  await writeFile(path(broken.actionId), 'broken');
  await assert.rejects(pendingMcpActions(dir));
  assert.equal(await readFile(path(broken.actionId), 'utf8'), 'broken');
});

test('readers tolerate completion publication and concurrent first writers', async t => {
  const dir = await fixture(t);
  for (let i = 0; i < 20; i++) {
    const action = await enqueueMcpAction(dir, queued);
    const readers = Array.from({ length: 10 }, () => readMcpAction(dir, action.actionId));
    const results = await Promise.all([completeMcpAction(dir, { ...action, status: 'completed', result: 'a' }),
      completeMcpAction(dir, { ...action, status: 'failed', error: 'b' })]);
    assert.deepEqual(results[0], results[1]);
    assert.ok((await Promise.all(readers)).every(Boolean));
    assert.deepEqual(await readMcpAction(dir, action.actionId), results[0]);
  }
});

test('interrupted admission fails bounded and never steals another owner lock', async t => {
  const dir = await fixture(t);
  const lock = join(dir, 'actions/.admission.lock');
  await mkdir(lock);
  const start = Date.now();
  await assert.rejects(withMcpAdmission(dir, queued), { code: 'QUEUE_BUSY' });
  assert.ok(Date.now() - start < 5000);
  assert.deepEqual(await readdir(join(dir, 'actions')), ['.admission.lock']);
});
