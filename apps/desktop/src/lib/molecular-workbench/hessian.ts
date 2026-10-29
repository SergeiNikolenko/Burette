/**
 * Cartesian Hessians read from ORCA `.hess` files and Gaussian formatted checkpoints.
 *
 * Both programs store second derivatives of the energy in atomic units, Hartree/bohr².
 * Checked independently: mass-weighting the matrices of the reviewed fixtures with the
 * file's own masses (amu) and diagonalizing reproduces their printed frequencies with
 * 1 Eh/(bohr²·amu) = 5140.487² (cm⁻¹)². Rows and columns run x, y, z of the first atom,
 * then of the second, in the atom order of the geometry the matrix belongs to.
 *
 * References: ORCA Hessian files as read by OPAN (https://github.com/bskinn/opan,
 * opan/hess.py, MIT); Gaussian "Cartesian Force Constants", the lower triangle in
 * row-major order (https://gaussian.com/interfacing/, cclib fchkparser.py and IOData
 * iodata/formats/fchk.py `_triangle_to_dense`).
 */

export const HESSIAN_UNITS = "hartree/bohr^2";
/** 400 atoms: a 1200 × 1200 matrix is 11.5 MB of float64, and larger ones exceed the 16 MiB text limit anyway. */
export const MAX_HESSIAN_ATOMS = 400;
export const MAX_HESSIAN_DIMENSION = 3 * MAX_HESSIAN_ATOMS;
// Finite-difference Hessians are only nearly symmetric: the reviewed ORCA files differ
// by up to 0.06 % of their largest element across the diagonal. Anything beyond 1 %
// is not a Hessian of one geometry.
const SYMMETRY_TOLERANCE = 1e-2;

export interface CartesianHessian {
  units: typeof HESSIAN_UNITS;
  /** Three times the atom count. */
  dimension: number;
  /** Row-major, dimension² values as the source gives them (a numerical Hessian is kept unsymmetrized). */
  values: Float64Array;
  /** Atomic masses in amu, in atom order, as the source states them. */
  massesAmu?: number[];
  source: "orca-hess" | "gaussian-fchk";
}

export function packedTriangleLength(dimension: number) {
  return dimension * (dimension + 1) / 2;
}

/** The dimension of a packed lower triangle of `count` values, refused before anything is allocated. */
export function packedTriangleDimension(count: number) {
  const dimension = Math.round((Math.sqrt(1 + 8 * count) - 1) / 2);
  if (!Number.isSafeInteger(count) || count < 1 || packedTriangleLength(dimension) !== count || dimension % 3 !== 0) {
    throw new Error("Hessian triangle length does not match three coordinates per atom.");
  }
  if (dimension > MAX_HESSIAN_DIMENSION) throw new Error(`Hessians are supported for at most ${MAX_HESSIAN_ATOMS} atoms.`);
  return dimension;
}

function checkDimension(atomCount: number) {
  if (!Number.isSafeInteger(atomCount) || atomCount < 1) throw new Error("A Hessian needs at least one atom.");
  if (atomCount > MAX_HESSIAN_ATOMS) throw new Error(`Hessians are supported for at most ${MAX_HESSIAN_ATOMS} atoms.`);
  return 3 * atomCount;
}

function checkMasses(masses: readonly number[] | undefined, atomCount: number) {
  if (!masses) return undefined;
  if (masses.length !== atomCount || masses.some((mass) => !Number.isFinite(mass) || mass <= 0 || mass > 1000)) {
    throw new Error("Hessian atomic masses must be one positive mass in amu per atom.");
  }
  return [...masses];
}

/** The same finite, nearly symmetric matrix is required by source readers and archives. */
export function checkHessianValues(values: Float64Array, dimension: number) {
  if (!Number.isSafeInteger(dimension) || dimension < 3 || dimension > MAX_HESSIAN_DIMENSION || dimension % 3 !== 0
    || !(values instanceof Float64Array) || values.length !== dimension * dimension) {
    throw new Error("Hessian dimensions do not match the Cartesian matrix.");
  }
  let largest = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error("Hessian values must be finite.");
    largest = Math.max(largest, Math.abs(value));
  }
  for (let row = 0; row < dimension; row++) for (let column = 0; column < row; column++) {
    if (Math.abs(values[row * dimension + column] - values[column * dimension + row]) > SYMMETRY_TOLERANCE * largest) {
      throw new Error(`Hessian is not symmetric at row ${row}, column ${column}.`);
    }
  }
}

function finish(values: Float64Array, dimension: number, atomCount: number, masses: readonly number[] | undefined, source: CartesianHessian["source"]): CartesianHessian {
  checkHessianValues(values, dimension);
  const massesAmu = checkMasses(masses, atomCount);
  return { units: HESSIAN_UNITS, dimension, values, ...(massesAmu ? { massesAmu } : {}), source };
}

/** A Gaussian lower triangle (row-major, i ≥ j) expanded to the full symmetric matrix. */
export function hessianFromLowerTriangle(triangle: ArrayLike<number>, atomCount: number, masses?: readonly number[]): CartesianHessian {
  const dimension = checkDimension(atomCount);
  if (triangle.length !== packedTriangleLength(dimension)) throw new Error("Hessian triangle length does not match the atoms.");
  const values = new Float64Array(dimension * dimension);
  let offset = 0;
  for (let row = 0; row < dimension; row++) for (let column = 0; column <= row; column++) {
    const value = triangle[offset++];
    values[row * dimension + column] = value;
    values[column * dimension + row] = value;
  }
  return finish(values, dimension, atomCount, masses, "gaussian-fchk");
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/;
function value(token: string) {
  if (!NUMBER.test(token)) throw new Error("Invalid Hessian number.");
  const parsed = Number(token.replace(/[dD]/, "e"));
  if (!Number.isFinite(parsed)) throw new Error("Hessian values must be finite.");
  return parsed;
}

/**
 * The `$hessian` section of an ORCA Hessian file: its dimension line, then blocks of
 * column numbers each followed by one line per row (row number and one value per column).
 * Every element must appear exactly once; rows, columns and the dimension must match the atoms.
 */
export function hessianFromOrcaSection(lines: readonly string[], atomCount: number, masses?: readonly number[]): CartesianHessian {
  const dimension = checkDimension(atomCount);
  if (lines[0]?.trim() !== String(dimension)) throw new Error("ORCA Hessian dimension does not match the atoms.");
  const values = new Float64Array(dimension * dimension);
  const seen = new Uint8Array(dimension * dimension);
  let filled = 0;
  let columns: number[] | null = null;
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    // Values always carry a decimal point; a line of bare integers numbers the next columns.
    if (parts.every((part) => /^\d+$/.test(part))) {
      columns = parts.map(Number);
      if (columns.some((column, index) => column >= dimension || (index > 0 && column <= columns![index - 1]))) {
        throw new Error("Invalid ORCA Hessian column numbers.");
      }
      continue;
    }
    if (!columns || !/^\d+$/.test(parts[0]) || parts.length !== columns.length + 1) throw new Error("Malformed ORCA Hessian row.");
    const row = Number(parts[0]);
    if (row >= dimension) throw new Error("ORCA Hessian row exceeds its dimension.");
    columns.forEach((column, index) => {
      const at = row * dimension + column;
      if (seen[at]) throw new Error("Duplicate ORCA Hessian element.");
      seen[at] = 1;
      values[at] = value(parts[index + 1]);
      filled++;
    });
  }
  if (filled !== dimension * dimension) throw new Error("Truncated ORCA Hessian matrix.");
  return finish(values, dimension, atomCount, masses, "orca-hess");
}
