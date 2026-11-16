import type { ZmatrixDocument } from '../../../../../scripts/zmatrix-document.mjs';
import { molfileWithPositions } from '../workbench/graph-positions';
import { optimizeZmatrixAsync } from '../workbench/zmatrix-chain-rule-optimization';
import type { CoupledZmatrixOptimizationResult, ZmatrixOptimizeOptions } from '../workbench/zmatrix-coupled-problem';
import { runChemistryTask } from './compute-client';
import { isExternalEnergyModelId, resolveEnergyModel, type EnergyModelChoice } from './energy-models';
import { externalEnergyModel, openExternalEnergyEvaluator } from './external-energy-models';
import type { MolecularStructure } from './molecular-graph';
import { optimizeCartesianAsync, type AsyncEnergyEvaluator, type OptimizeOptions, type OptimizationProgress, type OptimizationResult } from './optimization';
import type { MinimizerOptions } from './minimizer';
import type { EnergyModelId, ExternalEnergyModelId, Vec3 } from './types';

export type ModelOptimizeOptions = Omit<OptimizeOptions, 'forceField'> & MinimizerOptions;
export type ModelOptimizeTask = { signal?: AbortSignal; onProgress?: (progress: OptimizationProgress) => void; timeoutMs?: number };

function openExternal(id: ExternalEnergyModelId, structure: MolecularStructure) {
  const model = externalEnergyModel(id);
  if (!model) throw new Error('This energy model is no longer available.');
  return openExternalEnergyEvaluator(model, structure);
}

/** Runs `run` over a native session for `structure`; aborting closes the session, which
 * stops the evaluation in flight, and the session is closed once `run` settles. */
async function withExternalSession<T>(id: ExternalEnergyModelId, structure: MolecularStructure, signal: AbortSignal | undefined, run: (evaluator: AsyncEnergyEvaluator) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const evaluator = await openExternal(id, structure);
  const close = () => { void evaluator.dispose(); };
  signal?.addEventListener('abort', close, { once: true });
  try { return await run(evaluator); } finally {
    signal?.removeEventListener('abort', close);
    await evaluator.dispose();
  }
}

/** Avogadro's Calculate Energy with the chosen model: kcal/mol, and the model that ran. */
export async function energyWithModel(structure: MolecularStructure, choice: EnergyModelChoice): Promise<{ model: EnergyModelId; energy: number }> {
  const model = resolveEnergyModel(choice, structure);
  if (!isExternalEnergyModelId(model)) return { model, energy: await runChemistryTask({ action: 'energy', molecule: structure, forceField: model }) };
  return withExternalSession(model, structure, undefined, async evaluator => {
    const { energy } = await evaluator.evaluate(structure.atoms);
    if (!Number.isFinite(energy)) throw new Error('The energy model returned no finite energy.');
    return { model, energy };
  });
}

/**
 * Optimizes `structure` with the chosen model; Automatic resolves to a built-in one.
 * Built-in models run in a one-shot worker. External models (desktop only) run the
 * same minimizer on this thread over a native session, one evaluation at a time:
 * each evaluation is bounded natively, so `timeoutMs` applies to worker runs only,
 * and aborting closes the session, which stops the evaluation in flight.
 */
export async function optimizeWithEnergyModel(structure: MolecularStructure, choice: EnergyModelChoice, options: ModelOptimizeOptions = {}, task: ModelOptimizeTask = {}): Promise<OptimizationResult> {
  const model = resolveEnergyModel(choice, structure);
  if (!isExternalEnergyModelId(model)) {
    return runChemistryTask({ action: 'optimize', molecule: structure, options: { ...options, forceField: model } }, { signal: task.signal, timeoutMs: task.timeoutMs ?? 300_000, onProgress: task.onProgress });
  }
  return withExternalSession(model, structure, task.signal, async evaluator => {
    const { atoms, ...result } = await optimizeCartesianAsync(structure, evaluator, options.method ?? 'lbfgs', model, options, task.onProgress, task.signal);
    const map = structure.atomMap ?? atoms.map((_, i) => i), positions: Vec3[] = [];
    atoms.forEach((atom, i) => { positions[map[i]] = [atom.x, atom.y, atom.z]; });
    return { ...result, molecule: { ...structure, atoms, molfile: structure.molfile && molfileWithPositions(structure.molfile, positions) } };
  });
}

/** Coupled Z-matrix optimization with the chosen model, dispatched as
 * `optimizeWithEnergyModel`: built-in models difference the energy per variable in the
 * worker; external ones evaluate once per point on this thread (chain-rule gradient). */
export async function optimizeZmatrixWithEnergyModel(structure: MolecularStructure, definition: ZmatrixDocument, choice: EnergyModelChoice,
  options: Omit<ZmatrixOptimizeOptions, 'forceField'> = {}, task: ModelOptimizeTask = {}): Promise<CoupledZmatrixOptimizationResult> {
  const model = resolveEnergyModel(choice, structure);
  if (!isExternalEnergyModelId(model)) {
    return runChemistryTask({ action: 'optimize-zmatrix', molecule: structure, definition, options: { ...options, forceField: model } }, { signal: task.signal, timeoutMs: task.timeoutMs ?? 300_000, onProgress: task.onProgress });
  }
  return withExternalSession(model, structure, task.signal, evaluator => optimizeZmatrixAsync(structure, definition, evaluator, model, options, task.onProgress, task.signal));
}
