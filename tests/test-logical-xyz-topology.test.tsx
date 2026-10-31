import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { plugin as bunPlugin } from "bun";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec.js";
import { PluginContext } from "molstar/lib/mol-plugin/context.js";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms.js";
import { StructureElement } from "molstar/lib/mol-model/structure.js";
import { BuretteTopologyScene } from "../scripts/molstar-topology-scene.js";
import { BuretteGeometry } from "../scripts/molstar-geometry.js";

// The app's actual Compiler, source controller, iframe slots, receiver and model run
// together. Only file/HTML generation and camera capture are platform I/O fixtures.
const compiledPaths: string[] = [];
bunPlugin({ name: "topology-react-compiler", setup(build) {
  build.onLoad({ filter: /apps\/desktop\/src\/(components\/(geometry-panel|workbench\/zmatrix-panel|editor-area\/viewer-frame)\.tsx|hooks\/(use-geometry-binding|use-geometry-live-preview|use-source-editing)\.ts)$/u }, ({ path }) => {
    const tsx = path.endsWith(".tsx"), output = transformSync(readFileSync(path, "utf8"), { filename: path,
      babelrc: false, configFile: false, parserOpts: { plugins: tsx ? ["typescript", "jsx"] : ["typescript"] },
      plugins: [["babel-plugin-react-compiler", {}]] });
    assert.ok(output?.code); if (path.endsWith("use-geometry-binding.ts") || path.endsWith("use-geometry-live-preview.ts")) assert.ok(output.code.includes("react/compiler-runtime"), `memoized ${path}`); compiledPaths.push(path);
    return { contents: output.code, loader: tsx ? "tsx" : "ts" };
  });
} });
const dom = new Window({ url: "http://localhost/" });
const page = dom.document as unknown as Document;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, self: dom, document: page, CSS: dom.CSS,
  Node: dom.Node, NodeFilter: dom.NodeFilter, Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement,
  HTMLSelectElement: dom.HTMLSelectElement, HTMLFormElement: dom.HTMLFormElement, SVGElement: dom.SVGElement,
  DocumentFragment: dom.DocumentFragment, MutationObserver: dom.MutationObserver, Event: dom.Event,
  CustomEvent: dom.CustomEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent, KeyboardEvent: dom.KeyboardEvent,
  FocusEvent: dom.FocusEvent, navigator: dom.navigator, localStorage: dom.localStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => dom.setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: (id: ReturnType<typeof dom.setTimeout>) => dom.clearTimeout(id), getComputedStyle: dom.getComputedStyle.bind(dom),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true })) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { test, mock, afterAll } = await import("bun:test");
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
const browser = await import("../apps/desktop/src/lib/browser-dev-documents");
const htmlText = new Map<string, string>();
const htmlState = new Map<string, string>();
let generated = 0;
const htmlFor = (text: string) => { const html = `<html><head></head><body>fixture-${++generated}</body></html>`; htmlText.set(html, text); return html; };
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browser,
  openBrowserDevTextDocument: async (title: string, extension: string, text: string, _preferences: unknown, _reload: { rendererViewState?: string | null } | undefined, id: string) => {
    const runtimePath = htmlFor(text); if (_reload?.rendererViewState) htmlState.set(runtimePath, _reload.rendererViewState);
    return { id, path: title, title, extension, renderer: "molstar", runtimePath };
  },
}));
mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureText: async (path: string) => browser.readBrowserDevVirtualTextDocument(path),
  readStructureTextDocument: async (path: string) => ({ content: browser.readBrowserDevVirtualTextDocument(path), truncated: false }),
}));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
mock.module("../apps/desktop/src/lib/viewer-view-capture", () => ({ captureViewerView: async () => null }));
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { ViewerFrame } = await import("../apps/desktop/src/components/editor-area/viewer-frame");
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { requestViewerAction } = await import("../apps/desktop/src/lib/viewer-bridge");
const { createRoot } = await import("react-dom/client");
const { restoreScienceSession } = await import("../apps/desktop/src/lib/science-session/restore");
const { encodeScienceSession, decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
const { prepareSceneScienceExport } = await import("../apps/desktop/src/lib/science-session/export");
const { logicalSourceFor, documentUuidFor, beginScienceSessionRestore, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const { scientificStateFor, importedOriginalFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");

const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ShellActions } from "../apps/desktop/src/components/types";

const zmat = "O\r\nX 1 1.0\r\nH 1 R 2 A\r\nH 1 R 2 A 3 180\r\n\r\nR = 0.9572\r\nA = 52.26\r\n";
const source = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
const declaration = source.match(/\n  async function executeBuretteAgentAction\(action, requestOwner\) \{[\s\S]*?\n  \}/u)![0];
const restorePreview = source.match(/\n  async function restoreMeasurementPreview\(viewer, config\) \{[\s\S]*?\n  \}/u)![0];
const globals = source.slice(source.indexOf("  let geometryPreviewRequest ="), source.indexOf(declaration));
const start = source.indexOf("  window.addEventListener('message', event => {", source.indexOf(declaration));
const end = source.indexOf("  window.BuretteViewerActions =", start);
const failure = source.match(/\n  function agentActionFailure\(command, code, message\) \{[\s\S]*?\n  \}/u)![0];
type SceneViewer = { plugin: PluginContext };
type SceneScienceInterop = {
  binding(viewer: SceneViewer): import("../apps/desktop/src/lib/science-session/scene-binding").SceneScienceBindingReport;
  beginImport(plugin: PluginContext): string;
  completeImport(plugin: PluginContext, token: string): boolean;
  serialize(viewer: SceneViewer, source: { binding: import("../apps/desktop/src/lib/science-session/scene-binding").ScienceSceneBinding;
    positions: ArrayLike<number>; assets: import("../apps/desktop/src/lib/science-session/codec").ScienceSessionAsset[] }, params: { type: "molx" }): Promise<Blob>;
};
const sceneWindow: { BuretteSceneFiles?: { science: SceneScienceInterop } } = {};
vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/scene-file-actions.js", import.meta.url), "utf8"),
  { window: sceneWindow, crypto, TextEncoder, TextDecoder, Uint8Array, Float64Array, File });
assert.ok(sceneWindow.BuretteSceneFiles);
const sceneScience = sceneWindow.BuretteSceneFiles.science;
const actors = new Map<HTMLIFrameElement, { plugin: PluginContext; original: string; reads: number }>();
let heldRead: (() => void) | null = null, holdNextRead = false;
async function attach(frame: HTMLIFrameElement, text: string, archive?: Uint8Array) {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  plugin.state.setSnapshotParams({ camera: false });
  if (archive) {
    const token = sceneScience.beginImport(plugin);
    await plugin.managers.snapshot.open(new File([archive as BlobPart], "scene.molx"));
    assert.equal(sceneScience.completeImport(plugin, token), true);
  } else {
    const raw = await plugin.builders.data.rawData({ data: text });
    const trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
    const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model);
  }
  const actor = { plugin, original: text, reads: 0 }; actors.set(frame, actor);
  type Message = { data: unknown; source: { postMessage: (value: unknown) => void } };
  let receive!: (event: Message) => void;
  const server = { ...sceneWindow, molstar: { BuretteGeometry, BuretteTopologyScene, lib: { structure: { StructureElement } } }, BuretteAgent: { run() { throw new Error("Unexpected SDK route"); } },
    addEventListener: (_name: string, callback: typeof receive) => { receive = callback; } };
  vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/geometry-preview.js", import.meta.url), "utf8"), { window: server });
  const viewer = { plugin };
  vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/measurement-coordinate.js", import.meta.url), "utf8"), { window: server, crypto, TextEncoder, Uint8Array });
  const measurementRuntime = async () => (server as unknown as { BuretteMeasurementCoordinate: unknown }).BuretteMeasurementCoordinate;
  new Function("window", "activeMolstarViewer", "bytesToBase64", "activeConfig", "measurementCoordinateRuntime", `${globals}\n${declaration}\n${failure}\n${source.slice(start, end)}`)(server, () => viewer, (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"), {}, measurementRuntime);
  const transfer = htmlState.get(frame.getAttribute("srcdoc")!);
  if (transfer) {
    const restore = new Function("window", "activeMolstarViewer", "measurementCoordinateRuntime", `${restorePreview}; return restoreMeasurementPreview;`)(server, () => viewer, measurementRuntime);
    await restore(viewer, { rendererViewState: transfer });
  }
  const frameWindow = frame.contentWindow!;
  Object.defineProperty(frameWindow, "postMessage", { configurable: true, value: (data: { source?: string; body?: { action?: { type: string } } }) => {
    if (data.source !== "burette-agent-host") return;
    const reading = data.body?.action?.type === "geometry_binding"; if (reading) actor.reads++;
    receive({ data, source: { postMessage: reply => {
      const deliver = () => dom.dispatchEvent(new dom.MessageEvent("message", { source: frameWindow as unknown as typeof dom, data: structuredClone(reply) }));
      if (reading && holdNextRead) { holdNextRead = false; heldRead = deliver; } else deliver();
    } } });
  } });
  return actor;
}
const send: ShellActions["runStructureViewerAction"] = (document, action, options) => requestViewerAction(document.id, action, 1000, options?.signal, { target: options?.target });
let opened = 0;
const actions = {
  runStructureViewerAction: send,
  openStructureRecords: async (records) => records.map(record => {
    const id = `topology-${++opened}`, path = `burette-ketcher://${id}/${record.path}`;
    browser.writeBrowserDevVirtualTextDocument(path, record.text);
    const document = { id, path, title: record.path, extension: record.inputExtension, renderer: "molstar", virtual: true, runtimePath: htmlFor(record.text) } as ViewerDocument;
    useMoleculeStore.setState(state => ({ documents: [...state.documents, document] })); return document;
  }),
} as ShellActions;
let controller!: ReturnType<typeof useSourceEditingController>;
const errors: unknown[] = [];
function Fixture({ document }: { document: ViewerDocument }) {
  controller = useSourceEditingController({ activeDocument: document, preferences: defaultPreferences,
    pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} });
  const session = controller.sessionForDocument(document);
  return <SourceEditingProvider value={controller}>
    <ViewerFrame document={document} sourcePreview={session?.sourcePreview ?? undefined} onStagingLoad={(identity, frame) => controller.stagingLoaded(document, identity, frame)} />
    <GeometryPanel document={document} actions={actions} />
  </SourceEditingProvider>;
}
const wait = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 150 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(predicate(), label);
};
const ready = (frame: HTMLIFrameElement, document: ViewerDocument, source = frame.contentWindow) => dom.dispatchEvent(new dom.MessageEvent("message", {
  source: source as unknown as typeof dom, data: { source: "burette-viewer", body: { type: "ready", renderer: "molstar", documentId: document.id, molstarStructureCount: 1 } },
}));

test("restored logical MOLX topology stages its own model, retains Original and UUID history, and exports/reopens", async () => {
  await openScientificFiles(actions, [new File([zmat], "water.zmat")]);
  const generatedDocument = useMoleculeStore.getState().documents.at(-1)!;
  assert.ok(generatedDocument);
  const initialText = browser.readBrowserDevVirtualTextDocument(generatedDocument.path)!;
  const initialScience = scientificStateFor(generatedDocument.id, initialText).revision!.document;
  const originalFile = importedOriginalFor(generatedDocument.id)!;
  const initialPlugin = new PluginContext(DefaultPluginSpec()); await initialPlugin.init();
  initialPlugin.state.setSnapshotParams({ camera: false });
  const raw = await initialPlugin.builders.data.rawData({ data: initialText });
  const trajectory = await initialPlugin.builders.structure.parseTrajectory(raw, "xyz");
  const model = await initialPlugin.builders.structure.createModel(trajectory); await initialPlugin.builders.structure.createStructure(model);
  const initialBinding = sceneScience.binding({ plugin: initialPlugin });
  const ids = Array.from({ length: 3 }, () => crypto.randomUUID()), uuid = crypto.randomUUID();
  const encoded = await encodeScienceSession({ documentUuid: uuid, source: { extension: "xyz", text: initialText },
    atomIds: ids, binding: initialBinding, science: initialScience, original: originalFile });
  const archive = new Uint8Array(await (await sceneScience.serialize({ plugin: initialPlugin },
    { binding: initialBinding, positions: initialBinding.positions, assets: encoded.assets }, { type: "molx" })).arrayBuffer());
  initialPlugin.dispose();
  const document: ViewerDocument = { ...generatedDocument, path: "/Scenes/restored.molx", title: "restored.molx", extension: "molx", byteCount: archive.length };
  useMoleculeStore.setState({ documents: [document] });
  const mount = page.createElement("div"); page.body.append(mount);
  const root = createRoot(mount);
  const active = () => mount.querySelector<HTMLIFrameElement>("iframe.viewer-iframe")!;
  const button = (label: string) => mount.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const field = () => mount.querySelector<HTMLElement>('[role="spinbutton"][aria-label="Variable R"]');
  const press = async (key: string) => {
    await act(async () => field()!.dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key }) as unknown as Event));
    await act(async () => dom.dispatchEvent(new dom.KeyboardEvent("keyup", { key })));
  };
  const addAtom = async () => {
    await act(async () => button("Add").dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event));
    await wait(() => Boolean(page.querySelector('[role="menuitem"]')), "Add menu opens");
    await act(async () => [...page.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.trim() === "Add atom")!.click());
    await act(async () => page.querySelector<HTMLFormElement>('form[aria-label="New atom"]')!.requestSubmit());
  };
  const reload = async (count: number) => {
    await wait(() => controller.sessionForDocument(document)?.previewState === "queued", "topology draft queued");
    await act(async () => controller.applyPreview(document));
    await wait(() => Boolean(mount.querySelector(".source-preview-staging-iframe")), "real ViewerFrame creates candidate");
    const frame = mount.querySelector<HTMLIFrameElement>(".source-preview-staging-iframe")!;
    const text = htmlText.get(frame.getAttribute("srcdoc")!)!; assert.equal(Number(text.split(/\r?\n/u)[0]), count);
    await attach(frame, text);
    await act(async () => { frame.dispatchEvent(new dom.Event("load") as unknown as Event); ready(frame, document); });
    await wait(() => controller.sessionForDocument(document)?.previewState === "current", "controller acknowledges promotion");
    assert.equal(active() === frame, true, "the real promoted iframe owns the read");
    await wait(() => Boolean(field()) && !button("Undo").disabled, "promoted Geometry remains editable with Undo");
    assert.doesNotMatch(mount.textContent ?? "", /The scene changed\. Read the current source/u);
    assert.ok(actors.get(frame)!.reads > 0, "new unread model read the actual promoted MolStar source");
    return frame;
  };
  try {
    await act(async () => root.render(<Fixture document={document} />));
    const initialFrame = active();
    await attach(initialFrame, initialText, archive);
    await act(async () => { assert.equal(await restoreScienceSession(document,
      { readBytes: async () => archive, request: requestViewerAction, isOpen: () => true, pollMs: 1 }), "restored"); ready(initialFrame, document); });
    const sourceOwner = logicalSourceFor(document.id), originalOwner = importedOriginalFor(document.id);
    assert.equal(await originalOwner!.file.text(), zmat);
    await wait(() => Boolean(field()) && !field()!.hasAttribute("disabled"), "initial no-session reader recovers on actual model ready");
    await press("ArrowUp"); await wait(() => !button("Undo").disabled, "R edit committed");
    assert.equal(field()!.getAttribute("aria-valuenow"), "0.9672");
    await act(async () => button("Undo").click()); await wait(() => field()!.getAttribute("aria-valuenow") === "0.9572", "R undo");
    await act(async () => button("Redo").click()); await wait(() => field()!.getAttribute("aria-valuenow") === "0.9672", "R redo");
    // An old frame response held across promotion cannot authorize the new model.
    holdNextRead = true;
    const oldRead = Promise.resolve(send(document, { type: "geometry_binding", label: "Geometry", notify: false }))
      .then(() => null, (error: unknown) => error);
    await wait(() => heldRead !== null, "old frame ACK held");
    await addAtom();
    const fourFrame = await reload(4);
    await act(async () => { heldRead!(); heldRead = null; });
    assert.equal((await oldRead as Error).message, "The viewer changed before the response arrived.", "late old frame read is rejected rather than rebound");
    assert.match(mount.textContent ?? "", /H4/u);
    assert.equal(Number(BuretteGeometry.binding(actors.get(fourFrame)!.plugin).text.split("\n")[0]), 4);
    await act(async () => button("Undo").click()); const threeFrame = await reload(3);
    await act(async () => button("Redo").click()); const redoFrame = await reload(4);
    assert.notEqual(threeFrame, redoFrame); assert.equal(field()!.getAttribute("aria-valuenow"), "0.9672");
    await press("ArrowUp");
    await wait(() => field()!.getAttribute("aria-valuenow") === "0.9772" && !button("Undo").disabled, "new model accepts coordinate edits");
    const beforeFailure = controller.sessionForDocument(document)!.content;
    await addAtom();
    await wait(() => controller.sessionForDocument(document)?.previewState === "queued", "second topology draft queued");
    await act(async () => controller.applyPreview(document));
    const failed = mount.querySelector<HTMLIFrameElement>(".source-preview-staging-iframe")!;
    assert.ok(failed);
    await attach(failed, htmlText.get(failed.getAttribute("srcdoc")!)!);
    await act(async () => {
      failed.dispatchEvent(new dom.Event("load") as unknown as Event);
      dom.dispatchEvent(new dom.MessageEvent("message", { source: failed.contentWindow as unknown as typeof dom,
        data: { source: "burette-viewer", body: { type: "error", message: "Rejected candidate fixture" } } }));
    });
    await wait(() => controller.sessionForDocument(document)?.previewState === "current" && !button("Undo").disabled, "failed reload restores editable prior model");
    assert.equal(controller.sessionForDocument(document)!.content, beforeFailure);
    assert.equal(active() === redoFrame, true, "failed candidate never replaces the admitted frame");
    assert.equal(BuretteGeometry.binding(actors.get(redoFrame)!.plugin).text, beforeFailure);
    assert.equal(logicalSourceFor(document.id), sourceOwner, "own topology keeps logical source lifetime");
    assert.equal(importedOriginalFor(document.id), originalOwner);
    assert.equal(await originalOwner!.file.text(), zmat, "Original retains exact CRLF bytes");
    assert.equal(document.path, "/Scenes/restored.molx"); assert.equal(document.extension, "molx");
    assert.equal(documentUuidFor(document.id), uuid);
    const exported = await prepareSceneScienceExport(document, { sourceEditing: controller, sceneFileCount: 1, isOpen: () => true });
    assert.equal(exported?.kind, "science"); if (exported?.kind !== "science") throw new Error("No scientific export");
    const output = await requestViewerAction(document.id, exported.action); await exported.confirm();
    const bytes = new Uint8Array(Buffer.from(output.dataBase64 as string, "base64"));
    const decoded = (await decodeScienceSession(bytes))!;
    assert.equal(decoded.source.text, beforeFailure); assert.equal(decoded.documentUuid, uuid);
    assert.deepEqual(decoded.atomIds?.slice(0, 3), ids); assert.equal(decoded.atomIds?.length, 4);
    assert.equal(await decoded.original!.file.text(), zmat);
    const reopened = new PluginContext(DefaultPluginSpec()); await reopened.init();
    const token = sceneScience.beginImport(reopened); await reopened.managers.snapshot.open(new File([bytes], "again.molx"));
    assert.equal(sceneScience.completeImport(reopened, token), true);
    assert.equal(sceneScience.binding({ plugin: reopened }).atomCount, 4); reopened.dispose();
    // Superseding a staged topology transaction is cancellation, not permission
    // for its late iframe to become the current scene.
    await addAtom();
    await wait(() => controller.sessionForDocument(document)?.previewState === "queued", "cancellable topology queued");
    await act(async () => controller.applyPreview(document));
    const cancelledFrame = mount.querySelector<HTMLIFrameElement>(".source-preview-staging-iframe")!;
    await attach(cancelledFrame, htmlText.get(cancelledFrame.getAttribute("srcdoc")!)!);
    const cancelledSource = cancelledFrame.contentWindow;
    await act(async () => cancelledFrame.dispatchEvent(new dom.Event("load") as unknown as Event));
    await act(async () => controller.updateDraft(document, beforeFailure, { previewApplied: true }));
    await act(async () => ready(cancelledFrame, document, cancelledSource));
    await wait(() => !button("Undo").disabled, "cancel retains prior editable model");
    assert.equal(controller.sessionForDocument(document)!.content, beforeFailure);
    assert.equal(active(), redoFrame, "cancelled candidate cannot publish late");

    // A new actual native import revokes the old source generation, including
    // an old candidate whose ready message arrives after the new restore.
    await addAtom();
    await wait(() => controller.sessionForDocument(document)?.previewState === "queued", "old generation topology queued");
    await act(async () => controller.applyPreview(document));
    const lateFrame = mount.querySelector<HTMLIFrameElement>(".source-preview-staging-iframe")!;
    await attach(lateFrame, htmlText.get(lateFrame.getAttribute("srcdoc")!)!);
    const lateSource = lateFrame.contentWindow;
    await act(async () => lateFrame.dispatchEvent(new dom.Event("load") as unknown as Event));
    await act(async () => { beginScienceSessionRestore(document.id); });
    const replacementFrame = active();
    await attach(replacementFrame, beforeFailure, bytes);
    await act(async () => {
      assert.equal(await restoreScienceSession(document, { readBytes: async () => bytes,
        request: requestViewerAction, isOpen: () => true, pollMs: 1 }), "restored");
      ready(replacementFrame, document);
    });
    const replacement = logicalSourceFor(document.id);
    assert.notEqual(replacement, sourceOwner); assert.equal(replacement!.text, beforeFailure);
    await act(async () => ready(lateFrame, document, lateSource));
    assert.equal(logicalSourceFor(document.id), replacement);
    assert.equal(controller.sessionForDocument(document), null, "retired old draft cannot publish into replacement");
    assert.equal(controller.getWindowDirtySnapshot().dirty, true, "retired unsaved draft remains recoverable");
    const replacementPlugin = actors.get(replacementFrame)!.plugin;
    // Explicitly discard only the retired draft through the actual recovery dialog.
    await act(async () => { void controller.beginEditing(document, "geometry"); });
    await wait(() => Boolean(controller.recovery), "retired draft recovery is reachable");
    await act(async () => [...page.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Discard")!.click());
    await wait(() => controller.recovery === null, "explicit Discard settles recovery without closing replacement");
    // Native Undo during candidate loading revokes the receipt used to create
    // that candidate, even if it returns the original source bytes/positions.
    await addAtom();
    await wait(() => controller.sessionForDocument(document)?.previewState === "queued", "native Undo candidate queued");
    await act(async () => controller.applyPreview(document));
    const undoneCandidate = mount.querySelector<HTMLIFrameElement>(".source-preview-staging-iframe")!;
    await attach(undoneCandidate, htmlText.get(undoneCandidate.getAttribute("srcdoc")!)!);
    const priorPlugin = actors.get(replacementFrame)!.plugin;
    const retained = await send(document, { type: "geometry_binding", label: "Geometry", notify: false }) as { lease: string; text: string };
    await priorPlugin.state.data.build().toRoot().apply(StateTransforms.Data.RawData, { data: "native action during topology" }).commit({ canUndo: "Native source action" });
    const nativeDraft = retained.text.split("\n"), nativeAtom = nativeDraft[2].trim().split(/\s+/u);
    nativeAtom[1] = String(Number(nativeAtom[1]) + 0.1); nativeDraft[2] = nativeAtom.join(" ");
    await send(document, { type: "update_geometry", label: "Geometry", text: nativeDraft.join("\n"), lease: retained.lease, notify: false });
    await priorPlugin.runTask(priorPlugin.state.data.undo());
    const undoneState = priorPlugin.state.data.getSnapshot();
    await act(async () => { undoneCandidate.dispatchEvent(new dom.Event("load") as unknown as Event); ready(undoneCandidate, document); });
    await wait(() => controller.sessionForDocument(document)?.content === beforeFailure && controller.sessionForDocument(document)?.previewState === "paused", "native Undo rejects queued topology and keeps the source unapplied");
    assert.equal(active(), replacementFrame, "a queued topology cannot replace the natively undone model");
    assert.deepEqual(priorPlugin.state.data.getSnapshot(), undoneState);

    assert.equal(controller.sessionForDocument(document)!.diagnostic, "The Geometry source or viewer changed.");
    assert.equal(button("Undo").disabled, true, "revoked native owner cannot authorize another computed edit");
    await assert.rejects(() => send(document, { type: "update_geometry", label: "Geometry", text: retained.text,
      lease: retained.lease, notify: false }) as Promise<unknown>, { message: "The Geometry source or viewer changed." });
    assert.equal(logicalSourceFor(document.id), replacement);


    assert.equal(errors.length, 0);
    assert.ok(compiledPaths.some(path => path.endsWith("use-source-editing.ts")));
    assert.ok(compiledPaths.some(path => path.endsWith("viewer-frame.tsx")));
  } finally {
    await act(async () => root.unmount()); mount.remove();
    for (const actor of actors.values()) actor.plugin.dispose(); actors.clear();
    releaseClosedScienceSessions(new Set()); releaseClosedImports(new Set());
  }
}, 20_000);
