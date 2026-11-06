import type { ZmatrixDocument } from '../../../../../scripts/zmatrix-document.mjs';
import { createOptimizationEvaluator, type MolecularStructure, type OptimizationProgress, type OptimizationResult } from '../molecular-workbench/chemistry';
import { minimize } from '../molecular-workbench/minimizer';
import { coupledZmatrixProblem, coupledZmatrixResult, type CoupledZmatrixOptimizationResult, type ZmatrixOptimizeOptions } from './zmatrix-coupled-problem';

/**
 * Optimize the actual force-field energy on the geometry defined by the rows, over
 * the variables of `coupledZmatrixProblem`. The gradient is a central difference of
 * the energy per variable (Å, radians), two evaluations each.
 */
export function optimizeZmatrix(molecule: MolecularStructure, definition: ZmatrixDocument, options: ZmatrixOptimizeOptions = {}, onProgress?: (progress: OptimizationProgress) => void): CoupledZmatrixOptimizationResult {
  const problem = coupledZmatrixProblem(molecule, definition, options), { initial, unpack } = problem;
  const evaluator = createOptimizationEvaluator(molecule, options.forceField);
  try {
    const evaluate = (x: number[]) => evaluator.energy(unpack(x).atoms);
    const objective = (x: number[]) => ({ energy: evaluate(x), gradient: x.map((value, i) => {
      const sample = x.slice(), h = 1e-5;
      sample[i] = value + h; const plus = evaluate(sample);
      sample[i] = value - h; const minus = evaluate(sample);
      return (plus - minus) / (2 * h);
    }) });
    const frames: NonNullable<OptimizationResult['frames']> = [{ atoms: molecule.atoms.map(atom => ({ ...atom })), energy: evaluator.energy(molecule.atoms) }];
    const result = problem.runs ? minimize(initial, objective, problem.method, problem.iterations, x => {
      const atoms = unpack(x).atoms, energy = evaluator.energy(atoms);
      frames.push({ atoms, energy });
      onProgress?.({ iteration: frames.length - 1, energy, atoms });
    }, { gradientTolerance: options.gradientTolerance, energyTolerance: options.energyTolerance }) : null;
    const output = unpack(result?.x ?? initial);
    return coupledZmatrixResult(molecule, problem, result, frames, output, evaluator.energy(output.atoms), { forceField: options.forceField ?? 'MMFF94', gradient: 'central-difference' });
  } finally { evaluator.dispose(); }
}
