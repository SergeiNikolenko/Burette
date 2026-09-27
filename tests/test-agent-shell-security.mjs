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
  await writeFile(join(allowed, 'water.xyz'), '3\nwater\nO 0 0 0\nH 1 0 0\nH 0 1 0\n');
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'xyzrender'), '', { mode: 0o755 });
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
    import childProcess from 'node:child_process';
    import { promisify } from 'node:util';
    import { syncBuiltinESMExports } from 'node:module';
    import { dirname, join } from 'node:path';
    const originalOpen = fs.open;
    const originalExecFile = childProcess.execFile;
    childProcess.execFile = (file, args, options, callback) => {
      if (!String(file).endsWith('/xyzrender')) return originalExecFile(file, args, options, callback);
      fs.writeFile(args[args.indexOf('-o') + 1], '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>')
        .then(() => callback(null, '', ''), callback);
    };
    childProcess.execFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
      childProcess.execFile(file, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
    });
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
  child = spawn(process.versions.bun ? 'node' : process.execPath, ['--import', preload, 'scripts/agent-shell-server.mjs', '--dist', dist, '--session-dir', session, '--allow', allowed, '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
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
  const xyzUrl = `${base}/__burette/xyzrender`;
  const render = body => fetch(xyzUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(xyzUrl, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(xyzUrl, { headers })).status, 405);
  for (const path of [join(outside, 'secret.pdb'), join(allowed, 'linked.pdb')]) {
    assert.equal((await render({ path })).status, 400, 'rendering cannot read unauthorized files');
  }
  for (const body of [
    { path: join(allowed, 'water.xyz'), preset: 'flat' },
    { path: 'burette-ketcher://sketch.xyz', inputExtension: 'xyz', inputDataBase64: Buffer.from('1\nH\nH 0 0 0\n').toString('base64') },
  ]) {
    const response = await render(body);
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.match(payload.svg, /<svg/);
  }
  assert.equal((await render({ path: join(allowed, 'water.xyz'), controls: { extraArguments: '--output /private/file' } })).status, 400);
  assert.equal((await render({ inputExtension: 'xyz', inputDataBase64: 'A'.repeat(700000) })).status, 400);
  const fileActionUrl = `${base}/__burette/file-action`;
  assert.equal((await fetch(fileActionUrl, { method: 'POST', body: JSON.stringify({ type: 'list_apps', path: join(allowed, 'ordinary.pdb') }) })).status, 401);
  for (const path of [join(outside, 'secret.pdb'), join(allowed, 'linked.pdb')]) {
    const denied = await fetch(fileActionUrl, { method: 'POST', headers, body: JSON.stringify({ type: 'reveal', path }) });
    assert.equal(denied.status, 400);
  }
  const discovered = await fetch(fileActionUrl, { method: 'POST', headers, body: JSON.stringify({ type: 'list_apps', path: join(allowed, 'ordinary.pdb') }) });
  assert.equal(discovered.status, 200);
  assert.ok(Array.isArray((await discovered.json()).targets));
  const observeUrl = `${base}/__burette/agent-session/observe.json`;
  for (let batch = 0; batch < 8; batch++) {
    const states = Array.from({ length: 16 }, (_, index) => ({ index, selection: 'x'.repeat(index % 2 ? 10 : 24000) }));
    const writes = await Promise.all(states.map(state => fetch(observeUrl, { method: 'PUT', headers, body: JSON.stringify(state) })));
    assert.ok(writes.every(response => response.status === 200));
    const response = await fetch(observeUrl, { headers });
    assert.equal(response.status, 200, 'concurrent selection updates must leave valid JSON');
    const state = await response.json();
    assert.deepEqual(state, states[state.index], 'readers see one complete snapshot, never interleaved writes');
  }
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
  assert.deepEqual((await listing.json()).files, [join(allowed, 'ordinary.pdb'), join(allowed, 'water.xyz')]);
  await writeFile(join(allowed, 'ordinary.xtc'), 'SYNTHETIC TRAJECTORY');
  const paired = await fetch(`${base}/__burette/trajectory-pair?${new URLSearchParams({ path: join(allowed, 'ordinary.pdb') })}`, { headers });
  assert.equal(paired.status, 200);
  const pair = await paired.json();
  assert.deepEqual({ topologyPath: pair.topologyPath, trajectoryPath: pair.trajectoryPath }, {
    topologyPath: join(allowed, 'ordinary.pdb'), trajectoryPath: join(allowed, 'ordinary.xtc'),
  }, 'The shared shell needs both file identities to classify and navigate the paired document');
  const pairFor = path => fetch(
    `${base}/__burette/trajectory-pair?${new URLSearchParams({ path })}`, { headers },
  );
  // A nested simulation must not turn an ordinary structure into an unrelated
  // paired trajectory, even when the parent directory is authorized.
  const isolated = join(allowed, 'isolated');
  await mkdir(isolated);
  await writeFile(join(isolated, 'mini.pdb'), 'HEADER MINI');
  await mkdir(join(isolated, 'md'));
  await writeFile(join(isolated, 'md', 'run.xtc'), 'SYNTHETIC TRAJECTORY');
  await writeFile(join(isolated, 'md', 'run.gro'), 'SYNTHETIC TOPOLOGY');
  assert.equal((await pairFor(join(isolated, 'mini.pdb'))).status, 404);
  assert.equal((await pairFor(join(isolated, 'md', 'run.xtc'))).status, 200);
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
