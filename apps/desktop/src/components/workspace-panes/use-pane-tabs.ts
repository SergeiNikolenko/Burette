import { useCallback, useMemo } from "react";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";

export type PaneShown = "visible" | "minimized" | "hidden";

// The side panel shows one of its screens at a time: the one picked last, or
// the first one when that has left the panel.
export function visibleSideTabId(tabs: readonly MoleculeTab[], sidePaneTabId: string | null) {
  const sideTabs = tabs.filter((tab) => tab.pane === "side");
  return (sideTabs.find((tab) => tab.id === sidePaneTabId) ?? sideTabs[0])?.id ?? null;
}

export function useSidePaneTabs() {
  const tabs = useMoleculeStore((state) => state.tabs);
  const sidePaneTabId = useMoleculeStore((state) => state.sidePaneTabId);
  return useMemo(() => {
    const sideTabs = tabs.filter((tab) => tab.pane === "side");
    const visibleId = visibleSideTabId(tabs, sidePaneTabId);
    return { sideTabs, visibleTab: sideTabs.find((tab) => tab.id === visibleId) ?? null };
  }, [sidePaneTabId, tabs]);
}

export function useFloatingPaneTab() {
  return useMoleculeStore((state) => state.tabs.find((tab) => tab.pane === "floating") ?? null);
}

// Whether a placed screen is on screen right now. Settings is a full-window
// mode: the panes step aside while it is open, as the docks do.
export function usePaneVisibility(tabs: readonly MoleculeTab[], settingsMode: boolean) {
  const sidePaneTabId = useMoleculeStore((state) => state.sidePaneTabId);
  const sideHidden = useWorkspacePanesStore((state) => state.sideHidden);
  const floatingMinimized = useWorkspacePanesStore((state) => state.floatingMinimized);
  const sideTabId = visibleSideTabId(tabs, sidePaneTabId);
  return useCallback((tab: MoleculeTab): PaneShown => {
    if (settingsMode || !tab.pane) return "hidden";
    if (tab.pane === "side") return !sideHidden && tab.id === sideTabId ? "visible" : "hidden";
    return floatingMinimized ? "minimized" : "visible";
  }, [floatingMinimized, settingsMode, sideHidden, sideTabId]);
}
