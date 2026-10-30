import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { Window } from "happy-dom";
import type { ViewerDocument } from "../apps/desktop/src/types";
plugin({ name: "source-generation-compiler", setup(build) { build.onLoad({ filter: /hooks\/use-source-(?:editing|draft-recovery)\.ts$/u }, ({ path }) => ({
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
const browserDocuments = await import("../apps/desktop/src/lib/browser-dev-documents");
let buildPreview: (document: ViewerDocument) => Promise<ViewerDocument> = async document => ({ ...document, runtimePath: "draft" });
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browserDocuments, openBrowserDevTextDocument: async () => buildPreview(currentDocument) }));
const { createRoot } = await import("react-dom/client");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { adoptLogicalSource, beginScienceSessionRestore, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const sample = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8"), edited = sample.replace("$$$$", "> <DRAFT>\nretained\n\n$$$$");
let serial = 0, currentDocument: ViewerDocument;
async function fixture(extension = "molx") {
  const doc: ViewerDocument = { id: `source-gen-${++serial}`, path: `/Scenes/${serial}.${extension}`, title: `scene.${extension}`, extension, byteCount: 2048, renderer: "molstar", runtimePath: "original" };
  currentDocument = doc; let controller!: ReturnType<typeof useSourceEditingController>;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), errors: unknown[] = [];
  const frame = document.createElement("iframe"); host.append(frame);
  function Fixture() { controller = useSourceEditingController({ activeDocument: doc, preferences: defaultPreferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return null; }
  await act(async () => root.render(<Fixture />));
  return { doc, frame, errors, get controller() { return controller; }, async close() { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); native = false; prepare = async document => document; } };
}
function adopt(doc: ViewerDocument, text = sample) { adoptLogicalSource({ documentId: doc.id, extension: "sdf", text }, crypto.randomUUID(), null, ["C", "C", "O"]); }
test("beginning restore revokes an existing source session, atom-selection frame and operation before publication", async () => {
  const f = await fixture(); try {
    adopt(f.doc); await act(async () => f.controller.beginEditing(f.doc)); const operation = f.controller.captureOperation(f.doc);
    expect(f.controller.ownsCurrentSourceFrame(f.doc, f.frame)).toBe(true);
    await act(async () => f.controller.updateDraft(f.doc, edited));
    await act(async () => { beginScienceSessionRestore(f.doc.id); });
    expect([f.controller.sessionForDocument(f.doc), operation.isCurrent(), f.controller.ownsCurrentSourceFrame(f.doc, f.frame)]).toEqual([null, false, false]);
    expect(f.controller.getWindowDirtySnapshot().dirty).toBe(true);
    let closed!: Promise<boolean>; await act(async () => { closed = f.controller.closeDocuments([f.doc.id]); });
    expect(f.controller.recovery?.drafts[0].content).toBe(edited);
    await act(async () => f.controller.recovery?.cancel()); expect(await closed).toBe(false); expect(f.controller.getWindowDirtySnapshot().dirty).toBe(true);
    operation.release();
  } finally { await f.close(); }
});
test("a clean expired session is retired; a delayed old preview cannot publish into the replacement", async () => {
  const f = await fixture(), gate = deferred<ViewerDocument>(); try {
    adopt(f.doc); await act(async () => f.controller.beginEditing(f.doc));
    await act(async () => { beginScienceSessionRestore(f.doc.id); }); expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.controller.getWindowDirtySnapshot().dirty).toBe(false);
    await act(async () => adopt(f.doc)); await act(async () => f.controller.beginEditing(f.doc));
    buildPreview = () => gate.promise; await act(async () => f.controller.updateDraft(f.doc, edited)); let applying!: Promise<void>;
    await act(async () => { applying = Promise.resolve(f.controller.applyPreview(f.doc)); });
    await act(async () => { beginScienceSessionRestore(f.doc.id); adopt(f.doc); gate.resolve(f.doc); await applying; });
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.controller.getWindowDirtySnapshot().dirty).toBe(true); expect(f.errors).toEqual([]);
  } finally { gate.resolve(f.doc); buildPreview = async document => ({ ...document, runtimePath: "draft" }); await f.close(); }
});
test("null-to-pending-null restore generation revokes an awaited native source handle and operation", async () => {
  native = true; const f = await fixture("pdb"), gate = deferred<unknown>(); try {
    nativeRead = () => gate.promise; const operation = f.controller.captureOperation(f.doc), before = calls.length; let opening!: Promise<void>;
    await act(async () => { opening = Promise.resolve(f.controller.beginEditing(f.doc)); });
    await act(async () => { beginScienceSessionRestore(f.doc.id); gate.resolve({ handleId: "old-handle", content: "ATOM original\n", revision: { modifiedAt: 0, byteCount: 14, contentHash: "original" }, previewMode: "live" }); await opening; });
    expect([f.controller.sessionForDocument(f.doc), operation.isCurrent()]).toEqual([null, false]);
    expect(calls.slice(before)).toEqual(["open_source_edit_session", "close_source_edit_session"]); expect(f.errors).toEqual([]); operation.release();
  } finally { gate.resolve(null); await f.close(); }
});

test("independent: revoked owner cannot persist after held unverified-source confirmation", async () => {
  native = true; const f = await fixture("sdf"), gate = deferred<boolean>();
  try {
    nativeRead = async () => ({ handleId: "original-A", content: sample, revision: { modifiedAt: 0, byteCount: sample.length, contentHash: "A" }, previewMode: "live" });
    await act(async () => f.controller.beginEditing(f.doc));
    await act(async () => f.controller.updateDraft(f.doc, edited));
    confirmSave = () => gate.promise; const before = calls.length; let saving!: Promise<void>;
    await act(async () => { saving = Promise.resolve(f.controller.save(f.doc)); });
    await act(async () => { beginScienceSessionRestore(f.doc.id); adopt(f.doc, sample.replace("$$$$", "> <B>\nnew\n\n$$$$")); });
    await act(async () => { gate.resolve(true); await saving; });
    expect(calls.slice(before)).not.toContain("save_source_document");
    expect(f.controller.getWindowDirtySnapshot().dirty).toBe(true);
  } finally { gate.resolve(false); confirmSave = async () => false; await f.close(); }
});

for (const phase of ["conflict-confirm", "save-success", "save-error", "reconcile"] as const) test(`revoked native save ${phase} cannot clear or overwrite the retired draft`, async () => {
  native = true; const f = await fixture("sdf"), gate = deferred<unknown>(), entered = deferred<void>();
  try {
    nativeRead = async () => ({ handleId: "original-A", content: sample, revision: { modifiedAt: 0, byteCount: sample.length, contentHash: "A" }, previewMode: "live" });
    await act(async () => f.controller.beginEditing(f.doc));
    await act(async () => f.controller.updateDraft(f.doc, edited, { previewApplied: true }));
    saveNative = async () => {
      if (phase === "conflict-confirm") throw JSON.stringify({ code: "source_conflict", details: { actualRevision: { modifiedAt: 2, byteCount: 10, contentHash: "foreign" } } });
      if (phase === "reconcile") throw JSON.stringify({ code: "source_commit_uncertain" });
      entered.resolve(); await gate.promise;
      if (phase === "save-error") throw new Error("late old error");
      return { revision: { modifiedAt: 1, byteCount: 10, contentHash: "saved" } };
    };
    confirmSave = async () => { entered.resolve(); await gate.promise; return true; };
    reconcileNative = async () => { entered.resolve(); await gate.promise; return { revision: { modifiedAt: 1, byteCount: 10, contentHash: "saved" } }; };
    const before = calls.length; let saving!: Promise<void>;
    await act(async () => { saving = Promise.resolve(f.controller.save(f.doc)); await entered.promise; });
    await act(async () => { beginScienceSessionRestore(f.doc.id); adopt(f.doc); gate.resolve(undefined); await saving; });
    expect(calls.slice(before).filter(command => command === "save_source_document")).toHaveLength(1);
    expect(f.controller.getWindowDirtySnapshot().dirty).toBe(true); expect(f.controller.sessionForDocument(f.doc)).toBeNull();
    let opening!: Promise<void>; await act(async () => { opening = Promise.resolve(f.controller.beginEditing(f.doc)); });
    expect(f.controller.recovery?.drafts[0].content).toBe(edited); expect(f.controller.recovery?.isCurrent()).toBe(true);
    await act(async () => { f.controller.recovery?.cancel(); await opening; }); expect(f.errors).toEqual([]);
  } finally { gate.resolve(undefined); confirmSave = async () => false; saveNative = async () => ({ revision: {} }); await f.close(); }
});
for (const conflict of [false, true]) test(`current native save ${conflict ? "retries confirmed conflict" : "succeeds"} without losing its draft`, async () => {
  native = true; const f = await fixture("sdf"); try {
    nativeRead = async () => ({ handleId: "current-A", content: sample, revision: { modifiedAt: 0, byteCount: sample.length, contentHash: "A" }, previewMode: "live" });
    await act(async () => f.controller.beginEditing(f.doc)); await act(async () => f.controller.updateDraft(f.doc, edited, { previewApplied: true }));
    let attempts = 0; saveNative = async () => {
      if (++attempts === 1 && conflict) throw JSON.stringify({ code: "source_conflict", details: { actualRevision: { modifiedAt: 2, byteCount: 10, contentHash: "foreign" } } });
      return { revision: { modifiedAt: 3, byteCount: edited.length, contentHash: "saved" } };
    };
    confirmSave = async () => true; await act(async () => f.controller.save(f.doc));
    expect(attempts).toBe(conflict ? 2 : 1);
    const current = f.controller.sessionForDocument(f.doc); expect([current?.content, current?.baseContent, current?.dirty, current?.saving]).toEqual([edited, edited, false, false]); expect(f.errors).toEqual([]);
  } finally { confirmSave = async () => false; saveNative = async () => ({ revision: {} }); await f.close(); }
});
for (const waiting of ["confirmation", "write"] as const) test(`a newer current draft survives a held native ${waiting}`, async () => {
  native = true; const f = await fixture("sdf"), gate = deferred<void>(); try {
    nativeRead = async () => ({ handleId: "current-A", content: sample, revision: { modifiedAt: 0, byteCount: sample.length, contentHash: "A" }, previewMode: "live" });
    await act(async () => f.controller.beginEditing(f.doc));
    await act(async () => f.controller.updateDraft(f.doc, edited, waiting === "write" ? { previewApplied: true } : undefined));
    confirmSave = async () => { await gate.promise; return true; };
    saveNative = async () => { if (waiting === "write") await gate.promise; return { revision: { modifiedAt: 2, byteCount: edited.length, contentHash: "saved" } }; };
    const before = calls.length; let saving!: Promise<void>; await act(async () => { saving = Promise.resolve(f.controller.save(f.doc)); });
    const newer = edited.replace("retained", "newer"); await act(async () => f.controller.updateDraft(f.doc, newer, { previewApplied: true }));
    await act(async () => { gate.resolve(); await saving; });
    expect(calls.slice(before).filter(command => command === "save_source_document")).toHaveLength(waiting === "write" ? 1 : 0);
    const current = f.controller.sessionForDocument(f.doc); expect([current?.content, current?.baseContent, current?.dirty, current?.saving]).toEqual([newer, waiting === "write" ? edited : sample, true, false]);
  } finally { gate.resolve(); confirmSave = async () => false; await f.close(); }
});
