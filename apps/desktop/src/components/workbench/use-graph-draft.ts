import { runChemistryTask } from "../../lib/molecular-workbench/compute-client";
import { runGraphTask } from "../../lib/molecular-workbench/graph-compute-client";
import type { MolecularStructure } from "../../lib/molecular-workbench/molecular-graph";
import type { ViewerDocument } from "../../types";
import { useGraphDraft as useSharedGraphDraft, type GraphAdvancedCompute } from "../../lib/workbench/use-graph-draft";
import { useSourceEditing } from "../../lib/source-editing/context";
import { optimizerLabel } from "./optimize-button";

export type { GraphOutcome, GraphSnapshot, GraphHistory, GraphOperation } from "../../lib/workbench/use-graph-draft";

function normalized(structure: MolecularStructure, signal: AbortSignal) {
  return runGraphTask({ action: "edit-graph", molecule: structure, edits: [{ kind: "reorder-atoms", order: structure.atoms.map((_, index) => index) }] }, { signal });
}

const computeAdvanced: GraphAdvancedCompute = async (operation, structure, signal) => {
  if (operation.kind === "optimize") {
    const result = await runChemistryTask({ action: "optimize", molecule: structure, options: { method: operation.method, forceField: operation.forceField } }, { signal, timeoutMs: 300_000 });
    return {
      structure: await normalized(result.molecule, signal),
      outcome: { forceField: result.forceField ?? operation.forceField ?? "MMFF94", method: optimizerLabel(operation.method), initialEnergy: result.initialEnergy, energy: result.energy, converged: result.converged, iterations: result.iterations, frames: result.frames },
    };
  }
  const changed = await runChemistryTask({ action: "add-hydrogens", molecule: structure }, { signal });
  const next = await normalized(changed, signal);
  return { structure: { ...next, sourceAtomIndices: next.sourceAtomIndices.map(index => index < structure.atoms.length ? index : -1) }, outcome: null };
};

/** Full workbench adapter; base edits and all surfaces share the core's one history. */
export function useGraphDraft(document: ViewerDocument | null) {
  const editing = useSourceEditing();
  return useSharedGraphDraft(document, computeAdvanced, editing ? document => editing.beginEditing(document, "structure-edit") : undefined);
}
