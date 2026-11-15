import { useScientificDocument } from "./source";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../../components/types";

export const FIELDS_COMMAND = { label: "Slice and combine fields", description: "Contour slices, integrals and new fields from Cube files" };

/** A Cube document in the editable 3D renderer. */
export function useFieldsAvailable(document: ViewerDocument | null) {
  const { document: science } = useScientificDocument(document?.renderer === "molstar" ? document : null);
  return Boolean(science?.grid);
}

export function openFields(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, documentId: string) {
  actions.setDockDocument("right", documentId);
  actions.openDockTab("right", "fields");
}
