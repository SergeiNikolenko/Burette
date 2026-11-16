import { sourceExtension, useScientificDocument } from "./source";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../../components/types";

export const POTENTIAL_COMMAND = { label: "Show electrostatic potential", description: "A surface coloured by the potential of atomic charges or a potential cube" };

/** Molecule files whose bond orders and charges give Gasteiger charges when nothing else does. */
export const POTENTIAL_GRAPH_FORMATS = new Set(["mol", "sdf"]);

/** A calculation's atoms, or a MOL or SDF file, in the editable 3D renderer. */
export function usePotentialAvailable(document: ViewerDocument | null) {
  const molstar = document?.renderer === "molstar" ? document : null;
  const { document: science } = useScientificDocument(molstar);
  return Boolean(science?.atoms.length || (molstar && !molstar.mergedCollection && POTENTIAL_GRAPH_FORMATS.has(sourceExtension(molstar))));
}

export function openPotential(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, documentId: string) {
  actions.setDockDocument("right", documentId);
  actions.openDockTab("right", "potential");
}
