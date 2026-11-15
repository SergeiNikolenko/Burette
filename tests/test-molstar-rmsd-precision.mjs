import assert from 'node:assert/strict';
import { MinimizeRmsd, RmsdTransformState } from '@molstar/core/math/linear-algebra/3d/minimize-rmsd';

const reference = [[0, 0, 0], [4, 0, 0], [5, 4, 0], [3, 5, 3]];
function positions(points) {
  return Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, Float64Array.from(points, point => point[i])]));
}
function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`);
}
let state;
for (const [cos, sin] of [[0, 1], [Math.cos(.37), Math.sin(.37)]]) {
  const moving = reference.map(([x, y, z]) => [cos * x - sin * y + 20, sin * x + cos * y - 12, z + 7]);
  const input = { a: positions(reference), b: positions(moving) };
  const expected = [cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, 1, 0, -20 * cos + 12 * sin, 20 * sin + 12 * cos, -7, 1];
  const result = MinimizeRmsd.compute(input);
  state ??= new RmsdTransformState(input, result);
  for (const aligned of [result, MinimizeRmsd.compute(input, undefined, state)]) {
    const matrix = aligned.bTransform;
    assert.equal(aligned.nAlignedElements, reference.length);
    matrix.forEach((value, i) => near(value, expected[i], `inverse matrix ${i}`));
    for (let i = 0; i < 3; ++i) for (let j = 0; j < 3; ++j) {
      let dot = 0;
      for (let k = 0; k < 3; ++k) dot += matrix[4 * i + k] * matrix[4 * j + k];
      near(dot, i === j ? 1 : 0, `orthogonality ${i},${j}`);
    }
    moving.forEach((point, index) => {
      for (let axis = 0; axis < 3; ++axis) {
        const actual = point.reduce((sum, value, k) => sum + value * matrix[4 * k + axis], matrix[12 + axis]);
        near(actual, reference[index][axis], `aligned atom ${index},${axis}`);
      }
    });
  }
}
console.log('Mol* RMSD precision: signed and general rotations, translation, orthogonality and reused state passed');
