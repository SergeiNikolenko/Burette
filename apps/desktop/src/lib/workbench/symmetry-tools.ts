import type { ShellActions } from "../../components/types";
import { periodicCrystalFormat } from "../molecular-workbench/crystal-io";
import { classifySourceShape } from "../source-editing/policy";
import { useStructureSourceText } from "../source-editing/use-structure-source-text";
import { sourceExtension } from "../science-session/state";
import { structureEditAvailable } from "./graph-draft";
import { workbenchSupportsDocument } from "./structure";
import type { ViewerDocument } from "../../types";

export const CRYSTAL_COMMAND = { label: "Show crystal tools", description: "Unit cell, supercell, space group, powder pattern and g(r) of this crystal" };
export const SYMMETRY_COMMAND = { label: "Show molecular symmetry", description: "Point group, symmetry operations and Symmetrize for this molecule" };

/** The Crystal or Symmetry tab of the right dock, showing this document. */
export function openSymmetryTool(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, documentId: string, kind: "crystal" | "symmetry") {
  actions.setDockDocument("right", documentId);
  actions.openDockTab("right", kind);
}

/** A single-frame XYZ molecule without a Lattice; crystals use the Crystal panel. */
export function moleculeXyz(document: ViewerDocument | null, text: string | null) {
  return Boolean(document && workbenchSupportsDocument(document) && sourceExtension(document) === "xyz" && text !== null
    && !periodicCrystalFormat("xyz", text) && classifySourceShape("xyz", text) === "single");
}

/** Whether the document is a molecule whose point group the Symmetry panel finds. */
export function useSymmetryAvailable(document: ViewerDocument | null) {
  const xyz = document && !structureEditAvailable(document) && workbenchSupportsDocument(document) && sourceExtension(document) === "xyz" ? document : null;
  const { text } = useStructureSourceText(xyz);
  return structureEditAvailable(document) || moleculeXyz(xyz, text);
}

