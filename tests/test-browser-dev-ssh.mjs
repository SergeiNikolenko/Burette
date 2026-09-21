import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { registerBrowserDevSshRoutes } from '../apps/desktop/vite/browser-dev/ssh.ts';

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
