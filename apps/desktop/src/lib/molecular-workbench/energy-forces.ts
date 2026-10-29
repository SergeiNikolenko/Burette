import { createEnergyEvaluator, type MolecularStructure } from './chemistry';
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

export function evaluateFrameBatch(molecule: MolecularStructure, frames: MolecularAtom[][], forceField: MolecularForceField = 'MMFF94'): EnergyForces[] {
  if (!frames.length || frames.length > 64 || frames.length * molecule.atoms.length > 2048) throw new Error('Batch forces support at most 64 frames and 2048 atom-frames.');
  // Validate the entire batch before beginning work, without producing partial
  // values that could accidentally be interpreted as a complete trajectory.
  for (const atoms of frames) {
    if (atoms.length !== molecule.atoms.length || atoms.some((a, i) => a.element !== molecule.atoms[i].element || ![a.x, a.y, a.z].every(Number.isFinite))) throw new Error('Batch frames must retain atom identities and finite coordinates.');
  }
  return frames.map(atoms => evaluateEnergyForces({ ...molecule, atoms }, forceField));
}
