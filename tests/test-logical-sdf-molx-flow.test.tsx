import { expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import vm from "node:vm";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
plugin({ name: "logical-sdf-flow-compiler", setup(build) {
  build.onLoad({ filter: /(?:hooks\/use-source-editing|lib\/workbench\/use-graph-draft)\.ts$/u }, ({ path }) => ({ contents: transformSync(readFileSync(path, "utf8"), {
    filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]],
  })!.code!, loader: "ts" }));
} });
const browser = new Window({ url: "http://localhost/" }); Object.assign(browser, { setImmediate, clearImmediate });
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "MessageEvent", "CustomEvent", "MutationObserver", "localStorage", "CSS"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });
const sourceFiles = new Map<string, string>(), binaryFiles = new Map<string, Uint8Array>();
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureText: async path => {
  if (!sourceFiles.has(path)) throw new Error("An archive cannot be read as source text."); return sourceFiles.get(path);
}, readStructureTextDocument: async () => { throw new Error("The restored scene must use its logical source."); } }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async doc => doc, useDeferredViewerRuntime: doc => doc }));
globalThis.fetch = async input => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/__burette/trajectory-pair") return new Response(null, { status: 404 });
  const path = url.searchParams.get("path") ?? decodeURIComponent(url.pathname.replace(/^\/@fs/u, ""));
  const bytes = binaryFiles.get(path); if (!bytes) throw new Error(`Unexpected source request: ${url.pathname}`);
  return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
};
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js"), { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
const { StructureElement } = await import("molstar/lib/mol-model/structure.js");
const { setCanvasModule } = await import("molstar/lib/mol-geo/geometry/text/font-atlas.js");
setCanvasModule({ createCanvas: () => ({ getContext: () => ({ measureText: () => ({ width: 12 }), clearRect() {}, fillText() {}, getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) }) } as never);
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { useGraphDraft } = await import("../apps/desktop/src/lib/workbench/use-graph-draft");
const { graphSourceMetadata, graphDraftText } = await import("../apps/desktop/src/lib/workbench/graph-draft");
const { decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
const { prepareSceneScienceExport } = await import("../apps/desktop/src/lib/science-session/export");
const { restoreScienceSession } = await import("../apps/desktop/src/lib/science-session/restore");
const { readSceneDocumentBytes } = await import("../apps/desktop/src/lib/science-session/source-bytes");
const { logicalSourceFor, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const { releaseScopedScientificSource } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { openBrowserDevDocuments } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { requestViewerAction } = await import("../apps/desktop/src/lib/viewer-bridge");
const code = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
const extract = name => code.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, "u"))![0];
const scope: Record<string, any> = { molstar: { lib: { structure: { StructureElement } } } };
for (const name of ["scene-file-actions", "measurement-coordinate"]) vm.runInNewContext(readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), "utf8"), { window: scope, crypto, TextEncoder, TextDecoder, Uint8Array, Float64Array, File });
const science = scope.BuretteSceneFiles.science, measurements = scope.BuretteMeasurementCoordinate;
const camera = { position: [12, 3, 4], target: [0, 0, 0], up: [0, 1, 0], radius: 9, mode: "perspective" };
const configOf = (runtime: string) => JSON.parse(/window\.BuretteConfig\s*=\s*(\{[^\n]*?\});/u.exec(runtime)![1]);
const dataOf = (runtime: string) => Buffer.from(JSON.parse(/window\.BuretteDataBase64 = ("[^"\n]*");/u.exec(runtime)![1]), "base64").toString("utf8");
const until = async ready => { for (let i = 0; i < 250 && !ready(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(ready()).toBe(true); };

test("real SDF archive restore, compiled edits, Undo/Redo and fresh MOLX reopen preserve measurements, UUIDs and Original bytes", async () => {
  const sample = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8");
  const metadata = graphSourceMetadata(sample, "sdf", 3)!, ids = metadata.atoms.map(atom => atom.id);
  const source = graphDraftText(sample, "sdf", sample.split("$$$$")[0], metadata).replace(/\n/gu, "\r\n");
  const original = new TextEncoder().encode("\uFEFF" + source), initialPath = "/Structures/retained.sdf";
  sourceFiles.set(initialPath, source); binaryFiles.set(initialPath, original);
  const preferences = { ...defaultPreferences, rendererMode: "molstar" } as const;
  const plugins: any[] = [], frames: HTMLIFrameElement[] = [], readyCounts: number[] = [];
  // The headless plugin has no GPU camera; disable only snapshot camera capture through its public API.
  // Preview transport below still carries and verifies the authored camera fixture.
  const newPlugin = async () => { const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init(); plugin.state.setSnapshotParams({ camera: false }); plugins.push(plugin); return plugin; };
  const textViewer = async text => {
    const plugin = await newPlugin(), raw = await plugin.builders.data.rawData({ data: text });
    const trajectory = await plugin.builders.structure.parseTrajectory(raw, "sdf");
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" }); return { plugin };
  };
  const archiveViewer = async (bytes: Uint8Array) => { const plugin = await newPlugin(); const token = science.beginImport(plugin); await plugin.managers.snapshot.open(new File([bytes], "scene.molx")); expect(science.completeImport(plugin, token)).toBe(true); return { plugin }; };
  const runtimeGetter = new Function("window", `${extract("measurementCoordinateRuntime")};return measurementCoordinateRuntime;`)(scope);
  function attach(viewer, docId: string) {
    const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = docId; frame.dataset.renderer = "molstar";
    document.body.append(frame); frames.push(frame); const source = frame.contentWindow!;
    const execute = new Function("activeMolstarViewer", "measurementCoordinateRuntime", "window", "activeConfig", "bytesToBase64", "document", `${extract("executeBuretteAgentAction")};return executeBuretteAgentAction;`)(() => viewer, runtimeGetter, scope, {}, bytes => Buffer.from(bytes).toString("base64"), document);
    const cameraBranch = code.slice(code.indexOf("    if (event.source === window.parent && body.type === 'captureRendererViewState')"), code.indexOf("    if (event.source === window.parent && body.type === 'hostLayoutGesture')"));
    source.postMessage = envelope => {
      if (envelope.body.type === "captureRendererViewState") new Function("activeViewer", "captureMolstarCameraSnapshot", "postHostMessage", "window", "body", "event", cameraBranch)(viewer, () => camera, body => window.dispatchEvent(new MessageEvent("message", { source, data: { source: "burette-viewer", body: { ...body, documentId: docId } } })), { parent: window }, envelope.body, { source: window });
      else if (envelope.body.type === "agent-action") void execute(envelope.body.action).catch(error => ({ ok: false, error: { message: error.message } })).then(result => window.dispatchEvent(new MessageEvent("message", { source, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: envelope.body.id, result } } })));
    };
    return frame;
  }
  async function browserOpen(path: string, bytes: Uint8Array) { binaryFiles.set(path, bytes); const result = await openBrowserDevDocuments([path], preferences); expect(result.errors).toEqual([]); expect(result.documents).toHaveLength(1); expect(result.documents[0].viewerProfile).toBe("structure"); return result.documents[0]; }
  async function exportScene(document, sourceEditing) {
    const prepared = await prepareSceneScienceExport(document, { sourceEditing, sceneFileCount: 1, isOpen: () => true });
    expect(prepared?.kind).toBe("science"); if (prepared?.kind !== "science") throw new Error("Missing scientific archive.");
    const result = await requestViewerAction(document.id, prepared.action); await prepared.confirm(); return Uint8Array.from(Buffer.from(result.dataBase64 as string, "base64"));
  }
  let controller!: ReturnType<typeof useSourceEditingController>, graph!: ReturnType<typeof useGraphDraft>, scene: any;
  const errors: unknown[] = [], host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Graph() { graph = useGraphDraft(scene); return null; }
  function Fixture() { controller = useSourceEditingController({ activeDocument: scene, preferences, pushErrorStatus: cause => errors.push(cause), setDockOpen() {}, setDockActiveTab() {} }); return <SourceEditingProvider value={controller}><Graph /></SourceEditingProvider>; }
  const current = () => controller.sessionForDocument(scene)!;
  try {
    const initial = await textViewer(source), initialDoc = await browserOpen(initialPath, original), initialFrame = attach(initial, initialDoc.id);
    const structure = initial.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data, unit = structure.units[0];
    const loci = index => StructureElement.Loci(structure, [{ unit, indices: Int32Array.of(index) as never }]);
    await initial.plugin.managers.structure.measurement.addDistance(loci(0), loci(2), { visualParams: { visuals: ["lines"], customText: "Archive distance", linesColor: 0x123456 } });
    const expected = await measurements.capture(initial, science), firstBytes = await exportScene(initialDoc, null);
    const first = (await decodeScienceSession(firstBytes))!; expect(first.atomIds).toEqual(ids); expect(new Uint8Array(await first.original!.file.arrayBuffer())).toEqual(original);
    initialFrame.hidden = true; scene = await browserOpen("/Scenes/first.molx", firstBytes);
    let active = await archiveViewer(firstBytes), activeFrame = attach(active, scene.id);
    await act(async () => root.render(<Fixture />)); expect(graph.history).toBeNull();
    await act(async () => { expect(await restoreScienceSession(scene, { readBytes: readSceneDocumentBytes, request: requestViewerAction, isOpen: () => true, pollMs: 1 })).toBe("restored"); });
    await until(() => Boolean(graph.history)); expect(graph.error).toBeNull(); expect(logicalSourceFor(scene.id)?.text).toBe(source);
    expect(graph.history!.current.metadata!.atoms.map(atom => atom.id)).toEqual(ids);
    async function finish() {
      await until(() => { const session = current(), preview = session?.sourcePreview; return session?.previewState === "staging" && preview?.slots[preview.activeSlot === "primary" ? "secondary" : "primary"]?.identity?.revision === session.revision; });
      const before = current().sourcePreview!, staged = before.slots[before.activeSlot === "primary" ? "secondary" : "primary"]!;
      const config = configOf(staged.runtimePath), raw = dataOf(staged.runtimePath);
      expect([config.label, config.format, config.sourceExtension, config.viewerProfile]).toEqual(["first.sdf", "sdf", "sdf", "structure"]);
      expect(raw).toBe(current().content); expect(JSON.parse(config.rendererViewState).camera).toEqual(camera);
      expect(current().sourcePreview!.activeSlot).toBe(before.activeSlot);
      const next = await textViewer(raw), frame = attach(next, scene.id); frame.dataset.sourcePreviewRole = "staging";
      await act(async () => controller.stagingLoaded(scene, staged.identity!, frame));
      const startup = extract("startMolstar"), restore = /    await restoreMeasurementPreview\(viewer, config\);/u.exec(startup)!, ready = /    \{\n      const poseCount =[\s\S]*?\n    \}/u.exec(startup)!;
      const boundary = [restore, ready].sort((a, b) => a.index - b.index).map(match => match[0]).join("\n");
      const run = new Function("window", "measurementCoordinateRuntime", "normalizeRenderer", "currentMolstarStructureCount", "setStatus", "setTimeout", "hideStatus", "isQuickLookHost", `${extract("restoreMeasurementPreview")};${extract("previewReadyPayload")};${extract("molstarReadyPayload")};return async (viewer,config,prepared)=>{${boundary}};`)(scope, runtimeGetter, value => value, v => v.plugin.managers.structure.hierarchy.current.structures.length, () => {}, callback => callback(), payload => {
        readyCounts.push(next.plugin.managers.structure.measurement.state.distances.length); window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { source: "burette-viewer", body: { type: "ready", ...payload } } }));
      }, () => false);
      await act(async () => run(next, config, {})); await until(() => current().previewState === "current");
      const capture = await measurements.capture(next, science); expect({ items: capture.items, group: capture.group }).toEqual({ items: expected.items, group: expected.group });
      activeFrame.hidden = true; activeFrame = frame; frame.dataset.sourcePreviewRole = "active"; active = next;
      expect(graph.history!.current.metadata!.atoms.map(atom => atom.id)).toEqual(ids);
    }
    const positions = graph.history!.current.structure.atoms.map((atom, index) => [atom.x, atom.y + (index === 2 ? .5 : 0), atom.z] as [number, number, number]);
    await act(async () => { expect(await graph.apply({ kind: "positions", coordinates: positions, from: graph.history!.current })).not.toBeNull(); }); await finish();
    const positioned = current().content; expect(graph.history!.current.structure.atoms[2].y).toBe(.5);
    await act(async () => { expect(await graph.apply({ kind: "metadata", patch: { conformerLabel: "After scene restore" }, from: graph.history!.current })).not.toBeNull(); }); await finish();
    const edited = current().content; expect(graph.history!.current.metadata!.conformer.label).toBe("After scene restore");
    for (const [operation, text] of [["undo", positioned], ["undo", source], ["redo", positioned], ["redo", edited]] as const) { await act(async () => { await graph[operation](); }); expect(current().content).toBe(text); await finish(); }
    expect(current().content).toBe(edited); expect(readyCounts).toEqual([1, 1, 1, 1, 1, 1]); expect(errors).toEqual([]);
    const finalBytes = await exportScene(scene, controller), final = (await decodeScienceSession(finalBytes))!;
    expect({ source: final.source, uuid: final.documentUuid, atoms: final.atomIds }).toEqual({ source: { extension: "sdf", text: edited }, uuid: first.documentUuid, atoms: ids });
    expect(new Uint8Array(await final.original!.file.arrayBuffer())).toEqual(original);
    const reopened = await browserOpen("/Scenes/final.molx", finalBytes), fresh = await archiveViewer(finalBytes); attach(fresh, reopened.id);
    expect(await restoreScienceSession(reopened, { readBytes: readSceneDocumentBytes, request: requestViewerAction, isOpen: () => true, pollMs: 1 })).toBe("restored");
    expect(logicalSourceFor(reopened.id)).toEqual({ documentId: reopened.id, extension: "sdf", text: edited });
    const capture = await measurements.capture(fresh, science); expect({ items: capture.items, group: capture.group }).toEqual({ items: expected.items, group: expected.group });
    releaseScopedScientificSource(reopened.id);
  } finally { await act(async () => root.unmount()); if (scene) releaseScopedScientificSource(scene.id); releaseClosedScienceSessions(new Set()); host.remove(); frames.forEach(frame => frame.remove()); plugins.forEach(plugin => plugin.dispose()); }
}, 30_000);
