import { ensureGeometryViewerFrame } from "./fixtures/geometry-viewer-frame";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";

// Z-matrix rows added, moved and removed in the Geometry panel, through the real
// source-editing controller and its scene reload. The panel, its row controls, the live
// preview owner and the import owner compile with the React Compiler, as the app build does.
const COMPILED = /apps\/desktop\/src\/(components\/workbench\/geometry-fields\.tsx|lib\/workbench\/source\.ts|hooks\/use-geometry-live-preview\.ts|components\/workbench\/zmatrix-(panel|row-controls|definition-controls)\.tsx|components\/geometry-panel\.tsx)$/u;
plugin({
  name: "react-compiler",
  setup(build) {
    build.onLoad({ filter: COMPILED }, ({ path }) => {
      const tsx = path.endsWith(".tsx");
      const compiled = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
        parserOpts: { plugins: tsx ? ["typescript", "jsx"] : ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] });
      return { contents: compiled.code, loader: tsx ? "tsx" : "ts" };
    });
  },
});

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
for (const [name, value] of Object.entries({
  CSS: window.CSS, window, self: window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, HTMLFormElement: window.HTMLFormElement, HTMLSelectElement: window.HTMLSelectElement,
  HTMLButtonElement: window.HTMLButtonElement, NodeFilter: window.NodeFilter,
  CSS: window.CSS ?? { escape: (value) => String(value).replace(/[^\w-]/gu, (char) => `\\${char}`) }, SVGElement: window.SVGElement, DocumentFragment: window.DocumentFragment,
  MutationObserver: window.MutationObserver, CustomEvent: window.CustomEvent, Event: window.Event, FocusEvent: window.FocusEvent,
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
const { openScientificDocument, openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { useImportedOriginal, useImportedRevisions, useScientificDocument } = await import("../apps/desktop/src/lib/workbench/source");
const { rememberViewerAtomSelection, useViewerAtomSelection } = await import("../apps/desktop/src/lib/workbench/selection");
const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");
const { parseZmatrixDocument, atomsFromZmatrixDocument } = await import("../scripts/zmatrix-document.mjs");
const { placeInReferenceFrame } = await import("../scripts/internal-coordinates.mjs");
const { editZmatrixRows } = await import("../scripts/zmatrix-rows.mjs");

let opened = 0;
const sent = [];
const actions = {
  runStructureViewerAction: async (document, action) => { sent.push({ id: document.id, ...action }); },
  openStructureRecords: async (records) => records.map((record) => {
    const id = `zmat-rows-${++opened}`;
    const path = `burette-ketcher://${id}/${record.path}`;
    writeBrowserDevVirtualTextDocument(path, record.text);
    const document = { id, title: record.path, path, extension: record.inputExtension, renderer: "molstar", virtual: true };
    useMoleculeStore.setState((state) => ({ documents: [...state.documents, document] }));
    return document;
  }),
};
let controller;
// What other surfaces read for the document: its scientific data, original upload, 3D selection
// and the texts of its revisions.
let seen = {};
function Probe({ document }) {
  const { document: science, text } = useScientificDocument(document);
  const revisions = useImportedRevisions(document.id, text ?? "");
  seen = { science, original: useImportedOriginal(document.id), selection: useViewerAtomSelection(document.id), revisions: revisions?.map((revision) => revision.text) ?? null };
  return null;
}
// The scene reload opens the draft with the viewer's preferences.
const preferences = { rendererMode: "molstar" };
function Fixture({ document }) {
  ensureGeometryViewerFrame(document);
  controller = useSourceEditingController({ activeDocument: document, preferences, pushErrorStatus() {}, setDockOpen() {}, setDockActiveTab() {} });
  return <SourceEditingProvider value={controller}><GeometryPanel document={document} actions={actions} /><Probe document={document} /></SourceEditingProvider>;
}
const current = (document) => controller?.sessionForDocument(document)?.content ?? readBrowserDevVirtualTextDocument(document.path);
const shown = (document) => sent.filter((action) => action.id === document.id && action.type === "update_geometry").at(-1)?.text;
const lines = (text) => text.split("\n");
const atomsOf = (text) => text.trim().split("\n").slice(2).map((line) => {
  const [element, ...xyz] = line.trim().split(/\s+/u);
  return { element, position: xyz.map(Number) };
});
const distance = (a, b) => Math.hypot(...a.position.map((value, axis) => value - b.position[axis]));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

const body = () => window.document.body;
const byLabel = (label) => body().querySelector(`[aria-label="${label}"]`);
const alert = () => body().querySelector('[role="alert"]')?.textContent ?? null;
const status = () => body().querySelector('.zmatrix-panel [role="status"]')?.textContent ?? null;
const rows = () => [...body().querySelectorAll('[aria-label="Z-matrix rows"] tbody tr')].map((row) => row.querySelector("th").textContent);
// The Z-matrix panel is gone once its text is no longer one of its revisions.
const busy = () => byLabel("Add")?.disabled === true;
const click = async (element) => { await act(async () => element.click()); await settle(); };
const openMenu = async (label) => {
  await act(async () => byLabel(label).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
};
const choose = async (text) => {
  const item = [...body().querySelectorAll('[role="menuitem"]')].find((node) => node.textContent === text);
  assert.ok(item, `menu item ${text}`);
  return item;
};
const type = async (label, value) => {
  const input = byLabel(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};
const select = async (label, value) => {
  const element = body().querySelector(`select[aria-label="${label}"]`);
  await act(async () => { element.value = value; element.dispatchEvent(new window.Event("change", { bubbles: true })); });
};
// Fills the Add form (atom or reference point) and submits it.
async function addRow(kind, fields = {}) {
  await openMenu("Add");
  await click(await choose(kind === "atom" ? "Add atom" : "Add reference point"));
  for (const [label, value] of Object.entries(fields)) {
    if (label.endsWith("measured from") || label.endsWith("set by")) await select(label, value);
    else await type(label, value);
  }
  await act(async () => byLabel(kind === "atom" ? "New atom" : "New reference point").requestSubmit());
  await settle();
}
async function rowAction(label, item) {
  await openMenu(`${label} actions`);
  const node = await choose(item);
  if (node.getAttribute("aria-disabled") === "true" || node.hasAttribute("data-disabled")) return false;
  await click(node);
  return true;
}
const press = async (label, key) => {
  await act(async () => body().querySelector(`[role="spinbutton"][aria-label="${label}"]`).dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })));
  await settle();
};
const submitAgain = async (kind) => { await act(async () => byLabel(kind === "atom" ? "New atom" : "New reference point").requestSubmit()); await settle(); };

// The scene's reload of the draft: the staged viewer reports ready (or an error) as the
// staging iframe does. Returns once the panel is idle again.
async function reloadScene(document, body = { type: "ready", renderer: "molstar", molstarStructureCount: 1 }) {
  let identity = null;
  for (let attempt = 0; attempt < 100 && !identity; attempt++) {
    const preview = controller.sessionForDocument(document)?.sourcePreview;
    identity = preview?.slots[preview.activeSlot === "primary" ? "secondary" : "primary"]?.identity ?? null;
    if (!identity) await settle();
  }
  assert.ok(identity, "the draft reloads the scene");
  assert.equal(identity.revision, controller.sessionForDocument(document).revision, "the reload is of the current draft");
  const frame = { contentWindow: {} };
  controller.stagingLoaded(document, identity, frame);
  await act(async () => {
    const event = new window.Event("message");
    Object.defineProperty(event, "source", { value: frame.contentWindow });
    Object.defineProperty(event, "data", { value: { source: "burette-viewer", body } });
    window.dispatchEvent(event);
  });
  for (let attempt = 0; attempt < 50 && busy(); attempt++) await settle();
}
const staged = (document) => {
  const preview = controller.sessionForDocument(document)?.sourcePreview;
  return preview?.slots[preview.activeSlot === "primary" ? "secondary" : "primary"] ?? null;
};

async function mount(document) {
  const host = window.document.createElement("div");
  body().append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Fixture document={document} />));
  for (let attempt = 0; attempt < 50 && !host.querySelector('[aria-label="Z-matrix rows"]'); attempt++) await settle();
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
async function openZmat(text, name = "molecule.zmat") {
  await openScientificFiles(actions, [new File([text], name)]);
  return useMoleculeStore.getState().documents.at(-1);
}
// Each scene reload waits out the draft's preview delay.
const TIMEOUT_MS = 30_000;
const water = "O\nX 1 1.0\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 0.9572\nA = 52.26\n";

test("atoms and reference points are appended, moved and removed in the same document, one Undo step each", async () => {
  const document = await openZmat(water, "water.zmat");
  const imported = current(document);
  const view = await mount(document);
  try {
    assert.deepEqual(rows(), ["O1", "Ref 1", "H2", "H3"]);
    const science = seen.science;
    rememberViewerAtomSelection(document.id, { atomIdentities: [{ sourceIndex: 2 }], atoms: 1 });
    await settle();

    // A real atom: the scene reloads with four atoms; the existing atoms keep their lines.
    await addRow("atom", { Element: "F", "Bond measured from": "0", "Bond, Å": "1.4", "Dihedral, °": "120" });
    assert.ok(busy(), "the panel waits for the reloaded scene");
    assert.equal(current(document).split("\n")[0], "4", "the draft holds the new atom");
    await reloadScene(document);
    const t1 = current(document);
    assert.deepEqual(lines(t1).slice(0, 5), ["4", ...lines(imported).slice(1, 5)], "count line, comment with its import token and every existing atom line");
    assert.match(lines(t1)[5], /^F /u);
    assert.ok(Math.abs(distance(atomsOf(t1)[0], atomsOf(t1)[3]) - 1.4) < 1e-6, "the atom is where its row places it");
    assert.deepEqual(rows(), ["O1", "Ref 1", "H2", "H3", "F4"]);
    assert.equal(shown(document), imported, "the retained-lease barrier sends only the unchanged baseline; a new atom is never sent as moved coordinates");
    assert.equal(seen.selection, null, "the selection of the previous atoms is dropped");
    assert.equal(useMoleculeStore.getState().documents.at(-1).id, document.id, "no new molecule");

    // A reference point leaves the atoms alone: coordinates only, the selection stays.
    rememberViewerAtomSelection(document.id, { atomIdentities: [{ sourceIndex: 3 }], atoms: 1 });
    await addRow("point");
    const t2 = current(document);
    assert.deepEqual(atomsOf(t2), atomsOf(t1));
    assert.deepEqual(lines(t2).filter((_, index) => index !== 1), lines(t1).filter((_, index) => index !== 1), "only the definition marker changes");
    assert.match(lines(t2)[1], /^.* zdef-[0-9a-f]{8}$/u);
    assert.equal(shown(document), t2);
    assert.equal(staged(document), null, "no reload");
    assert.deepEqual(seen.selection?.atoms, [3]);
    assert.deepEqual(rows(), ["O1", "Ref 1", "H2", "H3", "F4", "Ref 2"]);

    // Moving H2 below H3 reorders the atoms; each keeps its own line and position.
    const before = editZmatrixRows(seen.science.internalCoordinates, { type: "move", index: 2, to: 3 }, atomsOf(t2));
    assert.equal(await rowAction("H2", "Move down"), true);
    await reloadScene(document);
    const t3 = current(document);
    assert.deepEqual(lines(t3).slice(2, 6), [2, 4, 3, 5].map((index) => lines(t2)[index]));
    assert.deepEqual(rows(), ["O1", "Ref 1", "H2", "H3", "F4", "Ref 2"]);
    for (const { binding } of before.detachedBindings) assert.ok(status()?.includes(`follows ${binding}`), `${status()} reports ${binding}`);

    // Removing the reference point keeps the atoms; removing F4 reloads with three.
    assert.equal(await rowAction("Ref 2", "Remove Ref 2"), true);
    const t4 = current(document);
    assert.deepEqual(atomsOf(t4), atomsOf(t3));
    assert.equal(shown(document), t4);
    assert.equal(await rowAction("F4", "Remove F4"), true);
    await reloadScene(document);
    const t5 = current(document);
    // Its text differs from every earlier one, so the comment no longer needs a definition marker.
    assert.deepEqual(lines(t5).slice(0, 5), ["3", lines(imported)[1], ...lines(t4).slice(2, 5)]);
    assert.deepEqual(rows(), ["O1", "Ref 1", "H2", "H3"]);

    // The first row cannot move up, the last cannot move down.
    assert.equal(await rowAction("O1", "Move up"), false);
    await act(async () => window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await settle();

    // The exported definition reopens as this geometry.
    const blobs = [];
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => { blobs.push(blob); return "blob:zmat"; };
    try { await click(byLabel("Export Z-matrix")); } finally { URL.createObjectURL = createObjectURL; }
    const exported = await blobs[0].text();
    const reopened = placeInReferenceFrame(atomsFromZmatrixDocument(parseZmatrixDocument(exported)), atomsOf(t5));
    reopened.forEach((atom, index) => assert.ok(distance(atom, atomsOf(t5)[index]) < 1e-5));

    // Undo walks back through every revision exactly; reloads where the atoms differ.
    const history = [imported, t1, t2, t3, t4, t5];
    for (let index = history.length - 2; index >= 0; index--) {
      await click(byLabel("Undo"));
      if (history[index].split("\n")[0] !== history[index + 1].split("\n")[0] || index === 2) await reloadScene(document);
      assert.equal(current(document), history[index], `Undo to revision ${index}`);
    }
    assert.deepEqual(rows(), ["O1", "Ref 1", "H2", "H3"]);
    assert.deepEqual(seen.science.atoms, science.atoms, "Undo restores the imported atoms and data");
    assert.equal(byLabel("Undo").disabled, true);
    for (let index = 1; index < history.length; index++) {
      await click(byLabel("Redo"));
      if (history[index].split("\n")[0] !== history[index - 1].split("\n")[0] || index === 3) await reloadScene(document);
      assert.equal(current(document), history[index], `Redo to revision ${index}`);
    }
    assert.deepEqual(rows(), ["O1", "Ref 1", "H2", "H3"]);
  } finally { await view.unmount(); }
}, TIMEOUT_MS);

test("rejected forms, the last atom and an essential reference point leave the document as it was", async () => {
  const document = await openZmat(water, "water-invalid.zmat");
  const imported = current(document);
  const view = await mount(document);
  try {
    await addRow("atom", { Element: "" });
    assert.equal(alert(), "Enter the element of the atom.");
    await type("Element", "X");
    await submitAgain("atom");
    assert.match(alert(), /reference point/u);
    await type("Element", "F");
    await type("Bond, Å", "abc");
    await submitAgain("atom");
    assert.equal(alert(), "Enter a number for the bond.");
    // A value the definition rejects is reported in the form, which keeps what was entered.
    await type("Bond, Å", "-1");
    await submitAgain("atom");
    assert.ok(alert(), "the definition rejects a negative bond");
    assert.equal(byLabel("Element").value, "F");
    assert.equal(current(document), imported);
    assert.equal(staged(document), null);
    assert.equal(byLabel("Undo").disabled, true, "nothing was recorded");
  } finally { await view.unmount(); }

  const single = await openZmat("H\nX 1 1.0\n", "single.zmat");
  const singleText = current(single);
  const singleView = await mount(single);
  try {
    await rowAction("H1", "Remove H1");
    assert.equal(alert(), "Keep at least one real atom.");
    assert.equal(current(single), singleText);
    assert.deepEqual(rows(), ["H1", "Ref 1"]);
  } finally { await singleView.unmount(); }

  const linear = await openZmat("C\nN 1 1.2\nX 1 1 2 90\nO 2 1.2 1 180 3 0\nF 1 1.4 2 90 3 90\n", "linear.zmat");
  const linearText = current(linear);
  const linearView = await mount(linear);
  try {
    await rowAction("Ref 1", "Remove Ref 1");
    assert.ok(alert(), "the reference point that places the rest cannot be removed");
    assert.equal(current(linear), linearText);
    assert.deepEqual(rows(), ["C1", "N2", "Ref 1", "O3", "F4"]);
    assert.equal(byLabel("Undo").disabled, true);
  } finally { await linearView.unmount(); }
}, TIMEOUT_MS);

test("a reload that fails, a source edited or closed meanwhile never leaves a half-applied row edit", async () => {
  const document = await openZmat(water, "water-lifecycle.zmat");
  const imported = current(document);
  const view = await mount(document);
  try {
    // The scene cannot show the draft: the draft and history return to where they were.
    await addRow("atom", { Element: "F", "Bond measured from": "0", "Bond, Å": "1.4" });
    await reloadScene(document, { type: "error", message: "Preview failed." });
    assert.equal(current(document), imported);
    assert.equal(alert(), "Preview failed.");
    assert.deepEqual(rows(), ["O1", "Ref 1", "H2", "H3"]);
    assert.equal(byLabel("Undo").disabled, true, "the failed edit is not in the history");

    // The source is edited while the scene reloads: the newer text stands.
    await addRow("atom", { Element: "F", "Bond measured from": "0", "Bond, Å": "1.4" });
    assert.ok(busy());
    const external = `${imported}\n`;
    await act(async () => controller.updateDraft(document, external));
    // The panel leaves with the text it edited; the edit's wait for its scene ends too.
    for (let attempt = 0; attempt < 15; attempt++) await settle();
    assert.equal(busy(), false);
    assert.equal(current(document), external, "the reload of the replaced draft does not write it back");
    assert.equal(staged(document), null, "nor reload it");
  } finally { await view.unmount(); }

  const closing = await openZmat(water, "water-closing.zmat");
  const closingText = current(closing);
  const closingView = await mount(closing);
  try {
    await addRow("atom", { Element: "F", "Bond measured from": "0", "Bond, Å": "1.4" });
    assert.ok(busy());
    // Closing discards the unsaved draft, as the user confirms.
    window.confirm = () => true;
    await act(async () => { await controller.closeDocuments([closing.id]); });
    for (let attempt = 0; attempt < 50 && busy(); attempt++) await settle();
    assert.equal(controller.sessionForDocument(closing), null);
    assert.equal(readBrowserDevVirtualTextDocument(closing.path), closingText, "nothing was written to the closed source");
  } finally { await closingView.unmount(); }
}, TIMEOUT_MS);

test("a new atom leaves out data indexed by the previous atoms; Undo brings it back with them", async () => {
  // An imported output whose leading atoms are collinear, with modes, orbitals, a basis and a grid.
  const parsed = parseScientificFile("chain.xyz", "5\nchain\nC 0 0 0\nN 1.2 0 0\nO 2.4 0 0\nH 1.2 1.05 0\nF 2.4 1.3 0.9\n");
  const displacements = parsed.atoms.map(() => [0, 0, 1]);
  const science = {
    ...parsed, converged: true,
    frames: [{ atoms: parsed.atoms, energyHartree: -1.5, velocitiesAngstromPerPs: displacements, forcesKcalMolAngstrom: displacements }],
    modes: [{ index: 0, frequencyCm1: 1000, displacements }],
    orbitals: [{ index: 0, energyHartree: -0.5, occupancy: 2, spin: "alpha", coefficients: [1, 0, 0, 0, 0] }],
    basis: parsed.atoms.map((_, atomIndex) => ({ atomIndex, kind: "s", spherical: true, exponents: [1], coefficients: [1] })),
    grid: { dimensions: [1, 1, 1], origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], values: new Float32Array([1]) },
  };
  const original = { name: "chain.out", file: new Blob(["chain output"]) };
  await openScientificDocument(actions, "chain.out", science, "final", original);
  const document = useMoleculeStore.getState().documents.at(-1);
  const imported = current(document);
  const view = await mount(document);
  try {
    const convert = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Convert to internal coordinates");
    await act(async () => convert.click());
    for (let attempt = 0; attempt < 50 && !view.host.querySelector('[aria-label="Z-matrix rows"]'); attempt++) await settle();
    assert.deepEqual(rows(), ["C1", "N2", "Ref 1", "O3", "H4", "F5"]);
    assert.equal(seen.science.modes.length, 1);

    await addRow("atom", { Element: "Cl", "Bond measured from": "0", "Bond, Å": "1.8" });
    await reloadScene(document);
    const edited = current(document);
    assert.equal(lines(edited)[0], "6");
    const { atoms, frames, modes, orbitals, basis, grid, converged, internalCoordinates } = seen.science;
    assert.deepEqual({ atoms: atoms.length, frames, modes, orbitals, basis, grid, converged, rows: internalCoordinates.rows.length },
      { atoms: 6, frames: [{ atoms }], modes: [], orbitals: [], basis: undefined, grid: undefined, converged: undefined, rows: 7 });
    assert.equal(seen.original, original, "the uploaded file stays with the document");

    await click(byLabel("Undo"));
    await reloadScene(document);
    assert.equal(current(document), imported);
    assert.equal(seen.science.modes.length, 1, "the previous revision keeps its modes");
    assert.equal(seen.science.orbitals.length, 1);
    assert.equal(seen.science.basis.length, 5);
    assert.equal(seen.science.frames[0].energyHartree, -1.5);
    await click(byLabel("Redo"));
    await reloadScene(document);
    assert.equal(current(document), edited);
    assert.deepEqual(seen.science.modes, []);
  } finally { await view.unmount(); }
}, TIMEOUT_MS);

test("rows of a converted XYZ keep each surviving atom's own source line, numbers as written", async () => {
  const text = "5\nleading collinear chain\nC 5.000000 -7.000000 11.000000\nN 5.432000 -6.424000 10.040000\nO 5.864000 -5.848000 9.080000\nH 4.592000 -6.160000 11.672000\nF 5.024000 -5.120000 9.720000\n";
  const [document] = await actions.openStructureRecords([{ path: "chain-written.xyz", text, inputExtension: "xyz" }]);
  const view = await mount(document);
  try {
    const convert = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Convert to internal coordinates");
    await act(async () => convert.click());
    for (let attempt = 0; attempt < 50 && !view.host.querySelector('[aria-label="Z-matrix rows"]'); attempt++) await settle();
    assert.deepEqual(rows(), ["C1", "N2", "Ref 1", "O3", "H4", "F5"]);
    assert.equal(await rowAction("H4", "Remove H4"), true);
    await reloadScene(document);
    const removed = current(document);
    assert.deepEqual(lines(removed), ["4", "leading collinear chain", ...[2, 3, 4, 6].map((index) => lines(text)[index]), ""]);
    assert.equal(await rowAction("F4", "Move up"), true);
    await reloadScene(document);
    assert.deepEqual(lines(current(document)).slice(2, 6), [2, 3, 6, 4].map((index) => lines(text)[index]), "moved rows carry their lines");
    await click(byLabel("Undo"));
    await reloadScene(document);
    await click(byLabel("Undo"));
    await reloadScene(document);
    assert.equal(current(document), text, "Undo returns the file exactly");
  } finally { await view.unmount(); }
}, TIMEOUT_MS);

test("a row edit the source moved past or closed before its scene showed gives back the Redo branch it replaced", async () => {
  // water → F (t1) → Ref (t2) → Undo to t1 → a Cl row whose scene is still loading.
  const branch = async (name) => {
    const document = await openZmat(water, name);
    const imported = current(document);
    const view = await mount(document);
    await addRow("atom", { Element: "F", "Bond measured from": "0", "Bond, Å": "1.4" });
    await reloadScene(document);
    const t1 = current(document);
    await addRow("point");
    const t2 = current(document);
    await click(byLabel("Undo"));
    assert.equal(current(document), t1);
    await addRow("atom", { Element: "Cl", "Bond measured from": "0", "Bond, Å": "1.8" });
    assert.ok(busy());
    assert.equal(lines(current(document))[0], "5");
    assert.deepEqual(seen.revisions, [imported, t1, current(document)], "the pending edit replaced the Redo branch for now");
    return { document, view, imported, t1, t2 };
  };

  // A text Undo in the source returns to t1 while the scene loads the Cl atom.
  const moved = await branch("water-superseded.zmat");
  try {
    await act(async () => controller.updateDraft(moved.document, moved.t1));
    for (let attempt = 0; attempt < 30 && busy(); attempt++) await settle();
    assert.equal(busy(), false);
    assert.equal(current(moved.document), moved.t1, "the source keeps its own text");
    assert.deepEqual(seen.revisions, [moved.imported, moved.t1, moved.t2], "the Redo branch is back");
    assert.equal(byLabel("Redo").disabled, false);
    await click(byLabel("Redo"));
    assert.equal(current(moved.document), moved.t2);
    assert.equal(seen.science.atoms.length, 4);
    assert.deepEqual(rows(), ["O1", "Ref 1", "H2", "H3", "F4", "Ref 2"]);
  } finally { await moved.view.unmount(); }

  // The source closes while the scene loads the Cl atom: the file is untouched, the history whole.
  const closed = await branch("water-superseded-closing.zmat");
  try {
    window.confirm = () => true;
    await act(async () => { await controller.closeDocuments([closed.document.id]); });
    for (let attempt = 0; attempt < 50 && busy(); attempt++) await settle();
    assert.equal(controller.sessionForDocument(closed.document), null);
    assert.equal(readBrowserDevVirtualTextDocument(closed.document.path), closed.imported, "nothing was written to the closed source");
    assert.deepEqual(seen.revisions, [closed.imported, closed.t1, closed.t2]);
  } finally { await closed.view.unmount(); }
}, TIMEOUT_MS);

test("edits that leave every real atom in place keep all data of the geometry; edits that move atoms leave it out", async () => {
  // An imported output with a Z-matrix and data computed for its geometry.
  const parsed = parseScientificFile("frame-data.zmat", water);
  const vectors = parsed.atoms.map(() => [0, 0, 1]);
  const modes = [{ index: 0, frequencyCm1: 1000, displacements: vectors }];
  const science = {
    ...parsed, converged: true, modes,
    frames: [{ atoms: parsed.atoms, energyHartree: -75.123, comment: "final frame", timePs: 2, temperatureKelvin: 298,
      velocitiesAngstromPerPs: vectors, forcesKcalMolAngstrom: vectors, modes }],
    orbitals: [{ index: 0, energyHartree: -0.5, occupancy: 2, spin: "alpha", coefficients: [1, 0, 0] }],
    basis: parsed.atoms.map((_, atomIndex) => ({ atomIndex, kind: "s", spherical: true, exponents: [1], coefficients: [1] })),
    grid: { dimensions: [1, 1, 1], origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], values: new Float32Array([1]) },
  };
  const original = { name: "frame-data.out", file: new Blob(["original bytes"]) };
  await openScientificDocument(actions, original.name, science, "final", original);
  const document = useMoleculeStore.getState().documents.at(-1);
  const view = await mount(document);
  const data = ({ internalCoordinates, ...rest }) => rest;
  try {
    const imported = data(seen.science);
    assert.deepEqual(imported.frames, science.frames);
    const kept = async (step) => {
      assert.deepEqual(data(seen.science), imported, `${step} keeps every atom and all their data`);
      assert.equal(seen.original, original, `${step} keeps the uploaded file`);
      assert.equal(staged(document), null, `${step} does not reload the scene`);
    };

    // A reference point appended, the distance of one changed, an unused variable added.
    await addRow("point");
    await kept("a reference point");
    // Ref 1 places both hydrogens, but only through its direction.
    await press("Bond of Ref 1, Å", "ArrowUp");
    await kept("a reference point's distance");
    await openMenu("Add");
    await click(await choose("Add variable"));
    await type("Variable name", "V1");
    await type("Variable value", "2");
    await act(async () => byLabel("Variable name").closest("form").requestSubmit());
    await settle();
    assert.deepEqual(seen.science.internalCoordinates.variables.map(({ name }) => name), ["R", "A", "V1"]);
    await kept("an unused variable");
    for (let step = 0; step < 3; step++) { await click(byLabel("Undo")); await kept(`Undo ${step + 1}`); }
    assert.equal(byLabel("Undo").disabled, true);
    for (let step = 0; step < 3; step++) { await click(byLabel("Redo")); await kept(`Redo ${step + 1}`); }

    // A variable that moves both hydrogens: the data of the previous geometry is left out.
    await press("Variable R", "ArrowUp");
    const { atoms, ...rest } = data(seen.science);
    assert.notDeepEqual(atoms, imported.atoms);
    assert.deepEqual({ ...rest, atoms: atoms.length }, { format: imported.format, frames: [{ atoms }], modes: [], orbitals: [], atoms: 3 });
    assert.equal(seen.original, original);
    await click(byLabel("Undo"));
    await kept("Undo of the moved atoms");
  } finally { await view.unmount(); }
}, TIMEOUT_MS);
