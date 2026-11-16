import type { MolecularAtom, UnitCell, Vec3 } from "../types";
import type { StandaloneWasm } from "./wasm-module";

/** Niggli reduction through spglib's niggli_reduce (spglib v2.8.0,
 * BSD-3-Clause). This changes only the lattice basis; it does not search
 * for space groups.
 *
 * Cells are rows of lattice vectors, as everywhere in the workbench. In
 * column form A = [a b c], the reduced basis is B = A·T with an integer,
 * unimodular T. Fractional coordinates transform as f' = T⁻¹·f, so Cartesian
 * positions and the cell volume are unchanged. spglib returns only the
 * reduced lattice; T is derived from A⁻¹·B and accepted only when it is
 * integral within INTEGER_TOLERANCE, has determinant ±1, and reproduces B. */

export const DEFAULT_NIGGLI_EPS = 1e-5;
export const MAX_NIGGLI_ATOMS = 100_000;
const INTEGER_TOLERANCE = 1e-6;
const RECONSTRUCTION_TOLERANCE = 1e-9;
const VECTOR_LIMIT = 1e5;

export type IntMatrix3 = [[number, number, number], [number, number, number], [number, number, number]];
export type NiggliInput = {
  cell: UnitCell;
  /** Absolute tolerance on metric-tensor entries in Å², as spglib's eps. */
  eps?: number;
  atoms?: MolecularAtom[];
};
export type NiggliAtoms = {
  /** Fractional coordinates in the reduced basis; Cartesian positions are unchanged. */
  fractional: Vec3[];
  /** The same sites translated into [0, 1) of the reduced cell. */
  wrappedFractional: Vec3[];
  /** Integer lattice translation removed from each site by wrapping. */
  latticeShifts: Vec3[];
  wrappedAtoms: MolecularAtom[];
};
export type NiggliResult = {
  cell: UnitCell;
  /** Column j holds reduced vector j in the input basis: b_j = Σ_i T[i][j]·a_i. */
  transform: IntMatrix3;
  inverseTransform: IntMatrix3;
  determinant: 1 | -1;
  /** Signed volumes (Å³); equal in magnitude, the sign records handedness. */
  inputVolume: number;
  reducedVolume: number;
  parameters: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };
  eps: number;
  atoms?: NiggliAtoms;
};

type NiggliExports = StandaloneWasm["exports"] & { burette_niggli_reduce(lattice: number, eps: number): number };

type Matrix3 = number[][];
const columns = (cell: UnitCell): Matrix3 => [0, 1, 2].map(row => [cell[0][row], cell[1][row], cell[2][row]]);
const rows = (matrix: Matrix3): UnitCell => [0, 1, 2].map(column => [matrix[0][column], matrix[1][column], matrix[2][column]] as Vec3) as UnitCell;
const multiply = (left: Matrix3, right: Matrix3): Matrix3 => left.map(row => [0, 1, 2].map(column => row.reduce((sum, value, k) => sum + value * right[k][column], 0)));
const apply = (matrix: Matrix3, vector: Vec3): Vec3 => matrix.map(row => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]) as Vec3;
const determinant = (m: Matrix3) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const adjugate = (m: Matrix3): Matrix3 => [
  [m[1][1] * m[2][2] - m[1][2] * m[2][1], m[0][2] * m[2][1] - m[0][1] * m[2][2], m[0][1] * m[1][2] - m[0][2] * m[1][1]],
  [m[1][2] * m[2][0] - m[1][0] * m[2][2], m[0][0] * m[2][2] - m[0][2] * m[2][0], m[0][2] * m[1][0] - m[0][0] * m[1][2]],
  [m[1][0] * m[2][1] - m[1][1] * m[2][0], m[0][1] * m[2][0] - m[0][0] * m[2][1], m[0][0] * m[1][1] - m[0][1] * m[1][0]],
];
const inverse = (m: Matrix3) => adjugate(m).map(row => row.map(value => value / determinant(m)));
const largest = (...matrices: Matrix3[]) => Math.max(...matrices.flat(2).map(Math.abs));

function validateNiggliInput(input: NiggliInput) {
  const { cell } = input;
  if (!Array.isArray(cell) || cell.length !== 3 || cell.some(vector => !Array.isArray(vector) || vector.length !== 3 || vector.some(value => !Number.isFinite(value) || Math.abs(value) > VECTOR_LIMIT))) {
    throw new Error("The cell must contain three finite lattice vectors.");
  }
  const lengths = cell.map(vector => Math.hypot(...vector));
  if (Math.abs(determinant(columns(cell))) <= 1e-8 * Math.max(1, lengths[0] * lengths[1] * lengths[2])) throw new Error("The lattice vectors are not independent.");
  const eps = input.eps ?? DEFAULT_NIGGLI_EPS;
  if (!Number.isFinite(eps) || eps <= 0 || eps > 0.1) throw new Error("The Niggli tolerance must be positive and at most 0.1 Å².");
  if (input.atoms && input.atoms.length > MAX_NIGGLI_ATOMS) throw new Error(`Niggli reduction supports at most ${MAX_NIGGLI_ATOMS} atoms.`);
  input.atoms?.forEach(atom => {
    if (![atom.x, atom.y, atom.z].every(Number.isFinite)) throw new Error("Atom coordinates must be finite.");
  });
  return eps;
}

/** Derives the exact integer T with B = A·T from two bases, or throws. */
export function integerBasisTransform(input: UnitCell, reduced: UnitCell): IntMatrix3 {
  const a = columns(input);
  const b = columns(reduced);
  const real = multiply(inverse(a), b);
  const transform = real.map(row => row.map(value => Math.round(value) + 0)) as IntMatrix3;
  const deviation = Math.max(...real.flatMap((row, i) => row.map((value, j) => Math.abs(value - transform[i][j]))));
  if (!(deviation <= INTEGER_TOLERANCE)) throw new Error(`The reduced cell is not an integer basis change of the input (deviation ${deviation.toExponential(2)}).`);
  const det = determinant(transform);
  if (det !== 1 && det !== -1) throw new Error(`The basis change has determinant ${det}; the reduced cell is not equivalent to the input.`);
  const rebuilt = multiply(a, transform);
  const error = Math.max(...rebuilt.flatMap((row, i) => row.map((value, j) => Math.abs(value - b[i][j]))));
  if (!(error <= RECONSTRUCTION_TOLERANCE * largest(a, b))) throw new Error(`The integer basis change does not reproduce the reduced cell (error ${error.toExponential(2)} Å).`);
  return transform;
}

export function reduceNiggliCell(wasm: StandaloneWasm, input: NiggliInput): NiggliResult {
  const eps = validateNiggliInput(input);
  const engine = wasm.exports as NiggliExports;
  const pointer = engine.malloc(72);
  let reducedColumns: Matrix3;
  try {
    const lattice = new Float64Array(engine.memory.buffer, pointer, 9);
    lattice.set(columns(input.cell).flat());
    if (engine.burette_niggli_reduce(pointer, eps) !== 1) throw new Error("spglib could not Niggli-reduce this cell within its iteration limit.");
    const flat = Array.from(new Float64Array(engine.memory.buffer, pointer, 9));
    reducedColumns = [flat.slice(0, 3), flat.slice(3, 6), flat.slice(6, 9)];
  } finally {
    engine.free(pointer);
  }
  if (!reducedColumns.flat().every(Number.isFinite)) throw new Error("spglib returned a non-finite reduced cell.");
  const transform = integerBasisTransform(input.cell, rows(reducedColumns));
  const inverseTransform = adjugate(transform).map(row => row.map(value => value * determinant(transform) + 0)) as IntMatrix3;
  // The returned cell is A·T itself, so T, T⁻¹ and the cell agree exactly.
  const reduced = multiply(columns(input.cell), transform);
  const cell = rows(reduced);
  const lengths = cell.map(vector => Math.hypot(...vector));
  const angle = (i: number, j: number) => Math.acos(Math.max(-1, Math.min(1, cell[i].reduce((sum, value, k) => sum + value * cell[j][k], 0) / (lengths[i] * lengths[j])))) * 180 / Math.PI;
  return {
    cell,
    transform,
    inverseTransform,
    determinant: determinant(transform) as 1 | -1,
    inputVolume: determinant(columns(input.cell)),
    reducedVolume: determinant(reduced),
    parameters: { a: lengths[0], b: lengths[1], c: lengths[2], alpha: angle(1, 2), beta: angle(0, 2), gamma: angle(0, 1) },
    eps,
    atoms: input.atoms && transformAtoms(input.atoms, input.cell, cell, inverseTransform),
  };
}

function transformAtoms(atoms: MolecularAtom[], input: UnitCell, cell: UnitCell, inverseTransform: IntMatrix3): NiggliAtoms {
  const toFractional = inverse(columns(input));
  const toCartesian = columns(cell);
  const fractional = atoms.map(atom => apply(inverseTransform, apply(toFractional, [atom.x, atom.y, atom.z])));
  const latticeShifts = fractional.map(point => point.map(value => {
    // Finite Cartesian input can overflow in a small or skewed basis. Wrapping
    // also needs an exactly representable integer lattice translation.
    if (!Number.isFinite(value) || Math.abs(value) >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Atom coordinates exceed the safe fractional range of the reduced cell.");
    }
    const shift = Math.floor(value);
    // Only normalize a boundary that rounded to 1 in floating-point subtraction.
    return value - shift === 1 ? shift + 1 : shift;
  }) as Vec3);
  const wrappedFractional = fractional.map((point, index) => point.map((value, axis) => Math.max(0, value - latticeShifts[index][axis])) as Vec3);
  const wrappedAtoms = atoms.map((atom, index) => {
    const [x, y, z] = apply(toCartesian, wrappedFractional[index]);
    return { ...atom, x, y, z };
  });
  return { fractional, wrappedFractional, latticeShifts, wrappedAtoms };
}
