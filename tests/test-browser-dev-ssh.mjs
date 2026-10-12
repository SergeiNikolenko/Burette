import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { registerBrowserDevSshRoutes } from '../apps/desktop/vite/browser-dev/ssh.ts';
import { SshPreviewCache } from '../apps/desktop/vite/browser-dev/ssh-preview-cache.ts';
import { SshRequestQueue } from '../apps/desktop/vite/browser-dev/ssh-request-queue.ts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const queue = new SshRequestQueue();
let running = 0, maximum = 0;
const started = [];
const results = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
  const release = await queue.acquire(new AbortController().signal);
  running++; maximum = Math.max(maximum, running); started.push(index);
  try { await new Promise(resolve => setTimeout(resolve, 1)); return `preview-${index}`; }
  finally { running--; release(); release(); }
}));
assert.equal(maximum, 3, 'ten quick requests use at most three active channels');
assert.deepEqual(started, Array.from({ length: 10 }, (_, index) => index), 'waiting requests keep their order');
assert.deepEqual(results, Array.from({ length: 10 }, (_, index) => `preview-${index}`));
const leases = await Promise.all(Array.from({ length: 3 }, () => queue.acquire(new AbortController().signal)));
const cancelled = new AbortController();
const waitingCancelled = assert.rejects(queue.acquire(cancelled.signal), /cancelled/);
cancelled.abort(); await waitingCancelled;
const waiting = Array.from({ length: 200 }, () => assert.rejects(queue.acquire(new AbortController().signal), /server closed/));
await assert.rejects(queue.acquire(new AbortController().signal), /Too many/);
queue.close();
await Promise.all(waiting);
leases.forEach(release => release());
await assert.rejects(queue.acquire(new AbortController().signal), /server closed/);

const cacheRoot = await mkdtemp(join(tmpdir(), 'burette-ssh-cache-test-'));
try {
  const cache = new SshPreviewCache(async () => cacheRoot);
  const response = (fingerprint, data, unchanged = false) => Buffer.concat([Buffer.from(JSON.stringify({ fingerprint, unchanged }) + '\n'), Buffer.from(data)]);
  const original = await cache.store('file', 'nested/mini.pdb', response('first', 'ATOM'));
  assert.equal(await cache.known('file'), 'first');
  assert.equal(await cache.store('file', 'nested/mini.pdb', response('first', '', true)), original);
  const updated = await cache.store('file', 'nested/mini.pdb', response('second', 'NEW ATOM'));
  assert.notEqual(original, updated);
  assert.equal(await readFile(original, 'utf8'), 'ATOM', 'old versions remain readable');
  await writeFile(updated, 'changed');
  assert.equal(await cache.known('file'), undefined, 'changed local copies must be downloaded again');
  await assert.rejects(cache.store('file', 'mini.pdb', response('second', '', true)), /cache changed/);
  await assert.rejects(cache.store('file', 'mini.pdb', response('second', 'extra', true)), /Invalid/);
  await Promise.all(Array.from({ length: 254 }, (_, i) => cache.store('key' + i, 'mini.pdb', response(String(i), ''))));
  const last = await Promise.allSettled([cache.store('over1', 'mini.pdb', response('over1', '')), cache.store('over2', 'mini.pdb', response('over2', ''))]);
  assert.deepEqual(last.map(item => item.status), ['rejected', 'rejected'], 'parallel admission cannot cross the 256-file bound');
} finally { await rm(cacheRoot, { recursive: true, force: true }); }


let handler;
const server = createServer((req, res) => handler(req, res));
registerBrowserDevSshRoutes({ httpServer: server, middlewares: { use: (_, route) => { handler = route; } } }, process.cwd());
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const post = (path, body, extra = {}) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Burette-SSH': '1', ...extra }, body: JSON.stringify(body) });
try {
  delete process.env.BURETTE_DEV_SSH;
  assert.equal((await post('/hosts', {})).status, 403);
  process.env.BURETTE_DEV_SSH = '1';
  assert.equal((await post('/hosts', {}, { Origin: 'http://localhost:9999' })).status, 403);
  assert.equal((await post('/hosts', {}, { 'X-Burette-SSH': '' })).status, 403);
  assert.equal((await post('/hosts', {}, { Host: 'attacker.example' })).status, 403);
  assert.equal((await post('/list', { host: '-oProxyCommand=evil', root: '~', path: '.' })).status, 400);
  assert.equal((await post('/list', { host: 'research;id', root: '~', path: '.' })).status, 400);
  assert.equal((await post('/list', { host: 'research', root: '\0', path: '.' })).status, 400);
  assert.equal((await post('/list', { host: 'research', root: 'x'.repeat(9000), path: '.' })).status, 413);
  assert.equal((await post('/delete-folder', { host: '-oProxyCommand=evil', root: '~', path: 'folder' })).status, 400);
  assert.equal((await post('/delete-folder', {}, { Origin: 'http://attacker.example' })).status, 403);
  assert.equal((await post('/other', {})).status, 404);
  const hosts = await post('/hosts', {});
  assert.equal(hosts.status, 200);
  assert.ok(Array.isArray(await hosts.json()));
  if (process.env.BURETTE_SSH_TEST_HOST && process.env.BURETTE_SSH_TEST_ROOT) {
    const request = { host: process.env.BURETTE_SSH_TEST_HOST, root: process.env.BURETTE_SSH_TEST_ROOT, path: '.' };
    const listing = await post('/list', request);
    assert.equal(listing.status, 200);
    assert.ok((await listing.json()).entries.some(e => e.name === 'mini.pdb'));
    const preview = await post('/preview', { ...request, path: 'mini.pdb' });
    assert.equal(preview.status, 200);
    const { readFile } = await import('node:fs/promises');
    assert.match(await readFile(await preview.json(), 'utf8'), /ATOM|HETATM/);
    const outside = await post('/list', { ...request, path: '../' });
    assert.equal(outside.status, 400);
    assert.match((await outside.json()).error, /outside/);
  }
  console.log('Browser SSH origin, opt-in, bounds, host validation and optional live preview passed');
} finally { await new Promise(resolve => server.close(resolve)); }
