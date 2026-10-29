import { ConformerGenerator, Molecule, MoleculeProperties, Resources } from 'openchemlib';
import resources from '../../../../../node_modules/openchemlib/dist/resources.json';
import { measureGeometry } from '../../../../../scripts/molecular-geometry.js';
import type { MolecularAtom, Vec3 } from './types';
import { appendHydrogens } from './hydrogen-geometry';
import { serializePhysicalMolfile } from './molecule-serialization';
import { optimizeWithMethod } from './optimization';
import type { MinimizerMethod } from './minimizer';
import { createForceField, type MolecularForceField } from './forcefield';
import { calculateGasteigerWasm, createUffWasmEvaluator, prepareUffWasm } from './uff-wasm';
export type { MolecularForceField } from './forcefield';

Resources.register(resources);

export type { MolecularStructure } from './molecular-graph';
import { checkMoleculeSize as checkSize, snapshotMolecule as snapshot, parseMolecule as parseGraph, type MolecularStructure } from './molecular-graph';
export type GeometryConstraint = { kind: 'freeze' | 'distance' | 'angle' | 'dihedral'; atoms: number[]; target?: number };
export type OptimizeOptions = { method?: MinimizerMethod; forceField?: MolecularForceField; constraints?: GeometryConstraint[]; maxIterations?: number };
export type OptimizationResult = {
  molecule: MolecularStructure; initialEnergy: number; energy: number; unit: 'kcal/mol';
  forceField?: MolecularForceField; method?: MinimizerMethod; iterations?: number; frames?: {atoms: MolecularAtom[]; energy:number}[];
  converged: boolean; constraintResiduals: { kind: GeometryConstraint['kind']; error: number; unit: 'angstrom' | 'degrees' }[];
};

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
  const mol = Molecule.fromMolfile(structure.molfile);
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  if (mol.getAllAtoms() !== structure.atoms.length) throw new Error('Molecular graph and coordinates have different atom counts.');
  if (structure.atomMap && (structure.atomMap.length !== structure.atoms.length || new Set(structure.atomMap).size !== structure.atoms.length || structure.atomMap.some(i => !Number.isInteger(i) || i < 0 || i >= structure.atoms.length))) throw new Error('Invalid molecular atom mapping.');
  structure.atoms.forEach((a, i) => {
    const index = structure.atomMap?.[i] ?? i;
    if (a.element !== mol.getAtomLabel(index) || ![a.x, a.y, a.z].every(Number.isFinite)) throw new Error('Molecular graph and atom identities do not match.');
    mol.setAtomX(index, a.x); mol.setAtomY(index, a.y); mol.setAtomZ(index, a.z);
  });
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
/** A numerical job retains one UFF kernel and its initial nonbonded term list.
 * The caller owns disposal, including cancellation and objective failures. */
export function createEnergyEvaluator(structure: MolecularStructure, forceField: MolecularForceField = 'MMFF94'): { energy: (atoms: MolecularAtom[]) => number; gradient?: (atoms: MolecularAtom[]) => Vec3[]; dispose: () => void } {
  if (forceField !== 'UFF') return { energy: (atoms: MolecularAtom[]) => getEnergy({ ...structure, atoms }, forceField), dispose() {} };
  const mol = toOcl(structure);
  if (Array.from({ length: mol.getAllAtoms() }, (_, i) => mol.getImplicitHydrogens(i)).some(Boolean)) throw new Error('Add explicit hydrogens before UFF calculations.');
  const field = createUffWasmEvaluator(serializePhysicalMolfile(mol));
  const evaluate = (atoms: MolecularAtom[]) => {
    if (atoms.length !== structure.atoms.length || atoms.some((atom, i) => atom.element !== structure.atoms[i].element)) throw new Error('Energy coordinates must preserve molecular atom identities.');
    const positions = new Float64Array(3 * atoms.length);
    atoms.forEach((atom, i) => { const index = structure.atomMap?.[i] ?? i; positions[3 * index] = atom.x; positions[3 * index + 1] = atom.y; positions[3 * index + 2] = atom.z; });
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

function constraintValue(atoms: MolecularAtom[], constraint: GeometryConstraint) {
  if (constraint.kind === 'freeze') throw new Error('Frozen atoms use Cartesian coordinates.');
  return measureGeometry(constraint.kind, constraint.atoms.map(i => ({ id: String(i), position: [atoms[i].x, atoms[i].y, atoms[i].z] }))).value as number;
}
function error(value: number, target: number, kind: GeometryConstraint['kind']) {
  return kind === 'dihedral' ? ((value - target + 540) % 360) - 180 : value - target;
}

export function optimize(structure: MolecularStructure, options: OptimizeOptions = {}): OptimizationResult {
  if (options.method) {
    const result = optimizeWithMethod(structure, options);
    return { ...result, molecule: snapshot(toOcl(result.molecule), structure.title, structure.graphSource, structure.graphComplete, structure.atomMap) };
  }
  const mol = toOcl(structure), ff = createForceField(mol, options.forceField), initialEnergy = ff.getTotalEnergy();
  const maxIterations = options.maxIterations ?? 250;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 1000) throw new Error('Use 1–1000 optimization iterations.');
  const constraints = options.constraints ?? [];
  if (!constraints.length) {
    const status = ff.minimise({ maxIts: maxIterations });
    // OCL publishes optimized coordinates to the molecule only on convergence.
    // Its internal last-iteration energy can otherwise describe a different
    // geometry; always evaluate the coordinates we are returning.
    const energy = createForceField(mol, options.forceField).getTotalEnergy();
    if (!Number.isFinite(energy) || energy > initialEnergy + 1e-6) throw new Error(`${options.forceField ?? 'MMFF94'} optimization did not lower the energy.`);
    return { molecule: snapshot(mol, structure.title, structure.graphSource, structure.graphComplete, structure.atomMap), initialEnergy, energy, unit: 'kcal/mol', forceField: options.forceField ?? 'MMFF94', converged: status === 0, constraintResiduals: [] };
  }
  if (structure.atoms.length > 64 || constraints.length > 64) throw new Error('Constrained browser minimization supports up to 64 atoms and constraints.');
  const frozen = new Set<number>();
  const restraints = constraints.flatMap(c => {
    const count = { freeze: 1, distance: 2, angle: 3, dihedral: 4 }[c.kind];
    if (!count || c.atoms.length !== count || new Set(c.atoms).size !== count || c.atoms.some(i => !Number.isInteger(i) || i < 0 || i >= structure.atoms.length)) throw new Error('Constraint contains invalid atom indices.');
    if (c.kind === 'freeze') { frozen.add(c.atoms[0]); return []; }
    const target = c.target ?? constraintValue(structure.atoms, c);
    if (!Number.isFinite(target) || (c.kind === 'distance' && target <= 0) || (c.kind === 'angle' && (target <= 0 || target >= 180)) || (c.kind === 'dihedral' && Math.abs(target) > 180)) throw new Error('Constraint target is outside the valid range.');
    return [{ ...c, target }];
  });
  let current = structure.atoms.map(a => ({ ...a }));
  const evaluator = createEnergyEvaluator(structure, options.forceField);
  try {
    const penaltyEnergy = (atoms: MolecularAtom[]) => restraints.reduce((sum, c) => {
      const delta = error(constraintValue(atoms, c), c.target, c.kind) * (c.kind === 'distance' ? 1 : Math.PI / 180);
      return sum + 1000 * delta * delta;
    }, 0);
    function evaluate(atoms: MolecularAtom[]) {
      const physical = evaluator.energy(atoms), penalty = penaltyEnergy(atoms);
      if (!Number.isFinite(physical + penalty)) throw new Error('The constrained geometry has invalid energy.');
      return { objective: physical + penalty, physical };
    }
    // Central finite differences of the actual MMFF94 + harmonic restraint energy.
    // Frozen atoms are excluded from the optimization variables exactly. Geometric
    // restraints are soft; residuals and convergence are returned to the caller.
    let score = evaluate(current), stationary = false;
    const h = 1e-4, axes = ['x', 'y', 'z'] as const;
    for (let iteration = 0; iteration < Math.min(maxIterations, 100); iteration++) {
      const gradient = current.map(() => [0, 0, 0]), analytic = evaluator.gradient?.(current);
      for (let i = 0; i < current.length; i++) if (!frozen.has(i)) for (let a = 0; a < 3; a++) {
        const axis = axes[a], original = current[i][axis];
        current[i][axis] = original + h; const plus = analytic ? penaltyEnergy(current) : evaluate(current).objective;
        current[i][axis] = original - h; const minus = analytic ? penaltyEnergy(current) : evaluate(current).objective;
        current[i][axis] = original;
        gradient[i][a] = (analytic?.[i][a] ?? 0) + (plus - minus) / (2 * h);
      }
      const norm = Math.hypot(...gradient.flat());
      if (norm < 1e-3) { stationary = true; break; }
      let step = Math.min(.01, .1 / norm), accepted = false;
      for (let trial = 0; trial < 16; trial++, step /= 2) {
        const next = current.map((atom, i) => ({ ...atom, ...Object.fromEntries(axes.map((axis, a) => [axis, atom[axis] - step * gradient[i][a]])) }));
        const nextScore = evaluate(next);
        if (nextScore.objective < score.objective) { current = next; score = nextScore; accepted = true; break; }
      }
      if (!accepted) break;
    }
    const constraintResiduals = restraints.map(c => ({ kind: c.kind, error: error(constraintValue(current, c), c.target, c.kind), unit: (c.kind === 'distance' ? 'angstrom' : 'degrees') as 'angstrom' | 'degrees' }));
    const satisfied = constraintResiduals.every(c => Math.abs(c.error) <= (c.unit === 'angstrom' ? .01 : 1));
    const result = { ...structure, atoms: current };
    return { molecule: snapshot(toOcl(result), structure.title, structure.graphSource, structure.graphComplete, structure.atomMap), initialEnergy, energy: score.physical, unit: 'kcal/mol', forceField: options.forceField ?? 'MMFF94', converged: stationary && satisfied, constraintResiduals };
  } finally { evaluator.dispose(); }
}

export function searchConformers(structure: MolecularStructure, options: { count?: number; seed?: number; forceField?: MolecularForceField } = {}) {
  const count = options.count ?? 8;
  if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error('Request 1–32 conformers.');
  const mol = toOcl(structure), generator = new ConformerGenerator(options.seed ?? 1);
  checkHydrogenExpansion(mol);
  if (!generator.initializeConformers(mol, { maxTorsionSets: 256 })) throw new Error('Could not initialize conformer generation.');
  const candidates: { molecule: MolecularStructure; energy: number; unit: 'kcal/mol' }[] = [];
  for (let i = 0; i < count; i++) {
    const conformer = generator.getNextConformerAsMolecule();
    if (!conformer) break;
    checkSize(conformer.getAllAtoms());
    const ff = createForceField(conformer, options.forceField); ff.minimise({ maxIts: 150 });
    const energy = createForceField(conformer, options.forceField).getTotalEnergy();
    if (Number.isFinite(energy)) candidates.push({ molecule: snapshot(conformer, structure.title, structure.graphSource, structure.graphComplete, expandedAtomMap(structure, conformer.getAllAtoms())), energy, unit: 'kcal/mol' });
  }
  if (!candidates.length) throw new Error('No conformers could be generated.');
  return candidates.sort((a, b) => a.energy - b.energy);
}
