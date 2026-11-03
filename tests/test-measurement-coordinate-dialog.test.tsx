import { expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { molstarMolV3000Plugin } from "../scripts/molstar-mol-v3000.mjs";
import { molstarV3000ChargesPlugin } from "../scripts/molstar-v3000-charges.mjs";
import reference from "./fixtures/coordinate-editing/rdkit-reference.json";
import type { ViewerDocument } from "../apps/desktop/src/types";
plugin(molstarMolV3000Plugin); plugin(molstarV3000ChargesPlugin);

// Expected coordinates are RDKit rdMolTransforms results (fixtures/coordinate-editing).
const browser = new Window({ url: "http://localhost/" }); Object.assign(browser, { setImmediate, clearImmediate });
browser.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "HTMLInputElement", "HTMLButtonElement", "HTMLSelectElement", "HTMLFormElement", "Element", "Node", "Event", "MessageEvent", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "PointerEvent", "MutationObserver", "localStorage", "CSS", "DocumentFragment", "NodeFilter", "SVGElement"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: browser[key] });
}
Object.assign(globalThis, { window: browser, self: browser, IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: browser.getComputedStyle.bind(browser),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: (callback: () => void) => browser.setTimeout(callback, 0), cancelAnimationFrame: (id: number) => browser.clearTimeout(id) });
const sources = new Map<string, string>();
const structureText = await import("../apps/desktop/src/lib/structure-text");
mock.module("../apps/desktop/src/lib/structure-text", () => ({ ...structureText, readStructureText: async (path: string) => sources.get(path)!,
  readStructureTextDocument: async (path: string) => ({ content: sources.get(path)!, truncated: false }) }));
const deferred = await import("../apps/desktop/src/hooks/use-deferred-viewer-runtime");
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ ...deferred, prepareDeferredViewerRuntime: async (doc: ViewerDocument) => doc, useDeferredViewerRuntime: (doc: ViewerDocument) => doc }));
const { PluginContext } = await import("@molstar/plugin"), { DefaultPluginSpec } = await import("@molstar/plugin/default-spec");
const { StructureElement } = await import("@molstar/model/model/structure");
const { setCanvasModule } = await import("@molstar/graphics/geo/geometry/text/font-atlas");
setCanvasModule({ createCanvas: () => ({ getContext: () => ({ measureText: () => ({ width: 12 }), clearRect() {}, fillText() {}, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) }) } as never);
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { useGraphDraft } = await import("../apps/desktop/src/lib/workbench/use-graph-draft");
const { useAppViewerStateMessages } = await import("../apps/desktop/src/hooks/use-app-viewer-state-messages");
const { closeWorkbenchDialog, useWorkbenchDialogRequest } = await import("../apps/desktop/src/lib/workbench/dialog-store");
const { MeasurementCoordinateDialogHost } = await import("../apps/desktop/src/components/workbench/measurement-coordinate-dialog");
const { parseMolecule } = await import("../apps/desktop/src/lib/molecular-workbench/molecular-graph");
const code = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
const extract = (name: string) => code.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, "u"))![0];
const scope: Record<string, any> = { molstar: { lib: { structure: { StructureElement } } } };
for (const name of ["scene-file-actions", "measurement-coordinate"]) vm.runInNewContext(readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), "utf8"), { window: scope, crypto, TextEncoder, TextDecoder, Uint8Array, Float64Array, File });
const science = scope.BuretteSceneFiles.science, runtime = scope.BuretteMeasurementCoordinate;
type Molecule = keyof typeof reference.molecules;
type Kind = "distance" | "angle" | "dihedral";
const noop = () => {};
const until = async (ready: () => boolean) => { for (let i = 0; i < 300 && !ready(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(ready()).toBe(true); };
let serial = 0;

/** A real Mol* model of the source with one measurement, an owning iframe and the host route. */
async function fixture(molecule: Molecule, variant: "v2000" | "v3000" | "sdf", kind: Kind, atoms: number[]) {
  const format = variant === "sdf" ? "sdf" : "mol", text = reference.molecules[molecule][variant];
  const doc = { id: `measurement-${++serial}`, path: `/measurement-${serial}.${format}`, title: `molecule.${format}`, extension: format, renderer: "molstar", runtimePath: "<html/>" } as ViewerDocument;
  sources.set(doc.path, text);
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, format);
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
  const viewer = { plugin }, structure = plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  const loci = (index: number) => StructureElement.Loci(structure, [{ unit: structure.units[0], indices: Int32Array.of(structure.units[0].elements.indexOf(index as never)) as never }]);
  const manager = plugin.managers.structure.measurement, picked = atoms.map(loci);
  const added = kind === "distance" ? await manager.addDistance(picked[0], picked[1]) : kind === "angle" ? await manager.addAngle(picked[0], picked[1], picked[2]) : await manager.addDihedral(picked[0], picked[1], picked[2], picked[3]);
  const execute = new Function("activeMolstarViewer", "measurementCoordinateRuntime", "window", "activeConfig", "bytesToBase64", "document", `${extract("executeBuretteAgentAction")};return executeBuretteAgentAction;`)(
    () => viewer, async () => runtime, scope, {}, (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"), document) as (action: Record<string, unknown>) => Promise<unknown>;
  const page = document.createElement("div"); page.className = "page-surface"; page.dataset.active = "true";
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = doc.id; frame.dataset.renderer = "molstar"; page.append(frame); document.body.append(page);
  let hold = false, release: (() => void) | null = null, captures = 0;
  Object.defineProperty(frame.contentWindow, "postMessage", { configurable: true, value: async (envelope: { body: { type: string; id: string; action: Record<string, unknown> } }) => {
    if (envelope.body.type !== "agent-action") return;
    if (envelope.body.action.type === "measurement_preview_capture") captures++;
    const result = await execute(envelope.body.action).catch((error: Error) => ({ ok: false, error: { message: error.message } }));
    const respond = () => window.dispatchEvent(new browser.MessageEvent("message", { source: frame.contentWindow, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: envelope.body.id, result } } }) as unknown as Event);
    if (hold) { hold = false; release = respond; } else respond();
  } });
  let controller!: ReturnType<typeof useSourceEditingController>, graph!: ReturnType<typeof useGraphDraft>, handle!: ReturnType<typeof useAppViewerStateMessages>["handleViewerStateMessage"], dialog: unknown = null;
  function Probe() {
    graph = useGraphDraft(doc); dialog = useWorkbenchDialogRequest();
    handle = useAppViewerStateMessages({ ownsCurrentSourceFrame: () => true, activeDocument: doc, documents: [doc], updateDirtyGridDocument: noop, addDocuments: noop,
      openCommandPalette: noop, openDockTab: noop, toggleDockTab: noop, setPreference: noop, setViewerLigandSelections: noop,
      setStructureOverlayModes: noop, setStructureStories: noop, toggleSidebar: noop, toggleDock: noop }).handleViewerStateMessage;
    return <MeasurementCoordinateDialogHost />;
  }
  function Fixture() {
    controller = useSourceEditingController({ activeDocument: doc, preferences: defaultPreferences, pushErrorStatus: noop, setDockOpen: noop, setDockActiveTab: noop });
    return <SourceEditingProvider value={controller}><Probe /></SourceEditingProvider>;
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<Fixture />)); await until(() => Boolean(graph.history) || Boolean(graph.error));
  const request = await runtime.describe(viewer, [plugin.state.data.cells.get(added.representation.ref)], science);
  const dispatch = async (body: Record<string, unknown> = { type: "editMeasurementCoordinate", documentId: doc.id, measurement: request }, sender: unknown = frame.contentWindow) => {
    await act(async () => { handle("burette-viewer", body, sender as MessageEventSource); });
  };
  const button = (name: string) => [...document.querySelectorAll("button")].find(item => item.textContent === name) as HTMLButtonElement | undefined;
  const field = () => document.querySelector(`[aria-label="${kind[0].toUpperCase()}${kind.slice(1)}, ${kind === "distance" ? "Å" : "°"}"]`) as HTMLElement;
  return { doc, frame, plugin, raw, request, dispatch, button, field,
    get graph() { return graph; }, get controller() { return controller; }, get dialog() { return dialog; }, get captures() { return captures; },
    holdNextCapture() { hold = true; release = null; }, get release() { return release; },
    alert: () => document.querySelector('[role="alert"]')?.textContent ?? null,
    async open() { await dispatch(); await until(() => Boolean(button("Apply") && !button("Apply")!.disabled) || Boolean(document.querySelector('[role="alert"]'))); },
    async type(value: number) {
      await act(async () => field().dispatchEvent(new browser.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }) as unknown as Event));
      await act(async () => {
        Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(field(), String(value));
        field().dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event);
      });
      await act(async () => field().dispatchEvent(new browser.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }) as unknown as Event));
    },
    async move(side: "first" | "last") {
      const select = document.querySelector('select[aria-label="Move"]') as HTMLSelectElement;
      await act(async () => { select.value = side; select.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event); });
    },
    async apply() { await act(async () => button("Apply")!.click()); },
    async close() { await act(async () => { closeWorkbenchDialog(); root.unmount(); }); host.remove(); page.remove(); plugin.dispose(); },
  };
}
const worst = (atoms: { x: number; y: number; z: number }[], expected: number[][]) => Math.max(...atoms.flatMap((atom, index) => [atom.x, atom.y, atom.z].map((value, axis) => Math.abs(value - expected[index][axis]))));
const butanol = (kind: Kind, atoms: number[]) => reference.measurements.find(item => item.molecule === "butanol" && item.measurement === kind && String(item.atoms) === String(atoms))!;

test("host and dialog set RDKit's values on MOL V2000/V3000 and SDF as one exact Undo step", async () => {
  const cases = [
    ...(["v2000", "v3000", "sdf"] as const).map(variant => ({ variant, kind: "distance" as Kind, atoms: [3, 1] })),
    { variant: "sdf" as const, kind: "angle" as Kind, atoms: [3, 1, 0] },
    { variant: "v3000" as const, kind: "dihedral" as Kind, atoms: [0, 1, 3, 4] },
  ];
  let largest = 0;
  for (const { variant, kind, atoms } of cases) {
    const expected = butanol(kind, atoms), v = await fixture("butanol", variant, kind, atoms);
    try {
      expect(v.request).toMatchObject({ kind, atoms, sourceFormat: variant === "sdf" ? "sdf" : "mol", atomCount: 15 });
      await v.open(); expect(v.alert()).toBeNull();
      const before = v.graph.history!.current;
      await v.type(expected.value);
      if (expected.side !== "smaller") await v.move(expected.side as "first" | "last");
      await v.apply(); await until(() => v.dialog === null);
      const after = v.graph.history!.current;
      largest = Math.max(largest, worst(after.structure.atoms, expected.expected!), worst(parseMolecule(v.controller.sessionForDocument(v.doc)!.content, variant === "sdf" ? "sdf" : "mol").atoms, expected.expected!));
      expect(v.graph.history!.undo).toEqual([before]);
      expect(after.structure.bonds).toEqual(before.structure.bonds);
      expect(after.metadata).toEqual(before.metadata);
      expect(after.text.includes("$$$$")).toBe(variant === "sdf");
      if (variant === "sdf") expect(after.text).toContain(">  <SOURCE_NOTE>\nkept verbatim\n");
      expect(v.captures).toBe(2); // Before the worker and again immediately before the draft write.
      await act(async () => v.graph.undo()); expect(v.graph.history!.current).toBe(before);
      expect(v.controller.sessionForDocument(v.doc)!.content).toBe(before.text);
      await act(async () => v.graph.redo()); expect(v.graph.history!.current).toBe(after);
    } finally { await v.close(); }
  }
  expect(largest).toBeLessThan(1e-9);
}, 60_000);

test("the host opens only the active editable frame's own graph measurement", async () => {
  const v = await fixture("butanol", "sdf", "distance", [3, 1]);
  try {
    await v.dispatch(undefined, window); expect(v.dialog).toBeNull();
    v.frame.dataset.readOnly = "true"; await v.dispatch(); expect(v.dialog).toBeNull(); delete v.frame.dataset.readOnly;
    await v.dispatch({ type: "editMeasurementCoordinate", documentId: "other", measurement: v.request }); expect(v.dialog).toBeNull();
    for (const measurement of [{ ...v.request, atoms: [1, 1] }, { ...v.request, sourceFormat: "xyz" }, { ...v.request, frameCount: 2 }, { ...v.request, sourceSha256: "f" }]) {
      await v.dispatch({ type: "editMeasurementCoordinate", documentId: v.doc.id, measurement }); expect(v.dialog).toBeNull();
    }
    await v.dispatch({ type: "editMeasurementCoordinate", documentId: v.doc.id, measurement: { ...v.request, sourceFormat: "mol" } }); expect(v.dialog).toBeNull();
    expect(v.captures).toBe(0); expect(v.controller.hasUnsavedOrSavingSessions).toBe(false);
    await v.dispatch(); expect(v.dialog).not.toBeNull();
  } finally { await v.close(); }
});

test("ring cuts are refused at open; the XYZ runtime refuses before any host request", async () => {
  const v = await fixture("cyclohexanol", "v2000", "distance", [1, 2]);
  try {
    await v.open();
    expect(v.alert()).toMatch(/ring/u); expect(v.button("Apply")!.disabled).toBe(true);
    expect(v.captures).toBe(0); expect(v.controller.sessionForDocument(v.doc)).toBeNull();
  } finally { await v.close(); }
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  try {
    const trajectory = await plugin.builders.structure.parseTrajectory(await plugin.builders.data.rawData({ data: "3\nwater\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n" }), "xyz");
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
    const structure = plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
    const loci = (index: number) => StructureElement.Loci(structure, [{ unit: structure.units[0], indices: Int32Array.of(index) as never }]);
    const added = await plugin.managers.structure.measurement.addDistance(loci(0), loci(1));
    await expect(runtime.describe({ plugin }, [plugin.state.data.cells.get(added.representation.ref)], science)).rejects.toThrow(/MOL or SDF/u);
  } finally { plugin.dispose(); }
});

test("a changed source, dismissal or replaced frame during the capture await leaves text and history unchanged", async () => {
  for (const change of ["raw", "dismiss", "frame", "same measurement"] as const) {
    const v = await fixture("butanol", "v2000", "distance", [3, 1]);
    try {
      await v.open(); const history = v.graph.history;
      await v.type(1.7);
      if (change === "raw") v.plugin.state.data.cells.get(v.raw.ref)!.obj!.data = `${reference.molecules.butanol.v2000}\n`;
      else v.holdNextCapture();
      await v.apply();
      if (change !== "raw") {
        await until(() => v.release !== null);
        if (change === "same measurement") {
          await v.open();
          await act(async () => v.field().dispatchEvent(new browser.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }) as unknown as Event));
          expect(Number((v.field() as HTMLInputElement).value)).toBeCloseTo(1.49427533273, 10);
        } else {
          await act(async () => { if (change === "dismiss") closeWorkbenchDialog(); else v.frame.dataset.documentId = "replaced"; });
        }
        await act(async () => { v.release!(); await new Promise(resolve => setTimeout(resolve, 20)); });
      }
      // Capture validation precedes the graph job, so an idle graph alone does
      // not mean the dialog has received and displayed the source-change refusal.
      if (change === "raw") await until(() => v.alert() !== null);
      await until(() => !v.graph.busy);
      expect(v.graph.history).toBe(history);
      expect(v.controller.sessionForDocument(v.doc)).toBeNull();
      expect(v.controller.hasUnsavedOrSavingSessions).toBe(false);
      if (change === "raw") expect(v.alert()).toMatch(/changed/u);
    } finally { await v.close(); }
  }
}, 30_000);
