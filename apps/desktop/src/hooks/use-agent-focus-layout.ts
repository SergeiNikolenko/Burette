import { useLayoutEffect } from "react";
import { setRightPanelOpen } from "../lib/right-workspace-panel";

import { browserDevAgentFocusLayout } from "../lib/browser-dev-startup";
import { isHostedMcpWidget } from "../lib/hosted-mcp-widget";
import { isWebDemoHeroEmbed, isWebDemoWorkspace } from "../lib/web-demo-workspace";
import { useMoleculeStore } from "../stores/molecule-store";
import { useShellStore } from "../stores/shell-store";
import { useTabWorkspaceStore } from "../stores/tab-workspace-store";

export function useAgentFocusLayout() {
  useLayoutEffect(() => {
    applyAgentFocusLayout();
  }, []);
}

export function applyAgentFocusLayout(
  search?: string,
  isAgentShell?: boolean,
  hostedMcpWidget = isHostedMcpWidget(),
) {
  const activeTabId = useMoleculeStore.getState().activeTabId;
  const workspace = useTabWorkspaceStore.getState();
  if (isWebDemoWorkspace()) {
    const state = useShellStore.getState();
    const heroEmbed = isWebDemoHeroEmbed();
    if (!state.sidebarOpen) state.toggleSidebar();
    if (activeTabId) {
      setRightPanelOpen(!heroEmbed);
      workspace.setDockOpen(activeTabId, "bottom", false);
    }
    return true;
  }
  if (!hostedMcpWidget && !browserDevAgentFocusLayout(search, isAgentShell)) {
    return false;
  }
  const state = useShellStore.getState();
  state.closeSidebar();
  if (activeTabId) {
    setRightPanelOpen(false);
    workspace.setDockOpen(activeTabId, "bottom", false);
  }
  return true;
}
