import { useLayoutEffect } from "react";
import { isBrowserSessionWorkspace, workspaceStorageKey } from "../lib/window-scope";

import { browserDevAgentFocusLayout } from "../lib/browser-dev-startup";
import { isHostedMcpWidget } from "../lib/hosted-mcp-widget";
import { isWebDemoHeroEmbed, isWebDemoWorkspace } from "../lib/web-demo-workspace";
import { useMoleculeStore } from "../stores/molecule-store";
import { useShellStore } from "../stores/shell-store";
import { useTabWorkspaceStore, WINDOW_TOOLS_ID } from "../stores/tab-workspace-store";

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
      workspace.setDockOpen(activeTabId, "right", !heroEmbed);
      workspace.setDockOpen(activeTabId, "bottom", false);
    }
    return true;
  }
  if (!hostedMcpWidget && !browserDevAgentFocusLayout(search, isAgentShell)) {
    return false;
  }
  // A restored Browser workspace owns its layout; focus is a first-start default.
  if (isBrowserSessionWorkspace() && activeTabId) {
    try {
      if (window.sessionStorage.getItem(workspaceStorageKey("burette.tab-workspaces"))
        && (workspace.workspaces[activeTabId] || workspace.workspaces[WINDOW_TOOLS_ID])) return false;
    } catch { /* Unavailable storage keeps the initial focus defaults. */ }
  }
  const state = useShellStore.getState();
  state.closeSidebar();
  if (activeTabId) {
    workspace.setDockOpen(activeTabId, "right", false);
    workspace.setDockOpen(activeTabId, "bottom", false);
  }
  return true;
}
