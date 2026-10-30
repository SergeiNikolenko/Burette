import { ensureGeometryViewerFrame } from "./fixtures/geometry-viewer-frame";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act, useState } from "react";

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({
  matches: false,
  media: "(prefers-reduced-motion: reduce)",
  addEventListener() {},
  removeEventListener() {},
});

for (const [name, value] of Object.entries({
  window,
  self: window,
  document: window.document,
  CSS: window.CSS,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  DocumentFragment: window.DocumentFragment,
  MutationObserver: window.MutationObserver,
  CustomEvent: window.CustomEvent,
  DOMRect: window.DOMRect,
  Event: window.Event,
  FocusEvent: window.FocusEvent,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  navigator: window.navigator,
  requestAnimationFrame: (callback) => window.setTimeout(callback, 0),
  cancelAnimationFrame: (id) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}

window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};
window.HTMLElement.prototype.hasPointerCapture = () => true;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { beforeEach, mock, test } = await import("bun:test");
const xyz = "3\nwater\nO 0 0 0\nH 0.9572 0 0\nH -0.24 0.927 0\n";
const writes = [];
const writeOptions = [];
const session = { content: xyz, dirty: false };
mock.module("../apps/desktop/src/lib/source-editing/context", () => ({ useSourceEditing: () => ({
  sessionForDocument: () => session,
  // As the controller does, the draft becomes the session's text.
  updateDraft: (_document, text, options) => { session.content = text; writes.push(text); writeOptions.push(options); },
}) }));
// Every test starts from the saved source.
beforeEach(() => { session.content = xyz; });
const { createRoot } = await import("react-dom/client");
// The source fixture supplies an already-read runtime receipt; actual iframe/lease races are covered by test-geometry-binding.
mock.module("../apps/desktop/src/lib/geometry-binding", () => ({ readGeometryBinding: async (document, _send, isCurrent) => ({
  lease: "panel-fixture", text: session.content, target: { documentId: document.id, source: window, isCurrent },
}) }));
const { DockPanel } = await import("../apps/desktop/src/components/dock-panel");
const { InputExportDialogHost } = await import("../apps/desktop/src/components/workbench/input-export-host");
const { geometryBase } = await import("../apps/desktop/src/lib/geometry-editing");


test("Geometry Dock renders the complete editor and opens one input export host", async () => {
  Object.defineProperty(globalThis, "NodeFilter", { configurable: true, value: window.NodeFilter });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const molecule = { id: "dock-water", title: "water.xyz", path: "/water.xyz", extension: "xyz", renderer: "molstar" };
  const state = { documents: [molecule], textDocuments: [], activeDocument: molecule, visibleDocuments: [molecule],
    activeTab: { location: { kind: "file", path: molecule.path, documentId: molecule.id } },
    rightDockTabs: [{ id: "geometry", kind: "geometry" }], rightDockActiveTab: "geometry", rightDockOpen: true,
    rightDockDocumentId: null, rightDockTool: null, dockDroppedStructures: [], hoveredGridRows: {} };
  const ownedFrame = ensureGeometryViewerFrame(molecule);
  const actions = { setStructureDragActive() {}, runStructureViewerAction: async () => {} };
  try {
    await act(async () => root.render(<><DockPanel area="right" state={state} actions={actions} /><InputExportDialogHost actions={actions} /></>));
    assert.ok(host.querySelector('[role="spinbutton"][aria-label="Bond of H2, Å"]'));
    assert.ok(host.querySelector('[aria-label="Copy Z-matrix"]'));
    assert.ok(host.querySelector('[aria-label="Keep bond of h2 fixed"]'));
    await act(async () => host.querySelector('[aria-label="Export input file"]').click());
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
    assert.ok(document.querySelector('[role="dialog"]').textContent.includes('Export input file'));
  } finally { await act(async () => root.unmount()); ownedFrame.remove(); host.remove(); }
});
