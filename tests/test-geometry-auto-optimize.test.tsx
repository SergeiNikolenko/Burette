import { ensureGeometryViewerFrame } from "./fixtures/geometry-viewer-frame";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act } from "react";

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
for (const [name, value] of Object.entries({
  CSS: window.CSS, window, self: window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, DocumentFragment: window.DocumentFragment,
  MutationObserver: window.MutationObserver, CustomEvent: window.CustomEvent, Event: window.Event, FocusEvent: window.FocusEvent,
  KeyboardEvent: window.KeyboardEvent, MouseEvent: window.MouseEvent, PointerEvent: window.PointerEvent, navigator: window.navigator,
  localStorage: window.localStorage, getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (callback) => window.setTimeout(callback, 0), cancelAnimationFrame: (id) => window.clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { mock, test } = await import("bun:test");
const { parseMolecule } = await import("../apps/desktop/src/lib/molecular-workbench/chemistry");
const xyz = "3\nAr3\nAr 0 0 0\nAr 3.1 0.4 0\nAr 1.2 2.9 0.3\n";
const writes = [];
const session = { content: xyz, dirty: false };
mock.module("../apps/desktop/src/lib/source-editing/context", () => ({ useSourceEditing: () => ({
  sessionForDocument: (document) => { if (document) ensureGeometryViewerFrame(document); return session; },
  updateDraft: (_document, text) => { session.content = text; writes.push(text); },
}) }));
// Parsing runs in place; the relaxation itself runs in the real Auto Optimize worker.
mock.module("../apps/desktop/src/lib/molecular-workbench/compute-client", () => ({
  runChemistryTask: async (request) => {
    if (request.action !== "parse") throw new Error(`unexpected ${request.action}`);
    return parseMolecule(request.source, request.format);
  },
}));
mock.module("../apps/desktop/src/lib/geometry-binding", () => ({ readGeometryBinding: async (document, _send, isCurrent) => ({
  lease: "panel-fixture", text: session.content, target: { documentId: document.id, source: window, isCurrent },
}) }));
const { createRoot } = await import("react-dom/client");
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");
const { requestOptimizationCommand } = await import("../apps/desktop/src/lib/workbench/optimization-commands");

const until = async (check, what) => {
  for (let i = 0; i < 200; i++) { if (check()) return; await act(async () => new Promise((resolve) => setTimeout(resolve, 20))); }
  throw new Error(`timed out waiting for ${what}`);
};
const pairs = (text) => {
  const atoms = text.trim().split("\n").slice(2).map((line) => line.trim().split(/\s+/u).slice(1, 4).map(Number));
  return [[0, 1], [1, 2], [0, 2]].map(([a, b]) => Math.hypot(...atoms[a].map((value, axis) => value - atoms[b][axis])));
};

test("Auto Optimize relaxes the Geometry draft until Stop, which keeps the result as one Undo step", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const doc = { id: "argon", title: "argon.xyz", path: "/argon.xyz", extension: "xyz", renderer: "molstar" };
  const previews = [];
  const actions = { setDockDocument() {}, openDockTab() {}, runStructureViewerAction: (_document, action) => { if (action.type === "update_geometry") previews.push(action); } };
  const status = () => host.querySelector('[role="status"].workbench-status')?.textContent ?? "";
  try {
    await act(async () => root.render(React.createElement(GeometryPanel, { document: doc, actions })));
    await until(() => host.querySelector('[aria-label="Undo"]'), "the Geometry table");
    window.localStorage.setItem("burette.workbench.force-field", "LJ");
    await act(async () => requestOptimizationCommand(actions, doc, "geometry", "auto-optimize"));
    await until(() => /ΔE -/u.test(status()), "a relaxed frame");
    assert.match(status(), /^Auto Optimize, Lennard-Jones, ΔE -\d+\.\d\d kcal\/mol$/u);
    assert.equal(writes.length, 0, "frames only preview; the draft is unchanged while Auto Optimize runs");
    // Let the cluster settle, then stop.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Stop").click());
    await until(() => writes.length === 1, "the published result");
    assert.equal(status(), "");
    for (const distance of pairs(writes[0])) assert.ok(Math.abs(distance - 3.66) < 1e-3, `pair distance ${distance}`);

    await act(async () => host.querySelector('[aria-label="Undo"]').click());
    await until(() => writes.length === 2, "Undo");
    assert.equal(writes[1], xyz);
  } finally { await act(async () => root.unmount()); host.remove(); window.localStorage.clear(); }
}, 30_000);
