import { ensureGeometryViewerFrame } from "./fixtures/geometry-viewer-frame";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";

// Editing a Z-matrix's definition (variables, bindings, references) through the real
// source-editing controller. Panels, their controls and the import owner compile with the
// React Compiler, as the app build does.
const COMPILED = /apps\/desktop\/src\/(components\/workbench\/geometry-fields\.tsx|lib\/workbench\/source\.ts|components\/workbench\/zmatrix-(panel|definition-controls)\.tsx|components\/geometry-panel\.tsx)$/u;
plugin({
  name: "react-compiler",
  setup(build) {
    build.onLoad({ filter: COMPILED }, ({ path }) => {
      const tsx = path.endsWith(".tsx");
      const compiled = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
        parserOpts: { plugins: tsx ? ["typescript", "jsx"] : ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] });
      if (!/(?:geometry-panel|zmatrix-panel)\.tsx$/u.test(path)) assert.match(compiled.code, /react\/compiler-runtime/u, `${path} was compiled`);
      return { contents: compiled.code, loader: tsx ? "tsx" : "ts" };
    });
  },
});

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
for (const [name, value] of Object.entries({
  CSS: window.CSS, window, self: window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, SVGElement: window.SVGElement, DocumentFragment: window.DocumentFragment,
  MutationObserver: window.MutationObserver, NodeFilter: window.NodeFilter, CustomEvent: window.CustomEvent, Event: window.Event, FocusEvent: window.FocusEvent,
  KeyboardEvent: window.KeyboardEvent, MouseEvent: window.MouseEvent, PointerEvent: window.PointerEvent, navigator: window.navigator,
  localStorage: window.localStorage, requestAnimationFrame: (callback) => window.setTimeout(callback, 0),
  cancelAnimationFrame: (id) => window.clearTimeout(id), getComputedStyle: window.getComputedStyle.bind(window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { mock, test } = await import("bun:test");
const { readBrowserDevVirtualTextDocument, writeBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
// Only source I/O is replaced.
mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureText: async (path) => readBrowserDevVirtualTextDocument(path),
  readStructureTextDocument: async (path) => ({ content: readBrowserDevVirtualTextDocument(path), truncated: false }),
}));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async (document) => document, useDeferredViewerRuntime: () => ({}) }));
// The panel/source fixture supplies the runtime read; actual frame/lease ownership is paired separately.
mock.module("../apps/desktop/src/lib/geometry-binding", () => ({ readGeometryBinding: async (document, _send, isCurrent) => ({
  lease: "zmatrix-fixture", text: current(document),
  target: { documentId: document.id, source: window, isCurrent },
}) }));
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { createRoot } = await import("react-dom/client");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");
const { parseZmatrixDocument } = await import("../scripts/zmatrix-document.mjs");

// Water placed from a reference point: both O–H bonds share R, both X–O–H angles share A.
const zmat = "O\r\nX 1 1.0\r\nH 1 R 2 A\r\nH 1 R 2 A 3 180\r\n\r\nR = 0.9572\r\nA = 52.26\r\n";
const sent = [];
const actions = {
  runStructureViewerAction: async (document, action) => { sent.push({ id: document.id, ...action }); },
  openStructureRecords: async (records) => records.map((record) => {
    const id = `zmat-definition-${record.path}`;
    const path = `burette-ketcher://${id}/${record.path}`;
    writeBrowserDevVirtualTextDocument(path, record.text);
    const document = { id, title: record.path, path, extension: record.inputExtension, renderer: "molstar", virtual: true };
    useMoleculeStore.setState((state) => ({ documents: [...state.documents, document] }));
    return document;
  }),
};
let controller;
function Fixture({ document }) {
  ensureGeometryViewerFrame(document);
  controller = useSourceEditingController({ activeDocument: document, preferences: {}, pushErrorStatus() {}, setDockOpen() {}, setDockActiveTab() {} });
  return <SourceEditingProvider value={controller}><GeometryPanel document={document} actions={actions} /></SourceEditingProvider>;
}
const current = (document) => controller?.sessionForDocument(document)?.content ?? readBrowserDevVirtualTextDocument(document.path);
const shown = (document) => sent.filter((action) => action.id === document.id && action.type === "update_geometry").at(-1)?.text;
const atomLines = (text) => text.split("\n").slice(2).join("\n");
const atoms = (text) => text.trim().split("\n").slice(2).map((line) => line.trim().split(/\s+/u).slice(1).map(Number));
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

const body = () => window.document.body;
const byLabel = (label) => body().querySelector(`[aria-label="${label}"]`);
const alert = () => body().querySelector('[role="alert"]')?.textContent ?? null;
const status = () => body().querySelector('.zmatrix-panel [role="status"]')?.textContent ?? null;
const variables = () => [...body().querySelectorAll('[aria-label="Variables"] tbody tr')].map((row) => [
  row.querySelector("th").textContent, row.querySelector('[role="spinbutton"]').getAttribute("aria-valuenow"), row.querySelector(".zmatrix-uses").textContent,
]);
const click = async (element) => { await act(async () => element.click()); await settle(); };
const openMenu = async (label) => {
  await act(async () => byLabel(label).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
};
const choose = async (role, text) => {
  const item = [...body().querySelectorAll(`[role="${role}"]`)].find((node) => node.textContent === text);
  assert.ok(item, `menu item ${text}`);
  await click(item);
};
const type = async (label, value) => {
  const input = byLabel(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};
const key = async (label, name) => { await act(async () => byLabel(label).dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true }))); await settle(); };
const addVariable = async (name, value) => {
  // The toolbar's Add menu opens the variable form beside it.
  if (!byLabel("Variable name")) { await openMenu("Add"); await choose("menuitem", "Add variable"); }
  await type("Variable name", name);
  await type("Variable value", value);
  await act(async () => byLabel("Variable name").closest("form").requestSubmit());
  await settle();
};
const rename = async (name, next) => {
  await openMenu(`${name} actions`);
  await choose("menuitem", "Rename");
  await type(`Rename variable ${name}`, next);
  await act(async () => byLabel(`Rename variable ${name}`).closest("form").requestSubmit());
  await settle();
};
// The "Set by" choices of the open definition menu.
const options = () => [...[...body().querySelectorAll('[role="menu"] [role="group"]')].at(-1).querySelectorAll('[role="menuitemradio"]')].map((node) => node.textContent);
const closeMenu = async () => { await act(async () => window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await settle(); };

test("variables are added, bound, renamed and removed, references switched, all through one Undo history", async () => {
  await openScientificFiles(actions, [new File([zmat], "water.zmat")]);
  const document = useMoleculeStore.getState().documents.at(-1);
  const host = window.document.createElement("div");
  body().append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Fixture document={document} />));
  for (let attempt = 0; attempt < 50 && !host.querySelector('[aria-label="Z-matrix rows"]'); attempt++) await settle();
  const texts = [current(document)];
  // Each accepted edit is one revision, shown in the scene and held by the session.
  const accepted = () => {
    const text = current(document);
    assert.notEqual(text, texts.at(-1), "the edit changed the source");
    assert.equal(shown(document), text, "the scene shows the accepted source");
    assert.equal(alert(), null);
    texts.push(text);
  };
  try {
    // Add: one unused variable; the molecule does not move.
    await addVariable("R", "2");
    assert.equal(alert(), "Variable names must be unique and values finite.", "a duplicate name is rejected in the form");
    assert.equal(current(document), texts[0]);
    await addVariable("D", "120");
    assert.equal(byLabel("Variable name"), null, "the form closes once the variable is added");
    accepted();
    assert.equal(atomLines(texts[1]), atomLines(texts[0]));
    assert.deepEqual(variables(), [["R", "0.9572", "bond H2, bond H3"], ["A", "52.26", "angle H2, angle H3"], ["D", "120", "Unused"]]);

    // Bind: the dihedral of H3 follows D, then −D; only H3 moves.
    await openMenu("Dihedral of H3 definition");
    await choose("menuitemradio", "D");
    accepted();
    assert.equal(byLabel("Dihedral of H3, °"), null, "a bound coordinate is not edited as a literal");
    assert.ok(byLabel("Dihedral of H3, 120.00 °, set by D"), "the cell names its variable");
    assert.deepEqual(variables().at(-1), ["D", "120", "dihedral H3"]);
    const [o, h2, h3] = atoms(texts[2]);
    assert.ok(Math.abs(distance(o, h3) - 0.9572) < 1e-4);
    assert.deepEqual(atoms(texts[2]).slice(0, 2), atoms(texts[1]).slice(0, 2), "O and H2 keep their positions");
    assert.ok(Math.abs(distance(h2, h3) - distance(...atoms(texts[1]).slice(1))) > 0.1, "H3 moved to the new dihedral");
    await openMenu("Dihedral of H3 definition");
    await choose("menuitemradio", "−D");
    accepted();
    assert.deepEqual(variables().at(-1), ["D", "120", "−dihedral H3"]);

    // Rename keeps every signed use and the coordinates.
    await rename("D", "A");
    assert.equal(alert(), "Variable names must be unique and values finite.");
    assert.equal(byLabel("Rename variable D").getAttribute("aria-invalid"), "true", "the name stays open to correct");
    assert.ok(byLabel("Rename variable D").closest('[data-slot="popover-content"]'), "the name is edited next to the column, not inside it");
    assert.equal(current(document), texts.at(-1));
    await key("Rename variable D", "Escape");
    assert.equal(byLabel("Rename variable D"), null);
    await rename("D", "PHI");
    accepted();
    assert.equal(atomLines(texts.at(-1)), atomLines(texts.at(-2)));
    assert.deepEqual(variables().at(-1), ["PHI", "120", "−dihedral H3"]);
    assert.deepEqual(parseZmatrixDocument(await exported()).rows[3].values, ["R", "A", "-PHI"]);

    // Remove inlines the resolved signed value; nothing moves and nothing asks to confirm.
    await openMenu("PHI actions");
    await choose("menuitem", "Remove");
    accepted();
    assert.equal(atomLines(texts.at(-1)), atomLines(texts.at(-2)));
    assert.deepEqual(variables().map(([name]) => name), ["R", "A"]);
    assert.equal(byLabel("Dihedral of H3, °").getAttribute("aria-valuenow"), "-120");

    // References: the angle of H3 now measured from H2 swaps with the dihedral's reference.
    // R still measures the same bond and stays; A no longer matches and becomes a value.
    await openMenu("Angle of H3 definition");
    await choose("menuitemradio", "H2");
    accepted();
    assert.equal(atomLines(texts.at(-1)), atomLines(texts.at(-2)), "a reference change keeps the molecule");
    assert.deepEqual([byLabel("Angle of H3 definition").textContent, byLabel("Dihedral of H3 definition").textContent], ["H2", "Ref 1"]);
    assert.equal(status(), "Angle of H3 no longer follows A: the new references measure a different value.");
    assert.deepEqual(variables(), [["R", "0.9572", "bond H2, bond H3"], ["A", "52.26", "angle H2"]]);
    // The literal is the H3–O–H2 angle measured on the unchanged atoms.
    const [oxygen, first, second] = atoms(texts.at(-1));
    const [u, v] = [second, first].map((atom) => atom.map((value, axis) => value - oxygen[axis]));
    const measured = Math.acos(u.reduce((sum, value, axis) => sum + value * v[axis], 0) / (Math.hypot(...u) * Math.hypot(...v))) * 180 / Math.PI;
    assert.ok(Math.abs(Number(byLabel("Angle of H3, °").getAttribute("aria-valuenow")) - measured) < 1e-6);
    assert.ok(Math.abs(measured - 52.26) > 1);

    // Undo walks back through every edit to the imported text; Redo returns to each.
    for (let index = texts.length - 2; index >= 0; index--) {
      await click(byLabel("Undo"));
      assert.equal(current(document), texts[index], `Undo to revision ${index}`);
      assert.equal(shown(document), texts[index]);
    }
    assert.equal(status(), null, "the reference note goes with the edit it described");
    assert.deepEqual(variables(), [["R", "0.9572", "bond H2, bond H3"], ["A", "52.26", "angle H2, angle H3"]]);
    assert.equal(byLabel("Undo").disabled, true);
    for (let index = 1; index < texts.length; index++) {
      await click(byLabel("Redo"));
      assert.equal(current(document), texts[index], `Redo to revision ${index}`);
    }
    assert.deepEqual(variables(), [["R", "0.9572", "bond H2, bond H3"], ["A", "52.26", "angle H2"]]);
    assert.equal(byLabel("Redo").disabled, true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("every coordinate offers each variable with the signs that give it a valid value", async () => {
  await openScientificFiles(actions, [new File([zmat], "water-signed.zmat")]);
  const document = useMoleculeStore.getState().documents.at(-1);
  const host = window.document.createElement("div");
  body().append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Fixture document={document} />));
  for (let attempt = 0; attempt < 50 && !host.querySelector('[aria-label="Z-matrix rows"]'); attempt++) await settle();
  try {
    await addVariable("L", "-1.2");
    assert.deepEqual(variables().at(-1), ["L", "-1.2", "Unused"]);
    const sets = [["Bond of H3", "R"], ["Angle of H3", "A"], ["Dihedral of H3", null]];
    const offered = [];
    for (const [label] of sets) {
      await openMenu(`${label} definition`);
      offered.push(options().filter((option) => option !== "Value"));
      await closeMenu();
    }
    // A negative bond length or angle is never offered; −L resolves to a valid bond of 1.2 Å.
    assert.deepEqual(offered, [["R", "A", "−L"], ["R", "A", "−L"], ["R", "−R", "A", "−A", "L", "−L"]]);
    await openMenu("Bond of H3 definition");
    await choose("menuitemradio", "−L");
    assert.equal(alert(), null);
    const [o, , h3] = atoms(current(document));
    assert.ok(Math.abs(distance(o, h3) - 1.2) < 1e-6, "the bond follows −L");
    assert.ok(byLabel("Bond of H3, 1.2000 Å, set by -L"), "the cell names its signed variable");
    assert.deepEqual(variables().at(-1), ["L", "-1.2", "−bond H3"]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

// The definition Export Z-matrix writes.
async function exported() {
  const blobs = [];
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = (blob) => { blobs.push(blob); return "blob:zmat"; };
  try { await click(byLabel("Export Z-matrix")); } finally { URL.createObjectURL = createObjectURL; }
  return blobs.at(-1).text();
}
