import { useIndexedTrajectorySource } from "./indexed-trajectory-source";
import { useScientificDocument, sourceExtension } from "./source";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../../components/types";

export const PLOTS_COMMAND = { label: "Show plots", description: "Geometry and imported quantities by frame" };
/** A multi-frame scientific source, or the displayed frame of an indexed trajectory (XTC, TRR, DCD and the like). */
export function usePlotsAvailable(document: ViewerDocument | null) {
  const { available: scientific } = useScientificPlots(document);
  const { available: indexed } = useIndexedTrajectorySource(scientific ? null : document);
  return scientific || indexed;
}
export function useScientificPlots(document: ViewerDocument | null) {
  const { document: science, text } = useScientificDocument(document?.renderer === "molstar" ? document : null);
  const extension = document ? sourceExtension(document) : null;
  const available = Boolean(science && science.frames.length > 1 && text !== null
    && (extension === "xyz" || (extension === "mol" && science.format === "cjson" && science.graph?.molfile === text)));
  return { available, science, text };
}
export function openPlots(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, documentId: string) {
  actions.setDockDocument("bottom", documentId);
  actions.openDockTab("bottom", "plots");
}
