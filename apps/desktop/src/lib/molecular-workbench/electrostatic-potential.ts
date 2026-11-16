import { boxAround } from "./gaussian";
import type { ScalarGrid } from "./scientific-types";
import type { MolecularAtom } from "./types";

const BOHR = 0.529177210903;
// Half the browser's million-value Cube, so the potential and the surface it colours fit in one.
const MAX_POINTS = 500_000;
/** Grid points times charges; above it the grid gets coarser instead of stalling the worker. */
const MAX_WORK = 200_000_000;

/**
 * Coulomb potential of point charges (elementary charges at the atoms, Å) at `point`,
 * in hartree per elementary charge: the atomic unit Gaussian's cubegen writes.
 */
export function coulombPotential(atoms: readonly MolecularAtom[], charges: readonly number[], point: readonly [number, number, number]) {
  let sum = 0;
  for (let i = 0; i < atoms.length; i++) {
    const distance = Math.hypot(point[0] - atoms[i].x, point[1] - atoms[i].y, point[2] - atoms[i].z) / BOHR;
    // A grid point on a nucleus is inside every surface; it only needs to stay finite.
    sum += charges[i] / Math.max(distance, 1e-3);
  }
  return sum;
}

/**
 * The potential of the charges on a box 4 Å beyond the atoms, z index fastest as in a Cube.
 * The spacing starts at 0.3 Å and widens until the grid fits the browser's work bound.
 */
export function coulombPotentialGrid(atoms: readonly MolecularAtom[], charges: readonly number[], spacingAngstrom = 0.3): ScalarGrid {
  if (!atoms.length || atoms.length > 10_000 || charges.length !== atoms.length || !charges.every(Number.isFinite)) throw new Error("Each atom needs one finite charge.");
  let spacing = spacingAngstrom, box = boxAround(atoms, { spacingAngstrom: spacing, paddingAngstrom: 4 });
  const pointsOf = (grid: typeof box) => grid.dimensions[0] * grid.dimensions[1] * grid.dimensions[2];
  while (pointsOf(box) > MAX_POINTS || pointsOf(box) * atoms.length > MAX_WORK) {
    spacing *= 1.25;
    if (spacing > 2) throw new Error("The molecule is too large for an electrostatic potential grid.");
    box = boxAround(atoms, { spacingAngstrom: spacing, paddingAngstrom: 4 });
  }
  const [nx, ny, nz] = box.dimensions, [ox, oy, oz] = box.origin;
  const at = new Float64Array(atoms.length * 3);
  atoms.forEach((atom, i) => { at[3 * i] = atom.x / BOHR; at[3 * i + 1] = atom.y / BOHR; at[3 * i + 2] = atom.z / BOHR; });
  const values = new Float32Array(nx * ny * nz), step = spacing / BOHR;
  let index = 0;
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const px = ox / BOHR + x * step, py = oy / BOHR + y * step, pz = oz / BOHR + z * step;
    let sum = 0;
    for (let i = 0; i < charges.length; i++) {
      sum += charges[i] / Math.max(Math.hypot(px - at[3 * i], py - at[3 * i + 1], pz - at[3 * i + 2]), 1e-3);
    }
    values[index++] = sum;
  }
  return { ...box, values };
}

// Bondi's radii (Mantina's for B), Å; other elements get 2 Å.
const VDW_RADII: Record<string, number> = {
  H: 1.2, He: 1.4, Li: 1.82, B: 1.92, C: 1.7, N: 1.55, O: 1.52, F: 1.47, Ne: 1.54, Na: 2.27, Mg: 1.73, Si: 2.1, P: 1.8, S: 1.8, Cl: 1.75,
  Ar: 1.88, K: 2.75, Ni: 1.63, Cu: 1.4, Zn: 1.39, Ga: 1.87, As: 1.85, Se: 1.9, Br: 1.85, Kr: 2.02, Pd: 1.63, Ag: 1.72, Cd: 1.58, Sn: 2.17, Te: 2.06, I: 1.98, Xe: 2.16, Pt: 1.75, Au: 1.66, Hg: 1.55,
};
/** The value of `vanDerWaalsField` on the surface. */
export const VAN_DER_WAALS_ISOVALUE = 1;

/**
 * A smooth van der Waals surface on the grid of `like`: Σ exp(−2 (d²/R² − 1)) over the atoms is 1 at
 * an isolated atom's radius and blends neighbouring spheres where they meet.
 */
export function vanDerWaalsField(atoms: readonly MolecularAtom[], like: ScalarGrid): ScalarGrid {
  const [nx, ny, nz] = like.dimensions, values = new Float32Array(nx * ny * nz);
  const radii = atoms.map(atom => VDW_RADII[atom.element[0].toUpperCase() + atom.element.slice(1).toLowerCase()] ?? 2);
  let index = 0;
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    let sum = 0;
    for (let i = 0; i < atoms.length; i++) {
      const dx = like.origin[0] + x * like.axes[0][0] + y * like.axes[1][0] + z * like.axes[2][0] - atoms[i].x;
      const dy = like.origin[1] + x * like.axes[0][1] + y * like.axes[1][1] + z * like.axes[2][1] - atoms[i].y;
      const dz = like.origin[2] + x * like.axes[0][2] + y * like.axes[1][2] + z * like.axes[2][2] - atoms[i].z;
      const reduced = (dx * dx + dy * dy + dz * dz) / (radii[i] * radii[i]);
      if (reduced < 9) sum += Math.exp(-2 * (reduced - 1));
    }
    values[index++] = sum;
  }
  return { dimensions: like.dimensions, origin: like.origin, axes: like.axes, values };
}

/**
 * A symmetric colour limit from the potential on the surface: the 98th percentile of |V| where the
 * surface field is within a factor of 1.5 of its isovalue, to two digits; 0.05 hartree/e without such points.
 */
export function surfacePotentialLimit(surface: ScalarGrid, isovalue: number, potential: ScalarGrid) {
  const samples: number[] = [];
  for (let index = 0; index < surface.values.length; index++) {
    const value = surface.values[index];
    if (value >= isovalue / 1.5 && value <= isovalue * 1.5) samples.push(Math.abs(potential.values[index]));
  }
  if (!samples.length) return 0.05;
  samples.sort((a, b) => a - b);
  const limit = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.98))];
  return limit > 0 ? Number(limit.toPrecision(2)) : 0.05;
}
