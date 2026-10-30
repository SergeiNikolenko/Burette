import { ensureGeometryViewerFrame } from "./fixtures/geometry-viewer-frame";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";

// Optimize in the Z-matrix Geometry tab, through the real source-editing controller. The
// panel, its controls, the live preview owner and the import owner compile with the React
// Compiler, as the app build does. Only the chemistry worker is held by the test.
const COMPILED = /apps\/desktop\/src\/(components\/workbench\/geometry-fields\.tsx|lib\/workbench\/source\.ts|hooks\/use-geometry-live-preview\.ts|components\/workbench\/(zmatrix-(panel|row-controls|definition-controls)|constraint-toggle|optimize-button)\.tsx|components\/geometry-panel\.tsx)$/u;
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
mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureText: async (path) => readBrowserDevVirtualTextDocument(path),
  readStructureTextDocument: async (path) => ({ content: readBrowserDevVirtualTextDocument(path), truncated: false }),
}));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async (document) => document, useDeferredViewerRuntime: () => ({}) }));
// The chemistry worker: parsing answers at once; each optimization waits for the test and
// rejects as the real client does when its signal aborts.
const jobs = [];
const parsed = [];
mock.module("../apps/desktop/src/lib/molecular-workbench/compute-client", () => ({
  runChemistryTask: (request, options = {}) => {
    if (request.action === "parse") {
      parsed.push(request);
      return Promise.resolve({ source: request.source });
    }
    return new Promise((resolve, reject) => {
      jobs.push({ request, options, resolve, reject });
      options.signal?.addEventListener("abort", () => reject(new DOMException("Calculation cancelled.", "AbortError")), { once: true });
    });
  },
}));
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
const { useWorkbenchDialogRequest, closeWorkbenchDialog } = await import("../apps/desktop/src/lib/workbench/dialog-store");
const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");
const { atomsFromZmatrixDocument } = await import("../scripts/zmatrix-document.mjs");
const { placeInReferenceFrame } = await import("../scripts/internal-coordinates.mjs");

let opened = 0;
const sent = [];
const actions = {
  runStructureViewerAction: async (document, action) => { sent.push({ id: document.id, ...action }); },
  openStructureRecords: async (records) => records.map((record) => {
    const id = `zmat-optimize-${++opened}`;
    const path = `burette-ketcher://${id}/${record.path}`;
    writeBrowserDevVirtualTextDocument(path, record.text);
    const document = { id, title: record.path, path, extension: record.inputExtension, renderer: "molstar", virtual: true };
    useMoleculeStore.setState((state) => ({ documents: [...state.documents, document] }));
    return document;
  }),
};
let controller;
let seen = {};
function Probe({ document }) {
  const { document: science, text } = useScientificDocument(document);
  const revisions = useImportedRevisions(document.id, text ?? "");
  seen = { science, original: useImportedOriginal(document.id), dialog: useWorkbenchDialogRequest(), revisions: revisions?.map((revision) => revision.text) ?? null };
  return null;
}
const preferences = { rendererMode: "molstar" };
// `panel` closes the Geometry tab while the document and its source session stay open.
function Fixture({ document, panel = true }) {
  ensureGeometryViewerFrame(document);
  controller = useSourceEditingController({ activeDocument: document, preferences, pushErrorStatus() {}, setDockOpen() {}, setDockActiveTab() {} });
  return <SourceEditingProvider value={controller}>{panel ? <GeometryPanel document={document} actions={actions} /> : null}<Probe document={document} /></SourceEditingProvider>;
}
const current = (document) => controller?.sessionForDocument(document)?.content ?? readBrowserDevVirtualTextDocument(document.path);
const shown = (document) => sent.filter((action) => action.id === document.id && action.type === "update_geometry").at(-1)?.text;
const staged = (document) => {
  const preview = controller.sessionForDocument(document)?.sourcePreview;
  return preview?.slots[preview.activeSlot === "primary" ? "secondary" : "primary"] ?? null;
};
const lines = (text) => text.split("\n");
const atomsOf = (text) => text.trim().split("\n").slice(2).map((line) => {
  const [element, ...xyz] = line.trim().split(/\s+/u);
  return { element, position: xyz.map(Number) };
});
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const body = () => window.document.body;
const byLabel = (label) => body().querySelector(`[aria-label="${label}"]`);
const alert = () => body().querySelector('.zmatrix-panel [role="alert"]')?.textContent ?? null;
const statuses = () => [...body().querySelectorAll('.zmatrix-panel p[role="status"]')].map((node) => node.textContent);
const result = () => statuses().find((text) => text.startsWith("MMFF94")) ?? null;
const optimizeButton = () => [...body().querySelectorAll(".zmatrix-panel button")].find((button) => button.textContent === "Optimize") ?? null;
const cancelButton = () => [...body().querySelectorAll(".zmatrix-panel button")].find((button) => button.textContent === "Cancel") ?? null;
const click = async (element) => { await act(async () => element.click()); await settle(); };
const press = async (label, key) => {
  await act(async () => body().querySelector(`[role="spinbutton"][aria-label="${label}"]`).dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })));
  await settle();
};
const pressed = (label) => byLabel(label)?.getAttribute("aria-pressed") === "true";
async function mount(document) {
  const host = window.document.createElement("div");
  body().append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Fixture document={document} />));
  for (let attempt = 0; attempt < 50 && !host.querySelector('[aria-label="Z-matrix rows"]'); attempt++) await settle();
  return {
    close: async () => { await act(async () => root.render(<Fixture document={document} panel={false} />)); await settle(); },
    unmount: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}
async function openZmat(text, name = "molecule.zmat") {
  await openScientificFiles(actions, [new File([text], name)]);
  return useMoleculeStore.getState().documents.at(-1);
}
// Optimized water as the worker reports it: `move` maps each current atom to its new position.
const optimized = (atoms, move, extra = {}) => ({
  molecule: { atoms: atoms.map((atom, index) => { const [x, y, z] = move(atom, index); return { element: atom.element, x, y, z }; }), bonds: [] },
  initialEnergy: 0.15, energy: 0, unit: "kcal/mol", converged: true, constraintResiduals: [], ...extra,
});
const TIMEOUT_MS = 30_000;
const water = "O\nX 1 1.0\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 0.9572\nA = 52.26\n";
const CHANGED = "The structure changed while optimizing; the result was not applied.";

test("Optimize holds frozen atoms and fixed coordinates on real atoms, writes one revision through the same rows, and Undo/Redo return to each exactly", async () => {
  // A Z-matrix output with data computed for its geometry.
  const science0 = parseScientificFile("frame-data.zmat", water);
  const vectors = science0.atoms.map(() => [0, 0, 1]);
  const modes = [{ index: 0, frequencyCm1: 1000, displacements: vectors }];
  const science = {
    ...science0, converged: true, modes,
    frames: [{ atoms: science0.atoms, energyHartree: -75.123, velocitiesAngstromPerPs: vectors, forcesKcalMolAngstrom: vectors, modes }],
    orbitals: [{ index: 0, energyHartree: -0.5, occupancy: 2, spin: "alpha", coefficients: [1, 0, 0] }],
    basis: science0.atoms.map((_, atomIndex) => ({ atomIndex, kind: "s", spherical: true, exponents: [1], coefficients: [1] })),
  };
  const original = { name: "frame-data.out", file: new Blob(["original bytes"]) };
  await openScientificDocument(actions, original.name, science, "final", original);
  const document = useMoleculeStore.getState().documents.at(-1);
  const view = await mount(document);
  try {
    const imported = current(document);
    const before = seen.science;
    // Reference points have no atom freeze; their coordinates can be held exactly.
    assert.equal(byLabel("Freeze Ref 1"), null);
    assert.equal(byLabel("Keep angle of h2 fixed").disabled, false);
    await click(byLabel("Freeze O1"));
    await click(byLabel("Keep bond of h3 fixed"));
    assert.ok(pressed("Freeze O1") && pressed("Keep bond of h3 fixed"));

    await click(optimizeButton());
    assert.equal(jobs.length, 1);
    const [job] = jobs;
    // The force field gets the three real atoms; H3 is real atom 2 although it is row 3.
    assert.equal(atomsOf(parsed.at(-1).source).length, 3);
    assert.deepEqual(atomsOf(parsed.at(-1).source).map(({ element }) => element), ["O", "H", "H"]);
    assert.equal(job.request.action, "optimize-zmatrix");
    assert.deepEqual(job.request.definition, before.internalCoordinates);
    assert.deepEqual(job.request.options, { frozenRows: [0], lockedCoordinates: ['3:0'], forceField: 'MMFF94' });
    assert.equal(job.options.timeoutMs, 300_000);
    assert.equal(body().querySelector('.zmatrix-panel .workbench-status[role="status"]')?.textContent, "Optimizing");
    assert.deepEqual(statuses(), []);
    assert.equal(byLabel("Undo").disabled, true);
    assert.equal(byLabel("Add").disabled, true);

    // Holding H3's bond holds the shared R, so both bond lengths remain fixed.
    // The free angle relaxes while O keeps its exact Cartesian coordinates.
    const nextDefinition = { ...before.internalCoordinates, variables: before.internalCoordinates.variables.map(variable => variable.name === 'A' ? { ...variable, value: 53 } : variable) };
    const after = atomsFromZmatrixDocument(nextDefinition);
    await act(async () => job.resolve(optimized(before.atoms, (_, index) => after[index].position, { definition: nextDefinition })));
    await settle();
    const t1 = current(document);
    assert.notEqual(t1, imported);
    assert.deepEqual(seen.revisions, [imported, t1], "one revision");
    assert.equal(lines(t1)[2], lines(imported)[2], "the frozen atom keeps its source line");
    assert.equal(lines(t1)[1], lines(imported)[1], "the comment keeps its import token");
    assert.equal(shown(document), t1, "the scene moves the atoms at the same camera");
    assert.equal(staged(document), null, "no reload");
    assert.equal(alert(), null);
    assert.equal(result(), "MMFF94 0.15 → 0.00 kcal/mol · Converged");
    assert.equal(statuses().some(text => text.includes("no longer follows")), false);

    // The definition keeps its rows and the reference point, and places exactly the optimized atoms.
    const definition = seen.science.internalCoordinates;
    assert.deepEqual(definition.rows.map(({ element, refs }) => [element, refs]), before.internalCoordinates.rows.map(({ element, refs }) => [element, refs]));
    assert.deepEqual(definition.rows[1].values, [1]);
    const rebuilt = placeInReferenceFrame(atomsFromZmatrixDocument(definition), atomsOf(t1));
    rebuilt.forEach((atom, index) => assert.ok(Math.hypot(...atom.position.map((value, axis) => value - atomsOf(t1)[index].position[axis])) < 1e-6));
    assert.deepEqual(definition, nextDefinition);
    assert.equal(definition.rows[2].values[0], 'R');
    assert.equal(definition.rows[3].values[0], 'R');
    // Data computed for the previous geometry is left out; the upload stays.
    const { atoms, frames, modes: left, orbitals, basis, converged } = seen.science;
    assert.deepEqual({ frames, modes: left, orbitals, basis, converged }, { frames: [{ atoms }], modes: [], orbitals: [], basis: undefined, converged: undefined });
    assert.equal(seen.original, original);
    // Constraints stay with the same rows.
    assert.ok(pressed("Freeze O1") && pressed("Keep bond of h3 fixed"));

    // Undo returns to the imported revision with its data; its own result is not shown there.
    await click(byLabel("Undo"));
    assert.equal(current(document), imported);
    assert.deepEqual(seen.science, before);
    assert.equal(result(), null);
    assert.equal(shown(document), imported);
    await click(byLabel("Redo"));
    assert.equal(current(document), t1);
    assert.equal(result(), "MMFF94 0.15 → 0.00 kcal/mol · Converged", "Redo brings back the result of exactly this revision");
    assert.deepEqual(seen.revisions, [imported, t1]);

    // Quantum input gets the real atoms and the same constraints.
    await click(byLabel("Export input file"));
    assert.equal(seen.dialog.kind, "input");
    assert.deepEqual(seen.dialog.atoms, seen.science.atoms);
    assert.deepEqual(seen.dialog.constraints, [{ kind: "freeze", atoms: [0] }, { kind: "distance", atoms: [2, 0] }]);
    await act(async () => closeWorkbenchDialog());
  } finally { await view.unmount(); }
}, TIMEOUT_MS);

test("a failed optimization or a result that does not match the atoms changes nothing and says why", async () => {
  const document = await openZmat(water, "water-failure.zmat");
  const view = await mount(document);
  try {
    const imported = current(document);
    await click(optimizeButton());
    await act(async () => jobs.at(-1).reject(new Error("MMFF94 optimization did not lower the energy.")));
    await settle();
    assert.equal(alert(), "MMFF94 optimization did not lower the energy.");
    assert.equal(current(document), imported);
    assert.deepEqual(seen.revisions, [imported]);
    assert.equal(optimizeButton().disabled, false);

    // A worker answer with other atoms is never written.
    await click(optimizeButton());
    const atoms = seen.science.atoms;
    await act(async () => jobs.at(-1).resolve(optimized(atoms.slice(0, 2), (atom) => [atom.x, atom.y, atom.z])));
    await settle();
    assert.equal(alert(), "The optimized structure does not match the Z-matrix atoms.");
    assert.equal(current(document), imported);
    assert.deepEqual(seen.revisions, [imported]);
    assert.equal(byLabel("Undo").disabled, true);
  } finally { await view.unmount(); }
}, TIMEOUT_MS);

test("Cancel stops the worker and keeps the text and history; a late answer is ignored", async () => {
  const document = await openZmat(water, "water-cancel.zmat");
  const view = await mount(document);
  try {
    const imported = current(document);
    await click(optimizeButton());
    const job = jobs.at(-1);
    await click(cancelButton());
    assert.equal(job.options.signal.aborted, true);
    assert.equal(cancelButton(), null);
    assert.equal(alert(), null);
    assert.deepEqual(statuses(), []);
    await act(async () => job.resolve(optimized(seen.science.atoms, (atom) => [atom.x + 0.1, atom.y, atom.z])));
    await settle();
    assert.equal(current(document), imported);
    assert.deepEqual(seen.revisions, [imported]);
    assert.equal(byLabel("Undo").disabled, true);
    assert.equal(optimizeButton().disabled, false);
  } finally { await view.unmount(); }
}, TIMEOUT_MS);

test("a source change or a closed panel stops the optimization; its result never applies", async () => {
  const document = await openZmat(water, "water-stale.zmat");
  const view = await mount(document);
  try {
    const t0 = current(document);
    await press("Variable R", "ArrowUp");
    const t1 = current(document);
    await click(byLabel("Undo"));
    assert.equal(current(document), t0);

    // Another surface moves the source to the next revision while the worker runs.
    await click(optimizeButton());
    const job = jobs.at(-1);
    await act(async () => controller.updateDraft(document, t1, { previewApplied: true }));
    await settle();
    assert.equal(job.options.signal.aborted, true);
    assert.equal(alert(), CHANGED);
    await act(async () => job.resolve(optimized(seen.science.atoms, (atom) => [atom.x, atom.y + 0.05, atom.z])));
    await settle();
    assert.equal(current(document), t1);
    assert.deepEqual(seen.revisions, [t0, t1], "the Redo branch is intact");

    // Closing the Geometry tab while the document stays open.
    await click(optimizeButton());
    const closed = jobs.at(-1);
    const sentBefore = sent.length;
    await view.close();
    assert.equal(closed.options.signal.aborted, true);
    await act(async () => closed.resolve(optimized(seen.science.atoms, (atom) => [atom.x, atom.y + 0.05, atom.z])));
    await settle();
    assert.equal(current(document), t1);
    assert.deepEqual(seen.revisions, [t0, t1]);
    assert.equal(sent.slice(sentBefore).some((action) => action.type === "update_geometry"), false, "nothing reaches the scene");
  } finally { await view.unmount(); }
}, TIMEOUT_MS);

test("frozen atoms and fixed coordinates stay with the rows they were set on: a row edit leaves them, Undo returns to them", async () => {
  const document = await openZmat(water, "water-rows.zmat");
  const view = await mount(document);
  try {
    await click(byLabel("Freeze H2"));
    assert.ok(pressed("Freeze H2"));
    // A reference point appended: the rows change, so nothing is held over them.
    await act(async () => byLabel("Add").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();
    await click([...body().querySelectorAll('[role="menuitem"]')].find((node) => node.textContent === "Add reference point"));
    await act(async () => byLabel("New reference point").requestSubmit());
    await settle();
    assert.equal(byLabel("Ref 2 actions") !== null, true);
    assert.equal(pressed("Freeze H2"), false);
    assert.ok(statuses().includes("Frozen atoms and fixed coordinates stay with the previous rows; Undo returns to them."));
    await click(optimizeButton());
    assert.deepEqual(jobs.at(-1).request.options, { frozenRows: [], lockedCoordinates: [], forceField: 'MMFF94' });
    await click(cancelButton());

    await click(byLabel("Undo"));
    assert.equal(byLabel("Ref 2 actions"), null);
    assert.ok(pressed("Freeze H2"));
    assert.deepEqual(statuses(), []);
    await click(optimizeButton());
    // The coupled optimizer receives row identities, including dummy rows.
    assert.deepEqual(jobs.at(-1).request.options, { frozenRows: [2], lockedCoordinates: [], forceField: 'MMFF94' });
    await click(cancelButton());
  } finally { await view.unmount(); }
}, TIMEOUT_MS);
