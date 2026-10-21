import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MolecularSurfaceFieldCache } from '../scripts/molstar-surface-field-cache.js';
import { patchMolstarSurfaceFieldCache } from '../scripts/molstar-surface-field-cache.mjs';
import { calcMolecularSurface } from 'molstar/lib/mol-math/geometry/molecular-surface.js';
import { getBoundary } from 'molstar/lib/mol-math/geometry/boundary.js';
import { computeMarchingCubesMesh } from 'molstar/lib/mol-geo/util/marching-cubes/algorithm.js';

function input() {
  const position = { indices: Int32Array.of(0, 1), x: Float32Array.of(0, 2),
    y: Float32Array.of(0, 0), z: Float32Array.of(0, 0),
    radius: Float32Array.of(3, 2.9), id: Int32Array.of(0, 1) };
  return { position, boundary: getBoundary(position), maxRadius: 1.6,
    props: { resolution: 0.5, probeRadius: 1.4, probePositions: 36 } };
}
const compute = i => calcMolecularSurface({ shouldUpdate: false }, i.position, i.boundary,
  i.maxRadius, i.boundary.box, i.props);
const values = f => ({ field: f.field.data, idField: f.idField.data, dimensions: f.field.space.dimensions,
  transform: f.transform, resolution: f.resolution, maxRadius: f.maxRadius });
const cache = new MolecularSurfaceFieldCache(1024 * 1024);
const unit = {}, original = input();
let calculations = 0;
const get = (u, i) => cache.getOrCreate(u, i, () => { calculations++; return compute(i); });
const cold = await get(unit, original);
const reference = await compute(original);
assert.deepEqual(values(cold), values(reference));
assert.equal(await get(unit, input()), cold);
assert.equal(calculations, 1);
// Actual marching-cubes consumers must not mutate the cached scalar/group fields.
await computeMarchingCubesMesh({ isoLevel: original.props.probeRadius,
  scalarField: cold.field, idField: cold.idField }).run();
assert.deepEqual(values(cold), values(reference));
assert.equal(await get(unit, original), cold);

for (const mutate of [
  i => { i.position.x[0] += 0.1; },
  i => { i.position.y[0] += 0.1; },
  i => { i.position.z[0] += 0.1; },
  i => { i.position.radius[0] += 0.1; },
  i => { i.position.id[0] = 7; },
  i => { i.position.indices = Int32Array.of(1); i.position.id = Int32Array.of(1); },
  i => { i.props.resolution = 0.6; },
  i => { i.props.probeRadius = 1.5; },
  i => { i.props.probePositions = 48; },
  i => { i.maxRadius = 1.7; },
  i => { i.boundary.box.min[0] -= 1; },
  i => { i.boundary.box.max[2] += 1; },
]) {
  const changed = input(); mutate(changed);
  const before = calculations;
  const field = await get(unit, changed);
  assert.equal(calculations, before + 1);
  assert.deepEqual(values(field), values(await compute(changed)));
  assert.equal(await get(unit, changed), field);
}
const otherUnitField = await get({}, original);
assert.notEqual(otherUnitField, cold, 'independent molecules do not share identity');

const size = cold.field.data.byteLength + cold.idField.data.byteLength
  + cold.transform.length * 8 + (10 + 2 * 6) * 8;
const bounded = new MolecularSurfaceFieldCache(size * 2);
const a = {}, b = {}, c = {};
let misses = 0;
const boundedGet = u => bounded.getOrCreate(u, original, () => { misses++; return compute(original); });
await boundedGet(a); await boundedGet(b); await boundedGet(a); await boundedGet(c);
assert.equal(misses, 3);
assert.ok(bounded.bytes <= size * 2);
await boundedGet(a); assert.equal(misses, 3);
await boundedGet(b); assert.equal(misses, 4, 'least recently used field was released');
// Repeated ordered scans larger than the budget must retain useful hits.
const scan = new MolecularSurfaceFieldCache(size * 2);
const units = [{}, {}, {}, {}];
let scanMisses = 0;
const scanGet = u => scan.getOrCreate(u, original, () => { scanMisses++; return compute(original); });
for (const u of units) await scanGet(u);
const evicted = scan.units.get(units[0]);
assert.deepEqual(evicted, { field: undefined, input: undefined, bytes: size, evicted: true });
for (let pass = 0; pass < 3; pass++) {
  const before = scanMisses;
  for (const u of units) assert.deepEqual(values(await scanGet(u)), values(reference));
  assert.equal(scanMisses - before, 2, 'the retained half survives each full scan');
  assert.equal(scan.bytes, size * 2);
}
const newUnit = {};
await scanGet(newUnit);
const beforeNewHit = scanMisses;
await scanGet(newUnit);
assert.equal(scanMisses, beforeNewHit, 'new documents can replace old retained units');
const tiny = new MolecularSurfaceFieldCache(1);
assert.notEqual(await tiny.getOrCreate(a, original, () => compute(original)),
  await tiny.getOrCreate(a, original, () => compute(original)));
assert.equal(tiny.bytes, 0);

const failed = new MolecularSurfaceFieldCache(1024 * 1024);
await assert.rejects(failed.getOrCreate(a, original, async () => { throw new Error('aborted'); }), /aborted/);
assert.equal(failed.bytes, 0);
await failed.getOrCreate(a, original, () => compute(original));
let resolveOld;
const changed = input(); changed.position.x[0] += 1;
const pending = failed.getOrCreate(a, changed, () => new Promise(resolve => { resolveOld = resolve; }));
const newer = await failed.getOrCreate(a, original, () => compute(original));
resolveOld(await compute(changed)); await pending;
assert.equal(await failed.getOrCreate(a, original, () => { throw new Error('stale result replaced newer entry'); }), newer);
const moving = input(); moving.position.x[0] += 2;
const mutable = failed.getOrCreate(a, moving, () => new Promise(resolve => { resolveOld = resolve; }));
moving.position.x[0] += 1; resolveOld(await compute(moving)); await mutable;
assert.equal(failed.bytes, 0, 'inputs changed during the task are not cached');

const source = await readFile(new URL('../node_modules/molstar/lib/mol-repr/structure/visual/util/molecular-surface.js', import.meta.url), 'utf8');
const patched = patchMolstarSurfaceFieldCache(source);
assert.equal(patched.split('buretteSurfaceFields.getOrCreate').length, 2);
assert.throws(() => patchMolstarSurfaceFieldCache(patched), /layout changed/);
assert.throws(() => patchMolstarSurfaceFieldCache('changed upstream layout'), /layout changed/);
console.log('Molecular surface field cache: exact fields, invalidation, LRU, abort and race checks passed');
