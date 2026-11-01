import { ELEMENT_SYMBOLS } from "./elements";
import type { CellParameters } from "./crystal";
import type { MolecularAtom, UnitCell, Vec3 } from "./types";

/**
 * Space-group analysis and standardization of an explicit, fully occupied crystal
 * cell. The symmetry finder is injected (the moyo WebAssembly module in the worker
 * and in tests); everything it receives and returns is checked here.
 *
 * Conventions, as documented by moyo 0.21: lattice bases and every flat 3x3 matrix
 * are column-major (element (i, j) at i + 3j); `A_std = A_input * std_linear` and
 * `x_std = inverse(std_linear) * (x_input - std_origin_shift)` before refinement; the
 * returned cells are symmetry-refined and rotated by a proper Cartesian rotation, so
 * a standardized cell is new geometry, not a passive change of basis.
 */

/** Rows of a 3x3 matrix. A lattice matrix holds the cell vectors as its columns. */
export type Mat3 = [Vec3, Vec3, Vec3];
export type SymmetryOperation = { rotation: Mat3; translation: Vec3 };
/** Atoms of one cell with their species (element plus any charge, e.g. "Fe2+") and site labels. */
export type CrystalSites = { atoms: MolecularAtom[]; cell: UnitCell; species: string[]; labels: string[] };
export type StandardCellKind = "conventional" | "primitive";
export type MoyoAnalyzer = {
  analyze_cell(cellJson: string, symprec: number, setting: string): unknown;
  operations_from_number(number: number, setting: { type: "Spglib" } | { type: "HallNumber"; value: number }, primitive: boolean): unknown;
  hall_symbol_entry(hallNumber: number): unknown;
};

/** Distance tolerance in angstrom. */
export const SYMMETRY_TOLERANCE = { min: 1e-4, max: 0.5, default: 0.01 } as const;
export const SYMMETRY_ATOM_LIMIT = 5_000;
/** A conventional cell holds at most four primitive cells (F centring). */
const OUTPUT_ATOM_LIMIT = 4 * SYMMETRY_ATOM_LIMIT;
const SITE_ROWS = 500;
/** (operation, atom) pairs checked on the finder's output; see verifyOperations. */
const OPERATION_CHECKS = 2_000_000;
const MOYO_SETTING = "Spglib";

export type SymmetrySite = { label: string; species: string; wyckoff: string; siteSymmetry: string; count: number };
export type StandardCellSummary = { atomCount: number; volume: number; parameters: CellParameters };
export type SymmetryAnalysis = {
  tolerance: number;
  number: number;
  hallNumber: number;
  symbol: string;
  crystalSystem: string;
  pearson: string;
  /** Operations of the analysed cell itself, lattice translations of a supercell included. */
  operationCount: number;
  atomCount: number;
  /** Symmetry-distinct sites, at most SITE_ROWS of them; `siteCount` is the full number. */
  sites: SymmetrySite[];
  siteCount: number;
  conventional: StandardCellSummary;
  primitive: StandardCellSummary;
  /** Largest Cartesian move of an atom onto its refined position, in angstrom; null when an atom has no counterpart. */
  maxShift: number | null;
};
export type StandardizedCrystal = {
  kind: StandardCellKind;
  cif: string;
  atomCount: number;
  siteCount: number;
  number: number;
  symbol: string;
  parameters: CellParameters;
  /** Every site label comes from the source atom it was refined from. */
  labelsFromSource: boolean;
};

// ---- 3x3 algebra ----------------------------------------------------------------

const det = (m: Mat3) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const apply = (m: Mat3, v: Vec3): Vec3 => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as Vec3;
const multiply = (a: Mat3, b: Mat3): Mat3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])) as Mat3;
const transpose = (m: Mat3): Mat3 => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]) as Mat3;
const norm = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function inverse(m: Mat3): Mat3 {
  const d = det(m);
  const [[a, b, c], [e, f, g], [h, i, j]] = m;
  return [[f * j - g * i, c * i - b * j, b * g - c * f], [g * h - e * j, a * j - c * h, c * e - a * g], [e * i - f * h, b * h - a * i, a * f - b * e]]
    .map((row) => row.map((value) => value / d)) as Mat3;
}
/** Column-major flat storage, as moyo writes it. */
export const fromColumnMajor = (flat: readonly number[]): Mat3 => [[flat[0], flat[3], flat[6]], [flat[1], flat[4], flat[7]], [flat[2], flat[5], flat[8]]];
/** Cell vectors become the columns of the lattice matrix: Cartesian = lattice * fractional. */
export const latticeOf = (cell: UnitCell): Mat3 => transpose(cell);
export const vectorsOf = (lattice: Mat3): UnitCell => transpose(lattice);
const wrap = (value: number) => { const result = value - Math.floor(value); return result >= 1 - 1e-12 ? 0 : result; };
const wrapped = (point: Vec3) => point.map(wrap) as Vec3;
/** Distances between the lattice planes, the thickness of the cell along each axis. */
const planeSpacings = (lattice: Mat3) => {
  const [a, b, c] = vectorsOf(lattice);
  const volume = Math.abs(det(lattice));
  return [norm(cross(b, c)), norm(cross(c, a)), norm(cross(a, b))].map((area) => volume / area);
};

export function cellParameters(lattice: Mat3): CellParameters {
  const [a, b, c] = vectorsOf(lattice);
  const angle = (u: Vec3, v: Vec3) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))))) * 180 / Math.PI;
  return { a: norm(a), b: norm(b), c: norm(c), alpha: angle(b, c), beta: angle(a, c), gamma: angle(a, b) };
}

export function crystalSystem(number: number) {
  return number <= 2 ? "triclinic" : number <= 15 ? "monoclinic" : number <= 74 ? "orthorhombic" : number <= 142 ? "tetragonal"
    : number <= 167 ? "trigonal" : number <= 194 ? "hexagonal" : "cubic";
}

// ---- periodic neighbour search ------------------------------------------------------

/**
 * Wrapped fractional points binned so that every point within `radius` (angstrom) of
 * a query lies in a neighbouring bin. Minimum-image distances are exact because the
 * radius is below half of every plane spacing (checked by the caller).
 */
class PeriodicIndex {
  private readonly counts: number[];
  private readonly bins = new Map<number, number[]>();
  constructor(private readonly lattice: Mat3, private readonly points: Vec3[], radius: number) {
    this.counts = planeSpacings(lattice).map((spacing) => Math.max(1, Math.min(32, Math.floor(spacing / radius))));
    points.forEach((point, index) => {
      const key = this.key(this.bin(point));
      const bin = this.bins.get(key);
      if (bin) bin.push(index); else this.bins.set(key, [index]);
    });
  }
  private bin(point: Vec3) { return point.map((value, axis) => Math.min(this.counts[axis] - 1, Math.floor(wrap(value) * this.counts[axis]))); }
  private key([i, j, k]: number[]) { return (i * this.counts[1] + j) * this.counts[2] + k; }
  distance(point: Vec3, index: number) {
    const delta = point.map((value, axis) => { const d = value - this.points[index][axis]; return d - Math.round(d); }) as Vec3;
    return norm(apply(this.lattice, delta));
  }
  /** Calls `visit` for each point within `radius`, once each. */
  within(point: Vec3, radius: number, visit: (index: number, distance: number) => void) {
    const centre = this.bin(point);
    const offsets = this.counts.map((count) => [...new Set([-1, 0, 1].map((offset) => offset % count))]);
    for (const i of offsets[0]) for (const j of offsets[1]) for (const k of offsets[2]) {
      const key = this.key([(centre[0] + i + this.counts[0]) % this.counts[0], (centre[1] + j + this.counts[1]) % this.counts[1], (centre[2] + k + this.counts[2]) % this.counts[2]]);
      for (const index of this.bins.get(key) ?? []) {
        const distance = this.distance(point, index);
        if (distance <= radius) visit(index, distance);
      }
    }
  }
  nearest(point: Vec3, radius: number, accept: (index: number) => boolean) {
    let best: { index: number; distance: number } | null = null;
    this.within(point, radius, (index, distance) => { if (accept(index) && (!best || distance < best.distance)) best = { index, distance }; });
    return best as { index: number; distance: number } | null;
  }
}

// ---- input ---------------------------------------------------------------------------

export function checkSymmetryTolerance(tolerance: number) {
  if (!Number.isFinite(tolerance) || tolerance < SYMMETRY_TOLERANCE.min || tolerance > SYMMETRY_TOLERANCE.max) {
    throw new Error(`The tolerance must be between ${SYMMETRY_TOLERANCE.min} and ${SYMMETRY_TOLERANCE.max} Å.`);
  }
}

function checkLattice(lattice: Mat3) {
  if (!lattice.flat().every(Number.isFinite)) throw new Error("The cell vectors must be finite.");
  const lengths = vectorsOf(lattice).map(norm);
  if (lengths.some((length) => !(length >= 0.1 && length <= 1000))) throw new Error("Each cell vector must be between 0.1 and 1000 Å long.");
  // Either handedness is accepted; a nearly flat cell is not.
  if (!(Math.abs(det(lattice)) >= 1e-3 * lengths[0] * lengths[1] * lengths[2])) throw new Error("The cell vectors are nearly coplanar.");
}

const SPECIES = /^([A-Z][a-z]?)(?:([1-9]\d?)([+-]))?$/u;

type PreparedCrystal = {
  lattice: Mat3;
  fractional: Vec3[];
  /** Species number (1-based index into `species`) per atom. */
  numbers: number[];
  species: string[];
  labels: string[];
  tolerance: number;
  index: PeriodicIndex;
};

/** Checks a cell before it reaches the symmetry finder, whose own errors do not say what is wrong. */
function prepare(sites: CrystalSites, tolerance: number): PreparedCrystal {
  checkSymmetryTolerance(tolerance);
  const { atoms, cell, species, labels } = sites;
  if (!atoms.length) throw new Error("The cell has no atoms.");
  if (atoms.length > SYMMETRY_ATOM_LIMIT) throw new Error(`Symmetry analysis supports up to ${SYMMETRY_ATOM_LIMIT.toLocaleString("en-US")} atoms per cell.`);
  if (species.length !== atoms.length || labels.length !== atoms.length) throw new Error("Every atom needs a species and a label.");
  if (cell.length !== 3 || cell.some((vector) => vector.length !== 3)) throw new Error("The cell needs three vectors.");
  const lattice = latticeOf(cell);
  checkLattice(lattice);
  // Neighbour searches reach twice the tolerance and must stay within half a plane spacing.
  if (Math.min(...planeSpacings(lattice)) <= 4 * tolerance) throw new Error("The cell is too thin for this tolerance.");
  const toFractional = inverse(lattice);
  const kinds: string[] = [];
  const numbers = species.map((key, index) => {
    const match = SPECIES.exec(key);
    if (!match || match[1] !== atoms[index].element || !ELEMENT_SYMBOLS.includes(match[1])) throw new Error(`Atom ${labels[index]} has an unsupported species ${key}.`);
    // Charged and neutral atoms of one element stay distinct species.
    const found = kinds.indexOf(key);
    if (found >= 0) return found + 1;
    kinds.push(key);
    return kinds.length;
  });
  const fractional = atoms.map((atom) => {
    const point: Vec3 = [atom.x, atom.y, atom.z];
    if (!point.every((value) => Number.isFinite(value) && Math.abs(value) <= 1e6)) throw new Error("Atom coordinates must be finite.");
    return wrapped(apply(toFractional, point));
  });
  const index = new PeriodicIndex(lattice, fractional, 2 * tolerance);
  fractional.forEach((point, i) => index.within(point, tolerance, (j, distance) => {
    if (j <= i) return;
    throw new Error(distance < 1e-3
      ? `Atoms ${labels[i]} and ${labels[j]} occupy the same site of the periodic cell. Remove the duplicate.`
      : `Atoms ${labels[i]} and ${labels[j]} are ${distance.toFixed(4)} Å apart, within the tolerance.`);
  }));
  return { lattice, fractional, numbers, species: kinds, labels, tolerance, index };
}

const moyoCell = (lattice: Mat3, positions: Vec3[], numbers: number[]) => JSON.stringify({ lattice: { basis: vectorsOf(lattice).flat() }, positions, numbers });

// ---- finder output ---------------------------------------------------------------------

type OutputCell = { lattice: Mat3; fractional: Vec3[]; numbers: number[] };
type Dataset = {
  number: number; hallNumber: number; symbol: string; pearson: string;
  operations: SymmetryOperation[]; orbits: number[]; wyckoffs: string[]; siteSymmetry: string[];
  std: OutputCell; stdLinear: Mat3; stdShift: Vec3; stdRotation: Mat3;
  prim: OutputCell; primLinear: Mat3; primShift: Vec3;
  /** Primitive-cell site of each input atom. */
  primMapping: number[];
};

const invalid = (what: string) => new Error(`The symmetry finder returned an invalid ${what}.`);
const record = (value: unknown, what: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(what);
  return value as Record<string, unknown>;
};
function numbers(value: unknown, length: number, what: string, integer = false) {
  if (!Array.isArray(value) || value.length !== length || !value.every((item) => typeof item === "number" && Number.isFinite(item) && (!integer || Number.isInteger(item)))) throw invalid(what);
  return value as number[];
}
function integer(value: unknown, min: number, max: number, what: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw invalid(what);
  return value;
}
function text(value: unknown, pattern: RegExp, what: string) {
  if (typeof value !== "string" || value.length > 32 || !pattern.test(value)) throw invalid(what);
  return value;
}
function list(value: unknown, max: number, what: string) {
  if (!Array.isArray(value) || value.length > max) throw invalid(what);
  return value as unknown[];
}
function outputCell(value: unknown, what: string, speciesCount: number): OutputCell {
  const cell = record(value, what);
  const lattice = fromColumnMajor(numbers(record(cell.lattice, what).basis, 9, `${what} lattice`));
  checkLattice(lattice);
  if (!(det(lattice) > 0)) throw invalid(`${what} handedness`);
  const positions = list(cell.positions, OUTPUT_ATOM_LIMIT, `${what} size`);
  if (!positions.length) throw invalid(`${what} size`);
  const fractional = positions.map((position) => wrapped(numbers(position, 3, `${what} position`) as Vec3));
  const species = numbers(cell.numbers, positions.length, `${what} species`, true);
  if (species.some((number) => number < 1 || number > speciesCount)) throw invalid(`${what} species`);
  return { lattice, fractional, numbers: species };
}

function readDataset(raw: unknown, input: { numbers: number[]; count: number; speciesCount: number }): Dataset {
  const data = record(raw, "result");
  const number = integer(data.number, 1, 230, "space-group number");
  const operations = list(data.operations, 48 * input.count, "operation list").map((value) => {
    const operation = record(value, "operation");
    const rotation = fromColumnMajor(numbers(operation.rotation, 9, "rotation", true));
    if (Math.abs(Math.abs(det(rotation)) - 1) > 1e-9 || rotation.flat().some((entry) => Math.abs(entry) > 64)) throw invalid("rotation");
    return { rotation, translation: wrapped(numbers(operation.translation, 3, "translation") as Vec3) };
  });
  if (!operations.length) throw invalid("operation list");
  const orbits = numbers(data.orbits, input.count, "orbit list", true);
  if (orbits.some((representative) => representative < 0 || representative >= input.count || orbits[representative] !== representative)) throw invalid("orbit list");
  const strings = (value: unknown, pattern: RegExp, what: string) => list(value, input.count, what).map((item) => text(item, pattern, what));
  const wyckoffs = strings(data.wyckoffs, /^(?:[a-z]|A)$/u, "Wyckoff letter");
  const siteSymmetry = strings(data.site_symmetry_symbols, /^[-0-9mn./ ]+$/u, "site symmetry");
  if (wyckoffs.length !== input.count || siteSymmetry.length !== input.count) throw invalid("site list");
  const std = outputCell(data.std_cell, "standard cell", input.speciesCount);
  const prim = outputCell(data.prim_std_cell, "primitive cell", input.speciesCount);
  const stdRotation = fromColumnMajor(numbers(data.std_rotation_matrix, 9, "rotation matrix"));
  const orthogonality = multiply(transpose(stdRotation), stdRotation);
  if (orthogonality.some((row, i) => row.some((value, j) => Math.abs(value - (i === j ? 1 : 0)) > 1e-6)) || Math.abs(det(stdRotation) - 1) > 1e-6) throw invalid("rotation matrix");
  // Despite its name, moyo's mapping runs from each input atom to its primitive-cell site.
  const mapping = numbers(data.mapping_std_prim, input.count, "primitive mapping", true);
  if (mapping.some((index, atom) => index < 0 || index >= prim.numbers.length || prim.numbers[index] !== input.numbers[atom])) throw invalid("primitive mapping");
  return {
    number, operations, orbits, wyckoffs, siteSymmetry, std, prim, stdRotation, primMapping: mapping,
    hallNumber: integer(data.hall_number, 1, 530, "Hall number"),
    symbol: text(data.hm_symbol, /^[A-Za-z0-9_/:\- ]+$/u, "space-group symbol"),
    pearson: text(data.pearson_symbol, /^[a-zA-Z]+\d+$/u, "Pearson symbol"),
    stdLinear: fromColumnMajor(numbers(data.std_linear, 9, "standard transformation")),
    stdShift: numbers(data.std_origin_shift, 3, "origin shift") as Vec3,
    primLinear: fromColumnMajor(numbers(data.prim_std_linear, 9, "primitive transformation")),
    primShift: numbers(data.prim_std_origin_shift, 3, "primitive origin shift") as Vec3,
  };
}

/**
 * A standardized cell must hold the input's atoms in the ratio of the cell volumes,
 * species by species; the lattice must be the transformed input lattice, rotated.
 */
function checkStandardCell(cell: OutputCell, linear: Mat3, input: PreparedCrystal, rotation: Mat3 | null, what: string) {
  const ratio = Math.abs(det(linear));
  if (!Number.isFinite(ratio) || ratio < 1e-6) throw invalid(`${what} transformation`);
  const expected = input.numbers.length * ratio;
  if (Math.abs(expected - cell.numbers.length) > 1e-6 * input.numbers.length) throw invalid(`${what} size`);
  const tally = (list: number[]) => input.species.map((_, index) => list.filter((number) => number === index + 1).length);
  const before = tally(input.numbers), after = tally(cell.numbers);
  if (before.some((count, index) => Math.abs(count * ratio - after[index]) > 1e-6 * input.numbers.length)) throw invalid(`${what} composition`);
  // Refinement moves lattice vectors by about the tolerance, never by a cell length.
  const target = multiply(input.lattice, linear);
  const placed = rotation ? multiply(rotation, target) : null;
  const vectors = vectorsOf(cell.lattice), expectedVectors = vectorsOf(placed ?? target);
  const lengths = vectors.map(norm), expectedLengths = vectorsOf(target).map(norm);
  const slack = 4 * input.tolerance + 0.02 * Math.max(...expectedLengths);
  if (lengths.some((length, axis) => Math.abs(length - expectedLengths[axis]) > slack)) throw invalid(`${what} lattice`);
  if (placed && vectors.some((vector, axis) => norm(vector.map((value, i) => value - expectedVectors[axis][i])) > slack)) throw invalid(`${what} orientation`);
}

/**
 * Every operation must map the structure onto itself within the tolerance, keeping
 * species and orbits. Operations with a distinct rotation are checked on every
 * atom, then the rest (lattice translations of a supercell) as far as the budget allows,
 * each on at least the first atom.
 */
function verifyOperations(dataset: Dataset, input: PreparedCrystal) {
  const radius = 2 * input.tolerance;
  const metric = multiply(transpose(input.lattice), input.lattice);
  const scale = Math.max(...metric.map((row, i) => row[i]));
  const seen = new Set<string>();
  const representatives = new Set(dataset.operations.filter((operation) => { const key = operation.rotation.flat().join(","); return !seen.has(key) && Boolean(seen.add(key)); }));
  let budget = OPERATION_CHECKS;
  for (const operation of [...representatives, ...dataset.operations.filter((operation) => !representatives.has(operation))]) {
    // An isometry of the lattice: R^T G R = G, up to the refinement the tolerance allows.
    const moved = multiply(transpose(operation.rotation), multiply(metric, operation.rotation));
    if (moved.some((row, i) => row.some((value, j) => Math.abs(value - metric[i][j]) > 0.05 * scale))) throw invalid("operation metric");
    const atoms = representatives.has(operation) ? input.fractional.length : Math.max(1, Math.min(input.fractional.length, budget));
    budget -= atoms;
    for (let atom = 0; atom < atoms; atom++) {
      const image = apply(operation.rotation, input.fractional[atom]).map((value, axis) => value + operation.translation[axis]) as Vec3;
      const match = input.index.nearest(image, radius, (index) => input.numbers[index] === input.numbers[atom]);
      if (!match || dataset.orbits[match.index] !== dataset.orbits[atom]) throw new Error("A reported symmetry operation does not map the structure onto itself. Try a smaller tolerance.");
    }
  }
}

function analyze(moyo: MoyoAnalyzer, cell: { lattice: Mat3; fractional: Vec3[]; numbers: number[] }, speciesCount: number, tolerance: number) {
  let raw: unknown;
  try {
    raw = moyo.analyze_cell(moyoCell(cell.lattice, cell.fractional, cell.numbers), tolerance, MOYO_SETTING);
  } catch {
    throw new Error("No consistent space group was found at this tolerance. Try another tolerance.");
  }
  return readDataset(raw, { numbers: cell.numbers, count: cell.numbers.length, speciesCount });
}

/** Input atom each standardized atom was refined from, and how far it moved. */
function sourceAtoms(cell: OutputCell, linear: Mat3, shift: Vec3, input: PreparedCrystal) {
  return cell.fractional.map((point, index) => {
    const back = apply(linear, point).map((value, axis) => value + shift[axis]) as Vec3;
    return input.index.nearest(back, 2 * input.tolerance, (atom) => input.numbers[atom] === cell.numbers[index]);
  });
}

function summary(cell: OutputCell): StandardCellSummary {
  return { atomCount: cell.numbers.length, volume: Math.abs(det(cell.lattice)), parameters: cellParameters(cell.lattice) };
}

function analyzed(moyo: MoyoAnalyzer, sites: CrystalSites, tolerance: number) {
  const input = prepare(sites, tolerance);
  const dataset = analyze(moyo, input, input.species.length, tolerance);
  checkStandardCell(dataset.std, dataset.stdLinear, input, dataset.stdRotation, "standard cell");
  checkStandardCell(dataset.prim, dataset.primLinear, input, null, "primitive cell");
  verifyOperations(dataset, input);
  return { input, dataset };
}

/** Read-only symmetry of the cell as given. */
export function analyzeCrystalSymmetry(moyo: MoyoAnalyzer, sites: CrystalSites, tolerance: number): SymmetryAnalysis {
  const { input, dataset } = analyzed(moyo, sites, tolerance);
  const ratio = Math.abs(det(dataset.stdLinear));
  const orbits = new Map<number, number>();
  dataset.orbits.forEach((representative) => orbits.set(representative, (orbits.get(representative) ?? 0) + 1));
  const sitesList = [...orbits].map(([representative, count]) => {
    // Wyckoff multiplicities refer to the conventional cell.
    const multiplicity = count * ratio;
    if (Math.abs(multiplicity - Math.round(multiplicity)) > 1e-6) throw invalid("orbit size");
    return { label: input.labels[representative], species: input.species[input.numbers[representative] - 1], wyckoff: `${Math.round(multiplicity)}${dataset.wyckoffs[representative]}`,
      siteSymmetry: dataset.siteSymmetry[representative], count };
  });
  const matches = sourceAtoms(dataset.std, dataset.stdLinear, dataset.stdShift, input);
  return {
    tolerance, number: dataset.number, hallNumber: dataset.hallNumber, symbol: dataset.symbol, crystalSystem: crystalSystem(dataset.number),
    pearson: dataset.pearson, operationCount: dataset.operations.length, atomCount: input.numbers.length,
    sites: sitesList.slice(0, SITE_ROWS), siteCount: sitesList.length,
    conventional: summary(dataset.std), primitive: summary(dataset.prim),
    maxShift: matches.every(Boolean) ? Math.max(...matches.map((match) => match!.distance)) : null,
  };
}

// ---- CIF output ---------------------------------------------------------------------------

function fraction(value: number) {
  for (const denominator of [1, 2, 3, 4, 6, 8, 12, 24]) {
    const numerator = Math.round(value * denominator);
    if (Math.abs(value * denominator - numerator) < 1e-8) {
      const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
      const divisor = gcd(numerator, denominator) || 1;
      return denominator / divisor === 1 ? `${numerator / divisor}` : `${numerator / divisor}/${denominator / divisor}`;
    }
  }
  return value.toFixed(10);
}

/** The operation as a CIF triplet, e.g. `-y+1/2,x,z+1/4`. */
export function symmetryOperationXyz(operation: SymmetryOperation) {
  return operation.rotation.map((row, axis) => {
    let term = row.map((coefficient, index) => {
      if (!coefficient) return "";
      const magnitude = Math.abs(coefficient) === 1 ? "" : `${Math.abs(coefficient)}*`;
      return `${coefficient < 0 ? "-" : "+"}${magnitude}${"xyz"[index]}`;
    }).join("");
    const translation = wrap(operation.translation[axis]);
    if (translation > 1e-9) term += `+${fraction(translation)}`;
    return term.replace(/^\+/u, "") || "0";
  }).join(",");
}

const cifText = (value: string) => (/^[A-Za-z0-9.()+-][A-Za-z0-9_.()+\-/]*$/u.test(value) ? value : `'${value.replace(/'/gu, "")}'`);
const cifLabel = (value: string) => value.replace(/[^A-Za-z0-9_.()+-]/gu, "").slice(0, 32);
const isIdentity = (operation: SymmetryOperation) => operation.rotation.every((row, i) => row.every((value, j) => value === (i === j ? 1 : 0))) && operation.translation.every((value) => value === 0);

const operationKey = (operation: SymmetryOperation) => `${operation.rotation.flat().join(",")}:${operation.translation.map((value) => Math.round(wrap(value) * 1e6) % 1e6).join(",")}`;
const sameOperations = (a: SymmetryOperation[], b: SymmetryOperation[]) => {
  const keys = new Set(a.map(operationKey));
  return a.length === b.length && keys.size === a.length && b.every((operation) => keys.has(operationKey(operation)));
};
function standardOperations(moyo: MoyoAnalyzer, number: number): SymmetryOperation[] {
  try {
    return list(moyo.operations_from_number(number, { type: MOYO_SETTING }, false), 192, "standard operations").map((value) => {
      const operation = record(value, "standard operation");
      return { rotation: fromColumnMajor(numbers(operation.rotation, 9, "standard rotation", true)), translation: wrapped(numbers(operation.translation, 3, "standard translation") as Vec3) };
    });
  } catch {
    return [];
  }
}

type CifSite = { label: string; species: string; wyckoff: string; multiplicity: number; position: Vec3 };
function writeCif(options: { block: string; lattice: Mat3; number: number; symbol: string | null; operations: SymmetryOperation[]; sites: CifSite[]; tolerance: number; kind: StandardCellKind; decimals: number }) {
  const { a, b, c, alpha, beta, gamma } = cellParameters(options.lattice);
  const lines = [
    `data_${cifLabel(options.block) || "crystal"}`,
    `_audit_creation_method ${cifText(`Burette ${options.kind} cell: moyo 0.21.0, spglib setting, symprec ${options.tolerance} A`)}`,
    ...([["length_a", a], ["length_b", b], ["length_c", c], ["angle_alpha", alpha], ["angle_beta", beta], ["angle_gamma", gamma]] as const).map(([name, value]) => `_cell_${name} ${value.toFixed(6)}`),
    `_cell_volume ${Math.abs(det(options.lattice)).toFixed(4)}`,
    `_space_group_crystal_system ${crystalSystem(options.number)}`,
    `_space_group_IT_number ${options.number}`,
    // The Hermann–Mauguin symbol names the standard setting; a primitive cell of a centred group is not in it.
    ...(options.symbol ? [`_space_group_name_H-M_alt ${cifText(options.symbol)}`] : []),
    "loop_", "_space_group_symop_id", "_space_group_symop_operation_xyz",
    ...options.operations.map((operation, index) => `${index + 1} '${symmetryOperationXyz(operation)}'`),
    // ITA multiplicities refer to the conventional cell; a primitive cell lists fewer copies.
    "loop_", "_atom_site_label", "_atom_site_type_symbol", ...(options.kind === "conventional" ? ["_atom_site_symmetry_multiplicity"] : []), "_atom_site_Wyckoff_symbol",
    "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z", "_atom_site_occupancy",
    ...options.sites.map((site) => [site.label, site.species, ...(options.kind === "conventional" ? [site.multiplicity] : []), site.wyckoff, ...site.position.map((value) => wrap(value).toFixed(options.decimals)), "1"].join(" ")),
  ];
  return `${lines.join("\n")}\n`;
}

export type CifReader = (text: string) => Promise<{ atoms: MolecularAtom[]; cell: UnitCell }>;

/**
 * The refined conventional or primitive cell as a new CIF: its own symmetry operations
 * (found again on that cell), the symmetry-distinct sites with Wyckoff letters, and labels
 * of the source atoms they came from. The CIF is read back and must reproduce every atom.
 */
export async function standardizeCrystal(moyo: MoyoAnalyzer, sites: CrystalSites, tolerance: number, kind: StandardCellKind, options: { title: string; readCif: CifReader; expectedNumber?: number }): Promise<StandardizedCrystal> {
  const { input, dataset } = analyzed(moyo, sites, tolerance);
  if (options.expectedNumber !== undefined && dataset.number !== options.expectedNumber) throw new Error("The structure changed since it was analysed.");
  const cell = kind === "conventional" ? dataset.std : dataset.prim;
  const sources = sourceAtoms(cell, kind === "conventional" ? dataset.stdLinear : dataset.primLinear, kind === "conventional" ? dataset.stdShift : dataset.primShift, input);
  // The refined cell's own operations, orbits and Wyckoff letters.
  const own = analyze(moyo, cell, input.species.length, tolerance);
  if (own.number !== dataset.number) throw new Error("The standardized cell has a different space group at this tolerance. Try a smaller tolerance.");
  // The Hermann–Mauguin symbol names a setting: write it only when this cell's operations
  // are exactly those of the standard setting, origin included.
  const inStandardSetting = kind === "conventional" && sameOperations(own.operations, standardOperations(moyo, dataset.number));
  const operations = [...own.operations].sort((a, b) => Number(isIdentity(b)) - Number(isIdentity(a)));
  if (!isIdentity(operations[0])) throw invalid("operation list");
  const counts = new Map<number, number>();
  own.orbits.forEach((representative) => counts.set(representative, (counts.get(representative) ?? 0) + 1));
  const used = new Set<string>();
  const perElement = new Map<string, number>();
  const cifSites = [...counts].map(([representative, multiplicity]) => {
    const species = input.species[cell.numbers[representative] - 1];
    const element = SPECIES.exec(species)![1];
    const source = sources[representative];
    let label = source ? cifLabel(input.labels[source.index]) : "";
    if (!label || used.has(label)) {
      let next = perElement.get(element) ?? 0;
      do label = `${element}${++next}`; while (used.has(label));
      perElement.set(element, next);
    }
    used.add(label);
    return { label, species, wyckoff: own.wyckoffs[representative], multiplicity, position: cell.fractional[representative] };
  });
  const block = `${options.title}_${kind}`;
  // Reading the CIF back expands the sites by the operations; written precision decides
  // whether symmetry copies of a special position coincide, so a mismatch retries it.
  for (const decimals of [10, 9, 11, 8]) {
    const cif = writeCif({ block, lattice: cell.lattice, number: dataset.number, symbol: inStandardSetting ? dataset.symbol : null, operations, sites: cifSites, tolerance, kind, decimals });
    if (await reproduces(cif, cell, input, options.readCif)) {
      return { kind, cif, atomCount: cell.numbers.length, siteCount: cifSites.length, number: dataset.number, symbol: dataset.symbol,
        parameters: cellParameters(cell.lattice), labelsFromSource: sources.every(Boolean) };
    }
  }
  throw new Error("The standardized cell could not be written as a CIF that reproduces it.");
}

async function reproduces(cif: string, cell: OutputCell, input: PreparedCrystal, readCif: CifReader) {
  const read = await readCif(cif);
  if (read.atoms.length !== cell.numbers.length) return false;
  const lattice = latticeOf(read.cell);
  const toFractional = inverse(lattice);
  const index = new PeriodicIndex(cell.lattice, cell.fractional, 1e-3);
  const matched = new Set<number>();
  return read.atoms.every((atom) => {
    const point = wrapped(apply(toFractional, [atom.x, atom.y, atom.z]));
    const match = index.nearest(point, 1e-4, (candidate) => !matched.has(candidate) && SPECIES.exec(input.species[cell.numbers[candidate] - 1])![1] === atom.element);
    if (match) matched.add(match.index);
    return Boolean(match);
  });
}

// ---- cell edits ------------------------------------------------------------------------------

/**
 * Space-group edits of Avogadro's Crystal ▸ Space Group menu, which calls spglib's
 * standardize_cell (avogadrolibs avospglib.cpp):
 *   primitive     to_primitive = 1, no_idealize = 1 — the primitive basis of the same
 *                 atoms, without moving them onto refined positions;
 *   conventional  to_primitive = 0, idealize — the refined conventional cell;
 *   symmetrize    to_primitive = 1, idealize — the refined primitive cell.
 * The finder here is moyo; its refined cells are rotated to the standard
 * orientation by a proper rotation, so the handedness of the structure is kept.
 */
export type SymmetryEditKind = "primitive" | "conventional" | "symmetrize" | "asymmetric-unit";
export type SymmetryEditResult = {
  sites: CrystalSites;
  /** Operations that expand `sites` to the full cell; only for the asymmetric unit. */
  operations: SymmetryOperation[] | null;
  number: number;
  hallNumber: number;
  symbol: string;
};

function sitesFrom(cell: OutputCell, input: PreparedCrystal, labels: string[]): CrystalSites {
  const atoms = cell.fractional.map((point, index) => {
    const [x, y, z] = apply(cell.lattice, point);
    return { element: SPECIES.exec(input.species[cell.numbers[index] - 1])![1], x, y, z };
  });
  return { atoms, cell: vectorsOf(cell.lattice), species: cell.numbers.map((number) => input.species[number - 1]), labels };
}

function refinedLabels(cell: OutputCell, linear: Mat3, shift: Vec3, input: PreparedCrystal) {
  return sourceAtoms(cell, linear, shift, input).map((match, index) => (match ? input.labels[match.index] : `${SPECIES.exec(input.species[cell.numbers[index] - 1])![1]}${index + 1}`));
}

export function editCrystalSymmetry(moyo: MoyoAnalyzer, sites: CrystalSites, tolerance: number, kind: SymmetryEditKind): SymmetryEditResult {
  const { input, dataset } = analyzed(moyo, sites, tolerance);
  const group = { number: dataset.number, hallNumber: dataset.hallNumber, symbol: dataset.symbol };
  if (kind === "conventional") {
    return { ...group, operations: null, sites: sitesFrom(dataset.std, input, refinedLabels(dataset.std, dataset.stdLinear, dataset.stdShift, input)) };
  }
  if (kind === "symmetrize") {
    return { ...group, operations: null, sites: sitesFrom(dataset.prim, input, refinedLabels(dataset.prim, dataset.primLinear, dataset.primShift, input)) };
  }
  if (kind === "asymmetric-unit") {
    const keep = input.numbers.flatMap((_, atom) => (dataset.orbits[atom] === atom ? [atom] : []));
    // A representative on a special position is averaged over the operations that fix
    // it (moving it by at most the tolerance), so its images coincide exactly when the
    // CIF is expanded again instead of becoming near-duplicates.
    const projected = keep.map((atom) => {
      const point = input.fractional[atom];
      const images = dataset.operations.flatMap((operation) => {
        const image = apply(operation.rotation, point).map((value, axis) => value + operation.translation[axis]) as Vec3;
        const delta = image.map((value, axis) => { const d = value - point[axis]; return d - Math.round(d); }) as Vec3;
        return norm(apply(input.lattice, delta)) <= 2 * tolerance ? [delta] : [];
      });
      const mean = [0, 1, 2].map((axis) => point[axis] + images.reduce((sum, delta) => sum + delta[axis], 0) / images.length) as Vec3;
      const [x, y, z] = apply(input.lattice, mean);
      return { ...sites.atoms[atom], x, y, z };
    });
    return {
      ...group,
      operations: [...dataset.operations].sort((a, b) => Number(isIdentity(b)) - Number(isIdentity(a))),
      sites: { cell: sites.cell, atoms: projected, species: keep.map((atom) => sites.species[atom]), labels: keep.map((atom) => sites.labels[atom]) },
    };
  }
  // Primitive basis of the same atoms: the lattice A·P, atoms kept at their Cartesian
  // positions modulo the new lattice, the first atom of each primitive site in source order.
  const lattice = multiply(input.lattice, dataset.primLinear);
  const toFractional = inverse(lattice);
  const kept = [...new Map(dataset.primMapping.map((site, atom) => [site, atom] as const).reverse()).values()].sort((x, y) => x - y);
  if (kept.length !== dataset.prim.numbers.length) throw invalid("primitive mapping");
  return {
    ...group, operations: null,
    sites: {
      cell: vectorsOf(lattice),
      atoms: kept.map((atom) => {
        const [x, y, z] = apply(lattice, wrapped(apply(toFractional, [sites.atoms[atom].x, sites.atoms[atom].y, sites.atoms[atom].z])));
        return { ...sites.atoms[atom], x, y, z };
      }),
      species: kept.map((atom) => sites.species[atom]),
      labels: kept.map((atom) => sites.labels[atom]),
    },
  };
}

/** One of the 530 Hall settings of the 230 space-group types, as a fill choice. */
export type SpaceGroupSetting = { hallNumber: number; number: number; symbol: string; hallSymbol: string; setting: string };

export function spaceGroupSettings(moyo: MoyoAnalyzer): SpaceGroupSetting[] {
  return Array.from({ length: 530 }, (_, index) => {
    const entry = record(moyo.hall_symbol_entry(index + 1), "Hall entry");
    return {
      hallNumber: integer(entry.hall_number, 1, 530, "Hall number"),
      number: integer(entry.number, 1, 230, "space-group number"),
      symbol: text(entry.hm_short, /^[A-Za-z0-9_/:\- ]+$/u, "space-group symbol"),
      hallSymbol: text(entry.hall_symbol, /^[A-Za-z0-9_/:\-+" ()'*=.]+$/u, "Hall symbol"),
      setting: typeof entry.setting === "string" ? entry.setting.slice(0, 16) : "",
    };
  });
}

/** Atoms closer than this, modulo the lattice, are one site after filling (Avogadro's 0.25 Å). */
export const FILL_DISTANCE = 0.25;

/**
 * Applies every operation of one Hall setting to every atom, in the cell as given,
 * and adds the images not already present (Avogadro's Fill Unit Cell). Source atoms
 * keep their positions and order; new atoms follow, wrapped into the cell. A site
 * that two different species would occupy is refused.
 */
export function fillUnitCell(moyo: MoyoAnalyzer, sites: CrystalSites, hallNumber: number): { sites: CrystalSites; added: number; number: number; symbol: string } {
  if (!Number.isInteger(hallNumber) || hallNumber < 1 || hallNumber > 530) throw new Error("Choose a space-group setting (Hall number 1 to 530).");
  const entry = record(moyo.hall_symbol_entry(hallNumber), "Hall entry");
  const number = integer(entry.number, 1, 230, "space-group number");
  const operations = list(moyo.operations_from_number(number, { type: "HallNumber", value: hallNumber }, false), 192, "operation list").map((value) => {
    const operation = record(value, "operation");
    return { rotation: fromColumnMajor(numbers(operation.rotation, 9, "rotation", true)), translation: numbers(operation.translation, 3, "translation") as Vec3 };
  });
  const lattice = latticeOf(sites.cell);
  checkLattice(lattice);
  const toFractional = inverse(lattice);
  const spacings = planeSpacings(lattice);
  const counts = spacings.map((spacing) => Math.max(1, Math.min(64, Math.floor(spacing / FILL_DISTANCE))));
  const bins = new Map<string, number[]>();
  const placed: { point: Vec3; species: string }[] = [];
  const binOf = (point: Vec3) => point.map((value, axis) => Math.min(counts[axis] - 1, Math.floor(wrap(value) * counts[axis])));
  const occupant = (point: Vec3) => {
    const [i, j, k] = binOf(point);
    for (const di of [-1, 0, 1]) for (const dj of [-1, 0, 1]) for (const dk of [-1, 0, 1]) {
      const key = [(i + di + counts[0]) % counts[0], (j + dj + counts[1]) % counts[1], (k + dk + counts[2]) % counts[2]].join(",");
      for (const index of bins.get(key) ?? []) {
        const delta = placed[index].point.map((value, axis) => { const d = value - point[axis]; return d - Math.round(d); }) as Vec3;
        if (norm(apply(lattice, delta)) < FILL_DISTANCE) return placed[index];
      }
    }
    return null;
  };
  const place = (point: Vec3, species: string) => {
    const key = binOf(point).join(",");
    const bin = bins.get(key);
    if (bin) bin.push(placed.length); else bins.set(key, [placed.length]);
    placed.push({ point, species });
  };
  const atoms = sites.atoms.map((atom) => ({ ...atom })), species = [...sites.species], labels = [...sites.labels];
  const fractional = sites.atoms.map((atom) => apply(toFractional, [atom.x, atom.y, atom.z]));
  fractional.forEach((point, index) => {
    const other = occupant(point);
    if (other && other.species !== sites.species[index]) throw new Error(`Atom ${sites.labels[index]} shares its site with a different element.`);
    place(point, sites.species[index]);
  });
  fractional.forEach((point, index) => {
    for (const operation of operations) {
      const image = wrapped(apply(operation.rotation, point).map((value, axis) => value + operation.translation[axis]) as Vec3);
      const other = occupant(image);
      if (other) {
        if (other.species !== sites.species[index]) throw new Error(`A symmetry copy of ${sites.labels[index]} lands on a different element. Check the space group.`);
        continue;
      }
      if (atoms.length >= OUTPUT_ATOM_LIMIT) throw new Error(`Filling the cell would exceed ${OUTPUT_ATOM_LIMIT.toLocaleString("en-US")} atoms.`);
      place(image, sites.species[index]);
      const [x, y, z] = apply(lattice, image);
      atoms.push({ ...sites.atoms[index], x, y, z });
      species.push(sites.species[index]);
      labels.push(sites.labels[index]);
    }
  });
  return { sites: { atoms, cell: sites.cell, species, labels }, added: atoms.length - sites.atoms.length, number, symbol: text(entry.hm_short, /^[A-Za-z0-9_/:\- ]+$/u, "space-group symbol") };
}
