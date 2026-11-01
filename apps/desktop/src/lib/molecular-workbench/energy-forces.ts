import { Molecule } from 'openchemlib';
import { createEnergyEvaluator, type MolecularStructure } from './chemistry';
import { parseMolecule } from './molecular-graph';
import type { MolecularForceField } from './forcefield';
import type { MolecularAtom, Vec3 } from './types';

export type EnergyForces = {
  energy: number; energyUnit: 'kcal/mol'; forces: Vec3[]; forceUnit: 'kcal/(mol·Å)';
  method: 'central-difference' | 'analytic'; stepAngstrom?: number;
};
/** Force = -dE/dr, in the caller's atom order. OCL's public browser API exposes
 * energy but no analytic gradient; use an explicit, convergent central difference.
 * UFF exposes an analytic gradient, in the same external atom order. */
export function evaluateEnergyForces(molecule: MolecularStructure, forceField: MolecularForceField = 'MMFF94'): EnergyForces {
  if (!molecule.atoms.length || molecule.atoms.length > 64) throw new Error('Browser forces support 1–64 atoms.');
  const evaluator = createEnergyEvaluator(molecule, forceField);
  try {
    const stepAngstrom = 1e-4, energy = evaluator.energy(molecule.atoms);
    const analytic = evaluator.gradient?.(molecule.atoms);
    if (analytic) return { energy, energyUnit: 'kcal/mol', forces: analytic.map(v => v.map(value => -value) as Vec3), forceUnit: 'kcal/(mol·Å)', method: 'analytic' };
    const atoms = molecule.atoms.map(a => ({ ...a }));
    const axes = ['x', 'y', 'z'] as const;
    const forces = atoms.map((atom, i) => axes.map(axis => {
      const original = atom[axis];
      atom[axis] = original + stepAngstrom; const plus = evaluator.energy(atoms);
      atom[axis] = original - stepAngstrom; const minus = evaluator.energy(atoms);
      atom[axis] = original;
      const force = -(plus - minus) / (2 * stepAngstrom);
      if (!Number.isFinite(force)) throw new Error(`Non-finite force for atom ${i + 1}.`);
      return force;
    }) as Vec3);
    return { energy, energyUnit: 'kcal/mol', forces, forceUnit: 'kcal/(mol·Å)', method: 'central-difference', stepAngstrom };
  } finally { evaluator.dispose(); }
}

export const BATCH_LIMITS = Object.freeze({ frames: 64, atomFrames: 2048 });

export function evaluateFrameBatch(molecule: MolecularStructure, frames: MolecularAtom[][], forceField: MolecularForceField = 'MMFF94'): EnergyForces[] {
  if (!frames.length || frames.length > BATCH_LIMITS.frames || frames.length * molecule.atoms.length > BATCH_LIMITS.atomFrames) throw new Error('Batch forces support at most 64 frames and 2048 atom-frames.');
  // Validate the entire batch before beginning work, without producing partial
  // values that could accidentally be interpreted as a complete trajectory.
  for (const atoms of frames) {
    if (atoms.length !== molecule.atoms.length || atoms.some((a, i) => a.element !== molecule.atoms[i].element || ![a.x, a.y, a.z].every(Number.isFinite))) throw new Error('Batch frames must retain atom identities and finite coordinates.');
  }
  return frames.map(atoms => evaluateEnergyForces({ ...molecule, atoms }, forceField));
}

/** Canonical graph identity: elements in source order, the bond set and OpenChemLib's
 * stereo-aware canonical code (formal charges, isotopes and configuration). */
function graphIdentity(structure: MolecularStructure) {
  const bonds = structure.bonds.map(bond => `${Math.min(bond.a, bond.b)}-${Math.max(bond.a, bond.b)}:${bond.order}`).sort();
  return JSON.stringify([structure.atoms.map(atom => atom.element), bonds, Molecule.fromMolfile(structure.molfile).getIDCode()]);
}

/** Energies and forces of SDF records (conformers) that share the graph of `reference`
 * (the file's first record) in one atom order. The whole page is validated before any
 * evaluation; `firstIndex` numbers the records in errors. */
export function evaluateRecordBatch(reference: string, records: string[], firstIndex: number, forceField: MolecularForceField = 'MMFF94'): (EnergyForces & { atoms: MolecularAtom[] })[] {
  if (!records.length || records.length > BATCH_LIMITS.frames) throw new Error('Batch forces support at most 64 frames and 2048 atom-frames.');
  const identity = graphIdentity(parseMolecule(reference, 'sdf')), structures = records.map(record => parseMolecule(record, 'sdf'));
  if (structures[0].atoms.length * structures.length > BATCH_LIMITS.atomFrames) throw new Error('Batch forces support at most 64 frames and 2048 atom-frames.');
  const different = structures.findIndex(structure => graphIdentity(structure) !== identity);
  if (different >= 0) throw new Error(`SDF record ${firstIndex + different + 1} has a different graph or atom order than record 1; batch forces need one shared graph.`);
  return structures.map(structure => ({ ...evaluateEnergyForces(structure, forceField), atoms: structure.atoms }));
}
