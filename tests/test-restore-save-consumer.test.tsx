import { test, expect, mock } from "bun:test";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";
import { PluginStateSnapshotManager } from "../node_modules/molstar/lib/mol-plugin-state/manager/snapshots.js";
import { fakeViewer, realSdfViewer, science, waterScience, XYZ, bindingOf } from "./science-session-fixture";

plugin({ name: "compiled-restore-save-boundary", setup(build) {
  build.onLoad({ filter: /(?:science-session\/(restore|export)|hooks\/use-workspace-file-actions)\.ts$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "ts",
  }));
} });
const browser = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: browser, document: browser.document, Event: browser.Event, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
let readBytes: () => Promise<Uint8Array> = async () => { throw new Error("No selected archive"); };
let viewer = fakeViewer(XYZ), native = false;
let documents: ViewerDocument[] = [], writes: Uint8Array[] = [];
let dialog: () => Promise<string | null> = async () => "/saved.molx";
let snapshotDelay: Promise<void> | null = null;
let sourceText: string | null = null;
let focusPlan: () => Promise<void> = async () => {};
let openDocumentPlan: () => Promise<any> = async () => { throw new Error("Unexpected materialization"); };
const urls = new Map<string, Blob>(); let nextUrl = 0;
URL.createObjectURL = blob => { if (!(blob instanceof Blob)) throw new Error("Expected a scene Blob"); const url = `blob:test-${++nextUrl}`; urls.set(url, blob); return url; };
URL.revokeObjectURL = url => { urls.delete(url); };
browser.HTMLAnchorElement.prototype.click = function () {
  const blob = urls.get(this.href); if (!blob) throw new Error("Missing download Blob");
  writes.push(new Uint8Array());
  const index = writes.length - 1;
  void blob.arrayBuffer().then(buffer => { writes[index] = new Uint8Array(buffer); });
};
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: { request: { contentsBase64: string; outputPath: string } }) => {
  if (command === "open_documents") return openDocumentPlan();
  if (command === "abort_open_document_claim") return;
  if (command !== "write_base64_file") throw new Error(`Unexpected native ${command}`);
  writes.push(Uint8Array.from(atob(args.request.contentsBase64), ch => ch.charCodeAt(0))); return args.request.outputPath;
} }));
mock.module("@tauri-apps/plugin-dialog", () => ({ save: () => dialog() }));
mock.module("../apps/desktop/src/lib/native-menu", () => ({ currentDocumentRegistryRevision: () => 0 }));
mock.module("../apps/desktop/src/lib/perf-trace", () => ({ tracePerf() {} }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native }));
mock.module("../apps/desktop/src/hooks/workspace-scene-import", () => ({ appendScenePayload() {}, focusSceneDocument: async () => focusPlan() }));
mock.module("../apps/desktop/src/hooks/workspace-chemical-copy", () => ({ validatePoseFiles() {}, validatePoseRecords() {} }));
mock.module("../apps/desktop/src/components/workspace-menu-items", () => ({ fileCapabilities: () => ({ scene: true }) }));
mock.module("../apps/desktop/src/lib/clipboard", () => ({ writeClipboardText() {} }));
mock.module("../apps/desktop/src/lib/docking-documents", () => ({ togetherDockingRequest() {} }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: {
  getState: () => ({ documents, replaceDocument: (id: string, replacement: ViewerDocument) => { documents = documents.map(doc => doc.id === id ? replacement : doc); } }), setState: (update: (state: { documents: ViewerDocument[] }) => { documents: ViewerDocument[] }) => { documents = update({ documents }).documents; },
} }));
const request = async (_id: string, action: Record<string, any>) => {
  if (action.type === "workspace_scene_state") return { ready: true };
  if (action.type === "scene_science_binding") return action.sourceExtension === "sdf" ? science.sdfBinding(viewer.viewer) : science.binding(viewer.viewer);
  if (action.type === "scene_science_restore_ack") return { adopted: await science.adoptValidated(viewer.viewer, action) };
  if (action.type === "workspace_scene_snapshot") {
    const blob = action.science ? await science.serialize(viewer.viewer, action.science, { type: "molx" }) : await viewer.viewer.plugin.managers.snapshot.serialize({ type: "molx" });
    const bytes = new Uint8Array(await blob.arrayBuffer()); await snapshotDelay;
    return { dataBase64: Buffer.from(bytes).toString("base64") };
  }
  throw new Error(`Unexpected ${action.type}`);
};
mock.module("../apps/desktop/src/lib/science-session/source-bytes", () => ({ readSceneDocumentBytes: () => readBytes() }));
mock.module("../apps/desktop/src/lib/viewer-bridge", () => ({ requestViewerAction: request, requestGridView() {} }));
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ readBrowserDevVirtualTextDocument: () => null }));
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureText: async () => { if (sourceText !== null) return sourceText; throw new Error("Archive read as text"); } }));
const errors: unknown[] = [];
mock.module("../apps/desktop/src/components/ui/toast", () => ({ toast: { add: (error: unknown) => errors.push(error) } }));
const { useScienceSessionRestore, waitForSceneScienceRestore } = await import("../apps/desktop/src/lib/science-session/restore");
const { prepareSceneScienceExport } = await import("../apps/desktop/src/lib/science-session/export");
const { encodeScienceSession, decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
const { useWorkspaceFileActions } = await import("../apps/desktop/src/hooks/use-workspace-file-actions");
const { logicalSourceFor, beginScienceSessionRestore } = await import("../apps/desktop/src/lib/science-session/state");
const original = Uint8Array.of(0xef, 0xbb, 0xbf, 13, 10, 0, 255);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

async function scientificArchive() {
  const binding = bindingOf(science.binding(viewer.viewer));
  const encoded = await encodeScienceSession({ documentUuid: "0f8fad5b-d9cb-469f-a165-70867728950e", source: { extension: "xyz", text: XYZ },
    atomIds: ["o", "h1", "h2"], binding, science: waterScience(), original: { name: "water.out", file: new Blob([original]) } });
  const blob = await science.serialize(viewer.viewer, { binding, positions: Float64Array.from(science.binding(viewer.viewer).positions), assets: encoded.assets }, { type: "molx" });
  return new Uint8Array(await blob.arrayBuffer());
}

let sequence = 0;
async function mountScene(cold = false, foreign = false) {
  native = false; writes = []; snapshotDelay = null; sourceText = null; focusPlan = async () => {}; dialog = async () => "/saved.molx";
  viewer = fakeViewer(XYZ);
  const bytes = foreign ? new Uint8Array(await (await viewer.viewer.plugin.managers.snapshot.serialize({ type: "molx" })).arrayBuffer()) : await scientificArchive(), hold = deferred<Uint8Array>();
  readBytes = () => hold.promise;
  const plugin = viewer.viewer.plugin as any;
  Object.assign(plugin, { runTask: (task: { run: () => Promise<unknown> }) => task.run(), log: { error() {} } });
  const importToken = science.beginImport(plugin);
  await (PluginStateSnapshotManager.prototype.open as any).call({ plugin, setStateSnapshot: async () => {}, events: { opened: { next() {} } } }, new File([bytes], "scene.molx"));
  expect(science.completeImport(plugin, importToken)).toBe(true);
  const doc = { id: `scene-${++sequence}`, path: "/Scenes/science.molx", title: "science.molx", extension: "molx", renderer: "molstar", viewerProfile: "structure", byteCount: bytes.length, ...(cold ? { runtimeDeferred: true, runtimePath: "" } : {}) } as any;
  documents = [doc];
  const host = browser.document.createElement("div"), root = createRoot(host as unknown as HTMLElement);
  let actions!: ReturnType<typeof useWorkspaceFileActions>;
  function Fixture() {
    actions = useWorkspaceFileActions({ documents, tabs: [], pinnedStructurePaths: [] } as any,
      { selectDocument() {}, openPaths: async () => {}, togglePinnedStructure() {} } as any);
    return null;
  }
  const render = () => act(async () => root.render(<Fixture />));
  await render();
  return { bytes, hold, doc, render, save: () => actions.saveScene(doc),
    async close() { hold.resolve(bytes); documents = []; await render(); await act(async () => root.unmount()); } };
}

test("compiled actual Save Scene waits for pending restore and preserves science/Original", async () => {
  const scene = await mountScene();
  try {
    const saving = scene.save(); await tick();
    expect(writes).toHaveLength(0); expect(logicalSourceFor(scene.doc.id)).toBeNull();
    scene.hold.resolve(scene.bytes); await act(async () => saving); await tick();
    expect(writes).toHaveLength(1);
    const result = (await decodeScienceSession(writes[0]))!;
    expect(result.science).toEqual(waterScience());
    expect(new Uint8Array(await result.original!.file.arrayBuffer())).toEqual(original);
  } finally { await scene.close(); }
});

test("validated foreign archive keeps normal plain Save only after restore resolves", async () => {
  const scene = await mountScene(false, true);
  try {
    const foreign = new Uint8Array(await (await viewer.viewer.plugin.managers.snapshot.serialize({ type: "molx" })).arrayBuffer());
    const saving = scene.save(); await tick(); expect(writes).toHaveLength(0);
    scene.hold.resolve(foreign); await act(async () => saving); await tick();
    expect(writes).toHaveLength(1); expect(await decodeScienceSession(writes[0])).toBeNull();
  } finally { await scene.close(); }
});

test("failed restore keeps Save failed instead of silently falling back to plain MOLX", async () => {
  const scene = await mountScene();
  try {
    const saving = scene.save(); void saving.catch(() => {});
    scene.hold.resolve(Uint8Array.of(1, 2, 3));
    await expect(saving).rejects.toThrow();
    await expect(scene.save()).rejects.toThrow(); expect(writes).toHaveLength(0);
  } finally { await scene.close(); }
});

test("cancelled restore cannot be treated as a validated foreign archive", async () => {
  const scene = await mountScene();
  try {
    const saving = scene.save(); void saving.catch(() => {}); await tick();
    beginScienceSessionRestore(scene.doc.id); scene.hold.resolve(scene.bytes);
    await expect(saving).rejects.toThrow(/cancelled/u); expect(writes).toHaveLength(0);
  } finally { await scene.close(); }
});

test("closed or replaced document invalidates a pending Save even when the id is reused", async () => {
  for (const replace of [false, true]) {
    const scene = await mountScene();
    try {
      const saving = scene.save(); void saving.catch(() => {}); await tick();
      const foreign = new Uint8Array(await (await viewer.viewer.plugin.managers.snapshot.serialize({ type: "molx" })).arrayBuffer());
      readBytes = async () => foreign;
      documents = replace ? [{ ...scene.doc, runtimePath: "/new/archive.molx" }] : [];
      await scene.render(); scene.hold.resolve(scene.bytes);
      await expect(saving).rejects.toThrow(/closed or changed/u); expect(writes).toHaveLength(0);
    } finally { await scene.close(); }
  }
});

test("source replacement during native Save dialog refuses the final platform write", async () => {
  const scene = await mountScene();
  try {
    scene.hold.resolve(scene.bytes); await act(async () => { await tick(); });
    native = true;
    const picked = deferred<string | null>(), opened = deferred<void>();
    dialog = () => { opened.resolve(); return picked.promise; };
    const saving = scene.save(); void saving.catch(() => {}); await opened.promise;
    documents = [{ ...scene.doc, runtimePath: "/another/archive.molx" }];
    readBytes = async () => scene.bytes; await scene.render(); picked.resolve("/saved.molx");
    await expect(saving).rejects.toThrow(/closed or changed/u); expect(writes).toHaveLength(0);
  } finally { await scene.close(); }
});

test("metadata-only document replacement during native dialog retains the same source lifetime", async () => {
  const scene = await mountScene();
  try {
    scene.hold.resolve(scene.bytes); await act(async () => { await tick(); });
    native = true;
    const picked = deferred<string | null>(), opened = deferred<void>();
    dialog = () => { opened.resolve(); return picked.promise; };
    const saving = scene.save(); await opened.promise;
    documents = [{ ...scene.doc, title: "Renamed scene", sceneUnsaved: false }];
    await scene.render(); picked.resolve("/saved.molx"); await saving;
    expect(writes).toHaveLength(1); expect((await decodeScienceSession(writes[0]))!.science).toEqual(waterScience());
  } finally { await scene.close(); }
});



test("a source runtime replacement during the original raw-byte read cannot reuse the old Save", async () => {
  native = false; writes = []; snapshotDelay = null;
  const bytes = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url));
  sourceText = bytes.toString(); viewer = await realSdfViewer(sourceText);
  const doc = { id: "raw-source-replacement", path: "/A/ethanol.sdf", runtimePath: "/runtime/old.sdf", title: "ethanol.sdf", extension: "sdf", renderer: "molstar", viewerProfile: "structure", byteCount: bytes.length } as any;
  const hold = deferred<Uint8Array>(), entered = deferred<void>(); let reads = 0;
  readBytes = () => { if (++reads === 1) { entered.resolve(); return hold.promise; } return Promise.resolve(bytes); };
  documents = [doc]; const root = createRoot(browser.document.createElement("div") as unknown as HTMLElement);
  let actions!: ReturnType<typeof useWorkspaceFileActions>;
  function Fixture() { actions = useWorkspaceFileActions({ documents, tabs: [], pinnedStructurePaths: [] } as any, { selectDocument() {} } as any); return null; }
  try {
    await act(async () => root.render(<Fixture />));
    const saving = actions.saveScene(doc); void saving.catch(() => {}); await entered.promise;
    documents = [{ ...doc, runtimePath: "/runtime/new.sdf" }];
    await act(async () => root.render(<Fixture />)); hold.resolve(bytes);
    await expect(saving).rejects.toThrow(/closed|changed/u); expect(writes).toHaveLength(0);
  } finally {
    hold.resolve(bytes); documents = []; await act(async () => root.render(<Fixture />)); await act(async () => root.unmount()); sourceText = null;
  }
});


test("a different source replacing the document during focus is rejected before preparing export", async () => {
  const scene = await mountScene();
  try {
    const focused = deferred<void>(), releaseFocus = deferred<void>();
    focusPlan = () => { focused.resolve(); return releaseFocus.promise; };
    const saving = scene.save(); void saving.catch(() => {}); await focused.promise;
    documents = [{ ...scene.doc, runtimePath: "/replaced-during-focus.molx" }];
    readBytes = async () => scene.bytes; await scene.render(); releaseFocus.resolve();
    await expect(saving).rejects.toThrow(/closed or changed/u); expect(writes).toHaveLength(0);
  } finally { await scene.close(); }
});

test("Save Scene can materialize its genuinely owned cold document through the real native preparation helper", async () => {
  const scene = await mountScene(true);
  try {
    native = true;
    const prepared = { ...scene.doc, runtimeDeferred: false, runtimePath: "/owned/runtime.molx", openClaimId: "owned-claim" };
    openDocumentPlan = async () => ({ documents: [prepared], errors: [] });
    readBytes = async () => scene.bytes;
    focusPlan = () => scene.render();
    await scene.save();
    expect(writes).toHaveLength(1);
    expect((await decodeScienceSession(writes[0]))!.science).toEqual(waterScience());
  } finally { await scene.close(); }
});
