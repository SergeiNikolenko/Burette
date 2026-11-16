import { useScientificDocument } from "./source";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../../components/types";

export const ORBITALS_COMMAND = { label: "Show orbitals", description: "Orbital energies, electron density and scalar fields" };

/** Capability belongs to this document's current source and editable 3D renderer. */
export function useOrbitalsAvailable(document: ViewerDocument | null) {
  const { document: science } = useScientificDocument(document?.renderer === "molstar" ? document : null);
  return Boolean(science && (science.orbitals.length || science.grid));
}

export function openOrbitals(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, documentId: string) {
  actions.setDockDocument("right", documentId);
  actions.openDockTab("right", "orbitals");
}
