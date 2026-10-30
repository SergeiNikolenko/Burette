import { ensureGeometryViewerFrame } from "./fixtures/geometry-viewer-frame";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act } from "react";

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
for (const [name, value] of Object.entries({
  CSS: window.CSS, window,
  self: window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  DocumentFragment: window.DocumentFragment,
  MutationObserver: window.MutationObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  FocusEvent: window.FocusEvent,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  navigator: window.navigator,
  localStorage: window.localStorage,
  requestAnimationFrame: (callback) => window.setTimeout(callback, 0),
  cancelAnimationFrame: (id) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { mock, test } = await import("bun:test");
const xyz = "3\nwater\nO 0 0 0\nH 0.9572 0 0\nH -0.24 0.927 0\n";
const writes = [];
const session = { content: xyz, dirty: false };
mock.module("../apps/desktop/src/lib/source-editing/context", () => ({ useSourceEditing: () => ({
  sessionForDocument: (document) => { if (document) ensureGeometryViewerFrame(document); return session; },
  // As the controller does, the draft becomes the session's text.
  updateDraft: (_document, text) => { session.content = text; writes.push(text); },
}) }));
// The panel's contract with the optimizer: same atoms back, new positions and energies.
mock.module("../apps/desktop/src/lib/molecular-workbench/compute-client", () => ({
  runChemistryTask: async (request) => (request.action === "parse" ? { atoms: [] } : {
    molecule: { atoms: [{ element: "O", x: 0, y: 0, z: 0 }, { element: "H", x: 0.97, y: 0, z: 0 }, { element: "H", x: -0.25, y: 0.94, z: 0 }] },
    initialEnergy: 0.15, energy: 0, converged: true, constraintResiduals: [],
  }),
}));
const { createRoot } = await import("react-dom/client");
// The source fixture supplies an already-read runtime receipt; actual iframe/lease races are covered by test-geometry-binding.
mock.module("../apps/desktop/src/lib/geometry-binding", () => ({ readGeometryBinding: async (document, _send, isCurrent) => ({
  lease: "panel-fixture", text: session.content, target: { documentId: document.id, source: window, isCurrent },
}) }));
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");

test("Geometry shows an optimization result only for the coordinates it produced", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const doc = { id: "water", path: "/water.xyz", extension: "xyz", renderer: "molstar" };
  const result = () => host.querySelector(".geometry-panel-result")?.textContent ?? null;
  const undo = () => act(async () => host.querySelector('[aria-label="Undo"]').click());
  const bond = () => host.querySelector('[role="spinbutton"][aria-label="Bond of H2, Å"]');
  try {
    await act(async () => root.render(React.createElement(GeometryPanel, { document: doc, actions: { runStructureViewerAction() {} } })));
    const optimize = [...host.querySelectorAll("button")].find((button) => button.textContent === "Optimize");
    await act(async () => optimize.click());
    assert.match(result(), /0\.15 → 0\.00 kcal\/mol · Converged/u);
    const optimized = Number(bond().getAttribute("aria-valuenow"));

    await act(async () => bond().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp", altKey: true })));
    assert.ok(Number(bond().getAttribute("aria-valuenow")) > optimized);
    assert.equal(result(), null, "a manual edit leaves the optimized coordinates, so their result is gone");

    await undo();
    assert.equal(Number(bond().getAttribute("aria-valuenow")), optimized);
    assert.match(result(), /Converged/u, "Undo back to the optimized coordinates brings their result back");

    await undo();
    assert.equal(writes.at(-1), xyz);
    assert.equal(result(), null, "Undo to the original coordinates shows no optimization result");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
