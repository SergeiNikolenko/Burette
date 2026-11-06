import { molfileWithPositions } from '../workbench/graph-positions';
import { runChemistryTask } from './compute-client';
import { isExternalEnergyModelId, resolveEnergyModel, type EnergyModelChoice } from './energy-models';
import { externalEnergyModel, openExternalEnergyEvaluator } from './external-energy-models';
import type { MolecularStructure } from './molecular-graph';
import { optimizeCartesianAsync, type OptimizeOptions, type OptimizationProgress, type OptimizationResult } from './optimization';
import type { MinimizerOptions } from './minimizer';
import type { EnergyModelId, ExternalEnergyModelId, Vec3 } from './types';

export type ModelOptimizeOptions = Omit<OptimizeOptions, 'forceField'> & MinimizerOptions;
export type ModelOptimizeTask = { signal?: AbortSignal; onProgress?: (progress: OptimizationProgress) => void; timeoutMs?: number };

function openExternal(id: ExternalEnergyModelId, structure: MolecularStructure) {
  const model = externalEnergyModel(id);
  if (!model) throw new Error('This energy model is no longer available.');
  return openExternalEnergyEvaluator(model, structure);
}

/** Avogadro's Calculate Energy with the chosen model: kcal/mol, and the model that ran. */
export async function energyWithModel(structure: MolecularStructure, choice: EnergyModelChoice): Promise<{ model: EnergyModelId; energy: number }> {
  const model = resolveEnergyModel(choice, structure);
  if (!isExternalEnergyModelId(model)) return { model, energy: await runChemistryTask({ action: 'energy', molecule: structure, forceField: model }) };
  const evaluator = await openExternal(model, structure);
  try {
    const { energy } = await evaluator.evaluate(structure.atoms);
    if (!Number.isFinite(energy)) throw new Error('The energy model returned no finite energy.');
    return { model, energy };
  } finally { await evaluator.dispose(); }
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
  task.signal?.throwIfAborted();
  const evaluator = await openExternal(model, structure);
  const close = () => { void evaluator.dispose(); };
  task.signal?.addEventListener('abort', close, { once: true });
  try {
    const { atoms, ...result } = await optimizeCartesianAsync(structure, evaluator, options.method ?? 'lbfgs', model, options, task.onProgress, task.signal);
    const map = structure.atomMap ?? atoms.map((_, i) => i), positions: Vec3[] = [];
    atoms.forEach((atom, i) => { positions[map[i]] = [atom.x, atom.y, atom.z]; });
    return { ...result, molecule: { ...structure, atoms, molfile: structure.molfile && molfileWithPositions(structure.molfile, positions) } };
  } finally {
    task.signal?.removeEventListener('abort', close);
    await evaluator.dispose();
  }
}
