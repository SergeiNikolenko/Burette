import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve(process.argv[2] || 'scripts/burette-agent.mjs');
const directory = await mkdtemp(join(tmpdir(), 'coordinate-cli-lossless-'));
const prefix = 'BURETTE_INTERNAL_COORDINATES_V1=';
let serial = 0;
function invoke(input, format, output, overwrite = false) {
  const result = spawnSync(process.execPath, [cli, 'convert', '--file', input, '--format', format, '--output', output, ...(overwrite ? ['--overwrite'] : [])],
    { cwd: directory, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.notEqual(result.signal, 'SIGTERM');
  const response = JSON.parse(result.status === 0 ? result.stdout : result.stderr);
  assert.equal(response.ok, result.status === 0);
  assert.equal(response.apiVersion, 'burette-agent-cli/v1');
  return response;
}
async function refused(bytes, extension = 'xyz', code) {
  const input = join(directory, `${serial++}.${extension}`), output = join(directory, `out-${serial}.${extension === 'xyz' ? 'zmat' : 'xyz'}`);
  await writeFile(input, bytes); await writeFile(output, 'retained destination');
  const before = await readFile(input), response = invoke(input, extension === 'xyz' ? 'zmat' : 'xyz', output, true);
  assert.equal(response.ok, false); if (code) assert.equal(response.error.code, code);
  assert.deepEqual(await readFile(input), before); assert.equal(await readFile(output, 'utf8'), 'retained destination');
}
function payload(text) { const match = text.match(/BURETTE_INTERNAL_COORDINATES_V1=([A-Za-z0-9_-]+)/); assert.ok(match); return JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); }
try {
  const input = join(directory, 'named.zmat'), middle = join(directory, 'named.xyz'), output = join(directory, 'restored.zmat');
  const original = '# sample burette-import-123\nC\nX 1 DX\nH 1 R 2 A\nF 1 +R 2 A 3 -P\n\nDX=1\nR=1.09\nA=109.5\nP=60\nUNUSED=-17.125\n';
  await writeFile(input, original);
  assert.equal(invoke(input, 'xyz', middle).ok, true);
  const xyz = await readFile(middle, 'utf8'), pair = payload(xyz);
  assert.deepEqual(pair.internalCoordinates, {
    rows: [{ element: 'C', refs: [], values: [] }, { element: 'X', refs: [0], values: ['DX'] }, { element: 'H', refs: [0, 1], values: ['R', 'A'] }, { element: 'F', refs: [0, 1, 2], values: ['+R', 'A', '-P'] }],
    variables: [{ name: 'DX', value: 1 }, { name: 'R', value: 1.09 }, { name: 'A', value: 109.5 }, { name: 'P', value: 60 }, { name: 'UNUSED', value: -17.125 }],
  });
  assert.deepEqual(pair.atoms.map(a => a.element), ['C', 'H', 'F']);
  assert.equal(xyz.split('\n')[1].startsWith('sample burette-import-123 '), true);
  assert.equal(invoke(middle, 'zmat', output).ok, true);
  assert.deepEqual(payload(await readFile(output, 'utf8')), pair);
  assert.equal(await readFile(input, 'utf8'), original);
  assert.equal(invoke(middle, 'zmat', output).error.code, 'OUTPUT_EXISTS');
  const retained = await readFile(output); assert.equal(invoke(middle, 'zmat', output, true).ok, true); assert.deepEqual(await readFile(output), retained);

  const legacy = join(directory, 'legacy.xyz'), migrated = join(directory, 'legacy.zmat');
  const legacyText = '1\nuser token zdef-0123abcd\nHe 42.1234567890123 -12 7\n'; await writeFile(legacy, legacyText);
  assert.equal(invoke(legacy, 'zmat', migrated).ok, true);
  const migration = await readFile(migrated, 'utf8');
  assert.equal(migration.includes('zdef-0123abcd'), false); assert.equal(migration.startsWith('# user token\n'), true);
  assert.deepEqual(payload(migration).atoms, [{ element: 'He', x: 42.1234567890123, y: -12, z: 7 }]);
  assert.equal(await readFile(legacy, 'utf8'), legacyText);

  await refused(Buffer.from([0xff, 0xfe, 0x31]), 'xyz', 'INVALID_COORDINATES');
  await refused('1\n' + 'x'.repeat(1048576 - 12) + '\nH 0 0 0\n', 'xyz', 'COORDINATE_LIMIT');
  await refused(xyz.replace(prefix, 'BURETTE_INTERNAL_COORDINATES_V2='), 'xyz', 'INVALID_COORDINATES');
  await refused(xyz.replace('C 0 0 0', 'C 0.000000000001 0 0'), 'xyz', 'INVALID_COORDINATES');
  await refused('H\nH 3 R\nR=1\n', 'zmat', 'INVALID_COORDINATES');
  await refused('1\n' + prefix + 'e30=\nH 0 0 0\n', 'xyz', 'INVALID_COORDINATES');
  const invalidInput = join(directory, 'directory.xyz'); await mkdir(invalidInput);
  assert.equal(invoke(invalidInput, 'zmat', join(directory, 'absent.zmat')).ok, false);
  const invalidOutput = join(directory, 'directory.zmat'); await mkdir(invalidOutput);
  assert.equal(invoke(legacy, 'zmat', invalidOutput, true).ok, false);
  console.log('Lossless coordinate CLI definitions, absolute pose, comments, UTF-8 and refusal preservation passed.');
} finally { await rm(directory, { recursive: true, force: true }); }
