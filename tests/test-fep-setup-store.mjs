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
globalThis.window = {
  localStorage: globalThis.localStorage,
  location: {
    search: "",
    protocol: "file:",
    hostname: "",
  },
};

const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store.ts");

const dockingDocument = {
  id: "docking-doc",
  path: "burrete-docking://poses",
  title: "Docking poses",
  extension: "html",
  renderer: "molstar",
  runtimePath: "<html></html>",
  byteCount: 0,
  virtual: true,
  dockingRequest: {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/poses.sdf"],
  },
};

const gridDocument = {
  id: "grid-doc",
  path: "/tmp/poses.sdf",
  title: "poses.sdf",
  extension: "sdf",
  renderer: "grid2d",
  runtimePath: "<html></html>",
  byteCount: 256,
};

useMoleculeStore.setState({
  documents: [dockingDocument, gridDocument],
  tabs: [{ id: "tab-1", location: { kind: "launcher" }, back: [], forward: [] }],
  activeTabId: "tab-1",
  activeDocumentId: null,
  recentStructures: [],
});

const candidatePayload = {
  paths: ["/tmp/analogs.sdf"],
  records: [{ path: "inline-ligand.smi", inputExtension: "smi", text: "CCO ethanol\n" }],
};

useMoleculeStore.getState().openFepSetupTab({
  kind: "fep-setup",
  receptorPath: "/tmp/receptor.pdb",
  gridDocumentId: gridDocument.id,
  gridPath: gridDocument.path,
  dockingDocumentId: dockingDocument.id,
  dockingPath: dockingDocument.path,
  referencePose: 2,
  candidatePayload,
});

const opened = useMoleculeStore.getState();
assert.equal(opened.tabs.length, 1);
assert.equal(opened.tabs[0].location.kind, "fep-setup");
assert.deepEqual(opened.tabs[0].location.candidatePayload, candidatePayload);
assert.equal(opened.activeTabId, opened.tabs[0].id);
assert.equal(opened.activeDocumentId, dockingDocument.id);

useMoleculeStore.getState().openFepSetupTab({
  kind: "fep-setup",
  receptorPath: "/tmp/receptor.pdb",
  gridDocumentId: gridDocument.id,
  gridPath: gridDocument.path,
  dockingDocumentId: dockingDocument.id,
  dockingPath: dockingDocument.path,
  referencePose: 4,
  candidatePayload: { paths: ["/tmp/series-b.sdf"], records: [] },
});

const reused = useMoleculeStore.getState();
assert.equal(reused.tabs.length, 1);
assert.equal(reused.tabs[0].location.referencePose, 4);
assert.deepEqual(reused.tabs[0].location.candidatePayload, { paths: ["/tmp/series-b.sdf"], records: [] });
assert.equal(reused.activeDocumentId, dockingDocument.id);

console.log("fep setup store tests passed");
