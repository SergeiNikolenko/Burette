import type { ZmatrixDocument } from '../../../../../scripts/zmatrix-document.mjs';
import type { MolecularStructure } from '../molecular-workbench/molecular-graph';
import { createAsyncMinimizer, type MinimizerResult } from '../molecular-workbench/minimizer';
import type { AsyncEnergyEvaluator, OptimizationFrame, OptimizationProgress } from '../molecular-workbench/optimization';
import type { EnergyModelId, MolecularAtom, Vec3 } from '../molecular-workbench/types';
import { coupledZmatrixProblem, coupledZmatrixResult, type CoupledZmatrixOptimizationResult, type CoupledZmatrixProblem, type ZmatrixOptimizeOptions } from './zmatrix-coupled-problem';

// The step (Å, radians) of the differenced position Jacobian, as the worker's energy difference.
const H = 1e-5;
const samePositions = (a: MolecularAtom[], b: MolecularAtom[]) => a.every((atom, i) => atom.x === b[i].x && atom.y === b[i].y && atom.z === b[i].z);

/** dE/dx_i = Σ_atoms g · ∂position/∂x_i, with the Jacobian from central differences of
 * `unpack`: pure geometry, so the decoding, frozen-shape projection and placement are
 * exactly those of the energy. Frozen atoms never move, so they contribute nothing. */
function chainRuleGradient(unpack: CoupledZmatrixProblem['unpack'], x: number[], gradient: readonly Vec3[]): number[] {
  return x.map((value, i) => {
    const sample = x.slice();
    sample[i] = value + H; const plus = unpack(sample).atoms;
    sample[i] = value - H; const minus = unpack(sample).atoms;
    let sum = 0;
    plus.forEach((atom, a) => {
      const [gx, gy, gz] = gradient[a], back = minus[a];
      sum += gx * (atom.x - back.x) + gy * (atom.y - back.y) + gz * (atom.z - back.z);
    });
    return sum / (2 * H);
  });
}

/**
 * `optimizeZmatrix` over an asynchronous model, such as an external program: the same
 * variables, frozen rows, locks, minimizer steps, frames and refusal. Each point costs
 * one model evaluation; its Cartesian gradient reaches the variables by the chain rule.
 * Aborting `signal` stops before the next evaluation; the caller disposes the evaluator.
 */
export async function optimizeZmatrixAsync(molecule: MolecularStructure, definition: ZmatrixDocument, evaluator: AsyncEnergyEvaluator, model: EnergyModelId,
  options: Omit<ZmatrixOptimizeOptions, 'forceField'> = {}, onProgress?: (progress: OptimizationProgress) => void, signal?: AbortSignal): Promise<CoupledZmatrixOptimizationResult> {
  const problem = coupledZmatrixProblem(molecule, definition, options), { unpack } = problem;
  const evaluate = async (atoms: MolecularAtom[]) => {
    signal?.throwIfAborted();
    // An abort may fail the evaluation in flight; report it as the abort.
    const value = await evaluator.evaluate(atoms).catch(error => { signal?.throwIfAborted(); throw error; });
    signal?.throwIfAborted();
    return value;
  };
  const atoms = molecule.atoms.map(atom => ({ ...atom })), start = await evaluate(atoms);
  const frames: OptimizationFrame[] = [{ atoms, energy: start.energy }];
  let output = unpack(problem.initial), energy = start.energy, run: MinimizerResult | null = null;
  // The start is evaluated once when the definition places exactly the input atoms.
  let reuse: typeof start | undefined = samePositions(output.atoms, molecule.atoms) ? start : undefined;
  if (!problem.runs && !reuse) energy = (await evaluate(output.atoms)).energy;
  if (problem.runs) {
    const minimizer = await createAsyncMinimizer(problem.initial, async x => {
      const point = unpack(x).atoms, value = reuse ?? await evaluate(point);
      reuse = undefined;
      return { energy: value.energy, gradient: Number.isFinite(value.energy) ? chainRuleGradient(unpack, x, value.gradient) : x.map(() => Number.NaN) };
    }, problem.method, { gradientTolerance: options.gradientTolerance, energyTolerance: options.energyTolerance });
    await minimizer.run(problem.iterations, (x, stepEnergy) => {
      const stepAtoms = unpack(x).atoms;
      frames.push({ atoms: stepAtoms, energy: stepEnergy });
      onProgress?.({ iteration: frames.length - 1, energy: stepEnergy, atoms: stepAtoms });
    });
    run = minimizer.result();
    output = unpack(run.x);
    energy = run.energy;
  }
  return coupledZmatrixResult(molecule, problem, run, frames, output, energy, { forceField: model, gradient: 'chain-rule' });
}
