#!/usr/bin/env node
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  },
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  location: { search: "", protocol: "file:", hostname: "" },
};

storage.set("burette.shell.ui", JSON.stringify({
  state: {
    rightDockOpen: true,
    rightDockWidth: 488,
    rightDockTabs: [{ id: "dock-files", kind: "files" }],
    rightDockActiveTab: "files",
    bottomDockOpen: true,
    bottomDockHeight: 344,
    bottomDockTabs: [{ id: "dock-jobs", kind: "jobs" }],
    bottomDockActiveTab: "jobs",
  },
  version: 0,
}));

const {
  defaultTabWorkspace,
  getTabWorkspace,
  getTabWorkspaceStoreSnapshot,
  useTabWorkspaceStore,
} = await import("../apps/desktop/src/stores/tab-workspace-store.ts");

assert.equal(getTabWorkspace("tab-1").right.open, true);
assert.equal(getTabWorkspace("tab-1").right.size, 488);
assert.equal(getTabWorkspace("tab-1").bottom.open, true);
assert.equal(getTabWorkspace("tab-1").bottom.size, 344);

function resetStore() {
  storage.clear();
  useTabWorkspaceStore.setState({ workspaces: {} });
}

resetStore();
assert.deepEqual(getTabWorkspace("tab-a"), defaultTabWorkspace());
assert.deepEqual(useTabWorkspaceStore.getState().workspaces, {}, "reading defaults must not mutate the store");

const workspace = useTabWorkspaceStore.getState();
workspace.setDockOpen("tab-a", "right", true);
workspace.setDockSize("tab-a", "right", 510);
workspace.openDockTab("tab-a", "right", "xyzrender");
workspace.setDockOpen("tab-a", "bottom", false);

workspace.setDockOpen("tab-b", "right", false);
workspace.setDockSize("tab-b", "right", 330);
workspace.setDockOpen("tab-b", "bottom", true);
workspace.setDockSize("tab-b", "bottom", 410);
workspace.openDockTab("tab-b", "bottom", "jobs");

const tabA = getTabWorkspace("tab-a");
const tabB = getTabWorkspace("tab-b");
assert.equal(tabA.right.open, true);
assert.equal(tabA.right.size, 510);
assert.equal(tabA.right.activeTab, "xyzrender");
assert.equal(tabA.bottom.open, false);
assert.equal(tabB.right.open, false);
assert.equal(tabB.right.size, 330);
assert.equal(tabB.bottom.open, true);
assert.equal(tabB.bottom.size, 410);
assert.equal(tabB.bottom.activeTab, "jobs");

workspace.setDockDocument("tab-a", "right", "runtime-only-document");
workspace.addDockDrop("tab-a", {
  area: "right",
  tabKind: "files",
  payload: { paths: ["/tmp/durable.pdb"], records: [] },
});
workspace.addDockDrop("tab-a", {
  area: "right",
  tabKind: "files",
  payload: {
    paths: [],
    records: [{ path: "inline", inputExtension: "pdb", text: "ATOM" }],
  },
});

assert.deepEqual(
  getTabWorkspaceStoreSnapshot().workspaces["tab-a"].droppedStructures.flatMap((drop) => drop.payload.records),
  [],
  "history snapshots must not duplicate inline molecular text",
);

const persisted = JSON.parse(storage.get("burette.tab-workspaces"));
assert.equal(persisted.version, 1);
assert.equal(persisted.state.workspaces["tab-a"].right.documentId, null);
assert.deepEqual(
  persisted.state.workspaces["tab-a"].droppedStructures.flatMap((drop) => drop.payload.paths),
  ["/tmp/durable.pdb"],
);

workspace.pruneWorkspaces(["tab-b"]);
assert.deepEqual(Object.keys(useTabWorkspaceStore.getState().workspaces), ["tab-b"]);

console.log("tab workspace store behavior tests passed");
