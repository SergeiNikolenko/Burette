#!/usr/bin/env node
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => {
    storage.set(key, String(value));
  },
  removeItem: (key) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
  key: (index) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  },
};
globalThis.window = { localStorage: globalThis.localStorage };

const { useShellStore } = await import("../apps/desktop/src/stores/shell-store.ts");

const initial = useShellStore.getState();
assert.equal(initial.rightDockOpen, true);
assert.deepEqual(initial.rightDockTabs.map((tab) => tab.kind), [
  "inspector",
  "text",
  "files",
]);
useShellStore.getState().openDockTab("right", "descriptors");
assert.deepEqual(useShellStore.getState().rightDockTabs.map((tab) => tab.kind), [
  "inspector",
  "text",
  "files",
]);

useShellStore.setState({
  projectRoots: ["/tmp/live-project", "/tmp/missing-project"],
  pinnedProjectRoots: ["/tmp/live-project", "/tmp/missing-project"],
  projectNameOverrides: {
    "/tmp/live-project": "Live Project",
    "/tmp/missing-project": "Missing Project",
  },
  expandedProjectIds: [
    "project:/tmp/live-project",
    "project:/tmp/missing-project",
    "loose-files",
  ],
  pinnedStructurePaths: [
    "/tmp/live-project/mini.pdb",
    "/tmp/missing-project/old.pdb",
  ],
});

useShellStore.getState().pruneSidebarPaths([
  "/tmp/live-project",
  "/tmp/live-project/mini.pdb",
]);

const pruned = useShellStore.getState();
assert.deepEqual(pruned.projectRoots, ["/tmp/live-project"]);
assert.deepEqual(pruned.pinnedProjectRoots, ["/tmp/live-project"]);
assert.deepEqual(pruned.projectNameOverrides, { "/tmp/live-project": "Live Project" });
assert.deepEqual(pruned.expandedProjectIds, ["project:/tmp/live-project", "loose-files"]);
assert.deepEqual(pruned.pinnedStructurePaths, ["/tmp/live-project/mini.pdb"]);

useShellStore.getState().renameProjectRoot("/tmp/implicit-project", "Implicit Project");

const renamedImplicit = useShellStore.getState();
assert.deepEqual(renamedImplicit.projectRoots, ["/tmp/live-project", "/tmp/implicit-project"]);
assert.deepEqual(renamedImplicit.projectNameOverrides, {
  "/tmp/live-project": "Live Project",
  "/tmp/implicit-project": "Implicit Project",
});
assert.deepEqual(renamedImplicit.expandedProjectIds, [
  "project:/tmp/live-project",
  "loose-files",
  "project:/tmp/implicit-project",
]);

console.log("shell store behavior tests passed");
