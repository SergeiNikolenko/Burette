import { expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import vm from "node:vm";
import { Window } from "happy-dom";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { molstarMolV3000Plugin } from "../scripts/molstar-mol-v3000.mjs";
import { molstarV3000ChargesPlugin } from "../scripts/molstar-v3000-charges.mjs";
plugin(molstarMolV3000Plugin); plugin(molstarV3000ChargesPlugin);
plugin({ name: "measurement-source-compiler", setup(build) {
  build.onLoad({ filter: /hooks\/use-source-editing\.ts$/u }, ({ path }) => ({ contents: transformSync(readFileSync(path, "utf8"), {
    filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]],
  })!.code!, loader: "ts" }));
} });
const browser = new Window({ url: "http://localhost/" }); Object.assign(browser, { setImmediate, clearImmediate });
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "MessageEvent", "CustomEvent", "MutationObserver", "localStorage", "CSS"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });
const inputs = new Map<string, string>();
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureText: async path => inputs.get(path), readStructureTextDocument: async path => ({ content: inputs.get(path), truncated: false }) }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async doc => doc, useDeferredViewerRuntime: doc => doc }));
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js"), { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
const { StructureElement } = await import("molstar/lib/mol-model/structure.js");
const { setCanvasModule } = await import("molstar/lib/mol-geo/geometry/text/font-atlas.js");
setCanvasModule({ createCanvas: () => ({ getContext: () => ({ measureText: () => ({ width: 12 }), clearRect() {}, fillText() {}, getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) }) } as never);
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { prepareMeasurementSourcePair, publishMeasurementSourcePair } = await import("../apps/desktop/src/lib/workbench/measurement-preview");
const { sha256Hex } = await import("../apps/desktop/src/lib/source-editing/source-identity");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const code = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
const extract = name => code.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, "u"))![0];
const scope: Record<string, any> = { molstar: { lib: { structure: { StructureElement } } } };
for (const name of ["scene-file-actions", "measurement-coordinate"]) vm.runInNewContext(readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), "utf8"), { window: scope, crypto, TextEncoder, Uint8Array, Float64Array, File });
const science = scope.BuretteSceneFiles.science, runtime = scope.BuretteMeasurementCoordinate;
const base = ["Preview", "Burette", "", "  0  0  0     0  0            999 V3000", "M  V30 BEGIN CTAB", "M  V30 COUNTS 4 3 0 0 0", "M  V30 BEGIN ATOM",
  "M  V30 20 H 0 0 0 0", "M  V30 7 N 1 0 0 0 CHG=1", "M  V30 90 C 1 1 0 0", "M  V30 4 O 1 1 1 0 CHG=-1", "M  V30 END ATOM", "M  V30 BEGIN BOND",
  "M  V30 2 1 20 7", "M  V30 8 1 7 90", "M  V30 3 2 90 4", "M  V30 END BOND", "M  V30 END CTAB", "M  END", ""].join("\n");
const camera = { position: [12, 3, 4], target: [0, 0, 0], up: [0, 1, 0], radius: 9, mode: "perspective" };
async function viewer(text: string, format: string) {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, format);
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
  return { plugin, raw };
}
const until = async ready => { for (let i = 0; i < 250 && !ready(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(ready()).toBe(true); };
let serial = 0;
async function fixture(format = "mol") {
  const text = base + (format === "sdf" ? "$$$$\n" : ""), changed = text.replace("90 C 1 1 0", "90 C 1 2 0");
  const doc = { id: `pipeline-${++serial}`, path: `/pipeline-${serial}.${format}`, title: `source.${format}`, extension: format, renderer: "molstar", runtimePath: "original runtime" } as any;
  inputs.set(doc.path, text);
  const plugins: any[] = [], frames: HTMLIFrameElement[] = [], requests: string[] = [], readyCounts: number[] = [];
  let active = await viewer(text, format); plugins.push(active.plugin);
  const structure = active.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data, unit = structure.units[0];
  const loci = index => StructureElement.Loci(structure, [{ unit, indices: Int32Array.of(index) as never }]);
  await active.plugin.managers.structure.measurement.addDistance(loci(1), loci(2), { visualParams: { visuals: ["lines"], customText: "Retained", linesColor: 0x123456 } });
  const expected = await runtime.capture(active, science);
  let holdNextCapture = false, releaseCapture: (() => void) | null = null;
  let controller!: ReturnType<typeof useSourceEditingController>, setDocument!: (doc: any) => void;
  const host = document.createElement("div"); document.body.append(host); const react = createRoot(host);
  function Probe() { const [activeDocument, select] = useState(doc); setDocument = select; controller = useSourceEditingController({ activeDocument, preferences: { ...defaultPreferences, rendererMode: "molstar" } as any, pushErrorStatus: cause => { throw cause; }, setDockOpen() {}, setDockActiveTab() {} }); return null; }
  await act(async () => react.render(<Probe />)); await act(async () => controller.beginEditing(doc));
  const runtimeGetter = new Function("window", `${extract("measurementCoordinateRuntime")};return measurementCoordinateRuntime;`)(scope);
  function attach(current) {
    const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = doc.id; frame.dataset.renderer = "molstar";
    document.body.append(frame); frames.push(frame); const source = frame.contentWindow!;
    const execute = new Function("activeMolstarViewer", "measurementCoordinateRuntime", "window", `${extract("executeBuretteAgentAction")};return executeBuretteAgentAction;`)(() => current, runtimeGetter, scope);
    const cameraBranch = code.slice(code.indexOf("    if (event.source === window.parent && body.type === 'captureRendererViewState')"), code.indexOf("    if (event.source === window.parent && body.type === 'hostLayoutGesture')"));
    source.postMessage = envelope => {
      requests.push(envelope.body.type === "agent-action" ? envelope.body.action.type : envelope.body.type);
      if (envelope.body.type === "captureRendererViewState") {
        // Exercise the real viewer camera response branch against an authored headless camera fixture.
        new Function("activeViewer", "captureMolstarCameraSnapshot", "postHostMessage", "window", "body", "event", cameraBranch)(current, () => camera, body => window.dispatchEvent(new MessageEvent("message", { source, data: { source: "burette-viewer", body: { ...body, documentId: doc.id } } })), { parent: window }, envelope.body, { source: window });
      } else if (envelope.body.type === "agent-action") {
        const send = () => { void execute(envelope.body.action).catch(error => ({ ok: false, error: { message: error.message } })).then(result => window.dispatchEvent(new MessageEvent("message", { source, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: envelope.body.id, result } } }))); };
        if (holdNextCapture) { holdNextCapture = false; releaseCapture = send; } else send();
      }
    };
    return frame;
  }
  let activeFrame = attach(active);
  const current = () => controller.sessionForDocument(doc)!;
  await prepareMeasurementSourcePair(text, changed, 4, format as "mol" | "sdf").then(pair => publishMeasurementSourcePair(doc.id, pair));
  const change = async (next: string) => { await act(async () => controller.updateDraft(doc, next, { view: "keep" })); };
  async function queued() {
    await until(() => Boolean(current().sourcePreview?.slots[current().sourcePreview!.activeSlot === "primary" ? "secondary" : "primary"]));
    const view = current().sourcePreview!, candidate = view.slots[view.activeSlot === "primary" ? "secondary" : "primary"]!;
    const config = JSON.parse(/window\.BuretteConfig = (.*);/u.exec(candidate.runtimePath)![1]);
    const raw = new TextDecoder().decode(Uint8Array.from(atob(JSON.parse(/window\.BuretteDataBase64 = ("[^"\n]*");/u.exec(candidate.runtimePath)![1])), char => char.charCodeAt(0)));
    expect(raw).toBe(current().content); expect(JSON.parse(config.rendererViewState).camera).toEqual(camera);
    expect(JSON.parse(config.rendererViewState).measurementTransfer.targetSourceSha256).toBe(await sha256Hex(raw));
    return { candidate, config, raw };
  }
  async function finish(staged, foreign = false) {
    const next = await viewer(staged.raw + (foreign ? "\n" : ""), format); plugins.push(next.plugin);
    const frame = attach(next); frame.dataset.sourcePreviewRole = "staging";
    await act(async () => controller.stagingLoaded(doc, staged.candidate.identity!, frame));
    const startup = extract("startMolstar"), restore = /    await restoreMeasurementPreview\(viewer, config\);/u.exec(startup)!;
    const ready = /    \{\n      const poseCount =[\s\S]*?\n    \}/u.exec(startup)!;
    // Execute actual startup statements in their original source order: the test does not supply restore-before-ready ordering.
    const boundary = [restore, ready].sort((a, b) => a.index - b.index).map(match => match[0]).join("\n");
    const run = new Function("window", "measurementCoordinateRuntime", "normalizeRenderer", "currentMolstarStructureCount", "setStatus", "setTimeout", "hideStatus", "isQuickLookHost", `${extract("restoreMeasurementPreview")};${extract("previewReadyPayload")};${extract("molstarReadyPayload")};return async (viewer,config,prepared)=>{${boundary}};`)(scope, runtimeGetter, value => value, v => v.plugin.managers.structure.hierarchy.current.structures.length, () => {}, callback => callback(), payload => {
      readyCounts.push(next.plugin.managers.structure.measurement.state.distances.length);
      window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { source: "burette-viewer", body: { type: "ready", ...payload } } }));
    }, () => false);
    let error: Error | null = null;
    await act(async () => { try { await run(next, staged.config, {}); } catch (cause) { error = cause as Error; window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { source: "burette-viewer", body: { type: "error", message: error.message } } })); } });
    if (error) return { error, next };
    await until(() => current().previewState === "current");
    const captured = await runtime.capture(next, science);
    expect({ items: captured.items, group: captured.group }).toEqual({ items: expected.items, group: expected.group });
    activeFrame.hidden = true; activeFrame = frame; frame.dataset.sourcePreviewRole = "active"; active = next;
    return { error, next };
  }
  return { doc, text, changed, requests, readyCounts, current, get controller() { return controller; },
    async replace(replacement) { useMoleculeStore.getState().setDocuments([doc]); useMoleculeStore.getState().openDocumentsInActiveTab([replacement]); const actual = useMoleculeStore.getState().documents.find(value => value.path === doc.path)!; await act(async () => setDocument(actual)); return actual; }, queue: async (next: string) => { await change(next); return queued(); }, change, queued, finish,
    holdCapture() { holdNextCapture = true; }, get captureHeld() { return releaseCapture !== null; }, releaseCapture() { releaseCapture!(); releaseCapture = null; },
    removeActiveFrame() { activeFrame.remove(); }, get active() { return active; },
    async close() { await act(async () => react.unmount()); host.remove(); frames.forEach(frame => frame.remove()); plugins.forEach(plugin => plugin.dispose()); inputs.delete(doc.path); },
  };
}
test("actual camera and measurement transports retain MOL/SDF measurements through source candidate and return paths", async () => {
  for (const format of ["mol", "sdf"]) {
    const view = await fixture(format);
    try {
      for (const target of [view.changed, view.text, view.changed]) {
        const before = view.current().sourcePreview!, staged = await view.queue(target);
        expect(view.current().sourcePreview!.activeSlot).toBe(before.activeSlot);
        expect(await view.finish(staged)).toMatchObject({ error: null });
      }
      expect(view.readyCounts).toEqual([1, 1, 1]);
      expect(view.requests).toEqual(Array(3).fill(["captureRendererViewState", "measurement_preview_capture"]).flat());
    } finally { await view.close(); }
  }
}, 15_000);
test("a failed real source restore reports no ready and retains the previous active scene", async () => {
  const view = await fixture();
  try {
    const previous = view.current().sourcePreview!, staged = await view.queue(view.changed), active = view.active;
    const failed = await view.finish(staged, true);
    expect(failed.error?.message).toContain("source changed"); expect(view.readyCounts).toEqual([]);
    expect(view.current().previewState).toBe("paused");
    expect(view.current().sourcePreview!.activeSlot).toBe(previous.activeSlot);
    expect(view.current().sourcePreview!.slots[previous.activeSlot]).toEqual(previous.slots[previous.activeSlot]);
    expect(view.active).toBe(active); expect(active.plugin.managers.structure.measurement.state.distances).toHaveLength(1);
    expect(failed.next.plugin.managers.structure.measurement.state.distances).toHaveLength(0);
  } finally { await view.close(); }
}, 10_000);

test("coincident atoms with a foreign raw source cannot authorize or stage a candidate", async () => {
  const view = await fixture();
  try {
    const original = view.current().sourcePreview;
    view.active.raw.cell!.obj!.data += "\n";
    await view.change(view.changed); await until(() => view.current().previewState === "paused");
    expect(view.current().sourcePreview).toEqual(original);
    expect(view.current().diagnostic).toContain("displayed structure changed");
    expect(view.readyCounts).toEqual([]);
  } finally { await view.close(); }
}, 10_000);
test("an older capture reply cannot stage its stale source revision", async () => {
  const view = await fixture();
  try {
    view.holdCapture(); await view.change(view.changed); await until(() => view.captureHeld);
    await view.change(view.text); view.releaseCapture();
    const staged = await view.queued();
    expect(staged.candidate.identity!.revision).toBe(2);
    expect(staged.raw).toBe(view.text);
    expect(await view.finish(staged)).toMatchObject({ error: null });
    expect(view.readyCounts).toEqual([1]);
  } finally { await view.close(); }
}, 10_000);

test("direct source APIs cannot mutate or preview another document's same-path session", async () => {
  const view = await fixture();
  try {
    await act(async () => view.controller.updateDraft(view.doc, view.changed, { previewApplied: true }));
    const before = view.current();
    const replacement = await view.replace({ ...view.doc, id: view.doc.id + "-replacement", runtimePath: "replacement runtime" });
    expect(view.controller.sessionForDocument(replacement)).toBeNull();
    await act(async () => { view.controller.updateDraft(replacement, view.text + "\n"); await view.controller.applyPreview(replacement); await view.controller.save(replacement); });
    expect(view.current() === before).toBe(true);
    expect(view.current().content).toBe(view.changed);
    expect(view.current().baseContent).toBe(view.text);
    expect(view.requests).toEqual([]);
  } finally { await view.close(); }
}, 10_000);

test("a closed source preview cannot pause a new same-path session at the same revision", async () => {
  const previousConfirm = browser.confirm; browser.confirm = () => true;
  try { for (const removeFrame of [false, true]) {
    const view = await fixture();
    try {
      view.holdCapture(); await view.change(view.changed);
      let pending!: Promise<void>;
      await act(async () => { pending = view.controller.applyPreview(view.doc) as Promise<void>; });
      await until(() => view.captureHeld);
      await act(async () => { expect(await view.controller.closeDocuments([view.doc.id])).toBe(true); });
      const replacement = await view.replace({ ...view.doc, id: view.doc.id + "-replacement", runtimePath: "replacement runtime" });
      const nextSource = view.text.replace("Preview", "Replacement"); inputs.set(view.doc.path, nextSource);
      await act(async () => { await view.controller.beginEditing(replacement); view.controller.updateDraft(replacement, nextSource + "\n", { previewApplied: true }); });
      const next = view.controller.sessionForDocument(replacement)!;
      expect((next as any).revision).toBe(1); expect(next.previewState).toBe("current");
      if (removeFrame) view.removeActiveFrame();
      await act(async () => { view.releaseCapture(); await pending; });
      expect(view.controller.sessionForDocument(replacement) === next).toBe(true);
      expect(view.controller.sessionForDocument(replacement)?.previewState).toBe("current");
      expect(view.controller.sessionForDocument(replacement)?.content).toBe(nextSource + "\n");
    } finally { await view.close(); }
  } } finally { browser.confirm = previousConfirm; }
}, 10_000);
