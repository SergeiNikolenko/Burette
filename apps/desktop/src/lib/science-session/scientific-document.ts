import { bestRigidMotion } from "../workbench/zmatrix-optimization";
import { atomsFromZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";
import { atomicNumber } from "../molecular-workbench/elements";
import { checkMcdCompanion } from "../molecular-workbench/mcd-companion";
import { checkScientificSpectra, SCIENTIFIC_SPECTRA_LIMITS, type ScientificSpectra } from "../molecular-workbench/scientific-spectra";
import { shellSize } from "../molecular-workbench/gaussian-angular";
import { checkHessianValues, HESSIAN_UNITS } from "../molecular-workbench/hessian";
import type { GaussianShell, ScientificDocument } from "../molecular-workbench/scientific-types";
import type { MolecularAtom } from "../molecular-workbench/types";
import type { XyzFrame } from "./source-frames";
import { normalizeElement, ScienceSessionError, SCIENCE_SESSION_LIMITS } from "./contracts";

const FORMATS = new Set<ScientificDocument["format"]>(["gaussian-log", "qcschema", "fchk", "orca", "orca-hessian", "molden", "cube", "xyz", "zmat", "cjson"]);
const SHELLS = new Set(["s", "p", "d", "f", "g", "h", "i"]);
const MAX_COEFFICIENTS = 2_000_000;
const MAX_MODE_VALUES = 2_000_000;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numbers = (value: unknown): value is number[] => Array.isArray(value) && value.every(finite);
const isVec3 = (value: unknown) => numbers(value) && value.length === 3;
function fail(message: string): never { throw new ScienceSessionError("science", message); }

function optionalNumbers(record: Record<string, unknown>, keys: readonly string[], path: string) {
  for (const key of keys) if (record[key] !== undefined && !finite(record[key])) fail(`${path}.${key} must be a finite number.`);
}
function optionalString(record: Record<string, unknown>, key: string, path: string) {
  if (record[key] !== undefined && typeof record[key] !== "string") fail(`${path}.${key} must be text.`);
}

function checkAtoms(value: unknown, path: string, expected: readonly string[]): MolecularAtom[] {
  if (!Array.isArray(value) || !value.length || value.length > SCIENCE_SESSION_LIMITS.atoms) fail(`${path} must list 1–10,000 atoms.`);
  value.forEach((atom, index) => {
    if (!isRecord(atom) || typeof atom.element !== "string" || normalizeElement(atom.element) !== atom.element
      || ![atom.x, atom.y, atom.z].every((item) => finite(item) && Math.abs(item) <= 1e6)) fail(`${path}[${index}] is not an atom.`);
  });
  const atoms = value as MolecularAtom[];
  if (atoms.length !== expected.length || atoms.some((atom, index) => normalizeElement(atom.element) !== expected[index])) fail(`${path} does not match the scene atoms.`);
  return atoms;
}

// XYZ formatting rounds Cartesian positions. This tolerance covers that rounding, while
// scientific geometry stays in float64; Mol*'s wider float32 tolerance belongs at its bridge.
function matchesFrame(atoms: readonly MolecularAtom[], frame: XyzFrame) {
  return atoms.length === frame.elements.length && atoms.every((atom, index) => normalizeElement(atom.element) === frame.elements[index]
    && [atom.x, atom.y, atom.z].every((value, axis) => Math.abs(value - frame.positions[index * 3 + axis]) <= 1e-5));
}
const frameOf = (atoms: readonly MolecularAtom[]): XyzFrame => ({ elements: atoms.map((atom) => normalizeElement(atom.element)!), positions: Float64Array.from(atoms.flatMap((atom) => [atom.x, atom.y, atom.z])) });

/** Fully validates the schema panels and field evaluators consume, plus its source geometry. */
export function validateScientificDocument(value: unknown, sourceFrames: readonly XyzFrame[], graphSource?: string): ScientificDocument {
  if (!isRecord(value) || !FORMATS.has(value.format as ScientificDocument["format"])) fail("Scientific data has an unknown format.");
  const document = value;
  const elements = sourceFrames[0].elements;
  const atoms = checkAtoms(document.atoms, "atoms", elements);
  const geometry = frameOf(atoms);
  if (!matchesFrame(atoms, sourceFrames[0])) fail("Scientific atoms do not match the scene source geometry.");
  if (!Array.isArray(document.frames) || !document.frames.length || document.frames.length > SCIENCE_SESSION_LIMITS.frames) fail("Scientific data must have 1–2,000 frames.");
  let spectralRows = 0, spectralScalars = 0;
  const frameCount = document.frames.length;
  const checkSpectra = (value: unknown, owner: readonly MolecularAtom[], path: string, frameIndex?: number) => {
    if (value === undefined) return;
    let data: ScientificSpectra;
    try { data = checkScientificSpectra(value); }
    catch (error) { return fail(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
    if (data.atomicNumbers.length !== owner.length || data.atomicNumbers.some((number, i) => number !== atomicNumber(owner[i].element))) fail(`${path} does not match its source atoms.`);
    if (frameIndex === undefined) {
      if (data.source.scope !== "file") fail(`${path} must be file-scoped, not a current-frame alias.`);
    } else if (data.source.scope !== "frame" || data.source.frameIndex !== frameIndex || data.source.frameCount !== frameCount) fail(`${path} does not belong to this exact source frame.`);
    spectralScalars += data.atomicNumbers.length;
    for (const signal of data.spectra) {
      const size = signal.kind === "nmr" ? signal.valuesPpm.length : signal.positions.length;
      spectralRows += size;
      spectralScalars += size * 2 + (signal.kind !== "nmr" && signal.sourceRowIds ? size : 0);
      for (const column of signal.auxiliary ?? []) spectralScalars += column.values.length;
    }
    if (spectralRows > SCIENTIFIC_SPECTRA_LIMITS.rows || spectralScalars > SCIENTIFIC_SPECTRA_LIMITS.scalars) fail("Spectra across all source frames exceed the supported row/scalar budget.");
  };
  checkSpectra(document.spectra, atoms, "spectra");
  let modeValues = 0;
  const checkModes = (modes: unknown, path: string) => {
    if (modes === undefined) return;
    if (!Array.isArray(modes) || modes.length > elements.length * 3) fail(`${path} must list at most three modes per atom.`);
    const indices = new Set<number>();
    modes.forEach((mode, index) => {
      if (!isRecord(mode) || !finite(mode.frequencyCm1) || !Number.isInteger(mode.index) || (mode.index as number) < 0
        || (mode.index as number) >= elements.length * 3 || indices.has(mode.index as number)) fail(`${path}[${index}] is not a normal mode.`);
      indices.add(mode.index as number);
      optionalString(mode, "symmetry", `${path}[${index}]`);
      optionalNumbers(mode, ["intensityKmMol", "transitionDipoleSquared", "ramanActivityAngstrom4Amu", "ramanDepolarizationRatio", "ramanDepolarizationRatioUnpolarized", "reducedMassAmu", "forceConstantMdynAngstrom"], `${path}[${index}]`);
      for (const key of ["intensityKmMol", "transitionDipoleSquared", "ramanActivityAngstrom4Amu", "reducedMassAmu"]) {
        if (mode[key] !== undefined && (mode[key] as number) < 0) fail(`${path}[${index}].${key} cannot be negative.`);
      }
      for (const key of ["ramanDepolarizationRatio", "ramanDepolarizationRatioUnpolarized"]) {
        if (mode[key] !== undefined && ((mode[key] as number) < 0 || (mode[key] as number) > 1)) fail(`${path}[${index}].${key} must be between zero and one.`);
      }
      if (mode.displacements !== undefined) {
        if (!Array.isArray(mode.displacements) || mode.displacements.length !== elements.length || !mode.displacements.every(isVec3)) fail(`${path}[${index}] displacements do not match the atoms.`);
        modeValues += mode.displacements.length * 3;
        if (modeValues > MAX_MODE_VALUES) fail("Normal modes exceed the supported matrix size.");
      }
    });
  };
  const scientificFrames = document.frames.map((frame, index) => {
    if (!isRecord(frame)) fail(`frames[${index}] is not a frame.`);
    const frameAtoms = checkAtoms(frame.atoms, `frames[${index}].atoms`, elements);
    optionalNumbers(frame, ["energyHartree", "timePs", "temperatureKelvin"], `frames[${index}]`);
    optionalString(frame, "comment", `frames[${index}]`);
    checkModes(frame.modes, `frames[${index}].modes`);
    checkSpectra(frame.spectra, frameAtoms, `frames[${index}].spectra`, index);
    if (frame.mcdCompanion !== undefined) {
      const pair = frame.mcdCompanion;
      if (!isRecord(pair) || typeof pair.primaryOriginalSha256 !== "string" || typeof pair.companionOriginalSha256 !== "string"
        || typeof pair.sourceRevisionSha256 !== "string") fail(`frames[${index}].mcdCompanion is not a source pair.`);
      try {
        const checked = checkMcdCompanion(pair, { primaryOriginalSha256: pair.primaryOriginalSha256, companionOriginalSha256: pair.companionOriginalSha256,
          sourceRevisionSha256: pair.sourceRevisionSha256, frameIndex: index, frameCount, atomicNumbers: frameAtoms.map(atom => atomicNumber(atom.element)) });
        checkSpectra(checked.spectra, frameAtoms, `frames[${index}].mcdCompanion.spectra`, index);
      } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    }
    for (const key of ["velocitiesAngstromPerPs", "forcesKcalMolAngstrom"]) {
      const vectors = frame[key];
      if (vectors !== undefined && (!Array.isArray(vectors) || vectors.length !== elements.length || !vectors.every(isVec3))) fail(`frames[${index}].${key} do not match the atoms.`);
    }
    const hessian = frame.hessian;
    if (hessian !== undefined) {
      if (!isRecord(hessian) || hessian.units !== HESSIAN_UNITS || !(hessian.values instanceof Float64Array)
        || (hessian.source !== "orca-hess" && hessian.source !== "gaussian-fchk")) fail(`frames[${index}].hessian is not a Cartesian Hessian.`);
      if (hessian.dimension !== elements.length * 3) fail(`frames[${index}].hessian does not match the atoms.`);
      try { checkHessianValues(hessian.values, hessian.dimension); }
      catch (error) { fail('frames[' + index + '].hessian: ' + (error instanceof Error ? error.message : String(error))); }
      const masses = hessian.massesAmu;
      if (masses !== undefined && (!numbers(masses) || masses.length !== elements.length || masses.some((mass) => mass <= 0 || mass > 1000))) fail(`frames[${index}].hessian masses do not match the atoms.`);
    }
    return frameAtoms;
  });
  if (document.format === "cjson") {
    const graph = document.graph;
    if (!isRecord(graph) || typeof graph.molfile !== "string" || graph.molfile !== graphSource
      || sourceFrames.length !== 1 || !Number.isInteger(graph.activeFrameIndex)
      || (graph.activeFrameIndex as number) < 0 || (graph.activeFrameIndex as number) >= scientificFrames.length) {
      fail("CJSON science must own the exact MOL source and a valid source coordinate-set index.");
    }
    if (!matchesFrame(scientificFrames[graph.activeFrameIndex as number], geometry)) fail("The selected CJSON coordinate set does not match its MOL source.");
  } else if (document.graph !== undefined) fail("Only CJSON science can own an explicit graph source.");
  if (sourceFrames.length > 1) {
    if (sourceFrames.length !== scientificFrames.length || sourceFrames.some((frame, index) => !matchesFrame(scientificFrames[index], frame))) fail("Scientific trajectory frames do not match the scene source geometry.");
  } else if (!scientificFrames.some((frame) => matchesFrame(frame, geometry))) {
    // A final-layout source has one frame while its science retains optimization history.
    fail("Scientific history does not contain the scene source geometry.");
  }
  if (!Array.isArray(document.modes) || !Array.isArray(document.orbitals)) fail("Scientific data lacks its modes or orbitals.");
  modeValues = 0; // The current geometry repeats its modes outside the retained frame history.
  checkModes(document.modes, "modes");
  let basisCount: number | null = null;
  if (document.basis !== undefined) {
    if (!Array.isArray(document.basis) || !document.basis.length) fail("The Gaussian basis must list shells.");
    basisCount = 0;
    for (const shell of document.basis) {
      if (!isRecord(shell) || !Number.isInteger(shell.atomIndex) || (shell.atomIndex as number) < 0 || (shell.atomIndex as number) >= elements.length
        || !SHELLS.has(shell.kind as string) || typeof shell.spherical !== "boolean"
        || (shell.cartesianOrder !== undefined && shell.cartesianOrder !== "molden" && shell.cartesianOrder !== "gaussian")
        || (!shell.spherical && (shell.kind === "h" || shell.kind === "i") && shell.cartesianOrder !== "gaussian")
        || !numbers(shell.exponents) || !numbers(shell.coefficients) || !shell.exponents.length || shell.exponents.length > 1024
        || shell.exponents.length !== shell.coefficients.length || shell.exponents.some((exponent) => exponent <= 0)) fail("The Gaussian basis shell is malformed or does not match the atoms.");
      basisCount += shellSize(shell as unknown as GaussianShell);
      if (basisCount > 2000) fail("The Gaussian basis exceeds 2,000 functions.");
    }
  }
  if (document.orbitals.length > 10_000) fail("The orbital table exceeds 10,000 orbitals.");
  let coefficients = 0;
  const orbitalIndices = new Set<string>();
  document.orbitals.forEach((orbital, index) => {
    if (!isRecord(orbital) || !Number.isSafeInteger(orbital.index) || (orbital.index as number) < 0 || !finite(orbital.energyHartree)
      || !finite(orbital.occupancy) || orbital.occupancy < 0 || orbital.occupancy > 2 || !numbers(orbital.coefficients)
      || (orbital.spin !== "alpha" && orbital.spin !== "beta")) fail(`orbitals[${index}] is not an orbital.`);
    optionalString(orbital, "symmetry", `orbitals[${index}]`);
    const key = `${orbital.spin}:${orbital.index}`;
    if (orbitalIndices.has(key)) fail(`orbitals[${index}] duplicates an orbital index.`);
    orbitalIndices.add(key);
    if (basisCount !== null && orbital.coefficients.length !== basisCount) fail(`orbitals[${index}] coefficients do not match the Gaussian basis.`);
    coefficients += orbital.coefficients.length;
    if (coefficients > MAX_COEFFICIENTS) fail("The orbital coefficient matrix exceeds the supported size.");
  });
  const grid = document.grid;
  if (grid !== undefined) {
    if (!isRecord(grid) || !(grid.values instanceof Float32Array) || !numbers(grid.dimensions) || grid.dimensions.length !== 3
      || !isVec3(grid.origin) || !Array.isArray(grid.axes) || grid.axes.length !== 3 || !grid.axes.every(isVec3)) fail("The scalar grid is malformed.");
    if (!grid.dimensions.every((size) => Number.isInteger(size) && size >= 1)) fail("The scalar grid dimensions are invalid.");
    const product = grid.dimensions.reduce((total, size) => total * size, 1);
    if (product > SCIENCE_SESSION_LIMITS.gridValues || grid.values.length !== product || !grid.values.every(Number.isFinite)) fail("The scalar grid values do not match its dimensions.");
  }
  if (document.converged !== undefined && typeof document.converged !== "boolean") fail("Scientific convergence must be a boolean.");
  if (document.internalCoordinates !== undefined) {
    let real: MolecularAtom[];
    try {
      const rebuilt = atomsFromZmatrixDocument(document.internalCoordinates as never);
      if (rebuilt.length !== atoms.length || rebuilt.some((atom, index) => atom.element !== atoms[index].element)) fail("The Z-matrix atoms do not match the scientific geometry.");
      // Internal coordinates define shape and handedness, not the source's world pose.
      const motion = bestRigidMotion(rebuilt.map(atom => atom.position), atoms.map(({ x, y, z }) => [x, y, z]));
      real = rebuilt.map(({ element, position }) => { const [x, y, z] = motion.point(position); return { element, x, y, z }; });
    }
    catch (error) { return fail(`The Z-matrix definition is invalid: ${error instanceof Error ? error.message : String(error)}`); }
    if (!matchesFrame(real, geometry)) fail("The Z-matrix definition does not match the scientific geometry.");
  }
  return document as unknown as ScientificDocument;
}
