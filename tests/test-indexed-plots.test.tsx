import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act } from "react";
const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
for (const [name, value] of Object.entries({ window, self: window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, SVGElement: window.SVGElement, DocumentFragment: window.DocumentFragment,
  MutationObserver: window.MutationObserver, CustomEvent: window.CustomEvent, Event: window.Event, KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent, PointerEvent: window.PointerEvent, navigator: window.navigator, localStorage: window.localStorage,
  requestAnimationFrame: callback => window.setTimeout(callback, 0), cancelAnimationFrame: id => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { test, mock } = await import("bun:test");
const bridge = await import("../apps/desktop/src/lib/viewer-bridge");
let frameIndex = 0, sourceId = "trajectory-a", total = 205;
let beforeRead = async (_request) => {};
const requests = [];
function response(request) {
  const offset = request.offset ?? 0, limit = request.limit ?? 100;
  const velocities = frameIndex !== 4;
  return { available: true, sourceId, modelId: `${sourceId}-model-${frameIndex}`, structureRef: "structure", frameIndex, frameCount: 10000, segmentIndex: 0,
    time: { value: frameIndex * 0.5, unit: "ps" }, step: frameIndex * 100,
    units: { position: "angstrom", ...(velocities ? { velocity: "angstrom/ps" } : {}), force: "kcal/mol/angstrom" },
    summary: request.includeSummary ? { maxForce: frameIndex + 2, rmsForce: frameIndex + 1, ...(velocities ? { rmsSpeed: frameIndex + 0.5 } : {}) } : {},
    offset, total, atoms: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
      index: offset + i, sourceAtomIndex: total - offset - i - 1, element: "H", position: [offset + i, 0, 0],
      ...(velocities ? { velocity: [1, 2, 3] } : {}), force: [4, 5, 6],
    })) };
}
// A scan page: atom i of frame f sits at x = i * (1 + f / 1000), so atoms 1 and 3 are 2 + f / 500 apart.
function scanPage(request) {
  if (request.expected.sourceId !== sourceId) throw new Error("The displayed trajectory changed. Scan again.");
  const frames = Array.from({ length: Math.max(0, Math.min(request.limit, 10000 - request.offset)) }, (_, at) => {
    const frame = request.offset + at;
    return { frameIndex: frame, time: { value: frame * 0.5, unit: "ps" }, positions: request.atoms.map(atom => [atom * (1 + frame / 1000), 0, 0]) };
  });
  return { sourceId, frameCount: 10000, offset: request.offset, frames };
}
mock.module("../apps/desktop/src/lib/viewer-bridge", () => ({ ...bridge, requestViewerAction: async (_id, request, _timeout, signal) => {
  requests.push(request); await beforeRead(request); signal?.throwIfAborted(); return request.type === "indexed_trajectory_scan" ? scanPage(request) : response(request);
} }));
const { createRoot } = await import("react-dom/client");
const { IndexedPlotsPanel } = await import("../apps/desktop/src/components/workbench/indexed-plots-panel");
const { usePlotsAvailable } = await import("../apps/desktop/src/lib/workbench/plots-tool");
const { PlotsDockContent } = await import("../apps/desktop/src/components/workbench/plots-dock-content");
const { indexedFrameCsv } = await import("../apps/desktop/src/lib/workbench/indexed-trajectory-source");
let serial = 0;
function Tools({ document }) { return <output>{usePlotsAvailable(document) ? "plots" : ""}</output>; }
function DockPlots({ document, actions }) { return <><Tools document={document}/><PlotsDockContent document={document} actions={actions} /></>; }
async function mount(inDock = false) {
  frameIndex = 0; sourceId = `trajectory-${++serial}`; total = 205; beforeRead = async () => {}; requests.length = 0;
  const doc = { id: `indexed-${serial}`, path: "/trajectory.trr", extension: "trr", title: "trajectory.trr", renderer: "molstar", runtimePath: `runtime-${serial}` };
  const saved = [], seeks = [];
  const actions = { saveKetcherExportFile: async value => saved.push(value), runStructureViewerAction: async (_doc, value) => seeks.push(value) };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(inDock ? <DockPlots document={doc} actions={actions}/> : <><Tools document={doc}/><IndexedPlotsPanel document={doc} actions={actions}/></>));
  const show = async (index, segmentStartFrame = 0) => {
    frameIndex = index;
    await act(async () => {
      window.dispatchEvent(new window.CustomEvent("burette:trajectory-frame-changed", {
        detail: { documentId: doc.id, frameIndex, frameCount: 10000, segmentStartFrame },
      }));
    });
  };
  return { host, doc, saved, seeks, show, replace: async document => { await act(async () => root.render(<><Tools document={document}/><IndexedPlotsPanel document={document} actions={actions}/></>)); }, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const button = (host, text) => [...host.querySelectorAll("button")].find(item => item.textContent.trim() === text);
const click = element => act(async () => element.click());

test("indexed Plots discovers displayed frames, preserves sparse frame numbers and seeks real indices", async () => {
  const view = await mount();
  try {
    assert.equal(view.host.querySelector("output").textContent, "");
    await view.show(0);
    assert.equal(view.host.querySelector("output").textContent, "plots");
    assert.equal(requests.length, 2, "lightweight discovery and explicit plotting have separate cached requests");
    assert.equal(requests.filter(request => request.includeSummary).length, 1);
    assert.match(view.host.textContent, /1 sampled frame/u);
    assert.equal(view.host.querySelector('[aria-label="Temperature per frame"]'), null);
    await view.show(4);
    const slider = view.host.querySelector('[role="slider"][aria-label="Max force, kcal/(mol·Å) frame"]');
    assert.equal(slider.getAttribute("aria-valuenow"), "5");
    assert.equal(slider.getAttribute("aria-valuemax"), "10000");
    assert.match(view.host.textContent, /2 sampled frames/u);
    assert.equal(view.host.querySelector('[aria-label="RMS speed, Å/ps frame"]').getAttribute("aria-valuetext"), "Frame 5");
    await act(async () => slider.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await act(async () => slider.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true })));
    assert.deepEqual(view.seeks.map(value => value.index), [5, 9999]);
    const input = view.host.querySelector('[aria-label="Atom numbers to measure"]');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "1 3"); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
    assert.match(view.host.querySelector('[aria-label="Distance, Å frame"]').getAttribute("aria-valuetext"), /Distance 2\.000/u);
    assert.equal(requests.filter(item => item.expected && item.limit === 1).length, 2);
    sourceId = "replacement";
    await view.show(0, 12_000);
    assert.match(view.host.textContent, /1 sampled frame/u);
    const segmentSlider = view.host.querySelector('[role="slider"][aria-label="Max force, kcal/(mol·Å) frame"]');
    await act(async () => segmentSlider.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    assert.equal(view.seeks.at(-1).index, 12_001);
  } finally { await view.unmount(); }
});

test("frame export pages exact atom order and units without synthesizing missing velocities", async () => {
  const view = await mount();
  try {
    await view.show(4);
    await click(button(view.host, "Export frame"));
    assert.equal(view.saved.length, 1);
    const lines = view.saved[0].text.trim().split("\n");
    assert.equal(lines.length, 206);
    assert.equal(lines[0], "frame,atom,source_atom,element,x_A,y_A,z_A,fx_kcal_mol_A,fy_kcal_mol_A,fz_kcal_mol_A");
    assert.equal(lines[1], "5,1,205,H,0,0,0,4,5,6");
    assert.equal(lines.at(-1), "5,205,1,H,204,0,0,4,5,6");
    assert.deepEqual(requests.filter(item => item.expected).map(item => item.offset), [0, 100, 200]);
  } finally { await view.unmount(); }
});

test("a seek or cancellation during paged export never saves mixed frame data", async () => {
  const view = await mount();
  try {
    await view.show(0);
    let release;
    beforeRead = request => request.offset === 100 ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
    await click(button(view.host, "Export frame"));
    assert.ok(release);
    await view.show(1);
    await act(async () => release());
    assert.equal(view.saved.length, 0);
    beforeRead = request => request.offset === 100 ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
    await click(button(view.host, "Export frame"));
    await click(button(view.host, "Cancel"));
    await act(async () => release());
    assert.equal(view.saved.length, 0);
    beforeRead = async request => { if (request.offset === 100) frameIndex++; };
    await assert.rejects(indexedFrameCsv(view.doc.id, response({}), new AbortController().signal, () => {}), /changed|match|stale/iu);
  } finally { await view.unmount(); }
});

test("history remains bounded instead of allocating the entire trajectory", async () => {
  const view = await mount();
  try {
    for (let index = 0; index < 260; index++) await view.show(index);
    assert.match(view.host.textContent, /256 sampled frames/u);
    const slider = view.host.querySelector('[role="slider"][aria-label="Max force, kcal/(mol·Å) frame"]');
    assert.equal(slider.getAttribute("aria-valuenow"), "260");
    assert.equal(requests.length, 520);
    assert.equal(requests.filter(request => request.includeSummary).length, 260);
    assert.ok(requests.every(request => request.limit === 1), "sampling never loads whole frames");
  } finally { await view.unmount(); }
}, 20000);


test("reusing the panel for another document never labels old plots as its data", async () => {
  const view = await mount();
  try {
    await view.show(2);
    assert.ok(view.host.querySelector('[aria-label="Max force per frame"]'));
    await view.replace({ ...view.doc, id: "other-document", title: "other.trr", path: "/other.trr", runtimePath: "other-runtime" });
    assert.match(view.host.textContent, /other.trr/u);
    assert.equal(view.host.querySelector('[aria-label="Max force per frame"]'), null);
    assert.equal(view.host.querySelector('[aria-label="RMS speed per frame"]'), null);
    assert.equal(button(view.host, "Export frame").disabled, true);
  } finally { await view.unmount(); }
});


test("workbench dock keeps Plots mounted during a pending seek and retains prior vector samples", async () => {
  const view = await mount(true);
  try {
    await view.show(0);
    assert.match(view.host.textContent, /1 sampled frame/u);
    const input = view.host.querySelector('[aria-label="Atom numbers to measure"]');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "1 3"); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
    assert.ok(view.host.querySelector('[aria-label="Distance per frame"]'));
    const releases = [];
    beforeRead = () => new Promise(resolve => releases.push(resolve));
    await view.show(4);
    assert.equal(view.host.querySelector("output").textContent, "plots");
    assert.ok(view.host.querySelector('[aria-label="Distance per frame"]'), "measurement identity survives a pending seek");
    assert.equal(input.getAttribute("aria-invalid"), "false");
    assert.equal(view.host.querySelector('[role="alert"]'), null, "pending seek never validates against zero atoms");
    assert.ok(view.host.querySelector('[aria-label="RMS speed per frame"]'), "prior speed chart remains while new frame is pending");
    beforeRead = async () => {};
    await act(async () => releases.forEach(resolve => resolve()));
    assert.match(view.host.textContent, /2 sampled frames/u);
    assert.ok(view.host.querySelector('[aria-label="RMS speed, Å/ps frame"]'), "a frame without velocity keeps earlier observed speed");
  } finally { await view.unmount(); }
});


test("Settings navigation preserves the bound Plots panel and its sampled history", async () => {
  const { DockPanel } = await import("../apps/desktop/src/components/dock-panel");
  const view = await mount();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const state = { page: "app", documents: [view.doc], textDocuments: [], activeDocument: view.doc,
    activeTab: { id: "molecule", location: { kind: "document", documentId: view.doc.id, path: view.doc.path } },
    bottomDockTabs: [{ id: "files", kind: "files" }, { id: "plots", kind: "plots" }], bottomDockActiveTab: "plots", bottomDockOpen: true,
    bottomDockDocumentId: view.doc.id, bottomDockTool: null, dockDroppedStructures: [], hoveredGridRows: {}, visibleDocuments: [view.doc] };
  const actions = { setStructureDragActive() {} };
  const draw = async next => { await act(async () => root.render(<DockPanel area="bottom" state={next} actions={actions} />)); };
  try {
    await view.show(0);
    await draw(state);
    await view.show(4);
    assert.match(host.textContent, /2 sampled frames/u);
    const panel = host.querySelector(".workbench-plots");
    const readCount = requests.length;
    await draw({ ...state, page: "settings", activeDocument: null, activeTab: { id: "settings", location: { kind: "settings" } } });
    assert.equal(host.querySelector(".workbench-plots"), panel);
    await draw(state);
    assert.equal(host.querySelector(".workbench-plots"), panel);
    assert.match(host.textContent, /2 sampled frames/u);
    assert.equal(host.querySelector('[data-active-tab="plots"]') !== null, true);
    assert.equal(requests.length, readCount, "Settings roundtrip does not reread trajectory data");
  } finally { await act(async () => root.unmount()); host.remove(); await view.unmount(); }
});

test("the Plots dock routes a displayed indexed trajectory to its frame panel", async () => {
  const view = await mount(true);
  try {
    assert.equal(view.host.querySelector("output").textContent, "");
    assert.equal(button(view.host, "Export frame"), undefined);
    await view.show(3);
    for (let i = 0; i < 20 && !button(view.host, "Export frame"); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    assert.equal(view.host.querySelector("output").textContent, "plots");
    assert.ok(view.host.querySelector('[aria-label="Max force per frame"]'));
    assert.equal(button(view.host, "Export frame").disabled, false);
  } finally { await view.unmount(); }
});

test("Scan all frames measures every frame of the displayed source without moving the scene and exports it", async () => {
  const view = await mount();
  try {
    await view.show(3);
    const input = view.host.querySelector('[aria-label="Atom numbers to measure"]');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "1 3"); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
    await click(button(view.host, "Scan all frames"));
    for (let i = 0; i < 200 && !button(view.host, "Export CSV"); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    const scans = requests.filter(item => item.type === "indexed_trajectory_scan");
    assert.deepEqual([scans.length, scans[0], scans.at(-1).offset], [50, { type: "indexed_trajectory_scan", atoms: [0, 2], offset: 0, limit: 200, expected: { sourceId } }, 9800]);
    assert.deepEqual(view.seeks, [], "a scan reads frames without seeking");
    assert.equal(view.host.querySelector('[role="slider"][aria-label="Distance, Å frame"]').getAttribute("aria-valuemax"), "10000");
    await click(button(view.host, "Export CSV"));
    const rows = view.saved[0].text.trim().split("\n");
    assert.equal(view.saved[0].title, "trajectory-distance-1-3.csv");
    assert.deepEqual([rows.length, rows[0], rows[1], rows[10000]], [10001, "frame,time_ps,distance_angstrom", "1,0,2", `10000,4999.5,${2 * (1 + 9999 / 1000)}`]);
    // Other atoms are a new measurement.
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "1 2"); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
    assert.ok(button(view.host, "Scan all frames"));
  } finally { await view.unmount(); }
});
