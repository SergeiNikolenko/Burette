import { ConformerGenerator, Molecule, MoleculeProperties, Resources } from 'openchemlib';
import resources from '../../../../../node_modules/openchemlib/dist/resources.json';
import type { MolecularAtom } from './types';
import { appendHydrogens } from './hydrogen-geometry';
import { assignProtonationStates, type ProtonationChange } from './protonation';
import { serializePhysicalMolfile } from './molecule-serialization';
import { readUnspecifiedMolfileStereo, retainUnknownStereo } from './molecule-stereochemistry';
import { optimizeCartesian, defaultOptimizationMethod, optimizationUnavailable, OPTIMIZATION_LIMITS, CONFORMER_LIMITS, flatDepiction, type EnergyEvaluator, type OptimizeOptions, type OptimizationResult } from './optimization';
import { createForceField, type MolecularForceField } from './forcefield';
import { ForceFieldMMFF94 } from 'openchemlib';
import { calculateGasteigerWasm, createUffWasmEvaluator, extractMmffParametersWasm, prepareUffWasm } from './uff-wasm';
import { decodeMmffTerms, mmffEnergy } from './mmff-analytic';
export type { MolecularForceField } from './forcefield';
export type { GeometryConstraint, OptimizeOptions, OptimizationResult, OptimizationMethod } from './optimization';

Resources.register(resources);

export type { MolecularStructure } from './molecular-graph';
import { checkMoleculeSize as checkSize, snapshotMolecule as snapshot, parseMolecule as parseGraph, type MolecularStructure } from './molecular-graph';

function checkHydrogenExpansion(mol: Molecule) {
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  checkSize(mol.getAllAtoms() + Array.from({ length: mol.getAllAtoms() }, (_, i) => mol.getImplicitHydrogens(i)).reduce((a, b) => a + b, 0));
}
function expandedAtomMap(structure: MolecularStructure, count: number): number[] {
  // Hydrogen expansion and conformer generation append new H after the existing,
  // normalized atom array. Retain external indices and append only new atoms.
  const existing = structure.atomMap ?? structure.atoms.map((_, i) => i);
  return [...existing, ...Array.from({ length: count - existing.length }, (_, i) => existing.length + i)];
}
function toOcl(structure: MolecularStructure, requireComplete = true): Molecule {
  checkSize(structure.atoms.length);
  if (requireComplete && !structure.graphComplete) throw new Error('XYZ does not specify bond orders or charges. Provide SMILES or SDF before this calculation.');
  const { molecule: mol, map: sourceMap } = Molecule.fromMolfileWithAtomMap(structure.molfile);
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  if (mol.getAllAtoms() !== structure.atoms.length) throw new Error('Molecular graph and coordinates have different atom counts.');
  if (structure.atomMap && (structure.atomMap.length !== structure.atoms.length || new Set(structure.atomMap).size !== structure.atoms.length || structure.atomMap.some(i => !Number.isInteger(i) || i < 0 || i >= structure.atoms.length))) throw new Error('Invalid molecular atom mapping.');
  const diagram = !mol.is3D() && structure.atoms.every(a => a.z === 0);
  // Resolve diagram stereo before XYZ writeback invalidates its source-frame helpers.
  const unspecified = readUnspecifiedMolfileStereo(mol, structure.molfile, sourceMap);
  structure.atoms.forEach((a, i) => {
    const index = structure.atomMap?.[i] ?? i;
    if (a.element !== mol.getAtomLabel(index) || ![a.x, a.y, a.z].every(Number.isFinite)) throw new Error('Molecular graph and atom identities do not match.');
    mol.setAtomX(index, a.x); mol.setAtomY(index, a.y); mol.setAtomZ(index, a.z);
  });
  if (diagram) {
    // Encode the retained diagram parity in the physical drawing frame.
    mol.setParitiesValid(0);
    mol.setStereoBondsFromParity();
  }
  if (unspecified.atoms.length || unspecified.bonds.length) {
    // Changed 3D coordinates own known stereo; only explicit unknown constraints survive from source.
    if (!diagram) mol.ensureHelperArrays(Molecule.cHelperCIP);
    retainUnknownStereo(mol, unspecified.atoms, unspecified.bonds);
  }
  return mol;
}


export function generateFromSmiles(smiles: string, seed = 1): MolecularStructure {
  if (!smiles.trim() || smiles.length > 16_384) throw new Error('Provide a valid SMILES string.');
  const mol = Molecule.fromSmiles(smiles);
  checkSize(mol.getAllAtoms());
  checkHydrogenExpansion(mol);
  if (!new ConformerGenerator(seed).getOneConformerAsMolecule(mol)) throw new Error('Could not generate a 3D conformer for this SMILES.');
  return snapshot(mol, smiles);
}

export function parseMolecule(source: string, format: 'xyz' | 'sdf' | 'mol' | 'smiles'): MolecularStructure {
  if (source.length > 2_000_000) throw new Error('Molecule input exceeds 2 MB.');
  return format === 'smiles' ? generateFromSmiles(source) : parseGraph(source, format);
}

export function getProperties(structure: MolecularStructure) {
  const mol = toOcl(structure), formula = mol.getMolecularFormula(), p = new MoleculeProperties(mol);
  return { formula: formula.formula, molecularWeight: formula.relativeWeight, exactMass: formula.absoluteWeight,
    atomCount: mol.getAllAtoms(), bondCount: mol.getAllBonds(), charge: Array.from({ length: mol.getAllAtoms() }, (_, i) => mol.getAtomCharge(i)).reduce((a, b) => a + b, 0),
    hydrogenBondDonors: p.donorCount, hydrogenBondAcceptors: p.acceptorCount, rotatableBonds: p.rotatableBondCount, polarSurfaceArea: p.polarSurfaceArea, logP: p.logP };
}
export function getEnergy(structure: MolecularStructure, forceField: MolecularForceField = 'MMFF94'): number { return createForceField(toOcl(structure), forceField).getTotalEnergy(); }
/** A numerical job retains one parsed graph (and, for UFF, one RDKit kernel with its
 * initial nonbonded term list). Energies may be non-finite at undefined geometries;
 * callers reject such points. The caller owns disposal, including cancellation. */
export function createEnergyEvaluator(structure: MolecularStructure, forceField: MolecularForceField = 'MMFF94'): EnergyEvaluator {
  return energyEvaluatorForGraph(structure, forceField, toOcl(structure));
}

function energyEvaluatorForGraph(structure: MolecularStructure, forceField: MolecularForceField, mol: Molecule): EnergyEvaluator {
  createForceField(mol, forceField);
  const place = (atoms: MolecularAtom[], set: (index: number, atom: MolecularAtom) => void) => {
    if (atoms.length !== structure.atoms.length || atoms.some((atom, i) => atom.element !== structure.atoms[i].element)) throw new Error('Energy coordinates must preserve molecular atom identities.');
    atoms.forEach((atom, i) => set(structure.atomMap?.[i] ?? i, atom));
  };
  if (forceField !== 'UFF') {
    return {
      energy(atoms) {
        place(atoms, (index, atom) => { mol.setAtomX(index, atom.x); mol.setAtomY(index, atom.y); mol.setAtomZ(index, atom.z); });
        return new ForceFieldMMFF94(mol, forceField).getTotalEnergy();
      },
      dispose() {},
    };
  }
  const field = createUffWasmEvaluator(serializePhysicalMolfile(mol));
  const evaluate = (atoms: MolecularAtom[]) => {
    const positions = new Float64Array(3 * atoms.length);
    place(atoms, (index, atom) => { positions[3 * index] = atom.x; positions[3 * index + 1] = atom.y; positions[3 * index + 2] = atom.z; });
    return field.evaluate(positions);
  };
  return {
    energy: atoms => evaluate(atoms).energyKcalMol,
    gradient(atoms) {
      const { gradient } = evaluate(atoms);
      return atoms.map((_, i) => { const index = structure.atomMap?.[i] ?? i; return [gradient[3 * index], gradient[3 * index + 1], gradient[3 * index + 2]]; });
    },
    dispose: () => field.dispose(),
  };
}

/** Largest |E(analytic surface) − E(OpenChemLib)| at the start geometry, kcal/mol, for
 * which MMFF optimizations run on the analytic surface. Measured agreement on the RDKit
 * reference set is 3.6e-5 (f32 parameters); a larger gap means the two toolkits typed
 * the molecule differently. */
const MMFF_SURFACE_AGREEMENT = 1e-3;

/** UFF and MMFF optimizations use analytic gradients. MMFF evaluates the term list that
 * the pinned RDKit module extracts (requires `prepareUffWasm()`). That list omits
 * interactions between separate fragments, which OpenChemLib includes. Use central
 * differences for such graphs and when analytic extraction or the energy check fails. */
export function createOptimizationEvaluator(structure: MolecularStructure, forceField: MolecularForceField = 'MMFF94'): EnergyEvaluator {
  const mol = toOcl(structure);
  const reference = energyEvaluatorForGraph(structure, forceField, mol);
  const n = structure.atoms.length;
  if (forceField === 'UFF' || mol.getFragmentAtoms(0, false).length !== n) return reference;
  // The canonical molfile is already in atomMap order. Extract terms from it
  // directly so another OCL serialization cannot permute the atom indices.
  let terms: ReturnType<typeof decodeMmffTerms>;
  try { terms = decodeMmffTerms(extractMmffParametersWasm(structure.molfile, forceField)); } catch { return reference; }
  const positions = new Float64Array(3 * n), gradient = new Float64Array(3 * n);
  let energy = Number.NaN, current = false;
  // Energy and gradient come from one evaluation; repeat requests at the same point reuse it.
  const evaluate = (atoms: MolecularAtom[]) => {
    if (atoms.length !== n || atoms.some((atom, i) => atom.element !== structure.atoms[i].element)) throw new Error('Energy coordinates must preserve molecular atom identities.');
    let same = current;
    atoms.forEach((atom, i) => {
      const index = 3 * (structure.atomMap?.[i] ?? i);
      if (positions[index] !== atom.x || positions[index + 1] !== atom.y || positions[index + 2] !== atom.z) same = false;
      positions[index] = atom.x; positions[index + 1] = atom.y; positions[index + 2] = atom.z;
    });
    if (!same) { energy = mmffEnergy(terms, positions, gradient); current = true; }
    return energy;
  };
  if (terms.atomCount !== n || !(Math.abs(evaluate(structure.atoms) - reference.energy(structure.atoms)) <= MMFF_SURFACE_AGREEMENT)) return reference;
  return {
    energy: evaluate,
    gradient(atoms) {
      evaluate(atoms);
      return atoms.map((_, i) => { const index = 3 * (structure.atomMap?.[i] ?? i); return [gradient[index], gradient[index + 1], gradient[index + 2]]; });
    },
    dispose() { reference.dispose(); },
  };
}

export async function getPartialCharges(structure: MolecularStructure): Promise<{ model: 'Gasteiger'; unit: 'e'; charges: number[]; iterations: 12 }> {
  const mol = toOcl(structure);
  if (Array.from({ length: mol.getAllAtoms() }, (_, i) => mol.getImplicitHydrogens(i)).some(Boolean)) throw new Error('Add explicit hydrogens before calculating Gasteiger charges.');
  await prepareUffWasm();
  const internal = calculateGasteigerWasm(serializePhysicalMolfile(mol));
  const formalCharge = Array.from({ length: mol.getAllAtoms() }, (_, i) => mol.getAtomCharge(i)).reduce((a, b) => a + b, 0);
  if (internal.length !== structure.atoms.length || internal.some(value => !Number.isFinite(value)) || Math.abs(internal.reduce((a, b) => a + b, 0) - formalCharge) > 1e-8) throw new Error('Partial charges do not match the molecular graph.');
  return { model: 'Gasteiger', unit: 'e', charges: structure.atoms.map((_, i) => internal[structure.atomMap?.[i] ?? i]), iterations: 12 };
}
export function removeHydrogens(structure: MolecularStructure): MolecularStructure {
  const mol = toOcl(structure);
  mol.deleteAtoms(Array.from({ length: mol.getAllAtoms() }, (_, i) => i).filter(i => mol.getAtomLabel(i) === 'H'));
  return snapshot(mol, structure.title);
}
export async function addHydrogens(structure: MolecularStructure): Promise<MolecularStructure> {
  const mol = toOcl(structure);
  checkHydrogenExpansion(mol);
  await appendHydrogens(mol);
  return snapshot(mol, structure.title, structure.graphSource, structure.graphComplete, expandedAtomMap(structure, mol.getAllAtoms()));
}

export type ProtonationResult = {
  /** All H explicit; `sourceAtomIndices[i]` is the input index of output atom i, or -1 for a new H. */
  structure: MolecularStructure & { sourceAtomIndices: number[] };
  pH: number;
  /** At most 64 changes, in output atom indices; `omittedChanges` counts the rest. */
  changes: ProtonationChange[]; omittedChanges: number;
};
/** Protonation states for `pH`, then every H explicit. Existing atoms keep their coordinates. */
export async function adjustHydrogensForPh(structure: MolecularStructure, pH: number): Promise<ProtonationResult> {
  if (!Number.isFinite(pH) || pH < 0 || pH > 14) throw new Error('Choose a pH from 0 to 14.');
  const mol = toOcl(structure), mapping = structure.atomMap ?? structure.atoms.map((_, i) => i);
  // Temporary map numbers follow atom identities through H deletion and appending.
  const original = mapping.map(i => mol.getAtomMapNo(i));
  mapping.forEach((j, i) => mol.setAtomMapNo(j, i + 1));
  const assigned = assignProtonationStates(mol, pH), tags = assigned.map(c => mol.getAtomMapNo(c.atom));
  checkHydrogenExpansion(mol);
  await appendHydrogens(mol);
  const all = Array.from({ length: mol.getAllAtoms() }, (_, i) => i), byTag = new Map(all.map(i => [mol.getAtomMapNo(i), i]));
  const sourceAtomIndices = [...structure.atoms.flatMap((_, i) => byTag.has(i + 1) ? [i] : []), ...all.filter(i => !mol.getAtomMapNo(i)).map(() => -1)];
  const order = [...sourceAtomIndices.filter(i => i >= 0).map(i => byTag.get(i + 1)!), ...all.filter(i => !mol.getAtomMapNo(i))];
  const changes = assigned.slice(0, 64).map((c, k) => ({ ...c, atom: sourceAtomIndices.indexOf(tags[k] - 1) }));
  all.forEach(i => mol.setAtomMapNo(i, mol.getAtomMapNo(i) ? original[mol.getAtomMapNo(i) - 1] : 0));
  const next = snapshot(mol, structure.title, structure.graphSource, structure.graphComplete, order);
  return { structure: { ...next, sourceAtomIndices }, pH, changes, omittedChanges: assigned.length - changes.length };
}

/** Optimizes with exactly the requested field and method and records every step. */
export function optimize(structure: MolecularStructure, options: OptimizeOptions = {}): OptimizationResult {
  const forceField = options.forceField ?? 'MMFF94', constraints = options.constraints ?? [];
  const method = options.method ?? defaultOptimizationMethod(forceField, constraints.length > 0);
  const maxIterations = options.maxIterations ?? 250;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > OPTIMIZATION_LIMITS.iterations) throw new Error('Use 1–1000 optimization iterations.');
  const unavailable = optimizationUnavailable(structure.atoms.length, constraints.length);
  if (unavailable) throw new Error(unavailable);
  const evaluator = createOptimizationEvaluator(structure, forceField);
  try {
    const { atoms, ...result } = optimizeCartesian(structure, evaluator, method, forceField, { constraints, maxIterations });
    return { ...result, molecule: snapshot(toOcl({ ...structure, atoms }), structure.title, structure.graphSource, structure.graphComplete, structure.atomMap) };
  } finally { evaluator.dispose(); }
}

// RMS difference of sorted heavy-atom distances, Å, below which two relaxed conformers are the same minimum.
const DUPLICATE_RMS = 0.05;
const EMBEDDING_ATTEMPTS = 8;
export type ConformerCandidate = { molecule: MolecularStructure; energy: number; relativeEnergy: number; unit: 'kcal/mol'; converged: boolean };
export type ConformerSearch = { conformers: ConformerCandidate[]; generated: number; duplicates: number; forceField: MolecularForceField; seed: number };

/** Sorted heavy-atom distances: invariant to rigid motion, reflection and atom permutation,
 * so topologically equivalent minima (for example tg and gt pentane) compare equal. */
function heavyDistances(mol: Molecule) {
  const heavy = Array.from({ length: mol.getAllAtoms() }, (_, i) => i).filter(i => mol.getAtomicNo(i) !== 1);
  return heavy.flatMap((a, i) => heavy.slice(i + 1).map(b => Math.hypot(mol.getAtomX(a) - mol.getAtomX(b), mol.getAtomY(a) - mol.getAtomY(b), mol.getAtomZ(a) - mol.getAtomZ(b)))).sort((a, b) => a - b);
}

/** OpenChemLib torsion sampling; every sample is relaxed to a minimum of the selected
 * field (MMFF: toolkit BFGS, UFF: L-BFGS) and duplicate minima are dropped. */
export function searchConformers(structure: MolecularStructure, options: { count?: number; seed?: number; forceField?: MolecularForceField } = {}): ConformerSearch {
  const count = options.count ?? 8, seed = options.seed ?? 1, forceField = options.forceField ?? 'MMFF94';
  if (!Number.isInteger(count) || count < 1 || count > CONFORMER_LIMITS.count) throw new Error(`Request 1–${CONFORMER_LIMITS.count} conformers.`);
  if (!Number.isInteger(seed) || seed < 0 || seed > CONFORMER_LIMITS.seeds) throw new Error('The conformer seed must be an integer from 0 to 2147483647.');
  const mol = toOcl(structure), generator = new ConformerGenerator(seed);
  const unknownAtoms = Array.from({ length: mol.getAllAtoms() }, (_, i) => i).filter(i => mol.isAtomConfigurationUnknown(i));
  const unknownBonds = Array.from({ length: mol.getAllBonds() }, (_, b) => b).filter(b => mol.getBondParity(b) === Molecule.cBondParityUnknown);
  checkHydrogenExpansion(mol);
  const expanded = mol.getAllAtoms() + Array.from({ length: mol.getAllAtoms() }, (_, i) => mol.getImplicitHydrogens(i)).reduce((a, b) => a + b, 0);
  if (forceField === 'UFF' && expanded > OPTIMIZATION_LIMITS.numericalAtoms) throw new Error(`UFF conformers support up to ${OPTIMIZATION_LIMITS.numericalAtoms} atoms including added hydrogens; this structure has ${expanded}.`);
  if (!generator.initializeConformers(mol, { maxTorsionSets: 256 })) throw new Error('Could not initialize conformer generation.');
  const kept: (ConformerCandidate & { distances: number[] })[] = [];
  let generated = 0, duplicates = 0;
  for (let i = 0; i < count; i++) {
    const conformer = generator.getNextConformerAsMolecule();
    if (!conformer) break;
    generated++;
    checkSize(conformer.getAllAtoms());
    const status = createForceField(conformer, forceField).minimise({ maxIts: forceField === 'UFF' ? OPTIMIZATION_LIMITS.iterations : 4000 });
    const energy = createForceField(conformer, forceField).getTotalEnergy();
    if (!Number.isFinite(energy)) continue;
    const distances = heavyDistances(conformer);
    if (kept.some(other => Math.abs(other.energy - energy) < 0.01 && Math.sqrt(distances.reduce((sum, d, k) => sum + (d - other.distances[k]) ** 2, 0) / Math.max(1, distances.length)) < DUPLICATE_RMS)) { duplicates++; continue; }
    if (unknownAtoms.length || unknownBonds.length) {
      // Keep the sampled pose and actual known parity, but retain unknown source constraints.
      conformer.ensureHelperArrays(Molecule.cHelperCIP);
      retainUnknownStereo(conformer, unknownAtoms, unknownBonds);
    }
    kept.push({ molecule: snapshot(conformer, structure.title, structure.graphSource, structure.graphComplete, expandedAtomMap(structure, conformer.getAllAtoms())), energy, relativeEnergy: 0, unit: 'kcal/mol', converged: status === 0, distances });
  }
  if (!kept.length) throw new Error('No conformers could be generated.');
  kept.sort((a, b) => a.energy - b.energy);
  return { conformers: kept.map(({ distances: _, ...item }) => ({ ...item, relativeEnergy: item.energy - kept[0].energy })), generated, duplicates, forceField, seed };
}

/**
 * Automatic 3D preparation of a flat (2D or all-z-zero) chemical graph: add the
 * implicit hydrogens, embed one OpenChemLib conformer with the source's known
 * stereochemistry, then optimize it. OpenChemLib's embedding occasionally inverts a
 * double bond, so each embedding is checked against the input's canonical stereo
 * graph and up to EMBEDDING_ATTEMPTS consecutive seeds are tried. Inputs that already
 * have depth are refused: they are optimized, not re-embedded.
 */
export function prepare3d(structure: MolecularStructure, options: { forceField?: MolecularForceField; method?: OptimizeOptions['method']; seed?: number; maxIterations?: number } = {}): OptimizationResult & { preparation: { addedHydrogens: number; seed: number; attempts: number } } {
  const forceField = options.forceField ?? 'MMFF94', requestedSeed = options.seed ?? 1;
  if (!Number.isInteger(requestedSeed) || requestedSeed < 0 || requestedSeed > CONFORMER_LIMITS.seeds - EMBEDDING_ATTEMPTS) throw new Error('The embedding seed must be an integer from 0 to 2147483639.');
  if (!flatDepiction(structure)) throw new Error('This structure already has 3D coordinates; optimize it instead.');
  const source = toOcl(structure);
  checkHydrogenExpansion(source);
  const addedHydrogens = Array.from({ length: source.getAllAtoms() }, (_, i) => source.getImplicitHydrogens(i)).reduce((a, b) => a + b, 0);
  const method = options.method ?? defaultOptimizationMethod(forceField, false);
  const unavailable = optimizationUnavailable(source.getAllAtoms() + addedHydrogens, 0);
  if (unavailable) throw new Error(unavailable);
  const unknownAtoms = Array.from({ length: source.getAllAtoms() }, (_, i) => i).filter(i => source.isAtomConfigurationUnknown(i));
  const unknownBonds = Array.from({ length: source.getAllBonds() }, (_, b) => b).filter(b => source.getBondParity(b) === Molecule.cBondParityUnknown);
  const identity = source.getIDCode();
  let embedded: Molecule | null = null, seed = requestedSeed, attempts = 0;
  for (; attempts < EMBEDDING_ATTEMPTS && !embedded; attempts++) {
    seed = requestedSeed + attempts;
    const candidate = new ConformerGenerator(seed).getOneConformerAsMolecule(toOcl(structure));
    if (!candidate) continue;
    candidate.ensureHelperArrays(Molecule.cHelperCIP);
    if (unknownAtoms.length || unknownBonds.length) retainUnknownStereo(candidate, unknownAtoms, unknownBonds);
    if (candidate.getIDCode() === identity) embedded = candidate;
  }
  if (!embedded) throw new Error(`No embedding from seeds ${requestedSeed}–${requestedSeed + EMBEDDING_ATTEMPTS - 1} kept the source stereochemistry; nothing was changed.`);
  const start = snapshot(embedded, structure.title, structure.graphSource, structure.graphComplete, expandedAtomMap(structure, embedded.getAllAtoms()));
  return { ...optimize(start, { forceField, method, maxIterations: options.maxIterations }), preparation: { addedHydrogens, seed, attempts } };
}
