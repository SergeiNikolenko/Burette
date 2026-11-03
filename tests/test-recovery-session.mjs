import assert from "node:assert/strict";

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
globalThis.window = { localStorage, location: { search: "", protocol: "file:", hostname: "" } };
const { useMoleculeStore, getMoleculeSessionSnapshot } = await import("../apps/desktop/src/stores/molecule-store.ts");

const source = {
  id: "protein", path: "/data/protein.pdb", title: "protein.pdb", extension: "pdb",
  renderer: "molstar", runtimePath: "/runtime/viewer.html", byteCount: 128,
  recoveryPath: "/private/popout-scenes/00000000-0000-0000-0000-000000000001.molx",
};
useMoleculeStore.getState().addDocuments([source]);
const initial = useMoleculeStore.getState();
const tabId = initial.activeTabId;
assert.deepEqual(initial.tabs.find(tab => tab.id === tabId).location, {
  kind: "file", documentId: source.id, path: source.path, recoveryPath: source.recoveryPath,
});
const snapshot = getMoleculeSessionSnapshot(initial);
useMoleculeStore.getState().restoreSession(snapshot.tabs, snapshot.activeIndex);
assert.equal(useMoleculeStore.getState().tabs.find(tab => tab.id === tabId).location.recoveryPath, source.recoveryPath);
await useMoleculeStore.persist.rehydrate();
assert.equal(useMoleculeStore.getState().tabs.find(tab => tab.id === tabId).location.recoveryPath, source.recoveryPath);

// Adopting a newer checkpoint keeps one logical document and the same tab.
const next = { ...source, recoveryPath: source.recoveryPath.replace(/1\.molx$/, "2.molx") };
useMoleculeStore.getState().addDocuments([next]);
assert.equal(useMoleculeStore.getState().documents.length, 1);
assert.equal(useMoleculeStore.getState().activeTabId, tabId);
assert.equal(useMoleculeStore.getState().tabs.find(tab => tab.id === tabId).location.recoveryPath, next.recoveryPath);

// A source saved and reopened without recovery metadata retires the old snapshot.
const { recoveryPath, ...saved } = source;
useMoleculeStore.getState().replaceDocument(source.id, saved);
assert.equal(useMoleculeStore.getState().tabs.find(tab => tab.id === tabId).location.recoveryPath, undefined);
assert.equal(useMoleculeStore.getState().documents[0].path, source.path);
console.log("Recovery session identity passed");
