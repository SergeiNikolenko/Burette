import { useSceneSpectra } from "./scene-spectra";
import { useMcdCompanionTarget } from "./mcd-companion-tool";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../../components/types";

export const SCIENTIFIC_SPECTRA_COMMAND = { label: "Show spectra", description: "NMR, VCD, MCD, electronic absorption, circular dichroism and density of states" };
export function useScientificSpectraAvailable(document: ViewerDocument | null) {
  const scene = useSceneSpectra(document), companion = useMcdCompanionTarget(document, scene);
  return Boolean(scene?.sources.length || companion);
}
export function openScientificSpectra(actions: Pick<ShellActions, "setDockDocument" | "openDockTab">, documentId: string) {
  actions.setDockDocument("right", documentId);
  actions.openDockTab("right", "scientific-spectra");
}
