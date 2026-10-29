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
let save: () => Promise<string> = async () => { throw new Error("No saved path"); };
const transport: { command: string; args: unknown }[] = [];
const tauri = await import("../apps/desktop/src/lib/tauri"), core = await import("@tauri-apps/api/core");
mock.module("../apps/desktop/src/lib/tauri", () => ({ ...tauri, isTauriRuntime: () => native }));
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke: async (command: string, args: unknown) => {
  transport.push({ command, args });
  if (command === "open_text_structure") return prepare();
  if (command === "operate_sidebar_file") return save();
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
async function fixture(run: (hook: Hook, published: ViewerDocument[][], remembered: ViewerDocument[][], statuses: string[]) => Promise<void>) {
  useMoleculeStore.setState({ documents: [] }); native = true; transport.length = 0;
  const published: ViewerDocument[][] = [], remembered: ViewerDocument[][] = [], statuses: string[] = []; let hook: Hook | null = null;
  const noop = () => {};
  const options: Options = { preferences: defaultPreferences, addProjectRoot: noop, addBackgroundDocuments: noop, addBackgroundTextDocuments: noop,
    addDocuments: (documents, options) => { published.push(documents); useMoleculeStore.getState().addDocuments(documents, options); }, addTextDocuments: noop, closeDocument: noop,
    detectContentSpectrumPaths: async () => new Set<string>(), expandStructureBundles: async paths => paths, openDockTab: noop, openDocumentsInActiveTab: noop,
    openDocumentTab: noop, openFepNetworkTab: noop, openTextDocumentsInActiveTab: noop, pushErrorStatus: noop, pushStatus: message => { statuses.push(message); },
    rememberRecentStructures: documents => { remembered.push(documents); }, replaceDocument: noop, setActiveDocument: noop, setDockActiveTab: noop,
    setDockDocument: noop, setDockOpen: noop, setDocuments: noop };
  function Probe() { hook = useAppFileOpen(options); return null; }
  const node = browser.document.createElement("div"); browser.document.body.append(node); const root = createRoot(node as unknown as Element);
  await act(async () => root.render(<Probe />));
  try { assert.ok(hook); await run(hook, published, remembered, statuses); }
  finally { await act(async () => root.unmount()); node.remove(); native = false; useMoleculeStore.setState({ documents: [] }); }
}

test("a false predicate avoids preparing records or publishing anything", async () => fixture(async (hook, published, remembered) => {
  let attempts = 0; prepare = async () => { attempts++; return prepared(); };
  let opened: ViewerDocument[] = [];
  await act(async () => { opened = await hook.openStructureRecords([record], undefined, { shouldApply: () => false }); });
  assert.deepEqual({ opened, published, remembered, transport, attempts }, { opened: [], published: [], remembered: [], transport: [], attempts: 0 });
}));

test("cancellation during preparation releases native claims and source registrations without publication", async () => fixture(async (hook, published, remembered) => {
  let finish: ((document: ViewerDocument) => void) | undefined;
  prepare = () => new Promise(resolve => { finish = resolve; });
  let allowed = true, pending: Promise<ViewerDocument[]> | undefined;
  await act(async () => { pending = hook.openStructureRecords([record], undefined, { shouldApply: () => allowed }); });
  assert.ok(finish && pending); allowed = false; const document = prepared();
  let opened: ViewerDocument[] = [];
  await act(async () => { finish!(document); opened = await pending!; });
  assert.deepEqual({ opened, published, remembered, stored: useMoleculeStore.getState().documents }, { opened: [], published: [], remembered: [], stored: [] });
  assert.deepEqual(transport.slice(1), [
    { command: "abort_open_document_claim", args: { claimId: document.openClaimId } },
    { command: "close_opened_source_documents", args: { documentIds: [document.id] } },
  ]);
}));

test("a valid record retains the existing publication and result behavior", async () => fixture(async (hook, published, remembered) => {
  const document = prepared(); prepare = async () => document; let opened: ViewerDocument[] = [];
  await act(async () => { opened = await hook.openStructureRecords([record], undefined, { shouldApply: () => true }); });
  assert.deepEqual({ opened, published, remembered, stored: useMoleculeStore.getState().documents }, { opened: [document], published: [[document]], remembered: [[document]], stored: [document] });
  assert.deepEqual(transport.map(call => call.command), ["open_text_structure"]);
}));

test("discarded prepared results never release a source already adopted by the store", async () => fixture(async (hook, published) => {
  const document = prepared(); useMoleculeStore.setState({ documents: [document] });
  let allowed = true; prepare = async () => { allowed = false; return { ...document, id: "unadopted-same-path" }; };
  await act(async () => { assert.deepEqual(await hook.openStructureRecords([record], undefined, { shouldApply: () => allowed }), []); });
  assert.deepEqual(published, []); assert.deepEqual(useMoleculeStore.getState().documents, [document]);
  assert.deepEqual(transport.map(call => call.command), ["open_text_structure"]);
}));

test("browser cancellation removes the real prepared virtual text without native calls", async () => fixture(async (hook, published, remembered) => {
  native = false;
  const { openBrowserDevTextDocument, readBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
  const reference = await openBrowserDevTextDocument(record.path, record.inputExtension, record.text, defaultPreferences);
  deleteBrowserDevVirtualTextDocument(reference.path);
  let checks = 0, opened: ViewerDocument[] = [];
  try {
    await act(async () => { opened = await hook.openStructureRecords([record], undefined, { shouldApply: () => ++checks === 1 }); });
    assert.equal(checks, 2); assert.equal(readBrowserDevVirtualTextDocument(reference.path), null);
    assert.deepEqual({ opened, published, remembered, transport }, { opened: [], published: [], remembered: [], transport: [] });
  } finally { deleteBrowserDevVirtualTextDocument(reference.path); }
}));


test("cancellation during folder saving keeps the written file and skips late document opening", async () => fixture(async (hook, published, remembered, statuses) => {
  let finish: ((path: string) => void) | undefined;
  save = () => new Promise(resolve => { finish = resolve; });
  let allowed = true, pending: Promise<ViewerDocument[]> | undefined;
  await act(async () => { pending = hook.openStructureRecords([record], "/saved", { shouldApply: () => allowed }); });
  assert.ok(finish && pending); allowed = false;
  let opened: ViewerDocument[] = [];
  await act(async () => { finish!("/saved/one.xyz"); opened = await pending!; });
  assert.deepEqual({ opened, published, remembered, stored: useMoleculeStore.getState().documents }, { opened: [], published: [], remembered: [], stored: [] });
  assert.deepEqual(transport, [{ command: "operate_sidebar_file", args: { request: { operation: "createText", path: "/saved", name: "one.xyz", contents: record.text } } }]);
  assert.deepEqual(statuses, ["Saved 1 molecule file in /saved"]);
}));
