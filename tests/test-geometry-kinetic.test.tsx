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
  CSS: window.CSS, window,
  self: window,
  document: window.document,
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
  sessionForDocument: (document) => { if (document) ensureGeometryViewerFrame(document); return session; },
  // As the controller does, the draft becomes the session's text.
  updateDraft: (_document, text, options) => { session.content = text; writes.push(text); writeOptions.push(options); },
}) }));
// Every test starts from the saved source.
beforeEach(() => { session.content = xyz; });
const { createRoot } = await import("react-dom/client");
// The source fixture supplies an already-read runtime receipt; actual iframe/lease races are covered by test-geometry-binding.
mock.module("../apps/desktop/src/lib/geometry-binding", () => ({ readGeometryBinding: async (document, _send, isCurrent) => ({
  lease: "panel-fixture", text: new TextDecoder().decode(new TextEncoder().encode(session.content)), target: { documentId: document.id, source: window, isCurrent },
}) }));
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");
const { geometryBase } = await import("../apps/desktop/src/lib/geometry-editing");

test("Geometry kinetic drag commits once, Undo restores precision, and keyboard/text remain editable", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const doc = { id: "water", path: "/water.xyz", extension: "xyz", renderer: "molstar" };
  const selections = [];
  const field = () => host.querySelector('[role="spinbutton"][aria-label="Bond of H2, Å"]');
  const pointer = async (type, x) => {
    await act(async () => field().dispatchEvent(new window.PointerEvent(type, {
      bubbles: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
      clientX: x, clientY: 10, pointerId: 1, pointerType: "mouse",
    })));
  };
  const key = async (key, extra = {}) => {
    await act(async () => field().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key, ...extra })));
  };
  try {
    await act(async () => root.render(React.createElement(GeometryPanel, {
      document: doc, actions: { runStructureViewerAction: (_doc, payload) => selections.push(payload) },
    })));
    const angle = () => host.querySelector('[role="spinbutton"][aria-label="Angle of H3, °"]');
    const originalAngle = Number(angle().getAttribute("aria-valuenow"));
    await act(async () => angle().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" })));
    await act(async () => angle().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" })));
    assert.equal(writes.length, 0, "opening and closing an untouched field preserves source precision");
    assert.equal(Number(angle().getAttribute("aria-valuenow")), originalAngle);
    const original = Number(field().getAttribute("aria-valuenow"));
    await pointer("pointerdown", 10);
    await pointer("pointermove", 30);
    await pointer("pointermove", 70);
    const dragged = Number(field().getAttribute("aria-valuenow"));
    assert.ok(dragged > original, "actual Kinetic pointer movement changes the field");
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 10)));
    const live = selections.filter(action => action.type === "update_geometry");
    assert.ok(live.length > 0, "coordinates reach the existing viewer before pointer release");
    assert.ok(Math.abs(geometryBase(live.at(-1).text).rows[1].values[0] - dragged) < 1e-5);
    assert.equal(writes.length, 0, "intermediate positions do not consume Undo history");
    await pointer("pointerup", 70);
    assert.equal(writes.length, 1, "release writes one geometry draft");
    assert.deepEqual(writeOptions.at(-1), { previewApplied: true });
    assert.ok(Math.abs(geometryBase(writes[0]).rows[1].values[0] - dragged) < 1e-5);
    assert.equal(selections.filter(action => action.type === "update_geometry").at(-1).text, writes[0], "release flushes the final coordinates");
    assert.equal(selections.some(action => action.type === "select_residues"), false, "scrubbing never commits molecular selection");
    assert.ok(selections.some(action => action.type === "clear_selection"), "pointer editing clears an existing molecular selection");
    await act(async () => host.querySelector('[aria-label="Undo"]').click());
    assert.equal(Number(field().getAttribute("aria-valuenow")), original);
    assert.equal(writes.at(-1), xyz);
    assert.equal(selections.filter(action => action.type === "update_geometry").at(-1).text, xyz, "Undo updates the existing scene immediately");
    assert.equal(host.querySelector('[aria-label="Undo"]').disabled, true, "one Undo reverts the whole drag");
    await key("ArrowUp", { altKey: true });
    assert.equal(writes.length, 3, "fine keyboard nudge writes a geometry draft");
    assert.ok(Number(field().getAttribute("aria-valuenow")) > original);
    await key("Enter");
    assert.equal(field().tagName, "INPUT", "Enter opens numeric typing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field(), "1,25");
      field().dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await key("Enter");
    assert.ok(Math.abs(geometryBase(writes.at(-1)).rows[1].values[0] - 1.25) < 1e-5);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("Geometry hover previews individual atoms and coordinate endpoints, then clears on leave and unmount", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const doc = { id: "water", path: "/water.xyz", extension: "xyz", renderer: "molstar" };
  const actions = [];
  const over = async (element) => act(async () => element.dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
  try {
    await act(async () => root.render(React.createElement(GeometryPanel, {
      document: doc, actions: { runStructureViewerAction: (_doc, action) => actions.push(action) },
    })));
    const row = host.querySelectorAll("tbody tr")[2];
    await over(row.querySelector("th"));
    assert.deepEqual(actions.at(-1).atoms, [2]);
    assert.equal(actions.at(-1).type, "preview_geometry");
    await over(row.querySelector('[data-geometry-slot="0"]'));
    assert.deepEqual(actions.at(-1).atoms, [2, 0]);
    assert.equal(actions.at(-1).kind, "bond");
    await over(row.querySelector('[data-geometry-slot="1"]'));
    assert.deepEqual(actions.at(-1).atoms, [2, 0, 1]);
    assert.equal(actions.at(-1).kind, "angle");
    assert.ok(actions.every(action => action.type === "preview_geometry" && action.notify === false), "hover never commits selection");
    await act(async () => host.querySelector("table").dispatchEvent(new window.PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
    assert.deepEqual(actions.at(-1).atoms, []);
    await over(row.querySelector("th"));
    await act(async () => root.unmount());
    assert.deepEqual(actions.at(-1).atoms, [], "closing the panel clears its preview");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("Geometry live preview rolls back on Escape and panel close without writing a draft", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const doc = { id: "water", path: "/water.xyz", extension: "xyz", renderer: "molstar" };
  const actions = [];
  const before = writes.length;
  const field = () => host.querySelector('[role="spinbutton"][aria-label="Bond of H2, Å"]');
  const flush = () => act(async () => new Promise(resolve => window.setTimeout(resolve, 10)));
  const key = key => act(async () => field().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key })));
  try {
    await act(async () => root.render(React.createElement(GeometryPanel, {
      document: doc, actions: { runStructureViewerAction: (_doc, action) => actions.push(action) },
    })));
    await key("Enter");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field(), "1.5");
      field().dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await flush();
    assert.ok(Math.abs(geometryBase(actions.filter(a => a.type === "update_geometry").at(-1).text).rows[1].values[0] - 1.5) < 1e-5);
    await key("Escape");
    await flush();
    assert.equal(actions.filter(a => a.type === "update_geometry").at(-1).text, xyz);
    assert.equal(writes.length, before, "Escape leaves the source unchanged");
    for (const [type, x] of [["pointerdown", 10], ["pointermove", 70]]) {
      await act(async () => field().dispatchEvent(new window.PointerEvent(type, { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: 10, pointerId: 1, pointerType: "mouse" })));
    }
    await flush();
    assert.notEqual(actions.filter(a => a.type === "update_geometry").at(-1).text, xyz);
    await act(async () => root.unmount());
    await flush();
    assert.equal(actions.filter(a => a.type === "update_geometry").at(-1).text, xyz, "unmount cancels transient scene edits");
    assert.equal(writes.length, before);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("Geometry waits for acknowledgement, blocks overlapping edits and restores baseline on failure", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const doc = { id: "water", path: "/water.xyz", extension: "xyz", renderer: "molstar" };
  const calls = [];
  let rejectUpdate;
  let delayed = true;
  const before = writes.length;
  const field = () => host.querySelector('[role="spinbutton"][aria-label="Bond of H2, Å"]');
  const key = key => act(async () => field().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key })));
  try {
    await act(async () => root.render(React.createElement(GeometryPanel, {
      document: doc, actions: { runStructureViewerAction: (_doc, action) => {
        calls.push(action);
        if (action.type === "update_geometry" && delayed) {
          delayed = false;
          return new Promise((_resolve, reject) => { rejectUpdate = reject; });
        }
      } },
    })));
    const original = Number(field().getAttribute("aria-valuenow"));
    await key("ArrowUp");
    assert.equal(writes.length, before, "unacknowledged coordinates never become a source draft");
    assert.equal(field().disabled, true);
    await key("ArrowUp");
    assert.equal(calls.filter(a => a.type === "update_geometry").length, 1);
    await act(async () => rejectUpdate(new Error("Viewer update failed")));
    assert.equal(field().disabled, false);
    assert.equal(Number(field().getAttribute("aria-valuenow")), original);
    assert.equal(calls.filter(a => a.type === "update_geometry").at(-1).text, xyz);
    assert.equal(writes.length, before);
    assert.equal(host.querySelector('[aria-label="Undo"]').disabled, true);
    assert.match(host.querySelector('[role="alert"]').textContent, /Viewer update failed/);
    await key("ArrowUp");
    assert.equal(writes.length, before + 1, "retry succeeds and creates one undo entry");
    const row = host.querySelectorAll("tbody tr")[1];
    await act(async () => row.click());
    assert.equal(row.hasAttribute("aria-selected"), false);
    assert.equal(calls.some(action => action.type === "select_residues"), false, "row clicks and field focus never select atoms");
    await act(async () => row.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true })));
    assert.equal(calls.at(-1).type, "clear_selection");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("precise near-linear input survives the geometry draft and Copy Z-matrix round trip", async () => {
  const { parseZmatrixDocument, atomsFromZmatrixDocument, resolveZmatrixDocument } = await import("../scripts/zmatrix-document.mjs");
  const { zmatrixRowsFromAtoms } = await import("../scripts/internal-coordinates.mjs");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const doc = { id: "precise-water", path: "/water.xyz", extension: "xyz", renderer: "molstar" };
  let copied = "";
  const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { copied = text; } } });
  const angle = () => host.querySelector('[role="spinbutton"][aria-label="Angle of H3, °"]');
  try {
    await act(async () => root.render(<GeometryPanel document={doc} actions={{ runStructureViewerAction: () => ({ ok: true }) }} />));
    // Exercise two near-linear values through the actual numeric input and clipboard.
    for (const target of [179.9999918842198, 179.9999959421099]) {
      await act(async () => angle().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" })));
      await act(async () => {
        angle().focus();
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(angle(), String(target));
        angle().dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await act(async () => angle().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" })));
      for (let attempt = 0; attempt < 20 && Math.abs(geometryBase(session.content).rows[2].values[1] - target) >= 1e-10; attempt++) {
        await act(async () => new Promise(resolve => window.setTimeout(resolve, 5)));
      }
      assert.ok(Math.abs(geometryBase(session.content).rows[2].values[1] - target) < 1e-10, "saved XYZ retains the entered angle");
      await act(async () => host.querySelector('[aria-label="Copy Z-matrix"]').click());
      const definition = parseZmatrixDocument(copied);
      assert.ok(Math.abs(resolveZmatrixDocument(definition)[2].values[1] - target) < 1e-10);
      const roundTripAngle = zmatrixRowsFromAtoms(atomsFromZmatrixDocument(definition))[2].values[1];
      assert.ok(roundTripAngle < 180 && Math.abs(roundTripAngle - target) < 1e-10);
    }
  } finally {
    await act(async () => root.unmount()); host.remove();
    if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});


test("Geometry Undo restores the exact CRLF receipt after an acknowledged edit", async () => {
  const exact = xyz.replaceAll("\n", "\r\n"); session.content = exact;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), sent = [];
  const doc = { id: "crlf-water", path: "/crlf-water.xyz", extension: "xyz", renderer: "molstar" };
  try {
    await act(async () => root.render(<GeometryPanel document={doc} actions={{ runStructureViewerAction: (_doc, action) => sent.push(action) }} />));
    await act(async () => host.querySelector('[role="spinbutton"][aria-label="Bond of H2, Å"]').dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    assert.notEqual(session.content, exact);
    await act(async () => host.querySelector('[aria-label="Undo"]').click());
    assert.equal(session.content, exact);
    assert.equal(sent.filter(action => action.type === "update_geometry").at(-1).text, exact);
  } finally { await act(async () => root.unmount()); host.remove(); }
});


test("raw UTF8 BOM Geometry preserves its source bytes through an edit and Undo", async () => {
  const original = "\uFEFF" + xyz.replaceAll("\n", "\r\n"); session.content = original;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), sent = [];
  const doc = { id: "bom-water", path: "/bom-water.xyz", extension: "xyz", renderer: "molstar" };
  try {
    await act(async () => root.render(<GeometryPanel document={doc} actions={{ runStructureViewerAction: (_doc, action) => sent.push(action) }} />));
    await act(async () => host.querySelector('[role="spinbutton"][aria-label="Bond of H2, Å"]').dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    assert.ok(session.content.startsWith("\uFEFF"));
    assert.equal(sent.filter(action => action.type === "update_geometry").at(-1).text, new TextDecoder().decode(new TextEncoder().encode(session.content)));
    await act(async () => host.querySelector('[aria-label="Undo"]').click());
    assert.equal(session.content, original);
    assert.equal(sent.filter(action => action.type === "update_geometry").at(-1).text, original.slice(1));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
