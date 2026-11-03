import { alignCoordinates } from "../molecular-workbench/coordinate-align";
import { runGraphTask } from "../molecular-workbench/graph-compute-client";
import type { GraphEditResult } from "../molecular-workbench/graph-edit";
import { editMeasurementCoordinate } from "../molecular-workbench/measurement-coordinate";
import type { Vec3 } from "../molecular-workbench/types";
import { positionsMatch } from "../source-editing/source-identity";
import { graphDraftText, graphSourceMetadata } from "./graph-draft";
import { normalizeGraphOrder, replaceGraphPositions } from "./graph-positions";
import type { AgentJobContext, AgentJobOutput, AgentJobRunner } from "./agent-jobs";
import type { Snapshot } from "./agent-source";

/** Why a revision has no source-owned graph whose coordinates alone can be replaced, or null. */
function coordinateUnavailable(snapshot: Snapshot): string | null {
  if (!["sdf", "sd", "mol"].includes(snapshot.extension)) return "Coordinate editing needs one MOL or SDF record; other sources have no source-owned bond graph.";
  if (snapshot.extension !== "mol" && snapshot.sdfRecords !== 1) return "Coordinate editing needs one SDF record; collections are unsupported.";
  if (!snapshot.source || !snapshot.structure) return snapshot.structureError ?? snapshot.sourceError ?? "The chemical graph could not be read.";
  if (snapshot.structure.graphSource !== "explicit" || !snapshot.structure.graphComplete) return "Coordinate editing requires a complete source bond graph.";
  const count = snapshot.source.atoms.length;
  return count < 1 || count > 256 ? "Coordinate editing supports 1–256 atoms." : null;
}

const atomsUnavailable = (snapshot: Snapshot, atoms: number[]) => {
  const count = snapshot.source!.atoms.length;
  return atoms.some(atom => atom >= count) ? `Atom indices must be below ${count}.` : null;
};

/**
 * The position-only revision the Edit history publishes for the same operation:
 * the graph worker's source-order connection table with exact new coordinates,
 * under the source record's title and data items (validated reserved metadata kept).
 */
async function coordinateRevision(input: Snapshot, edit: (structure: GraphEditResult) => { coordinates: Vec3[]; summary: Record<string, unknown> }, suffix: string, { signal, stem, artifact }: AgentJobContext): Promise<AgentJobOutput> {
  const format = input.extension === "mol" ? "mol" : "sdf";
  const parsed = await runGraphTask({ action: "parse", source: input.text, format }, { signal });
  const structure = await normalizeGraphOrder(parsed, signal);
  // Request indices are source rows: the edited graph must list the revision's atoms in that order.
  if (!positionsMatch(structure.atoms.flatMap(atom => [atom.x, atom.y, atom.z]), input.source!.atoms.flatMap(atom => [atom.x, atom.y, atom.z]), 1e-9)
    || structure.atoms.some((atom, index) => atom.element !== input.source!.atoms[index].element)) throw new Error("The graph does not keep the source atom order.");
  const { coordinates, summary } = edit(structure);
  const next = await replaceGraphPositions(structure, coordinates, signal);
  const metadata = graphSourceMetadata(input.text, format, next.atoms.length, { initialize: false });
  const text = graphDraftText(input.text, format, next.molfile, metadata);
  return { summary: { ...summary, format, atomCount: next.atoms.length },
    artifacts: [await artifact("structure", `${stem}-${suffix}.${format}`, format === "mol" ? "chemical/x-mdl-molfile" : "chemical/x-mdl-sdfile", text)] };
}

export const measurementSetJob: AgentJobRunner<"measurement_set"> = {
  unavailable: coordinateUnavailable,
  paramsUnavailable: (snapshot, params) => atomsUnavailable(snapshot, params.atoms),
  run: (input, params, context) => coordinateRevision(input, structure => {
    const target = params.measurement === "distance" ? params.valueAngstrom : params.valueDegrees;
    const result = editMeasurementCoordinate(structure, { kind: params.measurement, atoms: params.atoms, target, side: params.fragment === "smaller" ? undefined : params.fragment });
    return { coordinates: result.coordinates, summary: { measurement: params.measurement, atoms: params.atoms, unit: params.measurement === "distance" ? "Å" : "degrees",
      previous: result.previous, value: result.value, fragment: result.side, movedAtoms: result.movedAtoms } };
  }, params.measurement, context),
};

export const coordinateAlignJob: AgentJobRunner<"coordinate_align"> = {
  unavailable: coordinateUnavailable,
  paramsUnavailable: (snapshot, params) => atomsUnavailable(snapshot, params.axisAtom === undefined ? [params.originAtom] : [params.originAtom, params.axisAtom]),
  run: (input, params, context) => coordinateRevision(input, structure => {
    const result = alignCoordinates(structure.atoms.map(atom => [atom.x, atom.y, atom.z] as Vec3), { origin: params.originAtom, target: params.axisAtom, axis: params.axis ?? "x" });
    return { coordinates: result.coordinates, summary: { originAtom: params.originAtom, axisAtom: params.axisAtom ?? null, axis: params.axisAtom === undefined ? null : params.axis,
      translationAngstrom: result.translation, rotation: result.rotation } };
  }, "aligned", context),
};
