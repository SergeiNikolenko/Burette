#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'burette-shell-security-'));
let child;
try {
  const dist = join(root, 'dist');
  const session = join(root, 'session');
  const allowed = join(root, 'allowed');
  const outside = join(root, 'outside');
  await Promise.all([dist, session, allowed, outside].map(path => mkdir(path)));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Shell fixture</title>');
  await writeFile(join(session, 'session.json'), JSON.stringify({ token: 'fixture-secret-token', sessionDir: session }));
  await writeFile(join(allowed, 'ordinary.pdb'), 'HEADER ALLOWED');
  await writeFile(join(outside, 'secret.pdb'), 'SYNTHETIC SECRET');
  await symlink(join(outside, 'secret.pdb'), join(allowed, 'linked.pdb'));
  await symlink(outside, join(allowed, 'linked-dir'));
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const preload = join(root, 'swap-before-open.mjs');
  await writeFile(preload, `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { dirname, join } from 'node:path';
    const originalOpen = fs.open;
    fs.open = async (path, ...args) => {
      if (String(path).endsWith('/race/secret.pdb')) {
        const directory = dirname(path);
        await fs.rename(directory, directory + '-original');
        await fs.symlink(join(dirname(dirname(directory)), 'outside'), directory);
      }
      return originalOpen(path, ...args);
    };
    syncBuiltinESMExports();
  `);
  // Node's built-in export synchronization makes the path-swap injection deterministic.
  child = spawn(process.versions.bun ? 'node' : process.execPath, ['--import', preload, 'scripts/agent-shell-server.mjs', '--dist', dist, '--session-dir', session, '--allow', allowed, '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Server exited'); })]);
  const base = `http://127.0.0.1:${port}`;
  const bootstrap = await fetch(`${base}/?shellToken=fixture-secret-token`);
  assert.equal(bootstrap.status, 200);
  const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
  const headers = { Authorization: 'Bearer fixture-secret-token' };
  for (const [path, method] of [['observe.json', 'GET'], ['actions.json', 'PUT']]) {
    const url = `${base}/__burette/agent-session/${path}`;
    const options = { method, ...(method === 'PUT' ? { body: '{"actions":[]}' } : {}) };
    assert.equal((await fetch(url, options)).status, 401);
    const hostileHostStatus = await new Promise((resolve, reject) => {
      const req = request(url, { method, headers: { ...headers, Host: 'attacker.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on('error', reject);
      req.end(options.body);
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal((await fetch(url, { ...options, headers: { ...headers, Origin: 'http://attacker.example' } })).status, 403);
    assert.equal((await fetch(url, { ...options, headers })).status, 200);
    assert.equal((await fetch(url, { ...options, headers: { Cookie: cookie, Origin: base } })).status, 200);
  }
  assert.match(bootstrap.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(`${base}/__burette/agent-session/session.json?shellToken=wrong`)).status, 401);
  for (const path of ['linked.pdb', 'linked-dir/secret.pdb']) {
    const query = new URLSearchParams({ path: join(allowed, path) });
    const response = await fetch(`${base}/__burette/read-file?${query}`, { headers });
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /SYNTHETIC SECRET/);
  }
  const read = await fetch(`${base}/__burette/read-file?${new URLSearchParams({ path: join(allowed, 'ordinary.pdb') })}`, { headers });
  assert.equal(read.status, 200);
  assert.equal(await read.text(), 'HEADER ALLOWED');
  const listing = await fetch(`${base}/__burette/dev-files?${new URLSearchParams({ root: allowed })}`, { headers });
  assert.deepEqual((await listing.json()).files, [join(allowed, 'ordinary.pdb')]);
  await mkdir(join(allowed, 'race'));
  await writeFile(join(allowed, 'race', 'secret.pdb'), 'HEADER BEFORE SWAP');
  const raced = await fetch(`${base}/__burette/read-file?${new URLSearchParams({ path: join(allowed, 'race', 'secret.pdb') })}`, { headers });
  assert.equal(raced.status, 500);
  assert.doesNotMatch(await raced.text(), /SYNTHETIC SECRET/);
  console.log('Static shell: token, cookie bootstrap, Host/Origin, file/directory symlink containment and parent-swap race passed.');
} finally {
  if (child && child.exitCode == null) { child.kill(); await once(child, 'exit'); }
  await rm(root, { recursive: true, force: true });
}
