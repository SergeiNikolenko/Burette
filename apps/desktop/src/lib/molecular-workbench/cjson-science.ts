/** The vibrations, Gaussian basis and molecular orbitals of a Chemical JSON file, as
 * Avogadro writes and reads them (avogadro/io/cjsonformat.cpp, avogadrolibs revision
 * cb0e94852889da9f7288bd1e58241e69990935a7, BSD-3-Clause; see
 * docs/third-party/avogadro-LICENSE). Avogadro stores orbital energies in eV; they are
 * read here in Hartree. Exponents are bohr⁻², coefficients belong to normalized
 * primitives, and spherical shells keep Molden's m = 0, +1, −1, … order. */
import { shellSize } from "./gaussian-angular";
import type { AtomicChargeSet, GaussianShell, MolecularOrbital, VibrationalMode } from "./scientific-types";
import type { Vec3 } from "./types";

const EV_PER_HARTREE = 27.211386245988;
const MAX_BASIS = 2_000;
const MAX_COEFFICIENTS = 2_000_000;
// Avogadro's shellTypes: angular momentum, negative for spherical shells.
const SHELLS = new Map<number, [GaussianShell["kind"], boolean]>([
  [0, ["s", false]], [1, ["p", false]], [2, ["d", false]], [-2, ["d", true]],
  [3, ["f", false]], [-3, ["f", true]], [4, ["g", false]], [-4, ["g", true]],
]);

type RecordValue = Record<string, unknown>;
function fail(message: string): never { throw new Error(`Invalid Chemical JSON: ${message}`); }
const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function numbers(value: unknown, what: string, length?: number): number[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "number" || !Number.isFinite(item))
    || (length !== undefined && value.length !== length)) fail(`${what} must be ${length === undefined ? "a list of" : `${length}`} finite numbers.`);
  return value as number[];
}
const optional = (value: unknown, what: string, length: number) => value === undefined ? undefined : numbers(value, what, length);

/** One geometry's modes. Avogadro pads eigenvectors past 3N with zeros; those entries carry no atom. */
function readModes(value: RecordValue, atomCount: number): VibrationalMode[] {
  if (value.frequencies === undefined) return [];
  const frequencies = numbers(value.frequencies, "vibration frequencies");
  if (frequencies.length > 3 * atomCount) fail("there are more vibrations than 3N.");
  const intensities = optional(value.intensities, "IR intensities", frequencies.length);
  const raman = optional(value.ramanIntensities, "Raman intensities", frequencies.length);
  const vectors = value.eigenVectors;
  if (vectors !== undefined && (!Array.isArray(vectors) || vectors.length !== frequencies.length)) fail("each vibration needs one eigenvector.");
  return frequencies.map((frequencyCm1, index) => {
    const mode: VibrationalMode = { index, frequencyCm1 };
    if (intensities) mode.intensityKmMol = intensities[index];
    if (raman) mode.ramanActivityAngstrom4Amu = raman[index];
    if (Array.isArray(vectors)) {
      const flat = numbers(vectors[index], "eigenvectors");
      if (flat.length < 3 * atomCount || flat.length % 3 || flat.slice(3 * atomCount).some(entry => entry !== 0)) fail("an eigenvector does not match the atoms.");
      mode.displacements = Array.from({ length: atomCount }, (_, atom): Vec3 => [flat[3 * atom], flat[3 * atom + 1], flat[3 * atom + 2]]);
    }
    return mode;
  });
}

/** Modes by coordinate-set index: the sparse `conformers` map when present, else the flat keys for the active set. */
export function readCjsonVibrations(value: unknown, atomCount: number, activeSet: number): Map<number, VibrationalMode[]> {
  const sets = new Map<number, VibrationalMode[]>();
  if (value === undefined) return sets;
  if (!isRecord(value)) fail("vibrations must be an object.");
  if (isRecord(value.conformers)) {
    for (const [key, entry] of Object.entries(value.conformers)) {
      if (!/^\d+$/u.test(key) || !isRecord(entry)) fail("vibration conformers must be indexed objects.");
      sets.set(Number(key), readModes(entry, atomCount));
    }
  } else sets.set(activeSet, readModes(value, atomCount));
  return sets;
}

/** Contraction normalized over normalized primitives, as Avogadro's default `normalize`. */
function normalized(kind: GaussianShell["kind"], exponents: number[], coefficients: number[]) {
  const l = "spdfg".indexOf(kind);
  let norm = 0;
  exponents.forEach((a, p) => exponents.forEach((b, q) => { norm += coefficients[p] * coefficients[q] * (2 * Math.sqrt(a * b) / (a + b)) ** (l + 1.5); }));
  if (!(norm > 0)) fail("a basis shell has no normalizable contraction.");
  return coefficients.map(c => c / Math.sqrt(norm));
}

export function readCjsonBasis(value: unknown, atomCount: number): GaussianShell[] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail("basisSet must be an object.");
  if (value.primitiveNormalization !== undefined && value.primitiveNormalization !== "normalize") fail("only normalized basis primitives are supported.");
  const types = numbers(value.shellTypes, "shellTypes"), counts = numbers(value.primitivesPerShell, "primitivesPerShell");
  const owners = numbers(value.shellToAtomMap, "shellToAtomMap"), exponents = numbers(value.exponents, "basis exponents");
  const coefficients = numbers(value.coefficients, "basis coefficients", exponents.length);
  // Avogadro bounds the shells by shellTypes; some files carry a trailing primitive count.
  if (counts.length < types.length || owners.length < types.length) fail("every basis shell needs a primitive count and an atom.");
  let offset = 0, functions = 0;
  const basis = types.map((type, i): GaussianShell => {
    const shell = SHELLS.get(type), count = counts[i], atomIndex = owners[i];
    if (!shell) fail(`basis shell type ${type} is not supported.`);
    if (!Number.isInteger(atomIndex) || atomIndex < 0 || atomIndex >= atomCount || !Number.isInteger(count) || count < 1 || offset + count > exponents.length) fail("a basis shell does not match the atoms or primitives.");
    const shellExponents = exponents.slice(offset, offset + count);
    if (shellExponents.some(exponent => exponent <= 0)) fail("basis exponents must be positive.");
    const [kind, spherical] = shell;
    const result = { atomIndex, kind, spherical, exponents: shellExponents, coefficients: normalized(kind, shellExponents, coefficients.slice(offset, offset + count)) };
    offset += count;
    functions += shellSize(result);
    if (functions > MAX_BASIS) fail("the basis exceeds 2000 functions.");
    return result;
  });
  return basis.length ? basis : undefined;
}

function orbitalColumns(value: unknown, what: string, functions: number) {
  const flat = numbers(value, what);
  if (!flat.length || flat.length % functions) fail(`${what} do not match the basis.`);
  if (flat.length > MAX_COEFFICIENTS) fail("the orbital coefficients exceed the supported size.");
  // Avogadro's coefficient matrix is column-major: each orbital's coefficients are contiguous.
  return Array.from({ length: flat.length / functions }, (_, column) => flat.slice(column * functions, (column + 1) * functions));
}

/** The lowest orbitals filled when the file lists no occupations, as Avogadro's orbital table does. */
const aufbau = (count: number, electrons: number, perOrbital: number) =>
  Array.from({ length: count }, (_, i) => Math.max(0, Math.min(perOrbital, electrons - i * perOrbital)));

export function readCjsonOrbitals(value: unknown, basis: GaussianShell[] | undefined, multiplicity: number): MolecularOrbital[] {
  if (value === undefined || !basis) return [];
  if (!isRecord(value)) fail("orbitals must be an object.");
  const functions = basis.reduce((sum, shell) => sum + shellSize(shell), 0);
  const electrons = value.electronCount === undefined ? undefined : numbers([value.electronCount], "electronCount")[0];
  const table = (coefficients: number[][], energies: unknown, occupations: unknown, spin: MolecularOrbital["spin"], perOrbital: number, filled?: number) => {
    const ev = numbers(energies, `${spin === "beta" ? "beta " : ""}orbital energies`, coefficients.length);
    const occupancy = occupations !== undefined ? numbers(occupations, "orbital occupations", coefficients.length)
      : filled !== undefined ? aufbau(coefficients.length, filled, perOrbital) : coefficients.map(() => 0);
    if (occupancy.some(entry => entry < 0 || entry > perOrbital)) fail("orbital occupations are out of range.");
    const symmetries = Array.isArray(value.symmetries) && value.symmetries.length === coefficients.length && value.symmetries.every(label => typeof label === "string") && spin === "alpha" && perOrbital === 2
      ? value.symmetries as string[] : undefined;
    return coefficients.map((column, index): MolecularOrbital => ({ index, energyHartree: ev[index] / EV_PER_HARTREE, occupancy: occupancy[index], spin, coefficients: column,
      ...(symmetries?.[index] ? { symmetry: symmetries[index] } : {}) }));
  };
  if (value.moCoefficients != null) return table(orbitalColumns(value.moCoefficients, "orbital coefficients", functions), value.energies, value.occupations, "alpha", 2, electrons);
  if (value.alphaCoefficients == null && value.betaCoefficients == null) return [];
  const alpha = orbitalColumns(value.alphaCoefficients, "alpha orbital coefficients", functions);
  const beta = orbitalColumns(value.betaCoefficients, "beta orbital coefficients", functions);
  const unpaired = multiplicity - 1, alphaElectrons = electrons === undefined ? undefined : (electrons + unpaired) / 2;
  return [
    ...table(alpha, value.alphaEnergies, value.alphaOccupations, "alpha", 1, alphaElectrons),
    ...table(beta, value.betaEnergies, value.betaOccupations, "beta", 1, alphaElectrons === undefined ? undefined : electrons! - alphaElectrons),
  ];
}

/** Results Avogadro stores for a calculation: per-set energies, and the final geometry's energy, dipole and charges. */
export type CjsonResults = {
  /** Hartree energy of each coordinate set, when Avogadro stored one per set. */
  energies?: number[];
  /** The coordinate set the final energy, dipole and charges were computed at. */
  owner?: number;
  energyHartree?: number;
  dipoleDebye?: Vec3;
  charges?: AtomicChargeSet[];
};

const CHARGE_MODELS: Record<string, AtomicChargeSet["model"]> = {
  mulliken: "mulliken", loewdin: "lowdin", lowdin: "lowdin", hirshfeld: "hirshfeld", cm5: "cm5", npa: "npa",
  esp: "esp", chelpg: "chelpg", eeq: "eeq", gasteiger: "gasteiger",
};

/**
 * Avogadro's `properties.energies` (Hartree, one per set, each a one-element list), `totalEnergy`
 * (Hartree), `dipoleMoment` (debye) and `atoms.partialCharges` by model name. The total energy,
 * dipole and charges describe the final geometry: the only set, or the set whose stored energy is
 * the total energy. Avogadro keeps its first set in `coords.3d`, so position is no guide.
 */
export function readCjsonResults(properties: RecordValue, atoms: RecordValue, setCount: number, atomCount: number): CjsonResults {
  const results: CjsonResults = {};
  if (Array.isArray(properties.energies) && properties.energies.length === setCount) {
    const energies = properties.energies.map(entry => Array.isArray(entry) && entry.length === 1 ? entry[0] : entry);
    results.energies = numbers(energies, "set energies", setCount);
  }
  const total = typeof properties.totalEnergy === "number" && Number.isFinite(properties.totalEnergy) && properties.totalEnergy !== 0 ? properties.totalEnergy : undefined;
  const owner = setCount === 1 ? 0 : total === undefined || !results.energies ? -1 : results.energies.lastIndexOf(total);
  if (owner < 0) return results;
  results.owner = owner;
  if (total !== undefined) results.energyHartree = total;
  if (properties.dipoleMoment !== undefined) results.dipoleDebye = numbers(properties.dipoleMoment, "the dipole moment", 3) as Vec3;
  if (isRecord(atoms.partialCharges)) {
    const charges: AtomicChargeSet[] = [];
    for (const [name, values] of Object.entries(atoms.partialCharges)) {
      const model = CHARGE_MODELS[name.toLowerCase()];
      if (model && !charges.some(set => set.model === model)) charges.push({ model, values: numbers(values, `${name} charges`, atomCount) });
    }
    if (charges.length) results.charges = charges;
  }
  return results;
}
