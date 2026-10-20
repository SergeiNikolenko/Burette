import { useCallback } from "react";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";

export type PaneShown = "visible" | "minimized" | "hidden";

export function useFloatingPaneTab() {
  return useMoleculeStore((state) => state.tabs.find((tab) => tab.pane === "floating") ?? null);
}

// Whether a placed screen is on screen right now. Settings is a full-window
// mode: the floating window steps aside while it is open, as the docks do.
export function usePaneVisibility(settingsMode: boolean) {
  const floatingMinimized = useWorkspacePanesStore((state) => state.floatingMinimized);
  return useCallback((tab: MoleculeTab): PaneShown => {
    if (settingsMode || !tab.pane) return "hidden";
    return floatingMinimized ? "minimized" : "visible";
  }, [floatingMinimized, settingsMode]);
}
