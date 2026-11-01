import { runChemistryTask } from "../../lib/molecular-workbench/compute-client";
import { runGraphTask } from "../../lib/molecular-workbench/graph-compute-client";
import type { MolecularStructure } from "../../lib/molecular-workbench/molecular-graph";
import type { OptimizationResult } from "../../lib/molecular-workbench/optimization";
import type { ViewerDocument } from "../../types";
import { useGraphDraft as useSharedGraphDraft, type GraphAdvancedCompute, type GraphOutcome } from "../../lib/workbench/use-graph-draft";
import { useSourceEditing } from "../../lib/source-editing/context";
import { optimizerLabel } from "./optimize-button";

export type { GraphOutcome, GraphSnapshot, GraphHistory, GraphOperation } from "../../lib/workbench/use-graph-draft";

function normalized(structure: MolecularStructure, signal: AbortSignal) {
  return runGraphTask({ action: "edit-graph", molecule: structure, edits: [{ kind: "reorder-atoms", order: structure.atoms.map((_, index) => index) }] }, { signal });
}

const outcome = (result: OptimizationResult): GraphOutcome => ({
  forceField: result.forceField, method: optimizerLabel(result.method), initialEnergy: result.initialEnergy, energy: result.energy,
  converged: result.converged, iterations: result.iterations, frames: result.frames, frameSampling: result.frameSampling,
});

const computeAdvanced: GraphAdvancedCompute = async (operation, structure, signal) => {
  if (operation.kind === "optimize") {
    const result = await runChemistryTask({ action: "optimize", molecule: structure, options: { method: operation.method, forceField: operation.forceField } }, { signal, timeoutMs: 300_000 });
    return { structure: await normalized(result.molecule, signal), outcome: outcome(result) };
  }
  // Hydrogens are appended after the source atoms, so source atoms keep their indices.
  const keep = (next: Awaited<ReturnType<typeof normalized>>) => ({ ...next, sourceAtomIndices: next.sourceAtomIndices.map(index => index < structure.atoms.length ? index : -1) });
  if (operation.kind === "prepare-3d") {
    const result = await runChemistryTask({ action: "prepare-3d", molecule: structure, options: {} }, { signal, timeoutMs: 300_000 });
    return { structure: keep(await normalized(result.molecule, signal)), outcome: outcome(result) };
  }
  const changed = await runChemistryTask({ action: "add-hydrogens", molecule: structure }, { signal });
  return { structure: keep(await normalized(changed, signal)), outcome: null };
};

/** Full workbench adapter; base edits and all surfaces share the core's one history. */
export function useGraphDraft(document: ViewerDocument | null) {
  const editing = useSourceEditing();
  return useSharedGraphDraft(document, computeAdvanced, editing ? document => editing.beginEditing(document, "structure-edit") : undefined);
}
