#!/usr/bin/env bun
import assert from "node:assert/strict";

import { applyAgentFocusLayout } from "../apps/desktop/src/hooks/use-agent-focus-layout.ts";
import { browserDevAgentFocusLayout } from "../apps/desktop/src/lib/browser-dev-startup.ts";
import { useMoleculeStore } from "../apps/desktop/src/stores/molecule-store.ts";
import { useShellStore } from "../apps/desktop/src/stores/shell-store.ts";
import { getTabWorkspace, useTabWorkspaceStore } from "../apps/desktop/src/stores/tab-workspace-store.ts";

assert.equal(browserDevAgentFocusLayout("?agentLayout=focus", true), true);
assert.equal(browserDevAgentFocusLayout("?devFiles=%2Ftmp%2Fmini.pdb", true), false);
assert.equal(browserDevAgentFocusLayout("?agentLayout=focus", false), false);
assert.equal(browserDevAgentFocusLayout("?agentLayout=full", true), false);

const activeTabId = useMoleculeStore.getState().activeTabId;
useShellStore.setState({ sidebarOpen: true });
useTabWorkspaceStore.getState().setDockOpen(activeTabId, "right", true);
useTabWorkspaceStore.getState().setDockOpen(activeTabId, "bottom", true);
assert.equal(applyAgentFocusLayout("?devFiles=%2Ftmp%2Fmini.pdb", true), false);
assert.equal(useShellStore.getState().sidebarOpen, true);
assert.equal(getTabWorkspace(activeTabId).right.open, true);
assert.equal(getTabWorkspace(activeTabId).bottom.open, true);

assert.equal(applyAgentFocusLayout("?agentLayout=focus", true), true);
assert.equal(useShellStore.getState().sidebarOpen, false);
assert.equal(getTabWorkspace(activeTabId).right.open, false);
assert.equal(getTabWorkspace(activeTabId).bottom.open, false);

useShellStore.getState().toggleSidebar();
useTabWorkspaceStore.getState().setDockOpen(activeTabId, "right", true);
useTabWorkspaceStore.getState().setDockOpen(activeTabId, "bottom", true);
assert.equal(useShellStore.getState().sidebarOpen, true);
assert.equal(getTabWorkspace(activeTabId).right.open, true);
assert.equal(getTabWorkspace(activeTabId).bottom.open, true);

assert.equal(applyAgentFocusLayout("", false, true), true);
assert.equal(useShellStore.getState().sidebarOpen, false);
assert.equal(getTabWorkspace(activeTabId).right.open, false);
assert.equal(getTabWorkspace(activeTabId).bottom.open, false);

console.log("agent focus layout tests passed");
