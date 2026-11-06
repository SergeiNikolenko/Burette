/** Agent energy, force and optimization jobs on external models (xTB, Avogadro energy
 * packages). They run over the desktop's native sessions on this thread, not in the
 * chemistry worker; the browser shell lists no external models and refuses them. */
import { runChemistryTask } from "../molecular-workbench/compute-client";
import { energyWithModel, optimizeWithEnergyModel, type ModelOptimizeOptions } from "../molecular-workbench/optimize-with-model";
import { openExternalEnergyEvaluator, refreshExternalEnergyModels, type ExternalEnergyModel } from "../molecular-workbench/external-energy-models";
import type { EnergyForces } from "../molecular-workbench/energy-forces";
import type { MolecularStructure } from "../molecular-workbench/molecular-graph";
import type { ExternalEnergyModelId, MolecularAtom, Vec3 } from "../molecular-workbench/types";
import { isTauriRuntime } from "../tauri";

/** The model as listed now (a package may have been set up since the last listing). */
async function availableModel(id: ExternalEnergyModelId): Promise<ExternalEnergyModel> {
  const listed = await refreshExternalEnergyModels(), model = listed.find(item => item.id === id);
  if (!model) throw new Error(listed.length || isTauriRuntime() ? `${id} is not available in this Burette.` : "External energy models run only in the Burette desktop app.");
  if (model.unavailable) throw new Error(model.unavailable);
  return model;
}

/** The job signal, also aborted with a TimeoutError at the job deadline. Native
 * evaluations are bounded one by one; this bounds the whole job. */
const deadline = (signal: AbortSignal, timeoutMs: number) => AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

/** One evaluation; it cannot be stopped once sent, and the native module bounds it. */
export async function externalEnergy(structure: MolecularStructure, id: ExternalEnergyModelId, signal: AbortSignal) {
  await availableModel(id);
  signal.throwIfAborted();
  return (await energyWithModel(structure, id)).energy;
}

/** The first record's structure and the atoms of records [offset, end), which must
 * repeat its elements in order so that one session evaluates them all. */
export async function externalRecordFrames(records: string[], offset: number, end: number, options: { signal: AbortSignal; timeoutMs: number }) {
  const parse = (record: string) => runChemistryTask({ action: "parse", source: record, format: "sdf" }, options);
  const reference = await parse(records[0]), frames: MolecularAtom[][] = [];
  for (let index = offset; index < end; index++) {
    const { atoms } = index ? await parse(records[index]) : reference;
    if (atoms.length !== reference.atoms.length || atoms.some((atom, i) => atom.element !== reference.atoms[i].element)) {
      throw new Error(`SDF record ${index + 1} has different atoms than record 1; external models evaluate records with the same atoms in the same order.`);
    }
    frames.push(atoms);
  }
  return { reference, frames };
}

/** Energies and forces (−gradient) of frames with `structure`'s atoms, over one
 * native session that is closed at the end, on error and on abort. */
export async function externalFrameForces(structure: MolecularStructure, frames: MolecularAtom[][], id: ExternalEnergyModelId, jobSignal: AbortSignal, timeoutMs: number) {
  const model = await availableModel(id), signal = deadline(jobSignal, timeoutMs);
  signal.throwIfAborted();
  const evaluator = await openExternalEnergyEvaluator(model, structure);
  const close = () => { void evaluator.dispose(); };
  signal.addEventListener("abort", close, { once: true });
  try {
    const results: EnergyForces[] = [];
    for (const atoms of frames) {
      signal.throwIfAborted();
      const { energy, gradient } = await evaluator.evaluate(atoms).catch(error => { signal.throwIfAborted(); throw error; });
      if (!Number.isFinite(energy) || gradient.some(vector => !vector.every(Number.isFinite))) throw new Error(`${model.name} returned no finite energy and gradient.`);
      results.push({ energy, energyUnit: "kcal/mol", forces: gradient.map(vector => vector.map(value => -value) as Vec3), forceUnit: "kcal/(mol·Å)",
        method: model.gradients ? "analytic" : "central-difference" });
    }
    return results;
  } finally {
    signal.removeEventListener("abort", close);
    await evaluator.dispose();
  }
}

export async function externalOptimize(structure: MolecularStructure, id: ExternalEnergyModelId, options: ModelOptimizeOptions, jobSignal: AbortSignal, timeoutMs: number) {
  await availableModel(id);
  return optimizeWithEnergyModel(structure, id, options, { signal: deadline(jobSignal, timeoutMs) });
}
