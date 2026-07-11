#!/usr/bin/env bun
import assert from "node:assert/strict";

import { applyAgentFocusLayout } from "../apps/desktop/src/hooks/use-agent-focus-layout.ts";
import { browserDevAgentFocusLayout } from "../apps/desktop/src/lib/browser-dev-startup.ts";
import { useShellStore } from "../apps/desktop/src/stores/shell-store.ts";

assert.equal(browserDevAgentFocusLayout("?agentLayout=focus", true), true);
assert.equal(browserDevAgentFocusLayout("?devFiles=%2Ftmp%2Fmini.pdb", true), false);
assert.equal(browserDevAgentFocusLayout("?agentLayout=focus", false), false);
assert.equal(browserDevAgentFocusLayout("?agentLayout=full", true), false);

useShellStore.setState({ sidebarOpen: true, rightDockOpen: true, bottomDockOpen: true });
assert.equal(applyAgentFocusLayout("?devFiles=%2Ftmp%2Fmini.pdb", true), false);
assert.equal(useShellStore.getState().sidebarOpen, true);
assert.equal(useShellStore.getState().rightDockOpen, true);
assert.equal(useShellStore.getState().bottomDockOpen, true);

assert.equal(applyAgentFocusLayout("?agentLayout=focus", true), true);
assert.equal(useShellStore.getState().sidebarOpen, false);
assert.equal(useShellStore.getState().rightDockOpen, false);
assert.equal(useShellStore.getState().bottomDockOpen, false);

useShellStore.getState().toggleSidebar();
useShellStore.getState().setDockOpen("right", true);
useShellStore.getState().setDockOpen("bottom", true);
assert.equal(useShellStore.getState().sidebarOpen, true);
assert.equal(useShellStore.getState().rightDockOpen, true);
assert.equal(useShellStore.getState().bottomDockOpen, true);

assert.equal(applyAgentFocusLayout("", false, true), true);
assert.equal(useShellStore.getState().sidebarOpen, false);
assert.equal(useShellStore.getState().rightDockOpen, false);
assert.equal(useShellStore.getState().bottomDockOpen, false);

console.log("agent focus layout tests passed");
