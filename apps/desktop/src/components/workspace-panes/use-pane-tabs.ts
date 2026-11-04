import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useMoleculeStore, type MoleculeTab } from "../../stores/molecule-store";
import { useWorkspacePanesStore, type WorkspaceGroup } from "../../stores/workspace-panes-store";

import { reconcileGroupSelections, selectedGroupTab } from "../../lib/group-selection";

export { selectedGroupTab } from "../../lib/group-selection";

export type PaneShown = "visible" | "minimized" | "hidden";
const WORKSPACE_GROUPS = ["main", "right", "bottom", "floating"] as const;

export function useFloatingPaneTab() {
  return useMoleculeStore(state => state.tabs.find(tab => tab.pane === "floating") ?? null);
}

export function usePaneVisibility(settingsMode: boolean) {
  const tabs = useMoleculeStore(state => state.tabs);
  const activeTabId = useMoleculeStore(state => state.activeTabId);
  const closedGroups = useWorkspacePanesStore(state => state.closedGroups);
  const storedSelected = useWorkspacePanesStore(state => state.selectedTabs);
  const previousTabs = useRef(tabs);
  const selected = useMemo(() => reconcileGroupSelections(previousTabs.current, tabs, storedSelected), [tabs, storedSelected]);
  useLayoutEffect(() => {
    if (selected !== storedSelected) useWorkspacePanesStore.setState({ selectedTabs: selected });
    previousTabs.current = tabs;
  }, [tabs, selected, storedSelected]);
  const fullViewTabId = useWorkspacePanesStore(state => state.fullViewTabId);
  const floatingMinimized = useWorkspacePanesStore(state => state.floatingMinimized);
  useLayoutEffect(() => {
    const active = tabs.find(tab => tab.id === activeTabId);
    if (active && active.location.kind !== "settings") {
      const panes = useWorkspacePanesStore.getState();
      panes.selectTab(active.pane ?? "main", active.id);
      if (active.pane === "right" || active.pane === "bottom") panes.setGroupOpen(active.pane, true);
    }
    if (fullViewTabId && !tabs.some(tab => tab.id === fullViewTabId)) useWorkspacePanesStore.getState().setFullView(null);
    else if (fullViewTabId && active && active.location.kind !== "settings" && active.id !== fullViewTabId) useWorkspacePanesStore.getState().setFullView(active.id);
  }, [tabs, activeTabId, fullViewTabId]);
  // Both residency planning and rendering ask about every tab. Resolve each
  // group's selection once, so those passes do not rescan the entire strip.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    if (!settingsMode && !fullViewTabId) {
      for (const group of WORKSPACE_GROUPS) {
        if ((group === "right" || group === "bottom") && closedGroups[group]) continue;
        const tab = selectedGroupTab(tabs, activeTabId, selected, group);
        if (tab) ids.add(tab.id);
      }
    }
    return ids;
  }, [tabs, activeTabId, selected, closedGroups, settingsMode, fullViewTabId]);
  return useCallback((tab: MoleculeTab): PaneShown => {
    if (settingsMode) return tab.id === activeTabId ? "visible" : "hidden";
    if (fullViewTabId) return tab.id === fullViewTabId ? "visible" : "hidden";
    if (!visibleIds.has(tab.id)) return "hidden";
    return tab.pane === "floating" && floatingMinimized ? "minimized" : "visible";
  }, [visibleIds, activeTabId, fullViewTabId, floatingMinimized, settingsMode]);
}
