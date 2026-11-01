import { useScientificDocument, sourceExtension } from "./source";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../../components/types";

export const PLOTS_COMMAND = { label: "Show plots", description: "Geometry and imported quantities by frame" };
export function usePlotsAvailable(document: ViewerDocument | null) {
  const { document: science, text } = useScientificDocument(document?.renderer === "molstar" ? document : null);
  return Boolean(document && science && science.frames.length > 1 && text !== null && (sourceExtension(document) === "xyz"
    || (sourceExtension(document) === "mol" && science.format === "cjson" && science.graph?.molfile === text)));
}
export function openPlots(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, documentId: string) {
  actions.setDockDocument("bottom", documentId);
  actions.openDockTab("bottom", "plots");
}
