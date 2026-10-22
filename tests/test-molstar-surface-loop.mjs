import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { patchMolstarSurfaceLoop } from '../scripts/molstar-surface-loop.mjs';
import { calcMolecularSurface } from 'molstar/lib/mol-math/geometry/molecular-surface.js';
import { getBoundary } from 'molstar/lib/mol-math/geometry/boundary.js';
import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { computeMarchingCubesMesh } from 'molstar/lib/mol-geo/util/marching-cubes/algorithm.js';

const url = new URL('../node_modules/molstar/lib/mol-math/geometry/molecular-surface.js', import.meta.url);
const source = await readFile(url, 'utf8');
const patched = patchMolstarSurfaceLoop(source).replace(/from '(\.[^']+)'/gu, (_, path) => `from '${new URL(path, url)}'`);
const { calcMolecularSurface: optimized } = await import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
assert.throws(() => patchMolstarSurfaceLoop(patched), /surface loop changed/);
assert.throws(() => patchMolstarSurfaceLoop('different upstream'), /surface loop changed/);
const values = f => ({ field: f.field.data, id: f.idField.data, dimensions: f.field.space.dimensions,
  transform: f.transform, resolution: f.resolution, maxRadius: f.maxRadius });
for (const indices of [Int32Array.of(0, 2, 4), OrderedSet.ofBounds(1, 5)]) {
  for (const resolution of [0.3, 0.7]) for (const probeRadius of [0, 0.4, 1.4]) {
    const position = { indices, x: Float32Array.of(0, 1, 2, 2.4, 4),
      y: Float32Array.of(0, 0.3, 0.1, 1, 0), z: Float32Array.of(0, 0, 0.4, 0, 0),
      radius: Float32Array.from([1.7, 1.2, 1.52, 1.55, 1.8], r => r + probeRadius),
      id: Int32Array.of(11, 5, 29, 2) };
    const boundary = getBoundary(position);
    const props = { resolution, probeRadius, probePositions: 36 };
    const updates = [[], []];
    const args = [position, boundary, 1.8, boundary.box, props];
    const before = await calcMolecularSurface({ shouldUpdate: true, update: async p => updates[0].push(p) }, ...args);
    const after = await optimized({ shouldUpdate: true, update: async p => updates[1].push(p) }, ...args);
    assert.deepEqual(values(after), values(before));
    assert.deepEqual(updates[1], updates[0], 'Progress and cancellation yield boundaries remain unchanged');
    const meshes = await Promise.all([before, after].map(f => computeMarchingCubesMesh({
      isoLevel: probeRadius, scalarField: f.field, idField: f.idField }).run()));
    for (const key of ['vertexBuffer', 'indexBuffer', 'normalBuffer', 'groupBuffer']) {
      assert.deepEqual(meshes[1][key].ref.value, meshes[0][key].ref.value);
    }
    await assert.rejects(optimized({ shouldUpdate: true, update: async () => { throw Error('cancelled'); } }, ...args), /cancelled/);
  }
}
console.log('Surface loop preserves bitwise fields, groups, mesh, progress and cancellation for sparse and interval selections');
