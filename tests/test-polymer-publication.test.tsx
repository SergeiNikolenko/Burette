import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { Window } from "happy-dom";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { buildBrowserWorker } from "./support/browser-worker-build";
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



const built = await buildBrowserWorker(new URL("../apps/desktop/src/lib/workbench/polymer-worker.ts", import.meta.url));
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


const { attachNativePolymerSource } = await import("./polymer-native-fixture");
const { capturePolymerPickOwner } = await import("../apps/desktop/src/hooks/polymer-pick-owner");
const { parseMolecule } = await import("../apps/desktop/src/lib/molecular-workbench/molecular-graph");
async function nativeFixture() {
  const f = await fixture(); document.body.append(f.frame); await act(async () => adopt(f.doc));
  const scene = await attachNativePolymerSource(f.frame, f.doc, sample), capture = source.capture()!, lifetime = new AbortController();
  const picks = await capturePolymerPickOwner(f.doc, { text: sample, format: "sdf", atoms: parseMolecule(sample, "sdf").atoms }, capture.isCurrent, lifetime.signal, () => {});
  return { ...f, scene, picks, async close() { lifetime.abort(); capture.release(); picks.release(); await scene.close(); preparationGate?.resolve(); preparationGate = null; f.frame.remove(); await f.close(); } };
}

test("native edit/Undo or same-frame replacement during real preparation cannot publish with retirement withheld", async () => {
  for (const change of ["editUndo", "replace"] as const) {
    const f = await nativeFixture();
    try {
      const owner = source.prepare(settings, f.picks.isCurrent)!; await owner.build(); preparationGate = deferred<void>(); f.scene.holdRetirement();
      let validations = 0;
      const pending = owner.create(actions, () => { validations++; return f.picks.validate(); }).catch(error => error);
      await wait(() => prepared.length === 1); const candidate = prepared[0];
      if (change === "replace") await f.scene.replace();
      else { await f.scene.plugin.state.data.build().to(f.scene.raw).update({ data: sample.replace("Propylene", "Changed native source") }).commit({ canUndo: "Source edit" }); await f.scene.plugin.runTask(f.scene.plugin.state.data.undo()); }
      expect(f.scene.heldRetirements()).toBe(1); expect(f.picks.isCurrent()).toBe(true); expect(owner.isCurrent()).toBe(true);
      await act(async () => preparationGate!.resolve());
      expect((await pending).message).toContain("source changed"); expect(validations).toBe(1); expect(opened).toEqual([]);
      expect(browserDocuments.readBrowserDevVirtualTextDocument(candidate.path)).toBeNull(); owner.release(); f.scene.flushRetirement();
    } finally { await f.close(); }
  }
});

test("late cancel or request replacement during a successful native ACK rechecks the final adoption guard", async () => {
  for (const change of ["cancel", "request"] as const) {
    const f = await nativeFixture(); let current = true;
    try {
      const owner = source.prepare(settings, () => current && f.picks.isCurrent())!; f.scene.holdValidation();
      const pending = owner.create(actions, f.picks.validate);
      await wait(() => f.scene.heldValidations() === 1); expect(prepared).toHaveLength(1); const candidate = prepared[0];
      if (change === "cancel") owner.release(); else current = false;
      await act(async () => f.scene.flushValidation()); expect(await pending).toEqual([]); expect(opened).toEqual([]);
      expect(browserDocuments.readBrowserDevVirtualTextDocument(candidate.path)).toBeNull(); owner.release();
    } finally { await f.close(); }
  }
});

test("false, throwing and aborted validation release prepared bytes; normal retries reuse exact output", async () => {
  const f = await nativeFixture();
  try {
    const before = workers, owner = source.prepare(settings, f.picks.isCurrent)!, preview = await owner.build();
    for (const failure of [false, new Error("Validation failed"), new DOMException("Cancelled", "AbortError")]) {
      const callsBefore = prepared.length;
      const result = await owner.create(actions, async () => { expect(prepared.length).toBe(callsBefore + 1); if (failure === false) return false; throw failure; }).catch(error => error);
      expect(result).toEqual(failure === false ? [] : failure); expect(opened).toEqual([]);
      expect(browserDocuments.readBrowserDevVirtualTextDocument(prepared.at(-1)!.path)).toBeNull();
    }
    let first: ViewerDocument[] = [], second: ViewerDocument[] = [], validated = 0;
    const validate = async () => { validated++; return f.picks.validate(); };
    await act(async () => { first = await owner.create(actions, validate); second = await owner.create(actions, validate); });
    expect(validated).toBe(2); expect([first.length, second.length, workers - before]).toEqual([1, 1, 1]);
    expect(first[0].id).not.toBe(second[0].id); expect(first[0].path).not.toBe(second[0].path);
    expect(first.concat(second).map(doc => browserDocuments.readBrowserDevVirtualTextDocument(doc.path))).toEqual([preview!.sdf, preview!.sdf]); owner.release();
  } finally { await f.close(); }
});
