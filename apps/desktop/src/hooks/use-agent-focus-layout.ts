import { useLayoutEffect } from "react";

import { browserDevAgentFocusLayout } from "../lib/browser-dev-startup";
import { isHostedMcpWidget } from "../lib/hosted-mcp-widget";
import { isWebDemoHeroEmbed, isWebDemoWorkspace } from "../lib/web-demo-workspace";
import { useShellStore } from "../stores/shell-store";

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
  if (isWebDemoWorkspace()) {
    const state = useShellStore.getState();
    const heroEmbed = isWebDemoHeroEmbed();
    if (!state.sidebarOpen) state.toggleSidebar();
    state.setDockOpen("right", !heroEmbed);
    state.setDockOpen("bottom", false);
    return true;
  }
  if (!hostedMcpWidget && !browserDevAgentFocusLayout(search, isAgentShell)) {
    return false;
  }
  const state = useShellStore.getState();
  state.closeSidebar();
  state.setDockOpen("right", false);
  state.setDockOpen("bottom", false);
  return true;
}
