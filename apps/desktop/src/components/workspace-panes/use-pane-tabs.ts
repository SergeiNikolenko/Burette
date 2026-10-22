import { useCallback, useLayoutEffect } from "react";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { useWorkspacePanesStore, type WorkspaceGroup } from "../../stores/workspace-panes-store";

export type PaneShown = "visible" | "minimized" | "hidden";
export function selectedGroupTab(tabs: MoleculeTab[], activeTabId: string | null | undefined, selected: Partial<Record<WorkspaceGroup, string>>, group: WorkspaceGroup) {
  const candidates = tabs.filter(tab => (tab.pane ?? "main") === group && tab.location.kind !== "settings");
  return candidates.find(tab => tab.id === activeTabId) ?? candidates.find(tab => tab.id === selected[group]) ?? candidates[0] ?? null;
}
export function useFloatingPaneTab() {
  return useMoleculeStore(state => state.tabs.find(tab => tab.pane === "floating") ?? null);
}

export function usePaneVisibility(settingsMode: boolean) {
  const tabs = useMoleculeStore(state => state.tabs);
  const activeTabId = useMoleculeStore(state => state.activeTabId);
  const selected = useWorkspacePanesStore(state => state.selectedTabs);
  const fullViewTabId = useWorkspacePanesStore(state => state.fullViewTabId);
  const floatingMinimized = useWorkspacePanesStore(state => state.floatingMinimized);
  useLayoutEffect(() => {
    const active = tabs.find(tab => tab.id === activeTabId);
    if (active && active.location.kind !== "settings") useWorkspacePanesStore.getState().selectTab(active.pane ?? "main", active.id);
    if (fullViewTabId && !tabs.some(tab => tab.id === fullViewTabId)) useWorkspacePanesStore.getState().setFullView(null);
    else if (fullViewTabId && active && active.location.kind !== "settings" && active.id !== fullViewTabId) useWorkspacePanesStore.getState().setFullView(active.id);
  }, [tabs, activeTabId, fullViewTabId]);
  return useCallback((tab: MoleculeTab): PaneShown => {
    if (settingsMode) return tab.id === activeTabId ? "visible" : "hidden";
    if (fullViewTabId) return tab.id === fullViewTabId ? "visible" : "hidden";
    if (selectedGroupTab(tabs, activeTabId, selected, tab.pane ?? "main")?.id !== tab.id) return "hidden";
    return tab.pane === "floating" && floatingMinimized ? "minimized" : "visible";
  }, [tabs, activeTabId, selected, fullViewTabId, floatingMinimized, settingsMode]);
}
