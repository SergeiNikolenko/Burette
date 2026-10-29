// Frozen Cartesian atoms retain their mutual distances in reduced coordinates.
// A rigid fit then restores their absolute positions without restricting the
// other internal coordinates. Redundant distance equations are removed by QR.
import { bestRigidMotion } from './zmatrix-optimization';
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const maximum = (values: number[]) => Math.max(0, ...values.map(Math.abs));
const sub = (a: number[], b: number[]) => a.map((value, i) => value - b[i]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => Math.hypot(...a);

/** Retain the pose defined by all source atoms before satisfying frozen anchors.
 * Rank-one anchors determine only an axis: use its shortest rotation, without
 * introducing an arbitrary twist from a degenerate quaternion eigenspace. */
export function placeWithFrozenAtoms(points: number[][], reference: number[][], frozen: readonly number[]) {
  const sourceFit = bestRigidMotion(points, reference), placed = points.map(sourceFit.point);
  if (!frozen.length) return placed;
  const from = frozen.map(i => placed[i]), to = frozen.map(i => reference[i]);
  if (frozen.length === 1) return placed.map(point => point.map((value, i) => value + to[0][i] - from[0][i]));
  let farthest = 1;
  to.forEach((point, i) => { if (norm(sub(point, to[0])) > norm(sub(to[farthest], to[0]))) farthest = i; });
  const a = sub(from[farthest], from[0]), b = sub(to[farthest], to[0]);
  const u = a.map(value => value / norm(a)), v = b.map(value => value / norm(b));
  if (to.some(point => { const delta = sub(point, to[0]); return norm(cross(v, delta)) > 1e-8 * norm(delta); })) {
    const fit = bestRigidMotion(from, to);
    return placed.map(fit.point);
  }
  const k = cross(u, v), sine = norm(k), cosine = Math.max(-1, Math.min(1, dot(u, v)));
  let axis = sine > 1e-15 ? k.map(value => value / sine) : [0, 0, 0];
  if (sine <= 1e-15 && cosine < 0) {
    // Antiparallel axes admit many shortest half-turns. Let the complete source
    // geometry choose the perpendicular; a wholly linear source has no twist.
    const across = reference.map(point => { const delta = sub(point, to[0]); return delta.map((value, i) => value - dot(delta, v) * v[i]); });
    axis = across.reduce((best, value) => norm(value) > norm(best) ? value : best, [0, 0, 0]);
    if (norm(axis) < 1e-15) {
      const index = v.reduce((best, value, i) => Math.abs(value) < Math.abs(v[best]) ? i : best, 0);
      axis = v.map((value, i) => Number(i === index) - v[index] * value);
    }
    const size = norm(axis); axis = axis.map(value => value / size);
  }
  return placed.map(point => {
    const delta = sub(point, from[0]), turn = cross(axis, delta), along = dot(axis, delta);
    const rotated = sine <= 1e-15 && cosine >= 0 ? delta : delta.map((value, i) => cosine * value + sine * turn[i] + (1 - cosine) * along * axis[i]);
    return to[0].map((value, i) => value + rotated[i]);
  });
}

export function projectFrozenShape(initial: number[], residuals: (x: number[]) => number[]) {
  let x = initial.slice();
  for (let iteration = 0; iteration < 20; iteration++) {
    const residual = residuals(x);
    if (maximum(residual) < 1e-10) return x;
    const jacobian = residual.map(() => x.map(() => 0));
    x.forEach((value, column) => {
      const sample = x.slice(), h = 1e-5;
      sample[column] = value + h; const plus = residuals(sample);
      sample[column] = value - h; const minus = residuals(sample);
      residual.forEach((_, row) => { jacobian[row][column] = (plus[row] - minus[row]) / (2 * h); });
    });
    const basis: number[][] = [], correction = x.map(() => 0);
    jacobian.forEach((row, index) => {
      const direction = row.slice();
      // Reorthogonalize: frozen-atom distance constraints are often redundant.
      for (let pass = 0; pass < 2; pass++) for (const axis of basis) {
        const along = dot(direction, axis);
        direction.forEach((value, i) => { direction[i] = value - along * axis[i]; });
      }
      const length = Math.hypot(...direction);
      if (length < 1e-7) return;
      const axis = direction.map(value => value / length);
      const amount = (-residual[index] - dot(row, correction)) / length;
      correction.forEach((value, i) => { correction[i] = value + amount * axis[i]; });
      basis.push(axis);
    });
    let accepted = false;
    for (let step = 1; step >= 1 / 1024; step /= 2) {
      const candidate = x.map((value, i) => value + step * correction[i]);
      if (maximum(residuals(candidate)) < maximum(residual)) { x = candidate; accepted = true; break; }
    }
    if (!accepted) break;
  }
  throw new Error('The trial geometry cannot preserve the frozen atoms with these Z-matrix bindings.');
}
