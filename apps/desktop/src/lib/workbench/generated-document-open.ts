import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import { serializeXyz } from "../molecular-workbench/xyz";
import type { ShellActions } from "../../components/types";
import type { ViewerDocument } from "../../types";
import { safeExportFileName } from "../file-export";
import { fileStem, multiFrameXyz } from "./formats";
import { useMoleculeStore } from "../../stores/molecule-store";
import { claimImportedSource, forgetImportedSource, newImportToken, registerImportedScientificSource, type ImportedOriginal } from "./scientific-source-state";

/**
 * Generated structures open as new documents; the source document stays untouched.
 * `shouldApply` lets a caller drop the document while it is still being prepared.
 */
export function openGeneratedStructure(actions: Pick<ShellActions, "openStructureRecords">, name: string, extension: "xyz" | "sdf" | "cif", text: string, shouldApply?: () => boolean) {
  const fileName = safeExportFileName(`${fileStem(name)}.${extension}`);
  const records = [{ path: fileName, inputExtension: extension, text }];
  return shouldApply ? actions.openStructureRecords(records, undefined, { shouldApply }) : actions.openStructureRecords(records);
}

const energyComment = (energy: number | undefined) => energy === undefined ? "" : `Energy=${energy} Hartree `;

/** Final geometry as one XYZ frame, the geometry normal modes and orbitals refer to. */
function finalGeometryText(document: ScientificDocument, token: string) {
  return serializeXyz(document.atoms, `${energyComment(document.frames.at(-1)?.energyHartree)}${token}`);
}

/** XYZ the trajectory toolbar can play: every retained step, with its energy in the comment line. */
function stepsText(document: ScientificDocument, token: string) {
  return multiFrameXyz(document.frames.map((frame, index) => ({
    atoms: frame.atoms,
    comment: `Step ${index + 1} ${energyComment(frame.energyHartree)}${index === 0 ? token : ""}`.trim(),
  })));
}

/**
 * Opens parsed scientific data as a new XYZ document that keeps that data attached,
 * and the uploaded file it came from when there is one.
 */
export async function openScientificDocument(actions: Pick<ShellActions, "openStructureRecords">, name: string, document: ScientificDocument, layout: "final" | "steps", original: ImportedOriginal | null = null) {
  const token = newImportToken();
  const text = layout === "steps" ? stepsText(document, token) : finalGeometryText(document, token);
  // Steps are a trajectory of frames and energies; a frame's own modes travel with it.
  // The document's modes, orbitals and fields refer to the final geometry only, so
  // they stay with the single-frame document. File-scoped spectra travel with either layout.
  registerImportedScientificSource(token, text, layout === "steps"
    ? { format: document.format, atoms: document.frames[0]?.atoms ?? document.atoms, frames: document.frames, modes: [], orbitals: [], converged: document.converged, ...(document.spectra ? { spectra: document.spectra } : {}) }
    : document, original);
  // The import belongs to the one document this open created; without it, nothing is kept.
  // That document may already have closed (and close cleanup run) before the open returned.
  let opened: ViewerDocument[] = [];
  try {
    opened = await openGeneratedStructure(actions, name, "xyz", text);
  } finally {
    const own = opened.length === 1 ? opened[0].id : null;
    if (own && useMoleculeStore.getState().documents.some((item) => item.id === own)) claimImportedSource(token, own);
    else forgetImportedSource(token);
  }
}
