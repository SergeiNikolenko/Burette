import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { IDBFactory, forceCloseDatabase } from "fake-indexeddb";

import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";

const factory = new IDBFactory(), databases: IDBDatabase[] = [];
const openDatabase = factory.open.bind(factory);
factory.open = (...args: Parameters<typeof factory.open>) => {
  const request = openDatabase(...args); request.addEventListener("success", () => { databases.push(request.result); }); return request;
};
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, Event: browser.Event,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  localStorage: browser.localStorage, indexedDB: factory, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const documents = await import("../apps/desktop/src/lib/browser-dev-documents");
const prepareTextDocument = documents.openBrowserDevTextDocument;
let pauseAfterPrepare: ((document: ViewerDocument) => Promise<void>) | null = null;
// Hold the real adapter's completed preparation, never its parser or generated document.
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...documents,
  openBrowserDevTextDocument: async (...args: Parameters<typeof documents.openBrowserDevTextDocument>) => {
    const document = await prepareTextDocument(...args); await pauseAfterPrepare?.(document); return document;
  },
}));
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { detectContentSpectrumPaths } = await import("../apps/desktop/src/lib/content-spectrum-detection");
const { saveBrowserImport, readBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
const { initializeBrowserImportedFiles, registerDroppedBrowserFiles, webDemoProjectStructures } = await import("../apps/desktop/src/lib/web-demo-workspace");
const { scientificStateFor, importedOriginalFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");

function deferred<T = void>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
const { useAppStartupEffects } = await import("../apps/desktop/src/hooks/use-app-startup-effects");
const { useTabWorkspaceStore } = await import("../apps/desktop/src/stores/tab-workspace-store");
const { workspaceStorage, isBrowserSessionWorkspace } = await import("../apps/desktop/src/lib/window-scope");
async function fixture(restore = false) {
  const original = useMoleculeStore.getState().documents, ordinary: string[] = [], errors: unknown[] = [];
  let api!: ReturnType<typeof useAppFileOpen>;
  const store = useMoleculeStore.getState(), noop = () => {};
  const options: Parameters<typeof useAppFileOpen>[0] = { ...store, preferences: { ...defaultPreferences, rendererMode: "molstar" },
    addProjectRoot: noop, detectContentSpectrumPaths, expandStructureBundles: async paths => paths,
    openDockTab: noop, openDocumentTab: path => { ordinary.push(path); }, openFepNetworkTab: noop,
    pushErrorStatus: error => { errors.push(error); }, pushStatus: noop, rememberRecentStructures: noop,
    setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop,
  };
  function Probe() { api = useAppFileOpen(options); if (restore) useAppStartupEffects({ ...store, activeDocument: null, browserDevExplicitFolders: [], addProjectRoot: noop, setExpandedProjectIds: noop, setWorkspacePath: noop, openPaths: api.openPaths, openDocuments: api.openDocuments, openDockingDocument: async () => null, pushErrorStatus: options.pushErrorStatus }); return null; }
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement); await act(async () => root.render(<Probe />));
  return { api, ordinary, errors, async close() {
    pauseAfterPrepare = null;
    for (const document of useMoleculeStore.getState().documents) if (!original.includes(document)) documents.deleteBrowserDevVirtualTextDocument(document.path);
    useMoleculeStore.getState().setDocuments(original); releaseClosedImports(new Set(original.map(document => document.id)));
    await act(async () => root.unmount()); host.remove();
  } };
}

const bytes = readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url));
async function settle(check: () => boolean) {
  for (let n = 0; n < 100 && !check(); n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(check()).toBe(true);
}
const storeKey = "burette.molecule.session";
function releasePage() {
  for (const doc of useMoleculeStore.getState().documents) documents.deleteBrowserDevVirtualTextDocument(doc.path);
  releaseClosedImports(new Set());
  useMoleculeStore.setState({ documents: [], textDocuments: [], tabs: [], activeTabId: null, activeDocumentId: null });
}

test("same browser tab reload reopens its committed FCHK with modes, exact Original and retained dock/tab history", async () => {
  const saved = await registerDroppedBrowserFiles([new File([bytes], "reload-water.fchk")], 16 * 1024 * 1024);
  const view = await fixture();
  await act(async () => { await view.api.openPaths(saved.paths); });
  const before = useMoleculeStore.getState(), doc = before.documents[0], tabId = before.activeTabId!;
  useTabWorkspaceStore.getState().openDockTab(tabId, "right", "vibrations");
  const source = documents.readBrowserDevVirtualTextDocument(doc.path)!;
  expect(scientificStateFor(doc.id, source).revision?.document.modes).toHaveLength(3);
  const persisted = browser.sessionStorage.getItem(storeKey)!;
  const docks = browser.sessionStorage.getItem("burette.tab-workspaces")!;
  expect(JSON.parse(persisted).state.documents).toEqual([]);
  await view.close(); releasePage();
  browser.sessionStorage.setItem(storeKey, persisted);
  await useMoleculeStore.persist.rehydrate();
  browser.sessionStorage.setItem("burette.tab-workspaces", docks);
  await useTabWorkspaceStore.persist.rehydrate();
  const restored = await fixture(true);
  try {
    await settle(() => useMoleculeStore.getState().documents.length === 1);
    const after = useMoleculeStore.getState(), reopened = after.documents[0];
    const text = documents.readBrowserDevVirtualTextDocument(reopened.path)!;
    expect([after.activeTabId, after.tabs[0].id, reopened.path]).toEqual([tabId, tabId, doc.path]);
    expect(after.tabs[0].back).toEqual(before.tabs[0].back);
    expect(reopened.id).not.toBe(doc.id);
    expect(scientificStateFor(reopened.id, text).revision?.document.modes).toHaveLength(3);
    expect(new Uint8Array(await importedOriginalFor(reopened.id)!.file.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(useTabWorkspaceStore.getState().workspaces[tabId].right.activeTab).toBe("vibrations");
    expect(restored.errors).toEqual([]);
  } finally { await restored.close(); }
});

test("browser session isolation preserves global/native/MCP storage and explicit devFiles policy", async () => {
  expect(workspaceStorage()).toBe(browser.sessionStorage);
  const fresh = new Window({url:"http://localhost/"});
  expect(fresh.sessionStorage.getItem(storeKey)).toBeNull(); await fresh.happyDOM.close();
  browser.happyDOM.setURL("http://localhost/?devFiles=/private/secret.fchk");
  expect(isBrowserSessionWorkspace()).toBe(false);
  browser.happyDOM.setURL("http://localhost/?mcpWidget=1");
  expect(workspaceStorage()).toBe(browser.localStorage);
  browser.happyDOM.setURL("http://localhost/");
  Object.assign(browser, { BuretteMcpWorkspace: { storage: browser.localStorage, sessionId: "isolated-test" } });
  expect(workspaceStorage()).toBe(browser.localStorage); Reflect.deleteProperty(browser, "BuretteMcpWorkspace");
  Object.assign(browser, {__TAURI_INTERNALS__: {}});
  expect(workspaceStorage()).toBe(browser.localStorage); Reflect.deleteProperty(browser,"__TAURI_INTERNALS__");
});

test("missing or arbitrary persisted paths never become filesystem open authority", async () => {
  releasePage();
  useMoleculeStore.setState({ tabs: [{id:"missing",location:{kind:"file",path:"/private/not-imported.fchk",documentId:"stale"},back:[],forward:[]}],activeTabId:"missing" });
  const view=await fixture(true);
  try { await settle(()=>useMoleculeStore.getState().tabs.every(tab=>tab.id!=="missing"));
    expect([useMoleculeStore.getState().documents,view.ordinary,view.errors]).toEqual([[],[],[]]);
  } finally {await view.close();}
});

test("closing a restored tab while real scientific preparation is pending rejects its publication", async () => {
  const saved = await registerDroppedBrowserFiles([new File([bytes], "pending-water.fchk")], 16 * 1024 * 1024);
  releasePage();
  useMoleculeStore.setState({tabs:[{id:"pending",location:{kind:"file",path:saved.paths[0],documentId:"old"},back:[],forward:[]}],activeTabId:"pending"});
  const entered=deferred(), gate=deferred();pauseAfterPrepare=async()=>{entered.resolve();await gate.promise;};
  const view=await fixture(true); await entered.promise;
  await act(async()=>{useMoleculeStore.getState().closeAllDocuments();gate.resolve();});
  try {await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
    expect(useMoleculeStore.getState().documents).toEqual([]);
    expect(documents.readBrowserDevVirtualTextDocument(saved.paths[0])).toBe(bytes.toString());
    expect(view.errors).toEqual([]);
  } finally {await view.close();}
});
