import { boxAround } from "./gaussian";
import type { ScalarGrid } from "./scientific-types";
import type { MolecularAtom } from "./types";

const BOHR = 0.529177210903;
const MAX_POINTS = 1_000_000;
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

/**
 * A symmetric colour limit from the potential where a molecular surface runs: the 98th
 * percentile of |V| over grid points 1.6 to 2.2 Å from the nearest atom, to two digits.
 */
export function surfacePotentialLimit(grid: ScalarGrid, atoms: readonly MolecularAtom[]) {
  const [nx, ny, nz] = grid.dimensions, total = nx * ny * nz;
  // Every k-th point keeps the nearest-atom search within the potential's own cost.
  const stride = Math.max(1, Math.ceil(total * atoms.length / 50_000_000));
  const samples: number[] = [];
  for (let index = 0; index < total; index += stride) {
    const x = Math.floor(index / (ny * nz)), y = Math.floor(index / nz) % ny, z = index % nz;
    const point = [0, 1, 2].map(k => grid.origin[k] + x * grid.axes[0][k] + y * grid.axes[1][k] + z * grid.axes[2][k]);
    let nearest = Infinity;
    for (const atom of atoms) nearest = Math.min(nearest, Math.hypot(point[0] - atom.x, point[1] - atom.y, point[2] - atom.z));
    if (nearest >= 1.6 && nearest <= 2.2) samples.push(Math.abs(grid.values[index]));
  }
  if (!samples.length) return 0.05;
  samples.sort((a, b) => a - b);
  const limit = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.98))];
  return limit > 0 ? Number(limit.toPrecision(2)) : 0.05;
}
