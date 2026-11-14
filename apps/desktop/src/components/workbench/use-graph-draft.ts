import { runChemistryTask } from "../../lib/molecular-workbench/compute-client";
import { optimizeWithEnergyModel } from "../../lib/molecular-workbench/optimize-with-model";
import { runGraphTask } from "../../lib/molecular-workbench/graph-compute-client";
import type { MolecularStructure } from "../../lib/molecular-workbench/molecular-graph";
import type { OptimizationResult } from "../../lib/molecular-workbench/optimization";
import { optimizerTolerances } from "../../lib/workbench/optimizer-settings";
import type { ViewerDocument } from "../../types";
import { useGraphDraft as useSharedGraphDraft, type GraphAdvancedCompute, type GraphOutcome } from "../../lib/workbench/use-graph-draft";
import { useSourceEditing } from "../../lib/source-editing/context";
import { optimizerLabel } from "./optimize-button";
import { runFragmentTask } from "../../lib/workbench/fragment-task";
import { planStroke, type DrawStroke } from "../../lib/molecular-workbench/draw-stroke";
import type { GraphEditResult } from "../../lib/molecular-workbench/graph-edit";

export type { GraphOutcome, GraphSnapshot, GraphHistory, GraphOperation } from "../../lib/workbench/use-graph-draft";

function normalized(structure: MolecularStructure, signal: AbortSignal) {
  return runGraphTask({ action: "edit-graph", molecule: structure, edits: [{ kind: "reorder-atoms", order: structure.atoms.map((_, index) => index) }] }, { signal });
}

const outcome = (result: OptimizationResult): GraphOutcome => ({
  forceField: result.forceField, method: optimizerLabel(result.method), initialEnergy: result.initialEnergy, energy: result.energy,
  converged: result.converged, iterations: result.iterations, frames: result.frames, frameSampling: result.frameSampling,
  residuals: result.constraintResiduals,
});

const computeAdvanced: GraphAdvancedCompute = async (operation, structure, signal, onProgress) => {
  if (operation.kind === "optimize") {
    const { method, maxIterations, constraints } = operation;
    const result = await optimizeWithEnergyModel(structure, operation.forceField, { method, maxIterations, constraints, ...optimizerTolerances() }, { signal, onProgress });
    return { structure: await normalized(result.molecule, signal), outcome: outcome(result) };
  }
  // Hydrogens are appended after the source atoms, so source atoms keep their indices.
  const keep = (next: Awaited<ReturnType<typeof normalized>>) => ({ ...next, sourceAtomIndices: next.sourceAtomIndices.map(index => index < structure.atoms.length ? index : -1) });
  if (operation.kind === "prepare-3d") {
    const result = await runChemistryTask({ action: "prepare-3d", molecule: structure, options: {} }, { signal, timeoutMs: 300_000 });
    return { structure: keep(await normalized(result.molecule, signal)), outcome: outcome(result) };
  }
  // Insertion output is already an ordered graph edit with exact provenance.
  if (operation.kind === "insert-fragment") return { structure: (await runFragmentTask({ molecule: structure, fragment: operation.fragment, target: operation.target }, { signal })).structure, outcome: null };
  if (operation.kind === "protonate") {
    const result = await runChemistryTask({ action: "protonate", molecule: structure, pH: operation.pH }, { signal });
    // Protonation adds and removes hydrogens, so provenance comes from the worker, not the atom count.
    const next = await normalized(result.structure, signal);
    return { structure: { ...next, sourceAtomIndices: next.sourceAtomIndices.map(index => result.structure.sourceAtomIndices[index]) }, outcome: null };
  }
  if (operation.kind === "draw") return { structure: await drawStroke(structure, operation.stroke, operation.hydrogens, signal), outcome: null };
  const changed = await runChemistryTask({ action: "add-hydrogens", molecule: structure }, { signal });
  return { structure: keep(await normalized(changed, signal)), outcome: null };
};

/**
 * One Draw stroke: its graph edits, then hydrogens on the atoms it touched only.
 * Hydrogens are placed for the whole graph and the ones on other atoms dropped,
 * so a structure drawn without hydrogens elsewhere stays that way.
 */
async function drawStroke(structure: GraphEditResult, stroke: DrawStroke, hydrogens: boolean, signal: AbortSignal): Promise<GraphEditResult> {
  const plan = planStroke(structure, stroke, hydrogens);
  // A stroke that changes nothing is dropped without an error or an Undo step.
  if (!plan) throw new DOMException("The stroke changes nothing.", "AbortError");
  const edited = await runGraphTask({ action: "edit-graph", molecule: structure, edits: plan.edits }, { signal });
  if (!hydrogens) return edited;
  const filled = await normalized(await runChemistryTask({ action: "add-hydrogens", molecule: edited }, { signal }), signal);
  const touched = new Set(plan.touched), count = edited.atoms.length;
  const elsewhere = filled.atoms.flatMap((_, i) => i >= count && !filled.bonds.some(bond => (bond.a === i && touched.has(bond.b)) || (bond.b === i && touched.has(bond.a))) ? [i] : []);
  const kept = elsewhere.length ? await runGraphTask({ action: "edit-graph", molecule: filled, edits: [{ kind: "delete-atoms", indices: elsewhere }] }, { signal }) : filled;
  // Provenance runs kept → filled → edited → the structure the stroke started from.
  const toEdited = (index: number) => { const source = index < 0 ? -1 : filled.sourceAtomIndices[index]; return source >= 0 && source < count ? source : -1; };
  return { ...kept, sourceAtomIndices: kept.sourceAtomIndices.map(index => { const source = toEdited(index); return source < 0 ? -1 : edited.sourceAtomIndices[source]; }) };
}

/** Full workbench adapter; base edits and all surfaces share the core's one history. */
export function useGraphDraft(document: ViewerDocument | null) {
  const editing = useSourceEditing();
  return useSharedGraphDraft(document, computeAdvanced, editing ? document => editing.beginEditing(document, "structure-edit") : undefined);
}
