import type { UnitCell, Vec3 } from "../types";

/**
 * Distances between lattice images that do not depend on the basis chosen for
 * the lattice. Any lattice vector t + v with |t + v| < r has fractional
 * coordinates n_k + f_k = (t + v) · b*_k bounded by r |b*_k|, b*_k being the
 * dual (reciprocal) vectors, so enumerating those integer ranges is exact for
 * every basis. The basis is LLL-reduced first only to keep the ranges short:
 * an unreduced skew basis such as b' = 100a + b has long dual vectors.
 */

const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u: Vec3, v: Vec3): Vec3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const combine = (u: Vec3, scale: number, v: Vec3): Vec3 => [u[0] + scale * v[0], u[1] + scale * v[1], u[2] + scale * v[2]];

/** Lovász parameter; the classical 3/4 already bounds the dual vectors well in three dimensions. */
const LOVASZ = 0.99;
const MAX_SWAPS = 1_000;
/** An LLL-reduced basis needs a handful of candidates per search; more means a degenerate lattice. */
const MAX_CANDIDATES = 4_096;

export type ReducedLattice = { basis: UnitCell; dual: UnitCell };

/** LLL reduction of the cell's rows; the lattice itself is unchanged. */
export function reduceLattice(cell: UnitCell): ReducedLattice {
  const basis = cell.map((vector) => [...vector] as Vec3) as UnitCell;
  const gramSchmidt = () => {
    const star: Vec3[] = [];
    const mu = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) {
      let vector = basis[i];
      for (let j = 0; j < i; j++) {
        mu[i][j] = dot(basis[i], star[j]) / dot(star[j], star[j]);
        vector = combine(vector, -mu[i][j], star[j]);
      }
      star.push(vector);
    }
    return { star, mu };
  };
  let swaps = 0;
  for (let k = 1; k < 3;) {
    for (let j = k - 1; j >= 0; j--) {
      const q = Math.round(gramSchmidt().mu[k][j]);
      if (q) basis[k] = combine(basis[k], -q, basis[j]);
    }
    const { star, mu } = gramSchmidt();
    if (dot(star[k], star[k]) >= (LOVASZ - mu[k][k - 1] ** 2) * dot(star[k - 1], star[k - 1])) { k++; continue; }
    [basis[k], basis[k - 1]] = [basis[k - 1], basis[k]];
    k = Math.max(1, k - 1);
    if (++swaps > MAX_SWAPS) throw new Error("The unit cell is too skewed to reduce.");
  }
  const volume = dot(basis[0], cross(basis[1], basis[2]));
  const dual = [cross(basis[1], basis[2]), cross(basis[2], basis[0]), cross(basis[0], basis[1])].map((vector) => vector.map((value) => value / volume) as Vec3) as UnitCell;
  return { basis, dual };
}

/** Fractional coordinates of a Cartesian point in the reduced basis. */
export const reducedFractional = (lattice: ReducedLattice, point: Vec3): Vec3 => lattice.dual.map((vector) => dot(point, vector)) as Vec3;

/**
 * A search for the shortest |v + t| over lattice vectors t below `radius`
 * (t = 0 excluded when `excludeOrigin`); v is given in reduced fractional
 * coordinates. Returns null when no image is that close.
 */
export function imageSearch(lattice: ReducedLattice, radius: number, { excludeOrigin = false } = {}) {
  const reach = lattice.dual.map((vector) => radius * Math.hypot(...vector));
  const [u, v, w] = lattice.basis;
  return (fractional: Vec3): number | null => {
    const from = fractional.map((value, axis) => Math.ceil(-value - reach[axis]));
    const to = fractional.map((value, axis) => Math.floor(-value + reach[axis]));
    const candidates = [0, 1, 2].reduce((count, axis) => count * Math.max(0, to[axis] - from[axis] + 1), 1);
    if (candidates > MAX_CANDIDATES) throw new Error("The unit cell is too skewed to search for overlapping atoms.");
    let best: number | null = null;
    for (let i = from[0]; i <= to[0]; i++) {
      for (let j = from[1]; j <= to[1]; j++) {
        for (let k = from[2]; k <= to[2]; k++) {
          const a = fractional[0] + i, b = fractional[1] + j, c = fractional[2] + k;
          if (excludeOrigin && !a && !b && !c) continue;
          const distance = Math.hypot(a * u[0] + b * v[0] + c * w[0], a * u[1] + b * v[1] + c * w[1], a * u[2] + b * v[2] + c * w[2]);
          if (distance < radius && (best === null || distance < best)) best = distance;
        }
      }
    }
    return best;
  };
}

/** Length of the lattice's shortest nonzero translation. */
export function shortestTranslation(lattice: ReducedLattice) {
  const shortest = Math.min(...lattice.basis.map((vector) => Math.hypot(...vector)));
  // The basis vectors are lattice vectors, so the search radius always holds one.
  return imageSearch(lattice, shortest * (1 + 1e-12), { excludeOrigin: true })([0, 0, 0])!;
}
