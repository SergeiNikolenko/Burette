import { cartesianToFractional, fractionalToCartesian, type CellParameters } from "./crystal";
import type { MolecularAtom, UnitCell, Vec3 } from "./types";

/**
 * Unit-cell edits of an explicit periodic model, as Avogadro's Crystal menu
 * performs them. Every function keeps atom order and element, returns a new
 * model and never merges, drops or adds atoms unless its name says so.
 * Cells are rows of lattice vectors in angstrom.
 */

export type CrystalModel = { atoms: MolecularAtom[]; cell: UnitCell };
/** What stays fixed when the cell changes: the atoms' fractional or Cartesian coordinates. */
export type CoordinatePolicy = "fractional" | "cartesian";

export const SUPERCELL_LIMITS = { repeat: 20, atoms: 100_000 } as const;
export const SCALE_VOLUME_LIMITS = { factor: { min: 0.1, max: 10 } } as const;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const signedVolume = (cell: UnitCell) => dot(cell[0], cross(cell[1], cell[2]));

export function cellParametersOf(cell: UnitCell): CellParameters {
  const [a, b, c] = cell;
  const angle = (u: Vec3, v: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (norm(u) * norm(v))))) * 180 / Math.PI;
  return { a: norm(a), b: norm(b), c: norm(c), alpha: angle(b, c), beta: angle(a, c), gamma: angle(a, b) };
}

function withAtoms(model: CrystalModel, cell: UnitCell, place: (atom: MolecularAtom, index: number) => Vec3): CrystalModel {
  return { cell, atoms: model.atoms.map((atom, index) => { const [x, y, z] = place(atom, index); return { ...atom, x, y, z }; }) };
}

/** Replaces the cell; atoms keep either their fractional or their Cartesian coordinates. */
export function replaceCell(model: CrystalModel, cell: UnitCell, policy: CoordinatePolicy): CrystalModel {
  // cartesianToFractional validates both cells.
  cartesianToFractional([0, 0, 0], cell);
  if (policy === "cartesian") return { cell, atoms: model.atoms.map(atom => ({ ...atom })) };
  return withAtoms(model, cell, atom => fractionalToCartesian(cartesianToFractional([atom.x, atom.y, atom.z], model.cell), cell));
}

/** Moves each atom by whole lattice vectors into the half-open cell [0, 1)³. */
export function wrapAtoms(model: CrystalModel): CrystalModel {
  return withAtoms(model, model.cell, atom => fractionalToCartesian(cartesianToFractional([atom.x, atom.y, atom.z], model.cell).map(value => {
    const wrapped = value - Math.floor(value);
    // A coordinate a rounding step below 1 belongs to the next cell's face at 0.
    return wrapped >= 1 ? 0 : wrapped;
  }) as Vec3, model.cell));
}

/**
 * Rigidly rotates cell and atoms so that a lies along +x and b in the xy plane
 * with positive y, as Avogadro's "Rotate to Standard Orientation". The rotation is
 * proper, so a left-handed cell keeps its handedness and has c below the xy plane.
 */
export function standardOrientation(model: CrystalModel): CrystalModel {
  const [a, b] = model.cell;
  const x = a.map(value => value / norm(a)) as Vec3;
  const zRaw = cross(a, b);
  const z = zRaw.map(value => value / norm(zRaw)) as Vec3;
  const y = cross(z, x);
  const rotate = (point: Vec3): Vec3 => [dot(x, point), dot(y, point), dot(z, point)];
  const cell = model.cell.map(rotate) as UnitCell;
  // Exact zeros for the components the orientation defines.
  cell[0][1] = 0; cell[0][2] = 0; cell[1][2] = 0;
  return withAtoms(model, cell, atom => rotate([atom.x, atom.y, atom.z]));
}

/** Scales the cell uniformly to `volume` Å³; atoms keep their fractional coordinates. */
export function scaleVolume(model: CrystalModel, volume: number): CrystalModel {
  const current = Math.abs(signedVolume(model.cell));
  const factor = volume / current;
  if (!Number.isFinite(factor) || factor < SCALE_VOLUME_LIMITS.factor.min || factor > SCALE_VOLUME_LIMITS.factor.max) {
    throw new Error(`The new volume must be between ${SCALE_VOLUME_LIMITS.factor.min} and ${SCALE_VOLUME_LIMITS.factor.max} times the current volume.`);
  }
  const linear = Math.cbrt(factor);
  return replaceCell(model, model.cell.map(vector => vector.map(value => value * linear)) as UnitCell, "fractional");
}

/**
 * Repeats the cell na × nb × nc times. Atoms are copied by whole lattice
 * translations without wrapping, so a molecule that crosses a cell face stays
 * whole in every copy. Copies are ordered translation-major: all atoms of the
 * (0,0,0) image first, in source order, then (0,0,1) and so on.
 */
export function buildSupercell(model: CrystalModel, repeats: [number, number, number]) {
  if (repeats.some(value => !Number.isInteger(value) || value < 1 || value > SUPERCELL_LIMITS.repeat)) {
    throw new Error(`Each repeat count must be a whole number from 1 to ${SUPERCELL_LIMITS.repeat}.`);
  }
  const count = repeats[0] * repeats[1] * repeats[2] * model.atoms.length;
  if (count > SUPERCELL_LIMITS.atoms) throw new Error(`The supercell would hold ${count.toLocaleString("en-US")} atoms; the limit is ${SUPERCELL_LIMITS.atoms.toLocaleString("en-US")}.`);
  const atoms: MolecularAtom[] = [];
  const sourceAtomIndices: number[] = [];
  for (let i = 0; i < repeats[0]; i++) for (let j = 0; j < repeats[1]; j++) for (let k = 0; k < repeats[2]; k++) {
    const shift = fractionalToCartesian([i, j, k], model.cell);
    model.atoms.forEach((atom, index) => {
      atoms.push({ ...atom, x: atom.x + shift[0], y: atom.y + shift[1], z: atom.z + shift[2] });
      sourceAtomIndices.push(index);
    });
  }
  const cell = model.cell.map((vector, axis) => vector.map(value => value * repeats[axis])) as UnitCell;
  return { atoms, cell, sourceAtomIndices };
}
