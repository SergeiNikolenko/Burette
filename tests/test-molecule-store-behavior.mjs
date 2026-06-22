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

function document(id, path, title = path.split("/").at(-1) ?? id, renderer = "molstar") {
  return {
    id,
    path,
    title,
    extension: path.split(".").at(-1) ?? "pdb",
    renderer,
    runtimePath: "<html></html>",
    byteCount: 128,
  };
}

function resetStore() {
  storage.clear();
  useMoleculeStore.setState({
    documents: [],
    textDocuments: [],
    tabs: [{ id: "tab-1", location: { kind: "launcher" }, back: [], forward: [] }],
    activeTabId: "tab-1",
    activeDocumentId: null,
    recentStructures: [],
  });
}

resetStore();
useMoleculeStore.setState({
  documents: [document("old-doc", "/tmp/mini.pdb")],
  tabs: [{
    id: "tab-file",
    location: { kind: "file", documentId: "old-doc", path: "/tmp/mini.pdb" },
    back: [],
    forward: [],
  }],
  activeTabId: "tab-file",
  activeDocumentId: "old-doc",
});

useMoleculeStore.getState().addDocuments([document("new-doc", "/tmp/mini.pdb", "updated.pdb")]);

const updated = useMoleculeStore.getState();
assert.equal(updated.documents.length, 1);
assert.equal(updated.documents[0].id, "new-doc");
assert.equal(updated.tabs.length, 1);
assert.equal(updated.tabs[0].id, "tab-file");
assert.deepEqual(updated.tabs[0].location, {
  kind: "file",
  documentId: "new-doc",
  path: "/tmp/mini.pdb",
});
assert.equal(updated.activeTabId, "tab-file");
assert.equal(updated.activeDocumentId, "new-doc");

resetStore();
useMoleculeStore.setState({
  documents: [document("molstar-doc", "/tmp/mini.pdb", "mini.pdb", "molstar")],
  tabs: [{
    id: "tab-file",
    location: { kind: "file", documentId: "molstar-doc", path: "/tmp/mini.pdb" },
    back: [],
    forward: [],
  }],
  activeTabId: "tab-file",
  activeDocumentId: "molstar-doc",
});

useMoleculeStore.getState().addBackgroundDocuments([
  document("dock:bottom:/tmp/mini.pdb", "/tmp/mini.pdb", "mini.pdb", "xyzrender-external"),
]);

const withDockDocument = useMoleculeStore.getState();
assert.equal(withDockDocument.documents.length, 2);
assert.equal(withDockDocument.documents.find((item) => item.id === "molstar-doc")?.renderer, "molstar");
assert.equal(withDockDocument.documents.find((item) => item.id === "dock:bottom:/tmp/mini.pdb")?.renderer, "xyzrender-external");
assert.equal(withDockDocument.activeDocumentId, "molstar-doc");

resetStore();
useMoleculeStore.setState({
  documents: [],
  tabs: [{
    id: "tab-settings",
    location: { kind: "settings" },
    back: [],
    forward: [{ kind: "launcher" }],
  }],
  activeTabId: "tab-settings",
  activeDocumentId: null,
});

useMoleculeStore.getState().openDocumentsInActiveTab([document("opened-doc", "/tmp/opened.cif")]);

const opened = useMoleculeStore.getState();
assert.equal(opened.tabs.length, 1);
assert.equal(opened.tabs[0].id, "tab-settings");
assert.deepEqual(opened.tabs[0].location, {
  kind: "file",
  documentId: "opened-doc",
  path: "/tmp/opened.cif",
});
assert.deepEqual(opened.tabs[0].back, [{ kind: "settings" }]);
assert.deepEqual(opened.tabs[0].forward, []);
assert.equal(opened.activeDocumentId, "opened-doc");

resetStore();
useMoleculeStore.getState().restoreSession(
  [
    { location: { kind: "ketcher" }, back: [], forward: [] },
    { location: { kind: "settings" }, back: [], forward: [] },
    { location: { kind: "ketcher", draftMolfile: "mol" }, back: [], forward: [] },
  ],
  2,
);

const restored = useMoleculeStore.getState();
assert.equal(restored.tabs.filter((tab) => tab.location.kind === "ketcher").length, 1);
assert.equal(restored.tabs.length, 2);
assert.equal(restored.tabs.find((tab) => tab.id === restored.activeTabId)?.location.kind, "ketcher");
assert.equal(restored.activeDocumentId, null);

resetStore();
useMoleculeStore.setState({
  documents: [document("stored-doc", "/tmp/stored.pdb")],
  tabs: [
    {
      id: "tab-file",
      location: { kind: "file", documentId: "stored-doc", path: "/tmp/stored.pdb" },
      back: [],
      forward: [],
    },
    { id: "tab-settings", location: { kind: "settings" }, back: [], forward: [] },
    { id: "tab-ketcher", location: { kind: "ketcher" }, back: [], forward: [] },
  ],
  activeTabId: "tab-file",
  activeDocumentId: "stored-doc",
  recentStructures: [],
});

const persisted = JSON.parse(storage.get("burrete.molecule.session"));
assert.deepEqual(persisted.state.documents, []);
assert.equal(persisted.state.tabs.some((tab) => tab.location.kind === "file"), false);
assert.equal(persisted.state.tabs.some((tab) => tab.location.kind === "settings"), false);
assert.equal(persisted.state.tabs.some((tab) => tab.location.kind === "ketcher"), true);

resetStore();
storage.set("burrete.molecule.session", JSON.stringify({
  state: {
    documents: [],
    tabs: [
      {
        id: "legacy-file",
        location: { kind: "file", documentId: "legacy-doc", path: "/tmp/legacy.pdb" },
        back: [],
        forward: [],
      },
      { id: "legacy-settings", location: { kind: "settings" }, back: [], forward: [] },
      { id: "legacy-ketcher", location: { kind: "ketcher" }, back: [], forward: [] },
    ],
    activeTabId: "legacy-settings",
    recentStructures: [],
  },
  version: 0,
}));
await useMoleculeStore.persist.rehydrate();

const rehydrated = useMoleculeStore.getState();
assert.equal(rehydrated.documents.length, 0);
assert.equal(rehydrated.tabs.some((tab) => tab.location.kind === "file"), true);
assert.equal(rehydrated.tabs.some((tab) => tab.location.kind === "settings"), false);
assert.equal(rehydrated.tabs.some((tab) => tab.location.kind === "ketcher"), true);
assert.equal(rehydrated.tabs.find((tab) => tab.id === rehydrated.activeTabId)?.location.kind, "file");
assert.equal(rehydrated.activeDocumentId, null);

resetStore();
const manyDocuments = Array.from({ length: 14 }, (_, index) => (
  document(`recent-${index}`, `/tmp/project/file-${String(index).padStart(2, "0")}.pdb`)
));
useMoleculeStore.getState().rememberRecentStructures(manyDocuments);

const recent = useMoleculeStore.getState().recentStructures;
assert.equal(recent.length, manyDocuments.length);
assert.deepEqual(
  recent.map((structure) => structure.path).sort(),
  manyDocuments.map((structure) => structure.path).sort(),
);

useMoleculeStore.getState().pruneRecentStructures([
  "/tmp/project/file-00.pdb",
  "/tmp/project/file-03.pdb",
]);
const prunedRecent = useMoleculeStore.getState().recentStructures;
assert.deepEqual(
  prunedRecent.map((structure) => structure.path).sort(),
  [
    "/tmp/project/file-00.pdb",
    "/tmp/project/file-03.pdb",
  ],
);

console.log("molecule store behavior tests passed");
