#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const viewerSource = await readFile('PreviewExtension/Web/viewer.js', 'utf8');
const readinessStart = viewerSource.indexOf('  function assertMolstarLoadReady(viewer, prepared)');
const readinessEnd = viewerSource.indexOf('\n  // viewer-shell.js keeps the page transparent', readinessStart);
assert.ok(readinessStart > 0 && readinessEnd > readinessStart);
const readinessContext = { currentMolstarStructureCount: viewer => viewer.structureCount };
runInNewContext(`${viewerSource.slice(readinessStart, readinessEnd)}\nthis.assertMolstarLoadReady = assertMolstarLoadReady;`, readinessContext);
const validXyzViewer = { structureCount: 1, plugin: { state: { data: { cells: new Map() } } } };
assert.equal(readinessContext.assertMolstarLoadReady(validXyzViewer, { format: 'xyz', label: 'valid.xyz' }), undefined);
let readyAfterInvalidXyz = false;
assert.throws(
  () => {
    readinessContext.assertMolstarLoadReady({ ...validXyzViewer, structureCount: 0 }, { format: 'xyz', label: 'invalid.xyz' });
    readyAfterInvalidXyz = true;
  },
  /loaded no molecular structures for invalid\.xyz; viewer readiness was withheld/,
);
assert.equal(readyAfterInvalidXyz, false);
const parserFailure = { status: 'error', errorText: 'Could not parse XYZ coordinates.' };
assert.throws(
  () => readinessContext.assertMolstarLoadReady({
    ...validXyzViewer,
    plugin: { state: { data: { cells: new Map([['parser', parserFailure]]) } } },
  }, { format: 'xyz', label: 'invalid.xyz' }),
  /Could not parse XYZ coordinates\.; viewer readiness was withheld/,
);
assert.equal(readinessContext.assertMolstarLoadReady({ structureCount: 0 }, { kind: 'volume' }), undefined);
assert.match(viewerSource, /await withTimeout\(\s*loadPreparedStructure\(viewer, prepared\)[\s\S]*?assertMolstarLoadReady\(viewer, prepared\);\s*if \(config\.demoSnapshotUrl\)/);
const readinessCall = viewerSource.indexOf('    assertMolstarLoadReady(viewer, prepared);', viewerSource.indexOf('async function startMolstar'));
const agentReady = viewerSource.indexOf("postHostMessage({ type: 'agentReady'", readinessCall);
const sceneReady = viewerSource.indexOf('window.BuretteNativeSceneReady();', readinessCall);
assert.ok(readinessCall > 0 && agentReady > readinessCall && sceneReady > readinessCall);

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
  // Packaged shells may request only bundled, explicitly allowed runtime assets.
  const sequence = await fetch(`${base}/__burette/runtime/sequence-panel.js`, { headers });
  assert.equal(sequence.status, 200);
  assert.match(sequence.headers.get('content-type'), /^text\/javascript/);
  assert.match(await sequence.text(), /BuretteSequencePanel/);
  assert.equal((await fetch(`${base}/__burette/runtime/not-a-runtime-asset.js`, { headers })).status, 404);
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
  const xtcPairResponse = await pairFor(join(isolated, 'md', 'run.xtc'));
  assert.equal(xtcPairResponse.status, 200);
  const xtcPair = await xtcPairResponse.json();
  assert.equal(xtcPair.docking.ligands[0].binary, true);

  const lammps = join(allowed, 'lammps-pair');
  await mkdir(lammps);
  await writeFile(join(lammps, 'paired.pdb'), 'HEADER PAIRED');
  await writeFile(join(lammps, 'paired.lammpstrj'), 'ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n0\n');
  const lammpsPairResponse = await pairFor(join(lammps, 'paired.pdb'));
  assert.equal(lammpsPairResponse.status, 200);
  const lammpsPair = await lammpsPairResponse.json();
  assert.equal(lammpsPair.docking.ligands[0].format, 'lammpstrj');
  assert.equal(lammpsPair.docking.ligands[0].binary, false);
  assert.equal(
    Buffer.from(lammpsPair.payloads.ligands[0].dataBase64, 'base64').toString(),
    'ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n0\n',
  );
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
