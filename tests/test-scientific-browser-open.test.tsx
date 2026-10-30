import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { IDBFactory, forceCloseDatabase } from "fake-indexeddb";
import { gzipSync } from "node:zlib";
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
const molden = readFileSync(new URL("./fixtures/quantum/dispatcher/hydrogen.molden", import.meta.url), "utf8");
function deferred<T = void>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
async function fixture() {
  const original = useMoleculeStore.getState().documents, ordinary: string[] = [], errors: unknown[] = [];
  let api!: ReturnType<typeof useAppFileOpen>;
  const store = useMoleculeStore.getState(), noop = () => {};
  const options: Parameters<typeof useAppFileOpen>[0] = { ...store, preferences: { ...defaultPreferences, rendererMode: "molstar" },
    addProjectRoot: noop, detectContentSpectrumPaths, expandStructureBundles: async paths => paths,
    openDockTab: noop, openDocumentTab: path => { ordinary.push(path); }, openFepNetworkTab: noop,
    pushErrorStatus: error => { errors.push(error); }, pushStatus: noop, rememberRecentStructures: noop,
    setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop,
  };
  function Probe() { api = useAppFileOpen(options); return null; }
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement); await act(async () => root.render(<Probe />));
  return { api, ordinary, errors, async close() {
    pauseAfterPrepare = null;
    for (const document of useMoleculeStore.getState().documents) if (!original.includes(document)) documents.deleteBrowserDevVirtualTextDocument(document.path);
    useMoleculeStore.getState().setDocuments(original); releaseClosedImports(new Set(original.map(document => document.id)));
    await act(async () => root.unmount()); host.remove();
  } };
}

test("ordinary openPaths reparses a durable compressed Original and reopening preserves the live source", async () => {
  const raw = gzipSync("\ufeff" + molden.replaceAll("\n", "\r\n"));
  const saved = await registerDroppedBrowserFiles([new File([raw], "browser.molden.gz")], 16 * 1024 * 1024, { scientific: true });
  expect(saved.errors).toEqual([]);
  const registered = await readBrowserImport(saved.paths[0]); expect([registered?.kind, registered?.scientific]).toEqual(["compressed", true]);
  const restored = await saveBrowserImport({ path: "/OpenedFiles/fresh.molden.gz", name: "browser.molden.gz", kind: "compressed", scientific: true, file: new Blob([raw]) });
  const path = restored.path; forceCloseDatabase(databases.at(-1)! as unknown as Parameters<typeof forceCloseDatabase>[0]);
  await initializeBrowserImportedFiles(); expect(databases.length).toBeGreaterThan(1);
  expect(webDemoProjectStructures().some(file => file.path === path)).toBe(true);
  expect(documents.readBrowserDevVirtualTextDocument(path)).toBeNull();
  const view = await fixture();
  try {
    await view.api.openPaths([path], { requireSuccess: true });
    const document = useMoleculeStore.getState().documents.find(document => document.path === path)!;
    const text = documents.readBrowserDevVirtualTextDocument(path)!, state = scientificStateFor(document.id, text);
    expect([document.extension, document.renderer, document.virtual]).toEqual(["xyz", "molstar", true]);
    expect(state.revision?.document.orbitals[0].energyHartree).toBe(-.5);
    expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(new Uint8Array(raw));
    const edited = "1\nactive source draft\nH 0.2 0 0\n";
    documents.writeBrowserDevVirtualTextDocument(path, edited);
    await view.api.openPaths([path], { requireSuccess: true });
    expect(useMoleculeStore.getState().documents.filter(item => item.path === path)).toEqual([document]);
    expect(documents.readBrowserDevVirtualTextDocument(path)).toBe(edited);
    expect(importedOriginalFor(document.id)).toBe(state.original);
  } finally { await view.close(); }
});

test("a late prepared source cannot publish after cancellation or alter the next source", async () => {
  const a = await saveBrowserImport({ path: "/OpenedFiles/held.molden", name: "same.molden", kind: "text", file: new Blob([molden]) });
  const b = await saveBrowserImport({ path: "/OpenedFiles/next.molden", name: "same.molden", kind: "text", file: new Blob([molden.replace("Ene= -0.5", "Ene= -0.7")]) });
  const entered = deferred<ViewerDocument>(), release = deferred(); let current = true;
  pauseAfterPrepare = async document => { entered.resolve(document); await release.promise; };
  const view = await fixture();
  try {
    const opening = view.api.openPaths([a.path], { requireSuccess: true, shouldApply: () => current });
    const prepared = await entered.promise; current = false; pauseAfterPrepare = null;
    await view.api.openPaths([b.path], { requireSuccess: true });
    const next = useMoleculeStore.getState().documents.find(document => document.path === b.path)!;
    const before = scientificStateFor(next.id, documents.readBrowserDevVirtualTextDocument(b.path)!);
    release.resolve(); await opening;
    expect(useMoleculeStore.getState().documents.some(document => document.path === a.path)).toBe(false);
    expect(documents.readBrowserDevVirtualTextDocument(prepared.path)).toBeNull();
    expect(scientificStateFor(prepared.id, "").original).toBeNull();
    expect(scientificStateFor(next.id, documents.readBrowserDevVirtualTextDocument(b.path)!)).toEqual(before);
    expect(before.revision?.document.orbitals[0].energyHartree).toBe(-.7);
    expect(await (await readBrowserImport(a.path))!.file.text()).toBe(molden);
  } finally { current = false; release.resolve(); await view.close(); }
});

test("root QCSchema discriminates ordinary JSON; failed recognized inputs never fall back to text", async () => {
  const ordinary = await saveBrowserImport({ path: "/OpenedFiles/settings.json", name: "settings.json", kind: "text", file: new Blob(['{"metadata":{"schema_name":"qcschema_molecule"}}']) });
  const broken = await saveBrowserImport({ path: "/OpenedFiles/broken.fchk", name: "broken.fchk", kind: "text", file: new Blob(["not a checkpoint"]) });
  const view = await fixture();
  try {
    await view.api.openPaths([ordinary.path], { requireSuccess: true }); expect(view.ordinary).toEqual([ordinary.path]);
    await expect(view.api.openPaths([broken.path], { requireSuccess: true })).rejects.toThrow("could not be opened");
    expect(view.ordinary).toEqual([ordinary.path]); expect(useMoleculeStore.getState().documents.some(document => document.path === broken.path)).toBe(false);
    await view.api.openPaths([broken.path], { shouldApply: () => false, requireSuccess: true });
  } finally { await view.close(); }
});

test("explicit server files bypass unavailable local storage while imported paths still report it", async () => {
  await saveBrowserImport({ path: "/OpenedFiles/denied.molden", name: "denied.molden", kind: "text", file: new Blob([molden]) });
  forceCloseDatabase(databases.at(-1)! as unknown as Parameters<typeof forceCloseDatabase>[0]);
  const open = factory.open, fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch")!;
  factory.open = () => { throw new DOMException("Storage denied", "SecurityError"); };
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: async () => new Response('{"setting":1}') });
  const view = await fixture();
  try {
    const path = "https://example.test/settings.json";
    await view.api.openPaths([path], { requireSuccess: true }); expect(view.ordinary).toEqual([path]);
    await expect(view.api.openPaths(["/OpenedFiles/held.molden"], { requireSuccess: true })).rejects.toThrow("Storage denied");
  } finally { factory.open = open; Object.defineProperty(globalThis, "fetch", fetchDescriptor); await view.close(); }
});

test("independent: an earlier pending open cannot overwrite a later same-path live source", async () => {
  const saved = await saveBrowserImport({ path: "/OpenedFiles/concurrent.molden", name: "same.molden", kind: "text", file: new Blob([molden]) });
  const entered = deferred<ViewerDocument>(), release = deferred();
  pauseAfterPrepare = async document => { entered.resolve(document); await release.promise; };
  const view = await fixture();
  try {
    const first = view.api.openPaths([saved.path], { requireSuccess: true });
    await entered.promise; pauseAfterPrepare = null;
    await view.api.openPaths([saved.path], { requireSuccess: true });
    const current = useMoleculeStore.getState().documents.find(document => document.path === saved.path)!;
    const edited = "1\nuser source changed after second open\nH 0.2 0 0\n";
    documents.writeBrowserDevVirtualTextDocument(saved.path, edited);
    release.resolve(); await first;
    expect({ currentId: useMoleculeStore.getState().documents.find(document => document.path === saved.path)?.id, text: documents.readBrowserDevVirtualTextDocument(saved.path) }).toEqual({ currentId: current.id, text: edited });
  } finally { release.resolve(); await view.close(); }
});


test("a superseded null owner cannot revive after the newer document closes; a fresh reopen still works", async () => {
  const saved = await saveBrowserImport({ path: "/OpenedFiles/aba.molden", name: "same.molden", kind: "text", file: new Blob([molden]) });
  const entered = deferred<ViewerDocument>(), release = deferred();
  pauseAfterPrepare = async document => { entered.resolve(document); await release.promise; };
  const view = await fixture();
  try {
    const first = view.api.openPaths([saved.path], { requireSuccess: true });
    const prepared = await entered.promise; pauseAfterPrepare = null;
    await view.api.openPaths([saved.path], { requireSuccess: true });
    const newer = useMoleculeStore.getState().documents.find(document => document.path === saved.path)!;
    useMoleculeStore.getState().closeDocument(newer.id);
    documents.deleteBrowserDevVirtualTextDocument(saved.path);
    releaseClosedImports(new Set(useMoleculeStore.getState().documents.map(document => document.id)));
    release.resolve(); await expect(first).rejects.toThrow("could not be opened");
    expect(useMoleculeStore.getState().documents.some(document => document.path === saved.path)).toBe(false);
    expect(documents.readBrowserDevVirtualTextDocument(saved.path)).toBeNull();
    expect(documents.readBrowserDevVirtualTextDocument(prepared.path)).toBeNull();
    expect(importedOriginalFor(prepared.id)).toBeNull();
    await view.api.openPaths([saved.path], { requireSuccess: true });
    const reopened = useMoleculeStore.getState().documents.find(document => document.path === saved.path)!;
    expect(reopened.id).not.toBe(newer.id);
    expect(await importedOriginalFor(reopened.id)!.file.text()).toBe(molden);
  } finally { release.resolve(); await view.close(); }
});

test("successful preparation transfers its host text to the durable owner and releases only its temporary cache", async () => {
  const saved = await saveBrowserImport({ path: "/OpenedFiles/transferred.molden", name: "same.molden", kind: "text", file: new Blob([molden]) });
  let prepared: ViewerDocument | null = null;
  pauseAfterPrepare = async document => { prepared = document; };
  const view = await fixture();
  try {
    await view.api.openPaths([saved.path], { requireSuccess: true });
    const current = useMoleculeStore.getState().documents.find(document => document.path === saved.path)!;
    expect(prepared).not.toBeNull();
    expect(documents.readBrowserDevVirtualTextDocument(prepared!.path)).toBeNull();
    expect(scientificStateFor(current.id, documents.readBrowserDevVirtualTextDocument(saved.path)!).revision?.document.orbitals[0].energyHartree).toBe(-.5);
    expect(await importedOriginalFor(current.id)!.file.text()).toBe(molden);
  } finally { await view.close(); }
});


test("independent paths may finish out of order while a background open preserves the user's active tab", async () => {
  const a = await saveBrowserImport({ path: "/OpenedFiles/parallel-a.molden", name: "same.molden", kind: "text", file: new Blob([molden]) });
  const b = await saveBrowserImport({ path: "/OpenedFiles/parallel-b.molden", name: "same.molden", kind: "text", file: new Blob([molden.replace("Ene= -0.5", "Ene= -0.7")]) });
  const entered = deferred<ViewerDocument>(), release = deferred();
  pauseAfterPrepare = async document => { entered.resolve(document); await release.promise; };
  const view = await fixture();
  try {
    const first = view.api.openPaths([a.path], { requireSuccess: true, preserveActiveTab: true });
    await entered.promise; pauseAfterPrepare = null;
    await view.api.openPaths([b.path], { requireSuccess: true });
    const next = useMoleculeStore.getState().documents.find(document => document.path === b.path)!;
    release.resolve(); await first;
    const opened = useMoleculeStore.getState().documents.find(document => document.path === a.path)!;
    expect(useMoleculeStore.getState().activeDocumentId).toBe(next.id);
    expect([scientificStateFor(opened.id, documents.readBrowserDevVirtualTextDocument(a.path)!).revision?.document.orbitals[0].energyHartree,
      scientificStateFor(next.id, documents.readBrowserDevVirtualTextDocument(b.path)!).revision?.document.orbitals[0].energyHartree]).toEqual([-.5, -.7]);
    expect([await importedOriginalFor(opened.id)!.file.text(), await importedOriginalFor(next.id)!.file.text()]).toEqual([molden, molden.replace("Ene= -0.5", "Ene= -0.7")]);
  } finally { release.resolve(); await view.close(); }
});
