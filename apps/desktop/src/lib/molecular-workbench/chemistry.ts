import { ConformerGenerator, Molecule, MoleculeProperties, Resources } from 'openchemlib';
import resources from '../../../../../node_modules/openchemlib/dist/resources.json';
import type { MolecularAtom } from './types';
import { appendHydrogens } from './hydrogen-geometry';
import { serializePhysicalMolfile } from './molecule-serialization';
import { readUnspecifiedMolfileStereo, retainUnknownStereo } from './molecule-stereochemistry';
import { optimizeCartesian, defaultOptimizationMethod, optimizationUnavailable, OPTIMIZATION_LIMITS, type EnergyEvaluator, type OptimizeOptions, type OptimizationResult } from './optimization';
import { createForceField, type MolecularForceField } from './forcefield';
import { ForceFieldMMFF94 } from 'openchemlib';
import { calculateGasteigerWasm, createUffWasmEvaluator, prepareUffWasm } from './uff-wasm';
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
  const mol = toOcl(structure);
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

/**
 * Optimizes with exactly the requested field and method; an unavailable combination
 * fails instead of running another. `bfgs` runs OpenChemLib's MMFF minimizer, which
 * publishes coordinates only on convergence and exposes no intermediate steps.
 */
export function optimize(structure: MolecularStructure, options: OptimizeOptions = {}): OptimizationResult {
  const forceField = options.forceField ?? 'MMFF94', constraints = options.constraints ?? [];
  const method = options.method ?? defaultOptimizationMethod(forceField, constraints.length > 0);
  const maxIterations = options.maxIterations ?? 250;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > OPTIMIZATION_LIMITS.iterations) throw new Error('Use 1–1000 optimization iterations.');
  const unavailable = optimizationUnavailable(structure.atoms.length, forceField, method, constraints.length);
  if (unavailable) throw new Error(unavailable);
  if (method !== 'bfgs') {
    const evaluator = createEnergyEvaluator(structure, forceField);
    try {
      const { atoms, ...result } = optimizeCartesian(structure, evaluator, method, forceField, { constraints, maxIterations });
      return { ...result, molecule: snapshot(toOcl({ ...structure, atoms }), structure.title, structure.graphSource, structure.graphComplete, structure.atomMap) };
    } finally { evaluator.dispose(); }
  }
  const mol = toOcl(structure), initialEnergy = createForceField(mol, forceField).getTotalEnergy();
  const status = createForceField(mol, forceField).minimise({ maxIts: maxIterations });
  // OCL publishes optimized coordinates to the molecule only on convergence. Its
  // internal last-iteration energy can otherwise describe a different geometry;
  // always evaluate the coordinates we are returning.
  const energy = createForceField(mol, forceField).getTotalEnergy();
  if (!Number.isFinite(energy) || energy > initialEnergy + 1e-6) throw new Error(`${forceField} optimization did not lower the energy.`);
  const molecule = snapshot(mol, structure.title, structure.graphSource, structure.graphComplete, structure.atomMap);
  return { molecule, initialEnergy, energy, unit: 'kcal/mol', forceField, method, iterations: null, converged: status === 0,
    stopReason: status === 0 ? 'converged' : 'iterations', gradient: 'toolkit', maxGradient: null, frameSampling: 'endpoints',
    frames: [{ atoms: structure.atoms.map(atom => ({ ...atom })), energy: initialEnergy }, { atoms: molecule.atoms, energy }], constraintResiduals: [], frozenAtoms: [] };
}

export function searchConformers(structure: MolecularStructure, options: { count?: number; seed?: number; forceField?: MolecularForceField } = {}) {
  const count = options.count ?? 8;
  if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error('Request 1–32 conformers.');
  const mol = toOcl(structure), generator = new ConformerGenerator(options.seed ?? 1);
  const unknownAtoms = Array.from({ length: mol.getAllAtoms() }, (_, i) => i).filter(i => mol.isAtomConfigurationUnknown(i));
  const unknownBonds = Array.from({ length: mol.getAllBonds() }, (_, b) => b).filter(b => mol.getBondParity(b) === Molecule.cBondParityUnknown);
  checkHydrogenExpansion(mol);
  if (!generator.initializeConformers(mol, { maxTorsionSets: 256 })) throw new Error('Could not initialize conformer generation.');
  const candidates: { molecule: MolecularStructure; energy: number; unit: 'kcal/mol' }[] = [];
  for (let i = 0; i < count; i++) {
    const conformer = generator.getNextConformerAsMolecule();
    if (!conformer) break;
    checkSize(conformer.getAllAtoms());
    const ff = createForceField(conformer, options.forceField); ff.minimise({ maxIts: 150 });
    const energy = createForceField(conformer, options.forceField).getTotalEnergy();
    if (unknownAtoms.length || unknownBonds.length) {
      // Keep the sampled pose and actual known parity, but retain unknown source constraints.
      conformer.ensureHelperArrays(Molecule.cHelperCIP);
      retainUnknownStereo(conformer, unknownAtoms, unknownBonds);
    }
    if (Number.isFinite(energy)) candidates.push({ molecule: snapshot(conformer, structure.title, structure.graphSource, structure.graphComplete, expandedAtomMap(structure, conformer.getAllAtoms())), energy, unit: 'kcal/mol' });
  }
  if (!candidates.length) throw new Error('No conformers could be generated.');
  return candidates.sort((a, b) => a.energy - b.energy);
}
