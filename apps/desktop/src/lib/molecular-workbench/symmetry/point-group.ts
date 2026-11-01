import { atomicNumber } from "../elements";
import type { MolecularAtom, UnitCell, Vec3 } from "../types";
import { readCString, type StandaloneWasm } from "./wasm-module";

/** Molecular point groups and symmetrization through libmsym
 * (mcodev31/libmsym 85e4723, MIT).
 *
 * Coordinates stay in the caller's frame: libmsym only subtracts the
 * mass-weighted center internally, and symmetrized positions are returned in
 * input order at the original center and orientation. No canonical
 * reorientation is applied. Operation matrices act about `center`:
 * x' = M (x - center) + center. */

export const MAX_POINT_GROUP_ATOMS = 256;
/** Closer atoms are treated as overlapping input; libmsym divides by pair distances. */
export const MIN_ATOM_SEPARATION = 0.01;
const COORDINATE_LIMIT = 1e4;

/** "tight" is libmsym's default thresholds; the others are Avogadro's presets. */
export type PointGroupTolerance = "tight" | "normal" | "loose" | "very-loose";
const TOLERANCE_PRESETS: Record<PointGroupTolerance, number> = { tight: 0, normal: 1, loose: 2, "very-loose": 3 };

/** `isotope` is a mass number. Atoms without one use libmsym's default mass
 * number for the element, so an explicit ¹H matches plain H while D does not. */
export type PointGroupAtom = MolecularAtom & { isotope?: number };
export type PointGroupInput = { atoms: PointGroupAtom[]; tolerance?: PointGroupTolerance; cell?: UnitCell | null };

export type SymmetryOperationKind = "identity" | "rotation" | "improper-rotation" | "reflection" | "inversion";
export type SymmetryOperation = {
  kind: SymmetryOperationKind;
  /** Rotation order; null for the continuous C∞/S∞ axis of a linear molecule. */
  order: number | null;
  power: number;
  orientation: "none" | "horizontal" | "vertical" | "dihedral";
  /** libmsym's conjugacy class index within the group. */
  classIndex: number;
  /** Rotation axis or mirror-plane normal; null for identity and inversion. */
  axis: Vec3 | null;
  /** Row-major 3×3 matrix about `center`; null for a continuous axis. */
  matrix: [Vec3, Vec3, Vec3] | null;
  /** libmsym label such as "C3^1", "S4^3", "Rv" or "i". */
  label: string;
};
export type EquivalenceSet = { atoms: number[]; error: number };

export type PointGroupResult = {
  /** Schoenflies symbol with ∞ for linear groups, e.g. "C2v", "D∞h", "Kh". */
  pointGroup: string;
  /** libmsym's own symbol, e.g. "D0h". */
  libmsymPointGroup: string;
  /** Group order, or null for the infinite linear and spherical groups. */
  order: number | null;
  center: Vec3;
  operations: SymmetryOperation[];
  /** Symmetry-equivalent atoms; every input index appears exactly once. */
  equivalenceSets: EquivalenceSet[];
  tolerance: PointGroupTolerance;
};

export type SymmetrizeResult = PointGroupResult & {
  /** Symmetrized coordinates in input order. */
  coordinates: Vec3[];
  /** libmsym's reported symmetrization error. */
  symmetrizationError: number;
  maxDisplacement: number;
  rmsDisplacement: number;
};

type MsymExports = StandaloneWasm["exports"] & {
  burette_msym_analyze(count: number, charges: number, masses: number, xyz: number, preset: number, symmetrize: number): number;
  burette_msym_error(): number;
  burette_msym_point_group(): number;
  burette_msym_operation_count(): number;
  burette_msym_operations(): number;
  burette_msym_operation_name(index: number): number;
  burette_msym_set_count(): number;
  burette_msym_set_offsets(): number;
  burette_msym_set_atoms(): number;
  burette_msym_set_errors(): number;
  burette_msym_coordinates(): number;
  burette_msym_symmetrization_error(): number;
  burette_msym_center(): number;
  burette_msym_release(): void;
};

const OPERATION_STRIDE = 17;
const KINDS: SymmetryOperationKind[] = ["identity", "rotation", "improper-rotation", "reflection", "inversion"];
const ORIENTATIONS: SymmetryOperation["orientation"][] = ["none", "horizontal", "vertical", "dihedral"];

export function validatePointGroupInput(input: PointGroupInput) {
  if (input.cell) throw new Error("Point groups apply to isolated molecules; this structure has a periodic cell.");
  const { atoms } = input;
  if (!Array.isArray(atoms) || atoms.length < 1) throw new Error("The molecule has no atoms.");
  if (atoms.length > MAX_POINT_GROUP_ATOMS) throw new Error(`Point-group analysis supports at most ${MAX_POINT_GROUP_ATOMS} atoms.`);
  const tolerance = input.tolerance ?? "tight";
  if (!(tolerance in TOLERANCE_PRESETS)) throw new Error(`Unknown symmetry tolerance: ${tolerance}`);
  const charges = atoms.map(atom => atomicNumber(atom.element));
  const masses = atoms.map(atom => {
    if (atom.isotope === undefined) return 0;
    if (!Number.isInteger(atom.isotope) || atom.isotope < 1 || atom.isotope > 300) throw new Error("Isotope mass numbers must be integers between 1 and 300.");
    return atom.isotope;
  });
  atoms.forEach(atom => {
    if (![atom.x, atom.y, atom.z].every(value => Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT)) {
      throw new Error(`Atom coordinates must be finite and within ${COORDINATE_LIMIT} Å.`);
    }
  });
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      if (Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y, atoms[i].z - atoms[j].z) < MIN_ATOM_SEPARATION) {
        throw new Error(`Atoms ${i + 1} and ${j + 1} overlap.`);
      }
    }
  }
  return { atoms, charges, masses, tolerance };
}

export function analyzePointGroup(wasm: StandaloneWasm, input: PointGroupInput, mode: "detect"): PointGroupResult;
export function analyzePointGroup(wasm: StandaloneWasm, input: PointGroupInput, mode: "symmetrize"): SymmetrizeResult;
export function analyzePointGroup(wasm: StandaloneWasm, input: PointGroupInput, mode: "detect" | "symmetrize"): PointGroupResult | SymmetrizeResult {
  const { atoms, charges, masses, tolerance } = validatePointGroupInput(input);
  const engine = wasm.exports as MsymExports;
  const count = atoms.length;
  const chargePointer = engine.malloc(4 * count);
  const massPointer = engine.malloc(8 * count);
  const xyzPointer = engine.malloc(24 * count);
  try {
    new Int32Array(engine.memory.buffer, chargePointer, count).set(charges);
    new Float64Array(engine.memory.buffer, massPointer, count).set(masses);
    new Float64Array(engine.memory.buffer, xyzPointer, 3 * count).set(atoms.flatMap(atom => [atom.x, atom.y, atom.z]));
    const status = engine.burette_msym_analyze(count, chargePointer, massPointer, xyzPointer, TOLERANCE_PRESETS[tolerance], mode === "symmetrize" ? 1 : 0);
    if (status !== 0) {
      const details = readCString(engine.memory, engine.burette_msym_error()) || wasm.diagnostics().trim();
      throw new Error(`Symmetry analysis failed (libmsym ${status}): ${details || "no details"}`);
    }
    const result = readDetection(engine, count, tolerance);
    if (mode === "detect") return result;
    const flat = new Float64Array(engine.memory.buffer, engine.burette_msym_coordinates(), 3 * count);
    const coordinates = atoms.map((_, index) => [flat[3 * index], flat[3 * index + 1], flat[3 * index + 2]] as Vec3);
    const displacements = coordinates.map((point, index) => Math.hypot(point[0] - atoms[index].x, point[1] - atoms[index].y, point[2] - atoms[index].z));
    return {
      ...result,
      coordinates,
      symmetrizationError: engine.burette_msym_symmetrization_error(),
      maxDisplacement: Math.max(...displacements),
      rmsDisplacement: Math.sqrt(displacements.reduce((sum, value) => sum + value * value, 0) / count),
    };
  } finally {
    engine.burette_msym_release();
    engine.free(chargePointer);
    engine.free(massPointer);
    engine.free(xyzPointer);
  }
}

function readDetection(engine: MsymExports, count: number, tolerance: PointGroupTolerance): PointGroupResult {
  const libmsymPointGroup = readCString(engine.memory, engine.burette_msym_point_group());
  const operationCount = engine.burette_msym_operation_count();
  const raw = new Float64Array(engine.memory.buffer, engine.burette_msym_operations(), operationCount * OPERATION_STRIDE);
  const operations = Array.from({ length: operationCount }, (_, index): SymmetryOperation => {
    const values = raw.subarray(index * OPERATION_STRIDE, (index + 1) * OPERATION_STRIDE);
    const kind = KINDS[values[0]];
    const continuous = Number.isNaN(values[8]);
    return {
      kind,
      order: continuous ? null : values[1],
      power: values[2],
      orientation: ORIENTATIONS[values[3]],
      classIndex: values[4],
      axis: kind === "identity" || kind === "inversion" ? null : [values[5], values[6], values[7]],
      matrix: continuous ? null : [[values[8], values[9], values[10]], [values[11], values[12], values[13]], [values[14], values[15], values[16]]],
      label: readCString(engine.memory, engine.burette_msym_operation_name(index)),
    };
  });
  const setCount = engine.burette_msym_set_count();
  const offsets = new Int32Array(engine.memory.buffer, engine.burette_msym_set_offsets(), setCount + 1);
  const members = new Int32Array(engine.memory.buffer, engine.burette_msym_set_atoms(), count);
  const errors = new Float64Array(engine.memory.buffer, engine.burette_msym_set_errors(), setCount);
  const equivalenceSets = Array.from({ length: setCount }, (_, index) => ({ atoms: Array.from(members.subarray(offsets[index], offsets[index + 1])), error: errors[index] }));
  const center = Array.from(new Float64Array(engine.memory.buffer, engine.burette_msym_center(), 3)) as Vec3;
  const infinite = libmsymPointGroup === "Kh" || libmsymPointGroup === "K" || operations.some(operation => operation.order === null);
  return {
    pointGroup: libmsymPointGroup.replace(/^([CD])0/, "$1∞"),
    libmsymPointGroup,
    order: infinite ? null : operationCount,
    center,
    operations,
    equivalenceSets,
    tolerance,
  };
}
