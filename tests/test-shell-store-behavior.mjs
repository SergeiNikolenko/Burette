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
assert.deepEqual(initial.bottomDockTabs.map((tab) => tab.kind), [
  "files",
  "jobs",
]);
useShellStore.getState().openDockTab("right", "descriptors");
assert.deepEqual(useShellStore.getState().rightDockTabs.map((tab) => tab.kind), [
  "inspector",
  "text",
  "files",
]);

useShellStore.setState({
  bottomDockOpen: false,
  bottomDockTabs: [{ id: "dock-files", kind: "files" }],
});
useShellStore.getState().setDockOpen("bottom", true);
assert.deepEqual(useShellStore.getState().bottomDockTabs.map((tab) => tab.kind), [
  "files",
  "jobs",
]);

useShellStore.setState({
  projectRoots: ["/tmp/live-project", "/tmp/missing-project"],
  pinnedProjectRoots: ["/tmp/live-project", "/tmp/missing-project"],
  projectNameOverrides: {
    "/tmp/live-project": "Live Project",
    "/tmp/live-project/results": "Result Folder",
    "/tmp/missing-project": "Missing Project",
    "/tmp/missing-project/results": "Missing Result Folder",
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
assert.deepEqual(pruned.projectNameOverrides, {
  "/tmp/live-project": "Live Project",
  "/tmp/live-project/results": "Result Folder",
});
assert.deepEqual(pruned.expandedProjectIds, ["project:/tmp/live-project", "loose-files"]);
assert.deepEqual(pruned.pinnedStructurePaths, ["/tmp/live-project/mini.pdb"]);

useShellStore.getState().addProjectRoot("/tmp/added-project");

const addedProject = useShellStore.getState();
assert.deepEqual(addedProject.projectRoots, ["/tmp/live-project", "/tmp/added-project"]);
assert.deepEqual(addedProject.expandedProjectIds, ["project:/tmp/live-project", "loose-files"]);

useShellStore.getState().renameProjectRoot("/tmp/implicit-project", "Implicit Project");

const renamedImplicit = useShellStore.getState();
assert.deepEqual(renamedImplicit.projectRoots, ["/tmp/live-project", "/tmp/added-project", "/tmp/implicit-project"]);
assert.deepEqual(renamedImplicit.projectNameOverrides, {
  "/tmp/live-project": "Live Project",
  "/tmp/live-project/results": "Result Folder",
  "/tmp/implicit-project": "Implicit Project",
});
assert.deepEqual(renamedImplicit.expandedProjectIds, [
  "project:/tmp/live-project",
  "loose-files",
]);

useShellStore.getState().renameProjectFolder("/tmp/live-project/results", "Docking Results");
useShellStore.getState().renameProjectFolder("/tmp/outside/results", "Ignored");

const renamedFolder = useShellStore.getState();
assert.deepEqual(renamedFolder.projectRoots, ["/tmp/live-project", "/tmp/added-project", "/tmp/implicit-project"]);
assert.deepEqual(renamedFolder.projectNameOverrides, {
  "/tmp/live-project": "Live Project",
  "/tmp/live-project/results": "Docking Results",
  "/tmp/implicit-project": "Implicit Project",
});

useShellStore.getState().renameProjectFolder("/tmp/live-project/results", "");

assert.deepEqual(useShellStore.getState().projectNameOverrides, {
  "/tmp/live-project": "Live Project",
  "/tmp/implicit-project": "Implicit Project",
});

useShellStore.setState({ dockDroppedStructures: [] });
useShellStore.getState().addDockDrop({
  area: "bottom",
  tabKind: "jobs",
  payload: {
    paths: ["/tmp/mini.pdb"],
    records: [],
    items: [{ kind: "file", title: "mini.pdb", path: "/tmp/mini.pdb" }],
  },
});
assert.deepEqual(useShellStore.getState().dockDroppedStructures.map((item) => item.title), ["mini.pdb"]);

console.log("shell store behavior tests passed");
