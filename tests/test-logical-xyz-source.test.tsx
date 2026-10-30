import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";
import React, { act } from "react";
import { Window } from "happy-dom";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { zipSync, strToU8 } from "../apps/desktop/node_modules/fflate/esm/browser.js";
import { XYZ, waterScience } from "./scientific-data-fixture";
plugin({ name: "logical-xyz-compiler", setup(build) {
  build.onLoad({ filter: /hooks\/use-source-editing\.ts$/u }, ({ path }) => ({ contents: transformSync(readFileSync(path, "utf8"), {
    filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]],
  })!.code!, loader: "ts" }));
} });
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Element: browser.Element,
  Node: browser.Node, Event: browser.Event, MessageEvent: browser.MessageEvent, CustomEvent: browser.CustomEvent,
  MutationObserver: browser.MutationObserver, localStorage: browser.localStorage, CSS: browser.CSS, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} await browser.happyDOM.close(); });
let native = false;
const nativeCalls: { command: string; args: unknown }[] = [];
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: unknown) => {
  nativeCalls.push({ command, args });
  if (command === "open_source_edit_session") return { handleId: "xyz-source-handle", content: XYZ, revision: { modifiedAt: 1, byteCount: Buffer.byteLength(XYZ), contentHash: "hash" }, previewMode: "live" };
  if (command === "close_source_edit_session") return;
  throw new Error(`Unexpected native action ${command}`);
} }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native, trackTauriListener: () => () => {} }));

let prepare: (document: ViewerDocument) => Promise<ViewerDocument> = async document => document;
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: (document: ViewerDocument) => prepare(document) }));
const { createRoot } = await import("react-dom/client");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { encodeScienceSession, decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
const { beginScienceSessionRestore, adoptLogicalSource, logicalSourceFor, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const { adoptRestoredScientificSource, importedOriginalFor, scientificStateFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const changed = XYZ.replace("0.757200", "1.757200"), binding = { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: 3 };
const { writeBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { captureViewerActionTarget, requestViewerAction } = await import("../apps/desktop/src/lib/viewer-bridge");
const { readGeometryBinding } = await import("../apps/desktop/src/lib/geometry-binding");
const { claimGeometryPreview, releaseGeometryPreview } = await import("../apps/desktop/src/lib/geometry-preview-owners");
let serial = 0;
async function restore(documentId: string, uuid: string = crypto.randomUUID()) {
  const encoded = await encodeScienceSession({ documentUuid: uuid, source: { extension: "xyz", text: XYZ }, atomIds: null,
    binding, science: waterScience(), original: { name: "Original.xyz", file: new Blob([XYZ]) } });
  const archive = zipSync({ "state.json": strToU8('{"entries":[]}'), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, kind: "file", name: asset.name }]))), ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) });
  const decoded = (await decodeScienceSession(archive))!;
  adoptRestoredScientificSource(documentId, decoded.science ? { text: decoded.source.text, document: decoded.science } : null, decoded.original);
  adoptLogicalSource({ documentId, ...decoded.source }, decoded.documentUuid, decoded.atomIds, ["O", "H", "H"]);
  return decoded;
}
async function fixture(bindingText?: string, raw = false) {
  const doc: ViewerDocument = { id: `logical-xyz-${++serial}`, path: `/Scenes/${serial}.molx`, title: "Restored.MOLX", extension: "molx", byteCount: 2048, renderer: "molstar", runtimePath: "original-scene", virtual: true };
  if (raw) Object.assign(doc, { path: `/Files/${serial}.xyz`, title: "water.xyz", extension: "xyz", virtual: false });
  let active: ViewerDocument | null = doc, controller!: ReturnType<typeof useSourceEditingController>;
  const errors: unknown[] = [], host = document.createElement("div"); document.body.append(host);
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = doc.id; frame.dataset.renderer = "molstar"; host.append(frame);
  const sent: { body: { id: string; action: Record<string, unknown> } }[] = [], bindings: unknown[] = [];
  frame.contentWindow!.postMessage = payload => {
    if (payload.body.action.type !== "geometry_binding") { sent.push(payload); return; }
    bindings.push(payload); queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow!, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: payload.body.id, result: { ok: true, result: { lease: "captured-source-lease", text: bindingText ?? logicalSourceFor(doc.id)?.text } } } } })));
  };
  const target = document.createElement("div"); host.append(target); const root = createRoot(target);
  function Probe() { controller = useSourceEditingController({ activeDocument: active, preferences: defaultPreferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return null; }
  await act(async () => root.render(<Probe />));
  return { doc, frame, sent, bindings, errors, get controller() { return controller; },
    async inactive() { active = null; await act(async () => root.render(<Probe />)); },
    reply(index: number, ok = true) { window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow!, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: sent[index].body.id, result: ok ? { ok: true } : { ok: false, error: { message: "Runtime refused" } } } } })); },
    async close() { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); releaseClosedImports(new Set()); prepare = async document => document; },
  };
}
// Geometry calls intentionally require the real pending DockTabKind/catalog/render prerequisite; no type shim is installed here.
test("decoded MOLX XYZ admits only Geometry and keeps archive, Original and source lifetime", async () => {
  const f = await fixture(); try {
    const restored = await restore(f.doc.id), owner = logicalSourceFor(f.doc.id), original = importedOriginalFor(f.doc.id);
    await act(async () => f.controller.beginEditing(f.doc)); expect(f.controller.sessionForDocument(f.doc)).toBeNull();
    await act(async () => f.controller.beginEditing(f.doc, "structure-edit")); expect(f.controller.sessionForDocument(f.doc)).toBeNull();
    await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    expect(f.errors).toHaveLength(2);
    expect(f.controller.sessionForDocument(f.doc)?.content).toBe(restored.source.text);
    expect(f.controller.sessionForDocument(f.doc)?.saveDisabledReason).toContain("Export → Scene");
    await act(async () => f.controller.updateDraft(f.doc, changed, { previewApplied: true }));
    expect([f.doc.extension, f.doc.path, f.doc.runtimePath]).toEqual(["molx", `/Scenes/${serial}.molx`, "original-scene"]);
    expect(logicalSourceFor(f.doc.id)).toBe(owner); expect(importedOriginalFor(f.doc.id)).toBe(original);
    expect(new Uint8Array(await original!.file.arrayBuffer())).toEqual(new TextEncoder().encode(XYZ)); expect(f.controller.sessionForDocument(f.doc)?.dirty).toBe(true);
  } finally { await f.close(); }
});
test("host source publication waits for its matching ACK; rejected and superseded revisions cannot commit", async () => {
  const f = await fixture(); try {
    await restore(f.doc.id); await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    await act(async () => f.controller.updateDraft(f.doc, changed));
    let first!: Promise<void>; await act(async () => { first = Promise.resolve(f.controller.applyPreview(f.doc)); });
    expect(f.sent[0].body.action).toEqual({ type: "update_geometry", label: "Geometry", text: changed, lease: "captured-source-lease", notify: false });
    expect(f.controller.sessionForDocument(f.doc)?.previewState).toBe("staging");
    await act(async () => f.controller.updateDraft(f.doc, XYZ));
    await first; let second!: Promise<void>; await act(async () => { second = Promise.resolve(f.controller.applyPreview(f.doc)); });
    await act(async () => f.reply(0)); expect(f.controller.sessionForDocument(f.doc)?.previewState).toBe("staging");
    await act(async () => { f.reply(1, false); await second; }); expect(f.controller.sessionForDocument(f.doc)?.previewState).toBe("paused");
    let retry!: Promise<void>; await act(async () => { retry = Promise.resolve(f.controller.applyPreview(f.doc)); });
    await act(async () => { f.reply(2); await retry; });
    const session = f.controller.sessionForDocument(f.doc)!; expect([session.content, session.previewState, f.controller.ownsCurrentSourceFrame(f.doc, f.frame)]).toEqual([XYZ, "current", true]); expect(f.bindings).toHaveLength(1);
  } finally { await f.close(); }
});
test("inactive same-byte same-UUID null-ID restore revokes pending work while dirty close Cancel preserves history", async () => {
  const f = await fixture(); try {
    const decoded = await restore(f.doc.id); await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    const operation = f.controller.captureOperation(f.doc);
    await act(async () => f.controller.updateDraft(f.doc, changed)); let pending!: Promise<void>;
    await act(async () => { pending = Promise.resolve(f.controller.applyPreview(f.doc)); }); await f.inactive();
    await act(async () => { await restore(f.doc.id, decoded.documentUuid); }); await pending;
    expect(operation.isCurrent()).toBe(false); expect(f.controller.sessionForDocument(f.doc)).toBeNull();
    expect(f.controller.getWindowDirtySnapshot().dirty).toBe(true);
    await act(async () => f.reply(0)); expect(f.controller.sessionForDocument(f.doc)).toBeNull();
    let reopening!: Promise<void>; await act(async () => { reopening = Promise.resolve(f.controller.beginEditing(f.doc, "geometry")); });
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.controller.recovery?.drafts[0].content).toBe(changed);
    await act(async () => { f.controller.recovery!.cancel(); await reopening; });
    let closing!: Promise<boolean>; await act(async () => { closing = f.controller.closeDocuments([f.doc.id]); });
    await act(async () => f.controller.recovery!.cancel()); expect(await closing).toBe(false); expect(f.controller.getWindowDirtySnapshot().dirty).toBe(true);
    await act(async () => { closing = f.controller.closeDocuments([f.doc.id]); });
    await act(async () => f.controller.recovery!.discard()); expect(await closing).toBe(false);
    await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    expect([f.controller.sessionForDocument(f.doc)?.content, f.controller.sessionForDocument(f.doc)?.dirty]).toEqual([XYZ, false]); operation.release();
  } finally { await f.close(); }
});
test("cross-format replacement retires a clean Geometry session and close/unmount reject late opening or ACK", async () => {
  const f = await fixture(); try {
    await restore(f.doc.id); await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    await act(async () => adoptLogicalSource({ documentId: f.doc.id, extension: "mol", text: "different source" }, crypto.randomUUID(), null, []));
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.controller.getWindowDirtySnapshot().dirty).toBe(false);
    await restore(f.doc.id); let release!: (document: ViewerDocument) => void;
    prepare = () => new Promise(resolve => { release = resolve; }); let opening!: Promise<void>;
    await act(async () => { opening = Promise.resolve(f.controller.beginEditing(f.doc, "geometry")); });
    await act(async () => { await f.controller.closeDocuments([f.doc.id]); release(f.doc); await opening; });
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.errors).toEqual([]);
    prepare = async document => document; await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    await act(async () => f.controller.updateDraft(f.doc, changed)); let pending!: Promise<void>;
    await act(async () => { pending = Promise.resolve(f.controller.applyPreview(f.doc)); });
    const operation = f.controller.captureOperation(f.doc); await f.close(); await pending; f.reply(0);
    expect(operation.isCurrent()).toBe(false); operation.release();
  } finally { if (f.frame.isConnected) await f.close(); }
});
test("invalid and multi-frame logical drafts never reach the runtime; own acknowledged source publication keeps the lifetime and scientific revisions", async () => {
  const f = await fixture(); try {
    await restore(f.doc.id); await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    const owner = logicalSourceFor(f.doc.id), science = scientificStateFor(f.doc.id, XYZ).revision;
    for (const text of ["not XYZ", XYZ + XYZ.replace(/^\ufeff/u, ""), "3\nwater\nO 0 0 0\n"]) {
      await act(async () => { f.controller.updateDraft(f.doc, text); await f.controller.applyPreview(f.doc); });
      expect(f.controller.sessionForDocument(f.doc)?.previewState).toBe("paused");
    }
    expect(f.sent).toEqual([]);
    await act(async () => f.controller.updateDraft(f.doc, changed, { previewApplied: true }));
    await act(async () => f.controller.updateDraft(f.doc, XYZ, { previewApplied: true }));
    expect([f.controller.sessionForDocument(f.doc)?.content, f.controller.sessionForDocument(f.doc)?.dirty, f.controller.sessionForDocument(f.doc)?.previewState]).toEqual([XYZ, false, "current"]);
    expect(logicalSourceFor(f.doc.id)).toBe(owner); expect(scientificStateFor(f.doc.id, XYZ).revision).toBe(science);
  } finally { await f.close(); }
});
test("a same-byte restore while opening revokes admission and UTF-8 oversized drafts stay outside the runtime", async () => {
  const f = await fixture(); try {
    const decoded = await restore(f.doc.id); let release!: (document: ViewerDocument) => void;
    prepare = () => new Promise(resolve => { release = resolve; }); let opening!: Promise<void>;
    await act(async () => { opening = Promise.resolve(f.controller.beginEditing(f.doc, "geometry")); });
    await act(async () => { await restore(f.doc.id, decoded.documentUuid); release(f.doc); await opening; });
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.errors).toEqual([]);
    prepare = async document => document; await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    const large = XYZ.replace("water restored", "漢".repeat(1_000_000));
    expect(large.length).toBeLessThan(3_000_000); expect(Buffer.byteLength(large)).toBeGreaterThan(3_000_000);
    await act(async () => { f.controller.updateDraft(f.doc, large); await f.controller.applyPreview(f.doc); });
    expect(f.controller.sessionForDocument(f.doc)?.previewState).toBe("unsupported"); expect(f.sent).toEqual([]);
  } finally { await f.close(); }
});
test("Close Cancel keeps a same-owner dirty preview and capture usable until its real transport ACK", async () => {
  const f = await fixture(); try {
    await restore(f.doc.id); await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    const operation = f.controller.captureOperation(f.doc);
    await act(async () => f.controller.updateDraft(f.doc, changed)); let pending!: Promise<void>;
    await act(async () => { pending = Promise.resolve(f.controller.applyPreview(f.doc)); });
    window.confirm = () => false; let closed = true;
    await act(async () => { closed = await f.controller.closeDocuments([f.doc.id]); });
    expect(closed).toBe(false); expect(operation.isCurrent()).toBe(true);
    await act(async () => { f.reply(0); await pending; });
    expect([f.controller.sessionForDocument(f.doc)?.content, f.controller.sessionForDocument(f.doc)?.previewState, f.controller.getWindowDirtySnapshot().dirty]).toEqual([changed, "current", true]); operation.release();
  } finally { await f.close(); }
});
test("a replacement frame cannot receive an old logical session draft before registry adoption", async () => {
  const f = await fixture(); const replacement = document.createElement("iframe"); try {
    await restore(f.doc.id); await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    const operation = f.controller.captureOperation(f.doc), sent: unknown[] = [];
    replacement.className = "viewer-iframe"; replacement.dataset.documentId = f.doc.id; replacement.dataset.renderer = "molstar";
    document.body.append(replacement); f.frame.remove();
    replacement.contentWindow!.postMessage = payload => { sent.push(payload); queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { source: replacement.contentWindow!, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: payload.body.id, result: { ok: true } } } }))); };
    await act(async () => { f.controller.updateDraft(f.doc, changed); await f.controller.applyPreview(f.doc); });
    expect(sent).toEqual([]); expect(operation.isCurrent()).toBe(false); operation.release();
  } finally { replacement.remove(); await f.close(); }
});
test("a mismatched runtime binding cannot grant a lease to old logical source bytes", async () => {
  const f = await fixture(changed); try { await restore(f.doc.id); await act(async () => f.controller.beginEditing(f.doc, "geometry"));
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect((f.errors[0] as Error).message).toContain("no longer shows this source"); expect(f.sent).toEqual([]);
  } finally { await f.close(); }
});
test("changing srcdoc on the same frame revokes the retained Geometry target", async () => {
  const f = await fixture(); try { await restore(f.doc.id); await act(async () => f.controller.beginEditing(f.doc, "geometry")); const operation = f.controller.captureOperation(f.doc);
    f.frame.srcdoc = "<html>replacement</html>"; await act(async () => { f.controller.updateDraft(f.doc, changed); await f.controller.applyPreview(f.doc); });
    expect(f.sent).toEqual([]); expect(operation.isCurrent()).toBe(false); operation.release();
  } finally { await f.close(); }
});
test("close while the binding read is held aborts admission without a late session", async () => {
  const f = await fixture(); try { await restore(f.doc.id); f.frame.contentWindow!.postMessage = () => {}; let opening!: Promise<void>;
    await act(async () => { opening = Promise.resolve(f.controller.beginEditing(f.doc, "geometry")); });
    await act(async () => { await f.controller.closeDocuments([f.doc.id]); await opening; });
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test("supplied pre-gesture binding bypasses its own active preview owner without minting a new lease", async () => {
  const f = await fixture(), token = {}; try {
    await restore(f.doc.id);
    const baseline = await readGeometryBinding(f.doc, (doc, action, options) => requestViewerAction(doc.id, action, 1000, options?.signal, options), () => true);
    expect(claimGeometryPreview(f.doc.id, token, () => true)).toBe(true);
    await act(async () => f.controller.beginEditing(f.doc, "geometry", { geometryBinding: baseline }));
    expect([f.controller.sessionForDocument(f.doc)?.content, f.bindings.length]).toEqual([XYZ, 1]);
    await act(async () => f.controller.updateDraft(f.doc, changed)); let pending!: Promise<void>;
    await act(async () => { pending = Promise.resolve(f.controller.applyPreview(f.doc)); });
    expect(f.sent[0].body.action.lease).toBe(baseline.lease);
    await act(async () => { f.reply(0); await pending; });
    expect([f.controller.sessionForDocument(f.doc)?.previewState, f.bindings.length]).toEqual(["current", 1]);
  } finally { releaseGeometryPreview(f.doc.id, token); await f.close(); }
});
test("a supplied baseline must match its current document and source before admission", async () => {
  const f = await fixture(); try {
    await restore(f.doc.id); const target = captureViewerActionTarget(f.doc.id)!;
    await act(async () => f.controller.beginEditing(f.doc, "geometry", { geometryBinding: { lease: "old", text: changed, target } }));
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect((f.errors[0] as Error).message).toContain("no longer shows this source");
    await act(async () => f.controller.beginEditing(f.doc, "geometry", { geometryBinding: { lease: "old", text: XYZ, target: { ...target, documentId: "other" } } }));
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.bindings).toEqual([]); expect(f.sent).toEqual([]);
  } finally { await f.close(); }
});
test("begin restore or unmount cancels a binding admission blocked by another preview owner", async () => {
  for (const unmount of [false, true]) {
    const f = await fixture(), token = {}; try {
      await restore(f.doc.id); claimGeometryPreview(f.doc.id, token, () => true); let opening!: Promise<void>;
      await act(async () => { opening = Promise.resolve(f.controller.beginEditing(f.doc, "geometry")); });
      expect(f.bindings).toEqual([]);
      if (unmount) await f.close(); else await act(async () => { beginScienceSessionRestore(f.doc.id); });
      await opening; expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.errors).toEqual([]);
    } finally { releaseGeometryPreview(f.doc.id, token); if (f.frame.isConnected) await f.close(); }
  }
});
test("raw BOM CRLF XYZ uses the actual source reader and renderer decoder baseline while keeping Text semantics", async () => {
  const viewer = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
  const raw = viewer.match(/\n  function rawStructureData\([\s\S]*?\n  \}/u)![0];
  const rendererText: string = vm.runInNewContext(`let decodedStructureCache = null; ${raw}; rawStructureData({binary:false})`, { window: { BuretteDataBytes: new TextEncoder().encode(XYZ) }, Uint8Array, TextDecoder });
  expect(rendererText).toBe(XYZ.slice(1));
  const previousFetch = globalThis.fetch; globalThis.fetch = Object.assign(async () => Response.json({ content: Buffer.from(XYZ).toString("utf8"), byteCount: Buffer.byteLength(XYZ) }), { preconnect: previousFetch.preconnect });
  const f = await fixture(rendererText, true); try {
    const target = captureViewerActionTarget(f.doc.id)!;
    await act(async () => f.controller.beginEditing(f.doc, "geometry", { geometryBinding: { lease: "raw-lease", text: rendererText, target } }));
    expect(f.errors).toEqual([]); const session = f.controller.sessionForDocument(f.doc)!;
    expect([session.content, session.baseContent, session.saveDisabledReason]).toEqual([XYZ, XYZ, null]);
    await act(async () => f.controller.updateDraft(f.doc, changed, { previewApplied: true }));
    expect([f.controller.sessionForDocument(f.doc)?.content, f.controller.sessionForDocument(f.doc)?.dirty, f.sent, f.bindings]).toEqual([changed, true, [], []]);
    expect(logicalSourceFor(f.doc.id)).toBeNull(); expect(f.controller.sessionForDocument(f.doc)?.sourcePreview?.activeSlot).toBe(session.sourcePreview?.activeSlot);
  } finally { await f.close(); globalThis.fetch = previousFetch; }
});

test("a refused supplied raw baseline releases the opened native source-session handle", async () => {
  const f = await fixture(undefined, true); native = true; nativeCalls.length = 0;
  try {
    const target = captureViewerActionTarget(f.doc.id)!;
    await act(async () => f.controller.beginEditing(f.doc, "geometry", { geometryBinding: { lease: "old-source", text: changed, target } }));
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect((f.errors[0] as Error).message).toContain("no longer shows this source");
    expect(nativeCalls.map(call => call.command)).toEqual(["open_source_edit_session", "close_source_edit_session"]);
    expect(nativeCalls[1].args).toEqual({ request: { handleId: "xyz-source-handle" } });
  } finally { await f.close(); native = false; }
});

test("registered generated browser XYZ admits Geometry with its retained binding and exact source", async () => {
  const f = await fixture(XYZ.slice(1), true); f.doc.virtual = true;
  writeBrowserDevVirtualTextDocument(f.doc.path, XYZ);
  try {
    const geometryBinding = await readGeometryBinding(f.doc, (doc, action, options) => requestViewerAction(doc.id, action, 1000, options?.signal, options), () => true);
    await act(async () => f.controller.beginEditing(f.doc, "geometry", { geometryBinding }));
    expect(f.errors).toEqual([]); expect(f.controller.sessionForDocument(f.doc)?.content).toBe(XYZ);
    await act(async () => f.controller.updateDraft(f.doc, changed, { previewApplied: true }));
    expect([f.controller.sessionForDocument(f.doc)?.content, f.controller.sessionForDocument(f.doc)?.dirty, f.sent]).toEqual([changed, true, []]);
    await act(async () => beginScienceSessionRestore(f.doc.id));
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.controller.getWindowDirtySnapshot().dirty).toBe(true);
  } finally { deleteBrowserDevVirtualTextDocument(f.doc.path); await f.close(); }
});
test("virtual XYZ Geometry requires actual browser ownership and a current binding", async () => {
  const f = await fixture(XYZ.slice(1), true); f.doc.virtual = true;
  try {
    const geometryBinding = await readGeometryBinding(f.doc, (doc, action, options) => requestViewerAction(doc.id, action, 1000, options?.signal, options), () => true);
    await act(async () => f.controller.beginEditing(f.doc, "geometry", { geometryBinding }));
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect((f.errors.at(-1) as Error).message).toContain("read-only");
    writeBrowserDevVirtualTextDocument(f.doc.path, XYZ);
    await act(async () => f.controller.beginEditing(f.doc, "geometry")); expect(f.controller.sessionForDocument(f.doc)).toBeNull();
    f.frame.srcdoc = "<html>another source</html>";
    await act(async () => f.controller.beginEditing(f.doc, "geometry", { geometryBinding }));
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.sent).toEqual([]);
  } finally { deleteBrowserDevVirtualTextDocument(f.doc.path); await f.close(); }
});
test("removing generated XYZ ownership during deferred admission cannot publish a late session", async () => {
  const f = await fixture(XYZ.slice(1), true); f.doc.virtual = true; writeBrowserDevVirtualTextDocument(f.doc.path, XYZ);
  try {
    const geometryBinding = await readGeometryBinding(f.doc, (doc, action, options) => requestViewerAction(doc.id, action, 1000, options?.signal, options), () => true);
    let release!: (document: ViewerDocument) => void; prepare = () => new Promise(resolve => { release = resolve; }); let opening!: Promise<void>;
    await act(async () => { opening = Promise.resolve(f.controller.beginEditing(f.doc, "geometry", { geometryBinding })); });
    deleteBrowserDevVirtualTextDocument(f.doc.path); await act(async () => { release(f.doc); await opening; });
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.errors).toEqual([]); expect(f.sent).toEqual([]);
  } finally { deleteBrowserDevVirtualTextDocument(f.doc.path); await f.close(); }
});

test("registered generated browser XYZ opens Text without a Geometry binding and retains exact drafts", async () => {
  const f = await fixture(undefined, true); f.doc.virtual = true; f.doc.extension = ".XYZ"; writeBrowserDevVirtualTextDocument(f.doc.path, XYZ);
  try {
    await act(async () => f.controller.beginEditing(f.doc));
    expect(f.errors).toEqual([]); expect(f.controller.sessionForDocument(f.doc)?.content).toBe(XYZ);
    await act(async () => f.controller.updateDraft(f.doc, changed));
    expect([f.controller.sessionForDocument(f.doc)?.content, f.controller.sessionForDocument(f.doc)?.previewState, f.sent, f.bindings]).toEqual([changed, "queued", [], []]);
  } finally { deleteBrowserDevVirtualTextDocument(f.doc.path); await f.close(); }
});
test("Text admission refuses foreign virtual XYZ and revoked registration after a source await", async () => {
  const f = await fixture(undefined, true); f.doc.virtual = true;
  try {
    await act(async () => f.controller.beginEditing(f.doc)); expect(f.controller.sessionForDocument(f.doc)).toBeNull();
    expect((f.errors.at(-1) as Error).message).toContain("read-only"); f.errors.length = 0;
    writeBrowserDevVirtualTextDocument(f.doc.path, XYZ);
    let release!: (document: ViewerDocument) => void; prepare = () => new Promise(resolve => { release = resolve; }); let opening!: Promise<void>;
    await act(async () => { opening = Promise.resolve(f.controller.beginEditing(f.doc)); });
    deleteBrowserDevVirtualTextDocument(f.doc.path); await act(async () => { release(f.doc); await opening; });
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.errors).toEqual([]); expect(f.bindings).toEqual([]);
  } finally { deleteBrowserDevVirtualTextDocument(f.doc.path); await f.close(); }
});

test("Text publication rechecks browser ownership after the actual virtual-text read yields", async () => {
  const f = await fixture(undefined, true); f.doc.virtual = true; writeBrowserDevVirtualTextDocument(f.doc.path, XYZ);
  try {
    // The first microtask precedes beginEditing's continuation; the nested one
    // follows its call into the actual async virtual-text reader.
    prepare = async doc => { queueMicrotask(() => queueMicrotask(() => deleteBrowserDevVirtualTextDocument(doc.path))); return doc; };
    await act(async () => f.controller.beginEditing(f.doc));
    expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.errors).toEqual([]); expect(f.bindings).toEqual([]);
  } finally { deleteBrowserDevVirtualTextDocument(f.doc.path); await f.close(); }
});
