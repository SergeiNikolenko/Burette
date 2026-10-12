import { useWorkspacePanesStore } from "../stores/workspace-panes-store";
import { useMoleculeStore } from "../stores/molecule-store";
import { useCallback } from "react";
import type { DockArea, DockTabKind } from "../lib/dock";

type UseAppDockActionsOptions = {
  bottomDockActiveTab: DockTabKind;
  bottomDockOpen: boolean;
  openDockTab: (area: DockArea, kind: DockTabKind) => void;
  rightDockActiveTab: DockTabKind;
  rightDockOpen: boolean;
  setDockOpen: (area: DockArea, open: boolean) => void;
};

export function useAppDockActions({
  bottomDockActiveTab,
  bottomDockOpen,
  openDockTab,
  rightDockActiveTab,
  rightDockOpen,
  setDockOpen,
}: UseAppDockActionsOptions) {
  const toggleDockTab = useCallback((area: DockArea, kind: DockTabKind) => {
    const open = area === "right" ? rightDockOpen : bottomDockOpen;
    const activeKind = area === "right" ? rightDockActiveTab : bottomDockActiveTab;
    const screenSelected = area === "right" && !useWorkspacePanesStore.getState().sideHidden && useMoleculeStore.getState().tabs.some(tab => tab.pane === "side");
    if (open && !screenSelected && activeKind === kind) {
      setDockOpen(area, false);
      return;
    }
    openDockTab(area, kind);
  }, [bottomDockActiveTab, bottomDockOpen, openDockTab, rightDockActiveTab, rightDockOpen, setDockOpen]);

  return { toggleDockTab };
}
