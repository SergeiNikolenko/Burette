import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureGeometry } from '../scripts/molecular-geometry.js';
const atoms = points => points.map((position, i) => ({ id: String(i), position, occupancy: 1 }));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('analytic 3–4–5 distances and right angle with unchanged endpoint data', () => {
  const points = [[0, 0, 0], [3, 0, 0], [3, 4, 0]];
  close(measureGeometry('distance', atoms([points[0], points[1]])).value, 3);
  close(measureGeometry('distance', atoms([points[1], points[2]])).value, 4);
  const result = measureGeometry('distance', atoms([points[0], points[2]]));
  close(result.value, 5);
  assert.equal(result.units, 'angstrom');
  close(measureGeometry('angle', atoms(points)).value, 90);
  assert.deepEqual(points, [[0, 0, 0], [3, 0, 0], [3, 4, 0]]);
});

test('signed torsions and rigidly transformed coordinates', () => {
  const points = [[1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]];
  close(measureGeometry('dihedral', atoms(points)).value, 90);
  close(measureGeometry('dihedral', atoms(points.map(([x, y, z]) => [x, -y, z]))).value, -90);
  close(measureGeometry('dihedral', atoms(points.map(([x, y, z]) => [10 - y, 20 + x, z + 30]))).value, 90);
  assert.equal(measureGeometry('dihedral', atoms([[1, 2, 4], [0, 0, 0], [1, 1, 8], [0, -1, 4]])).value, 180);
});

test('degenerate/unknown endpoints fail; explicit zero occupancy is reported, not filtered', () => {
  assert.throws(() => measureGeometry('dihedral', atoms([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])), /collinear/);
  assert.throws(() => measureGeometry('angle', atoms([[0, 0, 0], [0, 0, 0], [1, 0, 0]])), /coincident/);
  assert.throws(() => measureGeometry('distance', atoms([[NaN, 0, 0], [1, 0, 0]])), /finite/);
  assert.throws(() => measureGeometry('distance', [{ id: 'a', position: [0, 0, 0] }, { id: 'a', position: [1, 0, 0] }]), /distinct/);
  const input = atoms([[0, 0, 0], [1, 0, 0]]);
  input[0].occupancy = 0;
  input[0].label_alt_id = 'A';
  const result = measureGeometry('distance', input);
  close(result.value, 1);
  assert.equal(result.warnings.length, 2);
  assert.deepEqual(result.endpoints.map(endpoint => endpoint.position), input.map(atom => atom.position));
});
