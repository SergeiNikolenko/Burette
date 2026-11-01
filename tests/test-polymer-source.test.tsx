import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { Window } from "happy-dom";
import type { ViewerDocument } from "../apps/desktop/src/types";
plugin({ name: "source-generation-compiler", setup(build) { build.onLoad({ filter: /(?:hooks\/use-(?:source-(?:editing|draft-recovery)|app-file-open)|workbench\/(?:polymer-source|owned-source-text))\.ts$/u }, ({ path }) => ({
  contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "ts",
})); } });
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Element: browser.Element, Node: browser.Node,
  Event: browser.Event, MessageEvent: browser.MessageEvent, CustomEvent: browser.CustomEvent, MutationObserver: browser.MutationObserver,
  localStorage: browser.localStorage, CSS: browser.CSS, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} await browser.happyDOM.close(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let native = false;
let confirmSave: () => Promise<boolean> = async () => false;
let saveNative: () => Promise<unknown> = async () => ({ revision: { modifiedAt: 1, byteCount: 10, contentHash: "saved" } });
let reconcileNative: () => Promise<unknown> = async () => ({ revision: { modifiedAt: 1, byteCount: 10, contentHash: "saved" } });
const actualDialogs = await import("@tauri-apps/plugin-dialog");
mock.module("@tauri-apps/plugin-dialog", () => ({ ...actualDialogs, confirm: () => confirmSave(), message: async () => {} }));
const calls: string[] = [];
let nativeRead: () => Promise<unknown> = async () => { throw new Error("Unexpected native read"); };
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native, trackTauriListener: () => () => {} }));
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string) => { calls.push(command); if (command === "open_source_edit_session") return nativeRead(); if (command === "save_source_document") return saveNative(); if (command === "reconcile_source_commit") return reconcileNative(); if (command !== "close_source_edit_session") throw new Error(`Unexpected native IPC ${command}`); } }));
const structureText = await import("../apps/desktop/src/lib/structure-text");
mock.module("../apps/desktop/src/lib/structure-text", () => ({ ...structureText, readStructureTextDocument: async () => { throw new Error("Archive read as text"); } }));
let prepare: (document: ViewerDocument) => Promise<ViewerDocument> = async document => document;
const deferredRuntime = await import("../apps/desktop/src/hooks/use-deferred-viewer-runtime");
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ ...deferredRuntime, prepareDeferredViewerRuntime: (document: ViewerDocument) => prepare(document) }));
const browserDocuments = { ...await import("../apps/desktop/src/lib/browser-dev-documents") };
let preparationGate: ReturnType<typeof deferred<void>> | null = null;
const prepared: ViewerDocument[] = [];
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browserDocuments, openBrowserDevTextDocument: async (...args: Parameters<typeof browserDocuments.openBrowserDevTextDocument>) => {
  const result = await browserDocuments.openBrowserDevTextDocument(...args); prepared.push(result); await preparationGate?.promise; return result;
} }));
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
let actions!: Pick<import("../apps/desktop/src/components/types").ShellActions, "openStructureRecords">;
const opened: ViewerDocument[] = [], noop = () => {};
const { createRoot } = await import("react-dom/client");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { adoptLogicalSource, beginScienceSessionRestore, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const fixtureGraph = JSON.parse(readFileSync(new URL("fixtures/polymer/propylene-reference.json", import.meta.url), "utf8"));
const { sdfFromGraph } = await import("../apps/desktop/src/lib/workbench/formats");
const sample = sdfFromGraph(fixtureGraph.atoms, fixtureGraph.bonds, "Propylene");
const settings = { head: 0, tail: 1, headLeaving: 5, tailLeaving: 4, count: 6, bondLength: 3, tacticity: "atactic" as const };
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { usePolymerSource } = await import("../apps/desktop/src/lib/workbench/polymer-source");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
let source!: ReturnType<typeof usePolymerSource>;
function Probe() { source = usePolymerSource(currentDocument); return null; }
let serial = 0, currentDocument: ViewerDocument;
async function fixture(extension = "molx") {
  opened.length = 0; prepared.length = 0;
  const doc: ViewerDocument = { id: `source-gen-${++serial}`, path: `/Scenes/${serial}.${extension}`, title: `scene.${extension}`, extension, byteCount: 2048, renderer: "molstar", runtimePath: "original" };
  currentDocument = doc; useMoleculeStore.setState({ documents: [doc] }); let controller!: ReturnType<typeof useSourceEditingController>;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), errors: unknown[] = [];
  const frame = document.createElement("iframe"); host.append(frame);
  function Fixture() {
    actions = useAppFileOpen({ preferences: defaultPreferences, addProjectRoot: noop, addBackgroundDocuments: noop, addBackgroundTextDocuments: noop,
      addDocuments: (docs, options) => { opened.push(...docs); useMoleculeStore.getState().addDocuments(docs, options); }, addTextDocuments: noop, closeDocument: noop,
      detectContentSpectrumPaths: async () => new Set<string>(), expandStructureBundles: async paths => paths, openDockTab: noop, openDocumentsInActiveTab: noop,
      openDocumentTab: noop, openFepNetworkTab: noop, openTextDocumentsInActiveTab: noop, pushErrorStatus: error => errors.push(error), pushStatus: noop,
      rememberRecentStructures: noop, replaceDocument: noop, setActiveDocument: noop, setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop, setDocuments: noop });
    controller = useSourceEditingController({ activeDocument: doc, preferences: defaultPreferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return <SourceEditingProvider value={controller}><Probe /></SourceEditingProvider>; }
  await act(async () => root.render(<Fixture />));
  return { doc, frame, errors, get controller() { return controller; }, async close() { await act(async () => root.unmount()); host.remove(); for (const doc of prepared) browserDocuments.deleteBrowserDevVirtualTextDocument(doc.path); releaseClosedScienceSessions(new Set()); native = false; prepare = async document => document; } };
}
function adopt(doc: ViewerDocument, text = sample) { adoptLogicalSource({ documentId: doc.id, extension: "sdf", text }, crypto.randomUUID(), null, fixtureGraph.atoms.map((a: { element: string }) => a.element)); }



const built = await Bun.build({ entrypoints: [new URL("../apps/desktop/src/lib/workbench/polymer-worker.ts", import.meta.url).pathname], target: "browser", format: "esm" });
if (!built.success) throw new AggregateError(built.logs, "Worker build failed");
const workerPath = `${import.meta.dir}/.polymer-worker-${crypto.randomUUID()}.js`; await Bun.write(workerPath, built.outputs[0]);
const NativeWorker = Worker; let hold = false, held: (() => void) | null = null, terminated = 0, workers = 0;
class CompiledWorker extends NativeWorker {
  constructor(_url: string | URL, options?: WorkerOptions) { super(workerPath, options); workers++; }
  override set onmessage(callback: ((event: MessageEvent) => void) | null) { super.onmessage = event => { if (hold) held = () => callback?.(event); else callback?.(event); }; }
  override terminate() { terminated++; return super.terminate(); }
}
Object.defineProperty(globalThis, "Worker", { configurable: true, value: CompiledWorker });
afterAll(() => { Object.defineProperty(globalThis, "Worker", { configurable: true, value: NativeWorker }); require("node:fs").unlinkSync(workerPath); });
async function wait(check: () => boolean) { for (let i = 0; i < 150 && !check(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); expect(check()).toBe(true); }

test("prepared source builds once and actual file-open creates two independent byte-identical documents", async () => {
  const f = await fixture();
  try {
    await act(async () => adopt(f.doc)); const owner = source.prepare(settings, () => true)!;
    const before = workers, preview = await owner.build(); expect(preview?.atomCount).toBe(56);
    let first: ViewerDocument[] = [], second: ViewerDocument[] = [];
    await act(async () => { first = await owner.create(actions); second = await owner.create(actions); });
    expect(f.errors).toEqual([]); expect(workers - before).toBe(1); expect(first).toHaveLength(1); expect(second).toHaveLength(1);
    expect(first[0].id).not.toBe(second[0].id); expect(first[0].path).not.toBe(second[0].path);
    expect(first.concat(second).map(doc => browserDocuments.readBrowserDevVirtualTextDocument(doc.path))).toEqual([preview!.sdf, preview!.sdf]);
    expect(source.text).toBe(sample); expect(f.errors).toEqual([]); owner.release();
  } finally { await f.close(); }
});

test("held real worker is terminated by close, exact object ABA, logical replacement and real draft ABA", async () => {
  for (const change of ["close", "document ABA", "logical", "draft ABA"] as const) {
    const f = await fixture(); hold = true; held = null;
    try {
      await act(async () => adopt(f.doc));
      if (change === "draft ABA") await act(async () => f.controller.beginEditing(f.doc));
      const owner = source.prepare(settings, () => true)!, before = terminated;
      const pending = owner.create(actions).catch(error => error);
      await wait(() => held !== null);
      await act(async () => {
        if (change === "draft ABA") { f.controller.updateDraft(f.doc, sample + "\n", { previewApplied: true }); f.controller.updateDraft(f.doc, sample, { previewApplied: true }); }
        else if (change === "logical") adopt(f.doc);
        else { useMoleculeStore.setState({ documents: [] }); if (change === "document ABA") useMoleculeStore.setState({ documents: [f.doc] }); }
      });
      expect(owner.isCurrent()).toBe(false);
      expect(terminated).toBe(before + 1); (held as (() => void) | null)?.();
      expect(await pending).toMatchObject({ name: "AbortError" }); expect(opened).toEqual([]); owner.release();
    } finally { hold = false; held = null; await f.close(); }
  }
});

test("held actual document preparation drops bytes after request replacement or source retirement", async () => {
  for (const change of ["dialog", "source"] as const) {
    const f = await fixture(); let current = true;
    try {
      await act(async () => adopt(f.doc)); const owner = source.prepare(settings, () => current)!;
      await owner.build(); preparationGate = deferred<void>();
      const pending = owner.create(actions); await wait(() => prepared.length === 1); const stale = prepared[0];
      await act(async () => { if (change === "dialog") current = false; else useMoleculeStore.setState({ documents: [] }); preparationGate!.resolve(); });
      expect(await pending).toEqual([]); expect(opened).toEqual([]);
      expect(browserDocuments.readBrowserDevVirtualTextDocument(stale.path)).toBeNull(); owner.release();
    } finally { preparationGate = null; await f.close(); }
  }
});
