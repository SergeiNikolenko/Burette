import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
globalThis.window = { localStorage: globalThis.localStorage, location: { search: "", protocol: "file:", hostname: "" } };
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store.ts");
const documents = ["a", "b", "c"].map(id => ({ id, path: `/${id}.sdf`, title: id, renderer: "grid2d", runtimePath: "", extension: "sdf", byteCount: 1 }));
useMoleculeStore.getState().setDocuments(documents);
useMoleculeStore.getState().setActiveDocument("a");
const a = useMoleculeStore.getState().activeTabId;
useMoleculeStore.getState().openSettingsTab();
useMoleculeStore.getState().openSettingsSection("appearance");
useMoleculeStore.getState().activateLastNonSettingsTab();
assert.equal(useMoleculeStore.getState().activeTabId, a, "Settings Back returns to the document before Settings, not the rightmost tab");
useMoleculeStore.getState().setActiveDocument("b");
const b = useMoleculeStore.getState().activeTabId;
const settings = useMoleculeStore.getState().tabs.find(tab => tab.location.kind === "settings");
useMoleculeStore.getState().setActiveTab(settings.id);
useMoleculeStore.getState().activateLastNonSettingsTab();
assert.equal(useMoleculeStore.getState().activeTabId, b, "activating an existing Settings tab also records the return target");
useMoleculeStore.getState().openSettingsSection("general");
useMoleculeStore.getState().closeTab(b);
useMoleculeStore.getState().activateLastNonSettingsTab();
assert.notEqual(useMoleculeStore.getState().activeTabId, b);
assert.notEqual(useMoleculeStore.getState().tabs.find(tab => tab.id === useMoleculeStore.getState().activeTabId)?.location.kind, "settings");
console.log("Settings return-tab checks passed.");
// Exercise the sidebar's actual click binding, so local navigation cannot bypass
// the store's remembered return target.
const { readFileSync } = await import("node:fs");
const sidebar = readFileSync("apps/desktop/src/components/sidebar/settings-sidebar.tsx", "utf8");
const click = sidebar.match(/className="settings-back-button" onClick=\{([^}]+)\}/)?.[1];
assert.ok(click);
const localHandler = sidebar.match(/  const handleBackToApp = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
useMoleculeStore.getState().setActiveDocument("a");
useMoleculeStore.getState().openSettingsTab();
const clickBack = new Function("state", "actions", `${localHandler}\nreturn ${click};`)(useMoleculeStore.getState(), {
  backToApp: useMoleculeStore.getState().activateLastNonSettingsTab,
  selectTab: useMoleculeStore.getState().setActiveTab,
  openNewTab: useMoleculeStore.getState().openNewTab,
});
clickBack();
assert.equal(useMoleculeStore.getState().activeTabId, a, "the visible Settings Back button uses the remembered return target");
console.log("Settings sidebar Back binding checks passed.");
