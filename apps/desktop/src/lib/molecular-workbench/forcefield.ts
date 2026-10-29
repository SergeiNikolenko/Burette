import { ForceFieldMMFF94, Molecule } from 'openchemlib';
import { serializePhysicalMolfile } from './molecule-serialization';
import { minimize } from './minimizer';
import { createUffWasmEvaluator } from './uff-wasm';

import type { MolecularForceField } from './types';
export type { MolecularForceField } from './types';

/** Use the toolkit's actual parameter set; never substitute a different field. */
export function createForceField(molecule: Molecule, model: MolecularForceField = 'MMFF94') {
  if (model !== 'MMFF94' && model !== 'MMFF94s' && model !== 'UFF') throw new Error('Unsupported molecular force field.');
  molecule.ensureHelperArrays(Molecule.cHelperNeighbours);
  if (Array.from({ length: molecule.getAllAtoms() }, (_, i) => molecule.getImplicitHydrogens(i)).some(Boolean)) {
    throw new Error(`Add explicit hydrogens before ${model} calculations.`);
  }
  if (model === 'UFF') return uffField(molecule);
  const field = new ForceFieldMMFF94(molecule, model);
  if (!Number.isFinite(field.getTotalEnergy())) throw new Error(`${model} cannot evaluate this structure.`);
  return field;
}

/** Native contexts live for one evaluation or minimization, including failures. */
function uffField(molecule: Molecule) {
  const coordinates = () => Array.from({ length: molecule.getAllAtoms() }, (_, i) => [molecule.getAtomX(i), molecule.getAtomY(i), molecule.getAtomZ(i)]).flat();
  const evaluator = () => {
    const field = createUffWasmEvaluator(serializePhysicalMolfile(molecule));
    if (field.atomCount !== molecule.getAllAtoms()) { field.dispose(); throw new Error('UFF changed molecular atom identities.'); }
    return field;
  };
  return {
    getTotalEnergy() {
      const field = evaluator();
      try { return field.evaluate(new Float64Array(coordinates())).energyKcalMol; }
      finally { field.dispose(); }
    },
    minimise(options: { maxIts?: number } = {}) {
      if (molecule.getAllAtoms() > 64) throw new Error("UFF browser optimization supports up to 64 atoms.");
      const field = evaluator();
      try {
        const result = minimize(coordinates(), x => {
          const value = field.evaluate(new Float64Array(x));
          return { energy: value.energyKcalMol, gradient: Array.from(value.gradient) };
        }, 'lbfgs', options.maxIts ?? 250);
        for (let i = 0; i < molecule.getAllAtoms(); i++) {
          molecule.setAtomX(i, result.x[3 * i]); molecule.setAtomY(i, result.x[3 * i + 1]); molecule.setAtomZ(i, result.x[3 * i + 2]);
        }
        return result.converged ? 0 : 1;
      } finally { field.dispose(); }
    },
  };
}
