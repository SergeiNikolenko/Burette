import type { CartesianHessian } from "./hessian";
import type { VibrationalMode } from "./scientific-types";
import type { MolecularAtom, Vec3 } from "./types";

// CODATA 2018: Eh, bohr, unified atomic mass unit and the speed of light.
const HARTREE_J = 4.3597447222071e-18, BOHR_M = 5.29177210903e-11, AMU_KG = 1.66053906660e-27, C_CM_S = 2.99792458e10;
/** √(Eh/(bohr²·amu)) in cm⁻¹. */
const CM1_PER_AU = Math.sqrt(HARTREE_J / (BOHR_M ** 2 * AMU_KG)) / (2 * Math.PI * C_CM_S);
/** Eh/bohr² in mdyn/Å. */
const MDYN_ANGSTROM_PER_AU = HARTREE_J / BOHR_M ** 2 / 100;
const BOHR_ANGSTROM = 0.529177210903;

/**
 * Eigenvalues (ascending) and eigenvectors (columns, row-major n×n) of a symmetric matrix:
 * Householder tridiagonalization and the implicit QL algorithm (tred2/tql2 of EISPACK, as
 * published in the public-domain JAMA library).
 */
export function symmetricEigen(matrix: Float64Array, n: number) {
  const V = Float64Array.from(matrix), d = new Float64Array(n), e = new Float64Array(n);
  const at = (r: number, c: number) => V[r * n + c];
  for (let j = 0; j < n; j++) d[j] = at(n - 1, j);
  for (let i = n - 1; i > 0; i--) {
    let scale = 0, h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) { d[j] = at(i - 1, j); V[i * n + j] = 0; V[j * n + i] = 0; }
    } else {
      for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      let f = d[i - 1], g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j]; V[j * n + i] = f; g = e[j] + at(j, j) * f;
        for (let k = j + 1; k <= i - 1; k++) { g += at(k, j) * d[k]; e[k] += at(k, j) * f; }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j]; g = e[j];
        for (let k = j; k <= i - 1; k++) V[k * n + j] -= f * e[k] + g * d[k];
        d[j] = at(i - 1, j); V[i * n + j] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[(n - 1) * n + i] = at(i, i); V[i * n + i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = at(k, i + 1) / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += at(k, i + 1) * at(k, j);
        for (let k = 0; k <= i; k++) V[k * n + j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k * n + i + 1] = 0;
  }
  for (let j = 0; j < n; j++) { d[j] = at(n - 1, j); V[(n - 1) * n + j] = 0; }
  V[(n - 1) * n + n - 1] = 1; e[0] = 0;

  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0, tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n && Math.abs(e[m]) > eps * tst1) m++;
    if (m > l) {
      let iterations = 0;
      do {
        if (++iterations > 64) throw new Error("Hessian diagonalization did not converge.");
        let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1, c2 = c, c3 = c, s = 0, s2 = 0;
        const el1 = e[l + 1];
        for (let i = m - 1; i >= l; i--) {
          c3 = c2; c2 = c; s2 = s;
          g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
          e[i + 1] = s * r; s = e[i] / r; c = p / r;
          p = c * d[i] - s * g; d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) {
            h = V[k * n + i + 1];
            V[k * n + i + 1] = s * V[k * n + i] + c * h;
            V[k * n + i] = c * V[k * n + i] - s * h;
          }
        }
        p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += f; e[l] = 0;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[a] - d[b]);
  const vectors = new Float64Array(n * n);
  order.forEach((column, j) => { for (let k = 0; k < n; k++) vectors[k * n + j] = V[k * n + column]; });
  return { values: Float64Array.from(order, i => d[i]), vectors };
}

/**
 * Harmonic normal modes of a Cartesian Hessian (Hartree/bohr²) with the masses (amu) its source
 * states. Translations and rotations about the centre of mass are projected out of the
 * mass-weighted Hessian (five for a linear geometry), so the result has 3N − 6 (3N − 5) modes in
 * ascending frequency; an imaginary frequency is negative. Displacements are the Cartesian
 * vectors of each mode, normalized to unit length; the reduced mass is 1/Σ(lᵢ²/mᵢ) of the unit
 * mass-weighted vector l, as Gaussian prints it.
 */
export function harmonicModes(atoms: readonly MolecularAtom[], hessian: CartesianHessian): VibrationalMode[] {
  const masses = hessian.massesAmu;
  const count = atoms.length, n = 3 * count;
  if (!masses || masses.length !== count) throw new Error("Normal modes need the atomic masses the Hessian's source states.");
  if (hessian.dimension !== n) throw new Error("The Hessian does not match the atoms.");
  const root = masses.map(Math.sqrt);
  const weighted = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    weighted[i * n + j] = (hessian.values[i * n + j] + hessian.values[j * n + i]) / 2 / (root[Math.floor(i / 3)] * root[Math.floor(j / 3)]);
  }
  // Rigid-body motions in mass-weighted coordinates, orthonormalized.
  const total = masses.reduce((sum, mass) => sum + mass, 0);
  const position = atoms.map(atom => [atom.x, atom.y, atom.z].map(value => value / BOHR_ANGSTROM) as Vec3);
  const centre = [0, 1, 2].map(axis => position.reduce((sum, r, a) => sum + masses[a] * r[axis], 0) / total);
  const relative = position.map(r => r.map((value, axis) => value - centre[axis]) as Vec3);
  const external: Float64Array[] = [];
  const candidates: Float64Array[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const translation = new Float64Array(n), rotation = new Float64Array(n);
    for (let a = 0; a < count; a++) {
      translation[3 * a + axis] = root[a];
      // e_axis × r
      const [x, y, z] = relative[a];
      const cross: Vec3 = axis === 0 ? [0, -z, y] : axis === 1 ? [z, 0, -x] : [-y, x, 0];
      for (let k = 0; k < 3; k++) rotation[3 * a + k] = root[a] * cross[k];
    }
    candidates.push(translation, rotation);
  }
  const scaleLength = Math.sqrt(total) * Math.max(1, ...relative.flat().map(Math.abs));
  for (const vector of candidates) {
    for (const basis of external) {
      let dot = 0;
      for (let k = 0; k < n; k++) dot += vector[k] * basis[k];
      for (let k = 0; k < n; k++) vector[k] -= dot * basis[k];
    }
    const norm = Math.hypot(...vector);
    // A linear geometry has no rotation about its axis.
    if (norm > 1e-6 * scaleLength) external.push(vector.map(value => value / norm));
  }
  // P H P with P = 1 − Σ e eᵀ.
  const project = (matrix: Float64Array) => {
    for (const basis of external) {
      const row = new Float64Array(n);
      for (let i = 0; i < n; i++) { let sum = 0; for (let k = 0; k < n; k++) sum += matrix[i * n + k] * basis[k]; row[i] = sum; }
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) matrix[i * n + j] -= row[i] * basis[j];
      for (let j = 0; j < n; j++) { let sum = 0; for (let k = 0; k < n; k++) sum += basis[k] * matrix[k * n + j]; row[j] = sum; }
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) matrix[i * n + j] -= basis[i] * row[j];
    }
  };
  project(weighted);
  const { values, vectors } = symmetricEigen(weighted, n);
  // The projected rigid motions are the eigenvectors lying in the external space.
  const overlap = Array.from({ length: n }, (_, j) => external.reduce((sum, basis) => {
    let dot = 0;
    for (let k = 0; k < n; k++) dot += vectors[k * n + j] * basis[k];
    return sum + dot * dot;
  }, 0));
  const rigid = new Set(Array.from({ length: n }, (_, j) => j).sort((a, b) => overlap[b] - overlap[a]).slice(0, external.length));
  const modes: VibrationalMode[] = [];
  for (let j = 0; j < n; j++) {
    if (rigid.has(j)) continue;
    const cartesian = Array.from({ length: n }, (_, k) => vectors[k * n + j] / root[Math.floor(k / 3)]);
    const squared = cartesian.reduce((sum, value) => sum + value * value, 0);
    const reducedMassAmu = 1 / squared, length = Math.sqrt(squared);
    const frequencyCm1 = Math.sign(values[j]) * Math.sqrt(Math.abs(values[j])) * CM1_PER_AU;
    modes.push({ index: modes.length, frequencyCm1, reducedMassAmu, forceConstantMdynAngstrom: values[j] * reducedMassAmu * MDYN_ANGSTROM_PER_AU,
      displacements: Array.from({ length: count }, (_, a) => [0, 1, 2].map(axis => cartesian[3 * a + axis] / length) as Vec3) });
  }
  return modes;
}
