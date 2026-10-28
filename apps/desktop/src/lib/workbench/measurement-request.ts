import type { MeasurementCoordinateEdit } from "../molecular-workbench/measurement-coordinate";
import { normalizeElement } from "../science-session/contracts";
import { positionsMatch, sha256Hex } from "../source-editing/source-identity";
import { checkBindingReport, checkSceneShowsSource } from "../science-session/scene-binding";
import { parseMolecule } from "../molecular-workbench/molecular-graph";

export type MeasurementRequest = Pick<MeasurementCoordinateEdit, "kind" | "atoms"> & {
  structureRef: string; modelRef: string; trajectoryRef: string;
  frameIndex: number; frameCount: number; atomCount: number; sourceSha256: string;
  sourceFormat: "sdf" | "mol";
};
export type MeasurementDialogRequest = MeasurementRequest & { frameSource: MessageEventSource | null };
const refs = ["structureRef", "modelRef", "trajectoryRef"] as const;

/** Ordered, bounded identities; selectionChanged deliberately sorts its atoms and cannot serve this contract. */
export function readMeasurementRequest(value: unknown): MeasurementRequest | null {
  if (!value || typeof value !== "object") return null;
  const v = value as MeasurementRequest;
  const size = { distance: 2, angle: 3, dihedral: 4 }[v.kind];
  if (!size || !["sdf", "mol"].includes(v.sourceFormat) || !Array.isArray(v.atoms) || v.atoms.length !== size || new Set(v.atoms).size !== size
    || !Number.isInteger(v.atomCount) || v.atomCount < size || v.atomCount > 256
    || Array.from(v.atoms).some(index => !Number.isInteger(index) || index < 0 || index >= v.atomCount)
    || !refs.every(key => typeof v[key] === "string" && v[key].length > 0 && v[key].length <= 128)
    || v.frameIndex !== 0 || v.frameCount !== 1 || typeof v.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(v.sourceSha256)) return null;
  return { kind: v.kind, atoms: [...v.atoms], structureRef: v.structureRef, modelRef: v.modelRef, trajectoryRef: v.trajectoryRef,
    frameIndex: 0, frameCount: 1, atomCount: v.atomCount, sourceSha256: v.sourceSha256, sourceFormat: v.sourceFormat };
}

/** Both the displayed parser input and the draft must still be the requested revision. */
export async function checkMeasurementSource(request: MeasurementRequest, text: string, value: Record<string, unknown>) {
  if (value.atomCount !== request.atomCount || value.sourceFormat !== request.sourceFormat) throw new Error("The structure changed. Open the measurement again.");
  const report = checkBindingReport(value);
  if (text.length > 2_000_000 || report.sourceSha256 !== request.sourceSha256 || await sha256Hex(text) !== request.sourceSha256
    || !([...refs, "frameIndex", "frameCount", "atomCount"] as const).every(key => report[key] === request[key])) {
    throw new Error("The structure changed. Open the measurement again.");
  }
  if (request.sourceFormat === "sdf") checkSceneShowsSource(report, text, "sdf");
  else {
    const { atoms } = parseMolecule(text, "mol");
    if (atoms.length !== report.atomCount || atoms.some((atom, index) => normalizeElement(atom.element) !== normalizeElement(report.elements[index]))
      || !positionsMatch(atoms.flatMap(atom => [atom.x, atom.y, atom.z]), report.positions)) throw new Error("The structure changed. Open the measurement again.");
  }
}
