import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { Window } from "happy-dom";
import type { ViewerDocument } from "../apps/desktop/src/types";
let ownedSourceCompiled = false;
afterAll(() => { expect(ownedSourceCompiled).toBe(true); });
plugin({ name: "source-generation-compiler", setup(build) { build.onLoad({ filter: /(?:hooks\/use-source-(?:editing|draft-recovery)|workbench\/owned-source-text)\.ts$/u }, ({ path }) => {
  const contents = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!;
  if (path.endsWith("owned-source-text.ts")) { expect(contents).toContain("react/compiler-runtime"); ownedSourceCompiled = true; }
  return { contents, loader: "ts" };
}); } });
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
const browserDocuments = await import("../apps/desktop/src/lib/browser-dev-documents");
let buildPreview: (document: ViewerDocument) => Promise<ViewerDocument> = async document => ({ ...document, runtimePath: "draft" });
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browserDocuments, openBrowserDevTextDocument: async () => buildPreview(currentDocument) }));
const { createRoot } = await import("react-dom/client");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { adoptLogicalSource, beginScienceSessionRestore, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const sample = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8"), edited = sample.replace("$$$$", "> <DRAFT>\nretained\n\n$$$$");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useAssemblySourceText } = await import("../apps/desktop/src/lib/workbench/assembly-source");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
let source!: ReturnType<typeof useAssemblySourceText>;
function Probe() { source = useAssemblySourceText(currentDocument); return null; }
let serial = 0, currentDocument: ViewerDocument;
async function fixture(extension = "molx") {
  const doc: ViewerDocument = { id: `source-gen-${++serial}`, path: `/Scenes/${serial}.${extension}`, title: `scene.${extension}`, extension, byteCount: 2048, renderer: "molstar", runtimePath: "original" };
  currentDocument = doc; useMoleculeStore.setState({ documents: [doc] }); let controller!: ReturnType<typeof useSourceEditingController>;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), errors: unknown[] = [];
  const frame = document.createElement("iframe"); host.append(frame);
  function Fixture() { controller = useSourceEditingController({ activeDocument: doc, preferences: defaultPreferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return <SourceEditingProvider value={controller}><Probe /></SourceEditingProvider>; }
  await act(async () => root.render(<Fixture />));
  return { doc, frame, errors, get controller() { return controller; }, async close() { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); native = false; prepare = async document => document; } };
}
function adopt(doc: ViewerDocument, text = sample) { adoptLogicalSource({ documentId: doc.id, extension: "sdf", text }, crypto.randomUUID(), null, ["C", "C", "O"]); }


test("assembly capture rejects real draft ABA and exact document replacement without clearing unrelated state", async () => {
  native = true; const f = await fixture("pdb");
  try {
    nativeRead = async () => ({ handleId: "assembly-source", content: "ATOM original\n", revision: { modifiedAt: 0, byteCount: 14, contentHash: "original" }, previewMode: "live" });
    await act(async () => f.controller.beginEditing(f.doc));
    expect(source.text).toBe("ATOM original\n");
    const capture = source.capture()!; expect(capture.isCurrent()).toBe(true);
    await act(async () => { f.controller.updateDraft(f.doc, "ATOM changed\n", { previewApplied: true }); f.controller.updateDraft(f.doc, "ATOM original\n", { previewApplied: true }); });
    expect([source.text, capture.isCurrent()]).toEqual(["ATOM original\n", false]); capture.release();
    const second = source.capture()!;
    await act(async () => useMoleculeStore.setState({ documents: [f.doc, { ...f.doc, id: "unrelated" }] }));
    expect(second.isCurrent()).toBe(true);
    await act(async () => { useMoleculeStore.setState({ documents: [{ ...f.doc }] }); useMoleculeStore.setState({ documents: [f.doc] }); });
    expect(second.isCurrent()).toBe(false); second.release();
    const third = source.capture()!;
    await act(async () => useMoleculeStore.setState({ documents: [] }));
    expect(third.isCurrent()).toBe(false); third.release();
  } finally { await f.close(); useMoleculeStore.setState({ documents: [] }); }
});
