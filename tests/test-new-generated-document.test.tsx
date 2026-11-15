import assert from "node:assert/strict";
import { test, afterAll, mock } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { StructureDragRecord } from "../apps/desktop/src/lib/structure-drag";
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement,
  Node: browser.Node, Event: browser.Event, MutationObserver: browser.MutationObserver, localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} await browser.happyDOM.close(); });
let native = false, prepare: () => Promise<ViewerDocument> = async () => { throw new Error("No prepared document"); };
const transport: { command: string; args: unknown }[] = [];
const tauri = await import("../apps/desktop/src/lib/tauri"), core = await import("@tauri-apps/api/core");
mock.module("../apps/desktop/src/lib/tauri", () => ({ ...tauri, isTauriRuntime: () => native }));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke: async (command: string, args: unknown) => {
  transport.push({ command, args });
  if (command === "open_text_structure") return prepare();
  if (["abort_open_document_claim", "close_opened_source_documents", "grid_close_runtime"].includes(command)) return;
  throw new Error(`Unexpected transport: ${command}`);
} }));
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
type Hook = ReturnType<typeof useAppFileOpen>;
type Options = Parameters<typeof useAppFileOpen>[0];
const record: StructureDragRecord = { path: "one.xyz", inputExtension: "xyz", text: "1\nHe\nHe 0 0 0\n" };
const prepared = (id = "one"): ViewerDocument => ({ id, path: `/cache/${id}.xyz`, runtimePath: `/runtime/${id}`, title: `${id}.xyz`, extension: "xyz", renderer: "molstar", byteCount: 18, openClaimId: `claim-${id}` });
async function fixture(run: (hook: Hook, published: ViewerDocument[][], remembered: ViewerDocument[][]) => Promise<void>) {
  useMoleculeStore.setState({ documents: [] }); native = true; transport.length = 0;
  const published: ViewerDocument[][] = [], remembered: ViewerDocument[][] = []; let hook: Hook | null = null;
  const noop = () => {};
  const options: Options = { preferences: defaultPreferences, addProjectRoot: noop, addBackgroundDocuments: noop, addBackgroundTextDocuments: noop,
    addDocuments: (documents, options) => { published.push(documents); useMoleculeStore.getState().addDocuments(documents, options); }, addTextDocuments: noop, closeDocument: noop,
    detectContentSpectrumPaths: async () => new Set<string>(), expandStructureBundles: async paths => paths, openDockTab: noop, openDocumentsInActiveTab: noop,
    openDocumentTab: noop, openFepNetworkTab: noop, openTextDocumentsInActiveTab: noop, pushErrorStatus: noop, pushStatus: noop,
    rememberRecentStructures: documents => { remembered.push(documents); }, replaceDocument: noop, setActiveDocument: noop, setDockActiveTab: noop,
    setDockDocument: noop, setDockOpen: noop, setDocuments: noop };
  function Probe() { hook = useAppFileOpen(options); return null; }
  const node = browser.document.createElement("div"); browser.document.body.append(node); const root = createRoot(node as unknown as Element);
  await act(async () => root.render(<Probe />));
  try { assert.ok(hook); await run(hook, published, remembered); }
  finally { await act(async () => root.unmount()); node.remove(); native = false; useMoleculeStore.setState({ documents: [] }); }
}

const { openGeneratedStructure } = await import("../apps/desktop/src/lib/workbench/generated-document-open");
const { openBrowserDevTextDocument, readBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");

test("generated new documents retain identical text in independent browser paths and store entries", async () => fixture(async (hook) => {
  native = false;
  let first: ViewerDocument[] = [], second: ViewerDocument[] = [];
  try {
    await act(async () => {
      first = await openGeneratedStructure(hook, "one", "xyz", record.text, () => true, { newDocument: true });
      second = await openGeneratedStructure(hook, "one", "xyz", record.text, () => true, { newDocument: true });
    });
    assert.equal(first.length, 1); assert.equal(second.length, 1);
    assert.notEqual(first[0].path, second[0].path);
    assert.notEqual(first[0].id, second[0].id);
    assert.deepEqual([first[0].title, second[0].title], ["one.xyz", "one.xyz"]);
    assert.deepEqual([readBrowserDevVirtualTextDocument(first[0].path), readBrowserDevVirtualTextDocument(second[0].path)], [record.text, record.text]);
    assert.deepEqual(useMoleculeStore.getState().documents.map(doc => doc.id), [first[0].id, second[0].id]);
    await act(async () => { useMoleculeStore.getState().closeDocument(first[0].id); });
    deleteBrowserDevVirtualTextDocument(first[0].path);
    assert.deepEqual(useMoleculeStore.getState().documents.map(doc => doc.id), [second[0].id]);
    assert.equal(readBrowserDevVirtualTextDocument(second[0].path), record.text);
  } finally { for (const document of [...first, ...second]) deleteBrowserDevVirtualTextDocument(document.path); }
}));

test("default browser text opening retains content-addressed deduplication", async () => fixture(async (hook) => {
  native = false;
  let first: ViewerDocument[] = [], second: ViewerDocument[] = [];
  try {
    await act(async () => {
      first = await hook.openStructureRecords([record]);
      second = await hook.openStructureRecords([record]);
    });
    assert.deepEqual({ ids: first.map(doc => doc.id), paths: first.map(doc => doc.path) }, { ids: second.map(doc => doc.id), paths: second.map(doc => doc.path) });
    assert.equal(useMoleculeStore.getState().documents.length, 1);
    assert.equal(readBrowserDevVirtualTextDocument(first[0].path), record.text);
  } finally { for (const document of [...first, ...second]) deleteBrowserDevVirtualTextDocument(document.path); }
}));

test("cancelled independent browser preparation releases only its own real source", async () => fixture(async (hook, published, remembered) => {
  native = false;
  const accepted = await openBrowserDevTextDocument(record.path, record.inputExtension, record.text, defaultPreferences, undefined, undefined, { newDocument: true });
  let abandonedPath = "", checks = 0;
  const randomUUID = crypto.randomUUID.bind(crypto);
  const original = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  // Observe the allocated path without replacing preparation or its output.
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => {
    const id = randomUUID(); abandonedPath = `burette-ketcher://${id}/one.xyz`; return id;
  } });
  try {
    let opened: ViewerDocument[] = [];
    await act(async () => { opened = await hook.openStructureRecords([record], undefined, { newDocument: true, shouldApply: () => ++checks === 1 }); });
    assert.equal(checks, 2); assert.ok(abandonedPath); assert.notEqual(abandonedPath, accepted.path);
    assert.equal(readBrowserDevVirtualTextDocument(abandonedPath), null);
    assert.equal(readBrowserDevVirtualTextDocument(accepted.path), record.text);
    assert.deepEqual({ opened, published, remembered, stored: useMoleculeStore.getState().documents, transport }, { opened: [], published: [], remembered: [], stored: [], transport: [] });
  } finally {
    if (original) Object.defineProperty(crypto, "randomUUID", original); else Reflect.deleteProperty(crypto, "randomUUID");
    deleteBrowserDevVirtualTextDocument(accepted.path); if (abandonedPath) deleteBrowserDevVirtualTextDocument(abandonedPath);
  }
}));

test("new-document native preparation keeps its existing command payload", async () => fixture(async (hook, published) => {
  const document = prepared(); prepare = async () => document;
  await act(async () => { assert.deepEqual(await openGeneratedStructure(hook, "one", "xyz", record.text, () => true, { newDocument: true }), [document]); });
  assert.deepEqual(published, [[document]]);
  assert.deepEqual(transport, [{ command: "open_text_structure", args: { request: { title: record.path, extension: record.inputExtension, text: record.text }, preferences: defaultPreferences, reloadOptions: undefined } }]);
}));
