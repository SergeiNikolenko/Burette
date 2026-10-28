// Exercise the real preparation pipeline against a tiny isolated source archive.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'burette-molstar-source-'));
let fixture = join(scratch, 'original');
try {
  const source = join(scratch, 'archive', 'source');
  await Promise.all(['packages/core/src', 'apps/viewer', 'apps/mesoscale-explorer'].map(path => mkdir(join(source, path), { recursive: true })));
  await writeFile(join(source, 'version.json'), JSON.stringify({ version: '6.0.0-dev.0' }));
  await writeFile(join(source, 'packages/core/package.json'), JSON.stringify({
    name: '@molstar/core', exports: { '.': { 'molstar-src': './src/index.ts' }, './*': { 'molstar-src': './src/*.ts' } },
  }));
  await writeFile(join(source, 'packages/core/src/index.ts'), `
export const identity = {};
export class ParameterProperty {
  value = this.input.value;
  constructor(private input: { value: number }) {}
}
`);
  const archive = join(scratch, 'source.tar.gz');
  const tar = spawnSync('tar', ['-czf', archive, '-C', join(scratch, 'archive'), 'source'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const bytes = await readFile(archive);
  const config = {
    repository: 'https://example.invalid/molstar-fixture', revision: 'a'.repeat(40), version: '6.0.0-dev.0',
    archive: `data:application/gzip;base64,${bytes.toString('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await Promise.all(['scripts', 'config', 'node_modules/.bin'].map(path => mkdir(join(fixture, path), { recursive: true })));
  for (const name of ['prepare-molstar-source.mjs', 'molstar-source.mjs', 'molstar-segmentor-lifecycle.mjs']) {
    await cp(join(repo, 'scripts', name), join(fixture, 'scripts', name));
  }
  // The fixture owns no TypeScript project. Stand in only for declaration emit;
  // real source compilation, package links, hashes and runtime imports are tested.
  await writeFile(join(fixture, 'node_modules/.bin/tsc'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config/molstar-source.json'), 'utf8'));
const output = path.join(root, '.tmp/molstar', config.revision, 'packages/core/lib');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'index.d.ts'), 'export declare const identity: object;');
`, { mode: 0o755 });
  await writeFile(join(fixture, 'run.mjs'), `
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { prepareMolstarSource, resolveMolstarModule } from './scripts/molstar-source.mjs';
await prepareMolstarSource();
const runtime = await import('@molstar/core');
const resolved = await import(pathToFileURL(resolveMolstarModule('@molstar/core')).href);
assert.equal(runtime.identity, resolved.identity, 'Package imports and build resolution share one module identity');
assert.equal(new runtime.ParameterProperty({ value: 37 }).value, 37, 'Compilation preserves parameter property initialization');
console.log('SOURCE_READY');
`);
  const saveConfig = value => writeFile(join(fixture, 'config/molstar-source.json'), JSON.stringify(value));
  await saveConfig(config);
  // Cold concurrent starts must all produce usable modules, with no partially
  // written manifests, duplicate identities, or package-link races.
  const cold = await Promise.all(Array.from({ length: 4 }, () => run()));
  for (const result of cold) assertReady(result);
  const firstModule = resolve(fixture, '.tmp/molstar', config.revision, '.burette-lib/packages/core/src/index.js');
  assert.ok(existsSync(firstModule));

  // Reusing node_modules after a revision switch must refresh every source link.
  const nextConfig = { ...config, revision: 'b'.repeat(40) };
  await saveConfig(nextConfig);
  assertReady(await run());

  // Move the complete prepared tree, including its absolute source symlinks.
  // The original path disappears, so a surviving absolute compiled import fails.
  const relocated = join(scratch, 'relocated');
  await rename(fixture, relocated);
  fixture = relocated;
  assertReady(await run());

  // An interrupted preparer must not permanently disable subsequent Bun starts.
  const lock = join(fixture, '.tmp/molstar/prepare.lock');
  await unlink(join(fixture, 'node_modules/.burette-molstar-source'));
  await mkdir(lock);
  await writeFile(join(lock, 'owner'), '2147483647');
  assertReady(await run());
  assert.equal(existsSync(lock), false, 'The dead-owner lock is reclaimed and released');

  // A source whose bytes do not match the pin never reaches compilation.
  await saveConfig({ ...nextConfig, sha256: '0'.repeat(64) });
  const rejected = await run();
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /integrity mismatch/);
  assert.equal(existsSync(lock), false, 'Integrity failures release the preparation lock');
  await saveConfig(nextConfig);
  assertReady(await run());
  console.log('Mol* source bootstrap: concurrent starts, module identity, class initialization, revision changes, relocation, dead locks and integrity checks passed');
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function assertReady(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /SOURCE_READY/);
}

function run() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ['run.mjs'], { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectRun(new Error('Isolated Mol* preparation timed out')); }, 15000);
    child.on('error', error => { clearTimeout(timer); rejectRun(error); });
    child.on('exit', code => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}
