#!/usr/bin/env node
import assert from "node:assert/strict";

import { executeAgentTabAction } from "../apps/desktop/src/lib/agent-tab-actions.ts";

const tabs = [
  { id: "tab-1", location: { kind: "launcher" }, back: [], forward: [] },
  { id: "tab-2", location: { kind: "ketcher" }, back: [], forward: [] },
];
const calls = [];
const actions = {
  openNewTab: () => calls.push(["new"]),
  setActiveTab: id => calls.push(["focus", id]),
  closeTab: id => calls.push(["close", id]),
  moveTab: (id, index) => calls.push(["move", id, index]),
};
const openPaths = async paths => calls.push(["open", ...paths]);

assert.equal((await executeAgentTabAction({ type: "manage_tabs", operation: "next" }, tabs, "tab-1", actions, openPaths)).ok, true);
assert.deepEqual(calls.pop(), ["focus", "tab-2"]);
assert.equal((await executeAgentTabAction({ type: "manage_tabs", operation: "focus", index: 0 }, tabs, "tab-2", actions, openPaths)).ok, true);
assert.deepEqual(calls.pop(), ["focus", "tab-1"]);
assert.equal((await executeAgentTabAction({ type: "manage_tabs", operation: "move", tabId: "tab-2", toIndex: 0 }, tabs, "tab-1", actions, openPaths)).ok, true);
assert.deepEqual(calls.pop(), ["move", "tab-2", 0]);
assert.equal((await executeAgentTabAction({ type: "manage_tabs", operation: "open_file", path: "/tmp/a.pdb" }, tabs, "tab-1", actions, openPaths)).ok, true);
assert.deepEqual(calls.pop(), ["open", "/tmp/a.pdb"]);
assert.equal((await executeAgentTabAction({ type: "manage_tabs", operation: "focus", tabId: "missing" }, tabs, "tab-1", actions, openPaths)).error.code, "TAB_NOT_FOUND");

console.log("agent tab action tests passed");
