import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { runMcpAppOperation as run } from '../scripts/mcp-app-session.mjs';
import { openMcpSession } from '../scripts/mcp-app-open.mjs';

test('retries preserve the original snapshot and current session without rereading changed or absent files', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'burette-open-test-'));
  const file = join(temp, 'mini.pdb'), openRequestId = randomUUID();
  const dir = join(tmpdir(), 'burette-mcp-app', openRequestId);
  t.after(() => Promise.all([rm(temp, { recursive: true, force: true }), rm(dir, { recursive: true, force: true })]));
  const source = await readFile(new URL('../samples/mini.pdb', import.meta.url));
  await writeFile(file, source);
  const input = { operation: 'open', file, workspace: true, openRequestId };
  const first = await run(input);
  assert.equal(first.reused, false);
  await run({ operation: 'exchange', sessionId: first.sessionId, token: first.token, state: { ready: true, tabs: [] } });
  await writeFile(file, 'changed');
  const second = await run(input);
  assert.notEqual(second.presentationId, first.presentationId);
  assert.deepEqual(second, { ...first, presentationId: second.presentationId, reused: true, ready: true });
  await rm(file);
  const third = await run({ ...input, openRequestId: openRequestId.toUpperCase() });
  assert.deepEqual(third, { ...second, presentationId: third.presentationId });
  assert.deepEqual(await readFile(join(dir, 'source')), source);
  await assert.rejects(run({ ...input, file: `${file}-different` }), { code: 'OPEN_REQUEST_CONFLICT' });
  await assert.rejects(run({ ...input, view: 'docking' }), { code: 'OPEN_REQUEST_CONFLICT' });
  await assert.rejects(run({ ...input, displayMode: 'fullscreen' }), { code: 'OPEN_REQUEST_CONFLICT' });
  await run({ operation: 'exchange', sessionId: first.sessionId, token: first.token, close: true });
  await assert.rejects(run(input), { code: 'OPEN_REQUEST_CLOSED' });
  assert.equal((await run({ operation: 'observe', sessionId: first.sessionId })).closed, true);
});

test('a retried opener card takes over the session and the earlier card steps aside', async t => {
  const openRequestId = randomUUID(), dir = join(tmpdir(), 'burette-mcp-app', openRequestId);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = { operation: 'open', openRequestId, workspace: true,
    file: new URL('../samples/mini.pdb', import.meta.url).pathname };
  const first = await run(input);
  const exchange = (card, extra) => run({ operation: 'exchange', sessionId: card.sessionId, token: card.token, presentationId: card.presentationId, ...extra });
  assert.equal((await exchange(first, {})).superseded, undefined);
  const second = await run(input);
  const stale = { closed: true, superseded: true, actions: [] };
  assert.deepEqual(await exchange(first, { state: { ready: true, tabs: [] } }), stale);
  assert.deepEqual(await exchange(first, { close: true }), stale);
  assert.equal((await run({ operation: 'observe', sessionId: first.sessionId })).lifecycle.status, 'awaiting_mount');
  await exchange(second, { state: { ready: true, tabs: [] } });
  assert.equal((await run({ operation: 'observe', sessionId: first.sessionId })).ready, true);
  await exchange(second, { close: true });
  assert.equal((await run({ operation: 'observe', sessionId: first.sessionId })).closed, true);
});

test('independent processes with one openRequestId share exactly one snapshot/session', async t => {
  const openRequestId = randomUUID(), dir = join(tmpdir(), 'burette-mcp-app', openRequestId);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = { operation: 'open', openRequestId, workspace: true,
    file: new URL('../samples/mini.pdb', import.meta.url).pathname };
  const moduleUrl = new URL('../scripts/mcp-app-session.mjs', import.meta.url).href;
  const script = `import {runMcpAppOperation as run} from ${JSON.stringify(moduleUrl)};const s=await run(${JSON.stringify(input)});console.log(JSON.stringify({id:s.sessionId,digest:s.sha256,documents:s.documents,reused:s.reused}));`;
  const child = () => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', script]);
    let out = '', err = '';
    proc.stdout.on('data', data => { out += data; }); proc.stderr.on('data', data => { err += data; });
    proc.on('error', reject); proc.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  });
  const results = await Promise.all(Array.from({ length: 4 }, child));
  assert.equal(results.filter(result => !result.reused).length, 1);
  const publicState = ({ reused, ...result }) => result;
  results.forEach(result => assert.deepEqual(publicState(result), publicState(results[0])));
  assert.equal(results[0].id, openRequestId);
  assert.deepEqual((await readdir(dir)).sort(), ['actions', 'observe.json', 'open-request.json', 'presentation.json', 'session.json', 'source']);
});

test('invalid keys fail before allocation; failed initialization cleans only its own new directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'burette-open-helper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { file: '/example.pdb', openRequestId: randomUUID() };
  for (const key of ['../escape', '', 123, 'a'.repeat(36)]) {
    await assert.rejects(openMcpSession(root, { ...input, openRequestId: key }, () => assert.fail()), { code: 'INVALID_OPEN_REQUEST' });
  }
  await assert.rejects(openMcpSession(root, input, async () => { throw new Error('snapshot failed'); }), /snapshot failed/);
  assert.deepEqual(await readdir(root), []);
  // A directory left by a crashed or legacy writer must never be stolen.
  await mkdir(join(root, input.openRequestId));
  await assert.rejects(openMcpSession(root, input, () => assert.fail()), { code: 'OPEN_REQUEST_BUSY' });
  assert.deepEqual(await readdir(root), [input.openRequestId]);
});

test('published claims survive later failure and incomplete marked claims are not stolen', async t => {
  const root = await mkdtemp(join(tmpdir(), 'burette-open-commit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { file: '/example.pdb', openRequestId: randomUUID() };
  const dir = join(root, input.openRequestId);
  await assert.rejects(openMcpSession(root, input, async () => {
    await writeFile(join(dir, 'session.json'), '{}');
    throw new Error('post-commit failure');
  }), /post-commit failure/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')), {});
  await rm(join(dir, 'session.json'));
  await assert.rejects(openMcpSession(root, input, () => assert.fail()), { code: 'OPEN_REQUEST_BUSY' });
  assert.deepEqual(await readdir(dir), ['open-request.json']);
});
