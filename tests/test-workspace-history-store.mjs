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

const {
  getMoleculeStoreSnapshot,
  useMoleculeStore,
} = await import("../apps/desktop/src/stores/molecule-store.ts");
const {
  defaultPreferences,
  useSettingsStore,
} = await import("../apps/desktop/src/stores/settings-store.ts");
const {
  getShellStoreSnapshot,
  useShellStore,
} = await import("../apps/desktop/src/stores/shell-store.ts");
const {
  configureWorkspaceHistoryExtras,
  useWorkspaceHistoryStore,
} = await import("../apps/desktop/src/stores/workspace-history-store.ts");
const {
  createWorkspaceHistoryShellActions,
} = await import("../apps/desktop/src/hooks/use-app-shell-actions.ts");

const initialShell = getShellStoreSnapshot();

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

function resetStores() {
  storage.clear();
  useMoleculeStore.setState({
    documents: [],
    textDocuments: [],
    tabs: [{ id: "tab-1", location: { kind: "launcher" }, back: [], forward: [] }],
    activeTabId: "tab-1",
    activeDocumentId: null,
    recentStructures: [],
  });
  useShellStore.getState().restoreSnapshot(initialShell);
  useSettingsStore.getState().restoreSnapshot({ preferences: defaultPreferences });
  configureWorkspaceHistoryExtras({});
  useWorkspaceHistoryStore.getState().clearWorkspaceHistory();
}

resetStores();
useWorkspaceHistoryStore.getState().withWorkspaceHistory("Open document", "documents", () => {
  useMoleculeStore.getState().addDocuments([document("doc-1", "/tmp/one.pdb")]);
});
assert.equal(useWorkspaceHistoryStore.getState().undoStack.length, 1);
assert.equal(useMoleculeStore.getState().activeDocumentId, "doc-1");
assert.equal(useWorkspaceHistoryStore.getState().undoWorkspaceAction(), true);
assert.equal(useMoleculeStore.getState().documents.length, 0);
assert.equal(useMoleculeStore.getState().tabs[0].location.kind, "launcher");
assert.equal(useWorkspaceHistoryStore.getState().redoWorkspaceAction(), true);
assert.equal(useMoleculeStore.getState().activeDocumentId, "doc-1");

resetStores();
useMoleculeStore.getState().addDocuments([document("doc-2", "/tmp/two.pdb")]);
useWorkspaceHistoryStore.getState().withWorkspaceHistory("Close document", "documents", () => {
  useMoleculeStore.getState().closeActiveDocument();
});
assert.equal(useMoleculeStore.getState().documents.length, 0);
assert.equal(useWorkspaceHistoryStore.getState().undoWorkspaceAction(), true);
assert.equal(useMoleculeStore.getState().activeDocumentId, "doc-2");

resetStores();
useWorkspaceHistoryStore.getState().withWorkspaceHistory("Change renderer", "settings", () => {
  useSettingsStore.getState().setPreference("rendererMode", "molstar");
});
assert.equal(useSettingsStore.getState().preferences.rendererMode, "molstar");
assert.equal(useWorkspaceHistoryStore.getState().undoWorkspaceAction(), true);
assert.equal(useSettingsStore.getState().preferences.rendererMode, defaultPreferences.rendererMode);
assert.equal(useWorkspaceHistoryStore.getState().redoWorkspaceAction(), true);
assert.equal(useSettingsStore.getState().preferences.rendererMode, "molstar");

resetStores();
useWorkspaceHistoryStore.getState().beginHistoryGroup("Resize sidebar", "layout");
useShellStore.getState().setSidebarWidth(300);
useShellStore.getState().setSidebarWidth(320);
useWorkspaceHistoryStore.getState().commitHistoryGroup();
assert.equal(useWorkspaceHistoryStore.getState().undoStack.length, 1);
assert.equal(useShellStore.getState().sidebarWidth, 320);
assert.equal(useWorkspaceHistoryStore.getState().undoWorkspaceAction(), true);
assert.equal(useShellStore.getState().sidebarWidth, initialShell.sidebarWidth);

resetStores();
useWorkspaceHistoryStore.getState().withWorkspaceHistory("Open document", "documents", () => {
  useMoleculeStore.getState().addDocuments([document("doc-3", "/tmp/three.pdb")]);
});
assert.equal(useWorkspaceHistoryStore.getState().undoWorkspaceAction(), true);
assert.equal(useWorkspaceHistoryStore.getState().redoStack.length, 1);
useWorkspaceHistoryStore.getState().withWorkspaceHistory("Toggle sidebar", "layout", () => {
  useShellStore.getState().toggleSidebar();
});
assert.equal(useWorkspaceHistoryStore.getState().redoStack.length, 0);

resetStores();
let updatePreference = "stable";
configureWorkspaceHistoryExtras({
  capture: () => ({ updatePreference }),
  restore: (extras) => {
    if (typeof extras.updatePreference === "string") updatePreference = extras.updatePreference;
  },
});
useWorkspaceHistoryStore.getState().withWorkspaceHistory("Change update preference", "settings", () => {
  updatePreference = "beta";
});
assert.equal(updatePreference, "beta");
assert.equal(useWorkspaceHistoryStore.getState().undoWorkspaceAction(), true);
assert.equal(updatePreference, "stable");

resetStores();
const actions = createWorkspaceHistoryShellActions({
  canNavigateBack: false,
  canNavigateForward: false,
  clearCache: () => {
    useShellStore.getState().toggleSidebar();
  },
  navigateBack: () => {},
  navigateForward: () => {},
  openNewTab: () => {
    useMoleculeStore.getState().openNewTab();
  },
  redoWorkspaceAction: () => false,
  undoWorkspaceAction: () => false,
}, {
  canNavigateBack: false,
  canNavigateForward: false,
  canRedoWorkspace: false,
  canUndoWorkspace: false,
});
actions.clearCache();
assert.equal(useWorkspaceHistoryStore.getState().undoStack.length, 0);
actions.openNewTab();
assert.equal(useWorkspaceHistoryStore.getState().undoStack.length, 1);

resetStores();
const asyncActions = createWorkspaceHistoryShellActions({
  canNavigateBack: false,
  canNavigateForward: false,
  chooseFiles: async () => {
    await Promise.resolve();
    useMoleculeStore.getState().addDocuments([document("doc-4", "/tmp/four.pdb")]);
  },
  navigateBack: () => {},
  navigateForward: () => {},
  redoWorkspaceAction: () => false,
  undoWorkspaceAction: () => false,
}, {
  canNavigateBack: false,
  canNavigateForward: false,
  canRedoWorkspace: false,
  canUndoWorkspace: false,
});
await asyncActions.chooseFiles();
assert.equal(useWorkspaceHistoryStore.getState().undoStack.length, 1);
assert.equal(useMoleculeStore.getState().activeDocumentId, "doc-4");
assert.equal(useWorkspaceHistoryStore.getState().undoWorkspaceAction(), true);
assert.equal(useMoleculeStore.getState().documents.length, 0);

resetStores();
useWorkspaceHistoryStore.getState().withWorkspaceHistory("No-op", "layout", () => {});
assert.equal(useWorkspaceHistoryStore.getState().undoStack.length, 0);
assert.deepEqual(getMoleculeStoreSnapshot().documents, []);

console.log("workspace history store tests passed");
