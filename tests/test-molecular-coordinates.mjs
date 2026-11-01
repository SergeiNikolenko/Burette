import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readCoordinateInterchange } from '../scripts/coordinate-interchange.mjs';
import { atomsFromZmatrixRows, placeInReferenceFrame, zmatrixRowsFromAtoms } from '../scripts/internal-coordinates.mjs';

const root = await mkdtemp(join(tmpdir(), 'burette-coordinates-'));
const cli = resolve(process.argv[2] || 'scripts/burette-agent.mjs');
let serial = 0;
function run(args, success = true) {
  const child = spawnSync(process.execPath, [cli, 'convert', ...args], { cwd: root, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.ifError(child.error);
  assert.equal(child.status === 0, success, child.stderr || child.stdout);
  const response = JSON.parse(success ? child.stdout : child.stderr);
  assert.equal(response.ok, success);
  assert.equal(response.apiVersion, 'burette-agent-cli/v1');
  return response;
}
async function convert(text, inputFormat = 'xyz', success = true) {
  const input = join(root, `${serial++}.${inputFormat}`);
  const format = inputFormat === 'xyz' ? 'zmat' : 'xyz';
  const output = join(root, `${serial++}.${format}`);
  await writeFile(input, text);
  const response = run(['--file', input, '--format', format, '--output', output], success);
  if (!success) {
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    return response.error;
  }
  const content = await readFile(output, 'utf8');
  assert.equal(response.result.byteCount, Buffer.byteLength(content));
  assert.deepEqual(response.result, { inputPath: input, outputPath: output, inputFormat, format, atomCount: Number((inputFormat === 'xyz' ? text : content).split('\n')[0]), byteCount: Buffer.byteLength(content) });
  return content;
}
const xyz = atoms => `${atoms.length}\nTest molecule\n${atoms.map(a => a.join(' ')).join('\n')}\n`;
const parse = text => text.trim().split('\n').slice(2).map(line => line.split(/\s+/).map((v, i) => i ? Number(v) : v));
const subtract = (a, b) => a.slice(1).map((v, i) => v - b[i + 1]);
const distance = (a, b) => Math.hypot(...subtract(a, b));
function volume(atoms) {
  const [a, b, c] = atoms.slice(1, 4).map(atom => subtract(atom, atoms[0]));
  return a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}
async function roundtrip(atoms) {
  const zmat = await convert(xyz(atoms));
  const result = parse(await convert(zmat, 'zmat'));
  assert.deepEqual(result, atoms, "Every absolute Cartesian coordinate survives without alignment.");
  assert.deepEqual(result.map(atom => atom[0]), atoms.map(atom => atom[0]));
  for (let i = 0; i < atoms.length; i++) {
    for (let j = 0; j < i; j++) assert.ok(Math.abs(distance(atoms[i], atoms[j]) - distance(result[i], result[j])) < 2e-9);
  }
  if (atoms.length >= 4 && Math.abs(volume(atoms)) > 1e-6) {
    assert.ok(volume(atoms) * volume(result) > 0, 'Roundtrip must preserve handedness.');
    assert.ok(Math.abs(volume(atoms) - volume(result)) < 2e-8);
  }
  assert.equal(await convert(xyz(atoms)), zmat, 'Export must be deterministic.');
}

try {
  const named = parse(await convert('O\nH 1 R\nH 1 R 2 A\nR=0.9572\nA=104.52\n', 'zmat'));
  assert.deepEqual(named.map(atom => atom[0]), ['O', 'H', 'H']);
  assert.ok(Math.abs(distance(named[0], named[1]) - 0.9572) < 1e-12);
  assert.ok(Math.abs(distance(named[0], named[2]) - 0.9572) < 1e-12);
  const dummy = parse(await convert('C\nX 1 1\nO 1 1.2 2 90\nO 1 1.2 2 90 3 180\n', 'zmat'));
  assert.deepEqual(dummy.map(atom => atom[0]), ['C', 'O', 'O']);
  assert.ok(Math.abs(distance(dummy[1], dummy[2]) - 2.4) < 1e-12);
  await roundtrip([['C', 0, 0, 0], ['C', 1, 0, 0], ['C', 2, 0, 0], ['H', 1, 1, 0], ['F', 2, 1, 1]]);
  await roundtrip([['He', 42, -12, 7]]);
  await roundtrip([['H', 1, 2, 3], ['H', 1, 2, 3.74]]);
  await roundtrip([['O', 0, 0, 0], ['H', 0.9572, 0, 0], ['H', -0.2399872, 0.927297, 0]]);
  await roundtrip([['C', 3, -2, 5], ['F', 4, -1, 6], ['Cl', 2, -3, 6], ['Br', 2, -1, 4], ['I', 4, -3, 4]]);
  await roundtrip([['C', 0, 0, 0], ['O', 0, 0, 1.2], ['O', 0, 0, -1.2], ['H', 0, 0, 2.4]]);
  await roundtrip([['C', 0, 0, 0], ['C', 1, 2, 3], ['C', 3, 6, 9], ['C', 7, 14, 21]]);
  await roundtrip(Array.from({ length: 30 }, (_, i) => ['C', Math.sin(i * 1.7) * 3 + i / 10, Math.cos(i * 0.8) * 2, Math.sin(i * 0.3) * 4]));
  const almostLinear = [['C', 0, 0, 0], ['H', -200000, 0, 0], ['Cl', -100000, 100000, 0], ['F', 1000000, 4e-7, 4e-7]];
  const almostLinearResult = parse(await convert(await convert(xyz(almostLinear)), 'zmat'));
  assert.ok(Math.abs(volume(almostLinear) - volume(almostLinearResult)) < Math.abs(volume(almostLinear)) * 1e-3, 'Small angular displacement must retain signed volume at large scale.');
  assert.ok(volume(almostLinear) * volume(almostLinearResult) > 0);
  // Neighbour references keep this placement off the near-linear C–H axis, so
  // export succeeds; distances and the sign of the handedness must survive.
  const offAxis = almostLinear.map((atom, i) => i === 3 ? ['F', 1000000, 1e-12, 1e-12] : atom);
  const offAxisResult = parse(await convert(await convert(xyz(offAxis)), 'zmat'));
  for (let i = 0; i < 4; i++) for (let j = 0; j < i; j++) assert.ok(Math.abs(distance(offAxis[i], offAxis[j]) - distance(offAxisResult[i], offAxisResult[j])) < 2e-9);
  assert.ok(volume(offAxis) * volume(offAxisResult) > 0);
  // Independent signed-torsion fixture: +90 degrees places atom 4 at negative Y.
  const known = parse(await convert('C\nH 1 1\nH 1 1 2 90\nH 1 1 2 90 3 90\n', 'zmat'));
  assert.ok(Math.abs(known[3][1]) < 1e-12 && Math.abs(known[3][2] + 1) < 1e-12 && Math.abs(known[3][3]) < 1e-12);
  assert.equal((await convert('O\nH 1 1\nH 1 1 2 180\nH 2 1 1 180 3 0\n', 'zmat')).split('\n')[0], '4');
  for (const text of [
    'H\nH 2 1\n', 'H\nH 1 1\nO 1 1 1 90\n', 'H\nH 1 NaN\n', 'H\nH 1 1e999\n',
    'H\nH 1 R\nS=1\n', 'X\n', 'H\nH 1 0\n', 'H\nH 1 1\nO 1 1 2 181\n',
    'H\nH 1 1\nO 1 1 2 90\nC 1 1 2 90 3 181\n',
    'C\nC 1 1\nC 2 1 1 180\nH 1 1 2 90 3 0\n',
  ]) assert.equal((await convert(text, 'zmat', false)).code, 'INVALID_COORDINATES');
  for (const text of ['1\ncomment\nH NaN 0 0\n', '1\ncomment\nX 0 0 0\n', '1\ncomment\nH 0 0 0 extra\n', '2\ncomment\nH 0 0 0\n', '1\ncomment\nH 0 0 0\n1\ncomment\nH 1 0 0\n', xyz([['H', 0, 0, 0], ['H', 0, 0, 0]])]) {
    assert.equal((await convert(text, 'xyz', false)).code, 'INVALID_COORDINATES');
  }
  for (const text of ['513\n\n', '0\n\n', ' '.repeat(1024 * 1024 + 1)]) assert.equal((await convert(text, 'xyz', false)).code, 'COORDINATE_LIMIT');
  for (const atoms of [[['H', -999999, 0, 0], ['H', 999999, 0, 0]], [['H', -999999, -999999, -999999], ['H', 999999, 999999, 999999]]]) {
    assert.equal((await convert(xyz(atoms), 'xyz', false)).code, 'INVALID_COORDINATES', 'Export must reject an out-of-bounds canonical frame before writing.');
  }
  const input = join(root, 'safe.xyz'), output = join(root, 'safe.zmat');
  const source = xyz([['H', 0, 0, 0]]);
  await writeFile(input, source);
  await writeFile(output, 'keep this');
  const args = ['--file', input, '--format', 'zmat', '--output', output];
  assert.equal(run(args, false).error.code, 'OUTPUT_EXISTS');
  assert.equal(await readFile(output, 'utf8'), 'keep this');
  run([...args, '--overwrite']);
  assert.deepEqual(readCoordinateInterchange(await readFile(output, 'utf8'), 'zmat').atoms, [{ element: 'H', x: 0, y: 0, z: 0 }]);
  assert.equal(run(['--file', input, '--format', 'zmat', '--output', input, '--overwrite'], false).error.code, 'SAME_INPUT_OUTPUT');
  for (const [kind, create] of [['hard', link], ['symbolic', symlink]]) {
    const alias = join(root, `${kind}.zmat`);
    await create(input, alias);
    run(['--file', input, '--format', 'zmat', '--output', alias, '--overwrite'], false);
    assert.equal(await readFile(input, 'utf8'), source);
  }
  for (const args of [[], ['--file', input, '--format', 'pdb', '--output', output], ['--file', input, '--format', 'xyz', '--output', output], ['--file', input, '--format', 'zmat', '--output', output, '--typo']]) {
    assert.equal(run(args, false).error.code, 'INVALID_ARGS');
  }
  // Editor geometry: chains reference bonded neighbours, an unedited matrix
  // rebuilds in place, and one torsion edit moves only the dependent atom.
  const butane = [[0, 0, 0], [1.53, 0, 0], [2.04, 1.44, 0], [3.57, 1.44, 0.3], [4.0, 2.4, 0.9]].map((position, i) => ({ element: i === 4 ? 'H' : 'C', position }));
  const rows = zmatrixRowsFromAtoms(butane);
  assert.deepEqual(rows.map(row => row.refs), [[], [0], [1, 0], [2, 1, 0], [3, 2, 1]]);
  const placed = placeInReferenceFrame(atomsFromZmatrixRows(rows), butane);
  placed.forEach((atom, i) => assert.ok(Math.hypot(...atom.position.map((v, k) => v - butane[i].position[k])) < 1e-9));
  const twisted = placeInReferenceFrame(atomsFromZmatrixRows(rows.map((row, i) => i === 3 ? { ...row, values: [row.values[0], row.values[1], row.values[2] - Math.sign(row.values[2]) * 60] } : row)), butane);
  twisted.slice(0, 3).forEach((atom, i) => assert.ok(Math.hypot(...atom.position.map((v, k) => v - butane[i].position[k])) < 1e-9));
  assert.ok(Math.hypot(...twisted[3].position.map((v, k) => v - butane[3].position[k])) > 0.5);
  const bondLength = (a, b) => Math.hypot(...a.position.map((v, k) => v - b.position[k]));
  assert.ok(Math.abs(bondLength(twisted[2], twisted[3]) - bondLength(butane[2], butane[3])) < 1e-9);
  console.log('Coordinate CLI conversions, geometry, chirality, validation bounds and safe writes passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
