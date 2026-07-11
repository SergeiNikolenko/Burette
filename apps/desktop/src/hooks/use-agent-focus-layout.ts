import { useLayoutEffect } from "react";

import { browserDevAgentFocusLayout } from "../lib/browser-dev-startup";
import { useShellStore } from "../stores/shell-store";

export function useAgentFocusLayout() {
  useLayoutEffect(() => {
    applyAgentFocusLayout();
  }, []);
}

export function applyAgentFocusLayout(search?: string, isAgentShell?: boolean) {
  if (!browserDevAgentFocusLayout(search, isAgentShell)) return false;
  const state = useShellStore.getState();
  state.closeSidebar();
  state.setDockOpen("right", false);
  state.setDockOpen("bottom", false);
  return true;
}
