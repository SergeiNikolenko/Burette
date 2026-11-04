import { useMoleculeStore } from "../stores/molecule-store";
import { useWorkspacePanesStore } from "../stores/workspace-panes-store";
import { useTabWorkspaceStore, WINDOW_TOOLS_ID } from "../stores/tab-workspace-store";
import { setRightPanelOpen } from "./right-workspace-panel";

// A panel toggle hides its tabs without moving or closing them. The selected
// screen remains remembered while keyboard focus returns to the main group.
export function toggleWorkspacePanel(group: "right" | "bottom"): boolean {
  const model = useMoleculeStore.getState();
  if (group === "right") {
    const closed = useWorkspacePanesStore.getState().closedGroups.right;
    setRightPanelOpen(closed === true || !model.tabs.some(tab => tab.pane === "right"));
    return true;
  }
  const tabs = model.tabs.filter(tab => tab.pane === group);
  if (!tabs.length) return false;
  const panes = useWorkspacePanesStore.getState();
  const dockWorkspace = useTabWorkspaceStore.getState().workspaces[WINDOW_TOOLS_ID];
  const open = panes.closedGroups[group] === true && !dockWorkspace?.[group].open;
  const selected = tabs.find(tab => tab.id === model.activeTabId)
    ?? tabs.find(tab => tab.id === panes.selectedTabs[group]) ?? tabs[0];
  panes.selectTab(group, selected.id);
  panes.setFullView(null);
  if (!open) {
    const mainTabs = model.tabs.filter(tab => !tab.pane && tab.location.kind !== "settings");
    const main = mainTabs.find(tab => tab.id === panes.selectedTabs.main) ?? mainTabs[0];
    useTabWorkspaceStore.getState().setDockOpen(WINDOW_TOOLS_ID, group, false);
    if (main && tabs.some(tab => tab.id === model.activeTabId)) model.setActiveTab(main.id);
  } else model.setActiveTab(selected.id);
  panes.setGroupOpen(group, open);
  return true;
}
