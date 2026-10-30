import { ensureGeometryViewerFrame } from "./fixtures/geometry-viewer-frame";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";

// Compile the panels and the import owner with the React Compiler, as the app build does.
const COMPILED = /apps\/desktop\/src\/(components\/workbench\/geometry-fields\.tsx|lib\/workbench\/source\.ts|components\/workbench\/zmatrix-panel\.tsx|components\/geometry-panel\.tsx)$/u;
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
// The draft owner's contract: a session per source path holding the current text; every
// change re-renders its consumers, as the provider's state does in the app.
const sessions = new Map();
const listeners = new Set();
let draftVersion = 0;
const draftsChanged = () => { draftVersion++; listeners.forEach((listener) => listener()); };
const { readBrowserDevVirtualTextDocument, writeBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const setDraft = (path, content) => { sessions.set(path, { content, dirty: true }); draftsChanged(); };
// Starting a session waits for `beginGate`, as a real session waits for its file.
let beginGate = Promise.resolve();
mock.module("../apps/desktop/src/lib/source-editing/context", () => ({ useSourceEditing: () => {
  React.useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => draftVersion);
  return {
    sessionForDocument: (document) => { if (!document) return null; ensureGeometryViewerFrame(document); return sessions.get(document.path) ?? null; },
    beginEditing: async (document) => {
      await beginGate;
      sessions.set(document.path, { content: readBrowserDevVirtualTextDocument(document.path), dirty: false });
      draftsChanged();
    },
    updateDraft: (document, content) => setDraft(document.path, content),
  };
} }));
mock.module("../apps/desktop/src/lib/geometry-binding", () => ({ readGeometryBinding: async (document, _send, isCurrent) => ({
  lease: "zmatrix-fixture", text: new TextDecoder().decode(new TextEncoder().encode(sessions.get(document.path)?.content ?? readBrowserDevVirtualTextDocument(document.path))),
  target: { documentId: document.id, source: window, isCurrent },
}) }));
const { createRoot } = await import("react-dom/client");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { GeometryPanel } = await import("../apps/desktop/src/components/geometry-panel");
const { atomsFromZmatrixDocument, parseZmatrixDocument } = await import("../scripts/zmatrix-document.mjs");
const { placeInReferenceFrame } = await import("../scripts/internal-coordinates.mjs");

// Water placed from a reference point: both O–H bonds share R, both X–O–H angles share A.
const zmat = "O\r\nX 1 1.0\r\nH 1 R 2 A\r\nH 1 R 2 A 3 180\r\n\r\nR = 0.9572\r\nA = 52.26\r\n";
let opened = 0;
// Every scene update the panels send; `viewer` answers them (an acknowledgement or a failure).
const sent = [];
let viewer = async () => {};
const actions = {
  runStructureViewerAction: (document, action) => { sent.push({ id: document.id, ...action }); return viewer(document, action); },
  openStructureRecords: async (records) => records.map((record) => {
    const id = `zmat-${++opened}`;
    const path = `burette-ketcher://${id}/${record.path}`;
    writeBrowserDevVirtualTextDocument(path, record.text);
    const document = { id, title: record.path, path, extension: record.inputExtension, renderer: "molstar", virtual: true };
    useMoleculeStore.setState((state) => ({ documents: [...state.documents, document] }));
    return document;
  }),
};
const current = (document) => sessions.get(document.path)?.content ?? readBrowserDevVirtualTextDocument(document.path);
const atomsOf = (text) => text.trim().split("\n").slice(2).map((line) => { const [element, ...xyz] = line.trim().split(/\s+/u); return { element, position: xyz.map(Number) }; });
const distance = (a, b) => Math.hypot(...a.position.map((value, axis) => value - b.position[axis]));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

async function mount(document) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<GeometryPanel document={document} actions={actions} />));
  for (let attempt = 0; attempt < 50 && !host.querySelector('[aria-label="Z-matrix rows"], .geometry-table'); attempt++) await settle();
  await settle();
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const field = (host, label) => host.querySelector(`[role="spinbutton"][aria-label="${label}"]`);
const press = async (host, label, key) => {
  await act(async () => field(host, label).dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key })));
  await settle();
};
const click = async (host, label) => { await act(async () => host.querySelector(`[aria-label="${label}"]`).click()); await settle(); };

test("an imported Z-matrix edits through its shared variables and reference point, with Undo, Redo and export", async () => {
  await openScientificFiles(actions, [new File([zmat], "water.zmat")]);
  const document = useMoleculeStore.getState().documents.at(-1);
  // The reference point places the hydrogens but never becomes an atom.
  const imported = atomsOf(current(document));
  assert.deepEqual(imported.map((atom) => atom.element), ["O", "H", "H"]);
  assert.ok(Math.abs(distance(imported[0], imported[1]) - 0.9572) < 1e-4);

  let view = await mount(document);
  try {
    const rows = [...view.host.querySelectorAll('[aria-label="Z-matrix rows"] tbody tr')];
    assert.deepEqual(rows.map((row) => row.querySelector("th").textContent), ["O1", "Ref 1", "H2", "H3"]);
    assert.deepEqual(rows.map((row) => row.hasAttribute("data-reference-point")), [false, true, false, false]);
    assert.deepEqual([...view.host.querySelectorAll('[aria-label="Variables"] tbody tr')].map((row) => [
      row.querySelector("th").textContent, row.querySelector('[role="spinbutton"]').getAttribute("aria-valuenow"), row.querySelector(".zmatrix-uses").textContent,
    ]), [["R", "0.9572", "bond H2, bond H3"], ["A", "52.26", "angle H2, angle H3"]]);

    // One variable edit moves both bonds it is bound to, in the same document.
    const before = current(document);
    await press(view.host, "Variable R", "ArrowUp");
    const edited = atomsOf(current(document));
    assert.equal(useMoleculeStore.getState().documents.at(-1).id, document.id, "no new document");
    assert.ok(Math.abs(distance(edited[0], edited[1]) - 0.9672) < 1e-4);
    assert.ok(Math.abs(distance(edited[0], edited[2]) - 0.9672) < 1e-4);
    assert.match(current(document).split("\n")[1], /import-[0-9a-f]{8}/u, "the edit keeps the import token");

    // An invalid value is reported before anything is applied; the source keeps its last valid text.
    let accepted = current(document);
    for (let attempt = 0; attempt < 15 && !view.host.querySelector('[role="alert"]'); attempt++) {
      accepted = current(document);
      await press(view.host, "Variable R", "PageDown");
    }
    assert.ok(view.host.querySelector('[role="alert"]'), "a negative bond is rejected");
    assert.equal(current(document), accepted);
    assert.equal(field(view.host, "Variable R").getAttribute("aria-valuenow"), view.host.querySelector('[aria-label="Variables"] [role="spinbutton"]').getAttribute("aria-valuenow"));
    assert.ok(Number(field(view.host, "Variable R").getAttribute("aria-valuenow")) > 0, "the field springs back to the applied value");

    // Undo walks back through revisions with their bindings; Redo returns.
    const revisionsBack = [];
    while (!view.host.querySelector('[aria-label="Undo"]').disabled) { await click(view.host, "Undo"); revisionsBack.push(current(document)); }
    assert.equal(current(document), before, "Undo reaches the imported geometry exactly");
    assert.equal(field(view.host, "Variable R").getAttribute("aria-valuenow"), "0.9572");
    await click(view.host, "Redo");
    assert.ok(Math.abs(distance(atomsOf(current(document))[0], atomsOf(current(document))[2]) - 0.9672) < 1e-4);
    assert.equal(field(view.host, "Variable R").getAttribute("aria-valuenow"), "0.9672");
  } finally { await view.unmount(); }

  // Switching away and back keeps the bindings and the history.
  view = await mount(document);
  try {
    assert.ok(view.host.querySelector('[aria-label="Z-matrix rows"]'));
    assert.equal(view.host.querySelector('[aria-label="Undo"]').disabled, false);

    // Export writes the edited definition with its variables and reference point; it opens again.
    const blobs = [];
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => { blobs.push(blob); return "blob:zmat"; };
    try { await click(view.host, "Export Z-matrix"); } finally { URL.createObjectURL = createObjectURL; }
    const exported = await blobs[0].text();
    assert.deepEqual(parseZmatrixDocument(exported), { rows: parseZmatrixDocument(zmat).rows, variables: [{ name: "R", value: 0.9672 }, { name: "A", value: 52.26 }] });
    await openScientificFiles(actions, [new File([exported], "water.zmat")]);
    const reopened = useMoleculeStore.getState().documents.at(-1);
    assert.notEqual(reopened.id, document.id);
    // The edit keeps the imported frame, so the reopened canonical placement agrees to rounding.
    atomsOf(current(reopened)).forEach((atom, index) => assert.ok(distance(atom, atomsOf(current(document))[index]) < 1e-9));
  } finally { await view.unmount(); }

  // An edit made elsewhere leaves no bindings to stale rows; returning to a revision brings them back.
  view = await mount(document);
  try {
    const bound = current(document);
    const lines = bound.split("\n");
    lines[3] = "H 2.000000 0.000000 0.000000";
    await act(async () => setDraft(document.path, lines.join("\n")));
    await settle();
    assert.equal(view.host.querySelector('[aria-label="Z-matrix rows"]'), null, "another edit shows Cartesian rows");
    assert.ok(view.host.querySelector(".geometry-table"));
    await act(async () => setDraft(document.path, bound));
    await settle();
    assert.ok(view.host.querySelector('[aria-label="Z-matrix rows"]'), "Undo of that edit restores the bindings");
  } finally { await view.unmount(); }
});

// Holds every geometry acknowledgement until `release`, which answers them all at once.
function holdAcknowledgements() {
  const acks = [];
  viewer = async (_document, action) => { if (action.type === "update_geometry") await new Promise((resolve) => acks.push(resolve)); };
  return {
    count: () => acks.length,
    release: async () => { viewer = async () => {}; acks.splice(0).forEach((resolve) => resolve()); await settle(); },
  };
}
const geometrySent = (document, text) => sent.some((action) => action.id === document.id && action.type === "update_geometry" && action.text === text);
// The geometry the scene shows last for `document`.
const shown = (document) => sent.filter((action) => action.id === document.id && action.type === "update_geometry").at(-1)?.text;
async function openZmatrix(text = zmat, name = "water.zmat") {
  await openScientificFiles(actions, [new File([text], name)]);
  return useMoleculeStore.getState().documents.at(-1);
}
const disabled = (host, label) => host.querySelector(`[aria-label="${label}"]`).disabled;

test("an edit whose acknowledgement arrives after the panel closed, or after the source moved on, writes nothing", async () => {
  const document = await openZmatrix();
  const imported = current(document);

  // Closed while the scene had the edit: no draft, no revision.
  let ack = holdAcknowledgements();
  let view = await mount(document);
  await press(view.host, "Variable R", "ArrowUp");
  assert.equal(ack.count(), 1, "the edit waits for the scene");
  await view.unmount();
  await ack.release();
  assert.equal(current(document), imported);
  view = await mount(document);
  assert.equal(disabled(view.host, "Undo"), true, "no revision was recorded");

  // Closed while the session was still opening: the scene never receives the edit.
  await view.unmount();
  sessions.delete(document.path);
  let open;
  beginGate = new Promise((resolve) => { open = resolve; });
  view = await mount(document);
  await press(view.host, "Variable A", "ArrowUp");
  await view.unmount();
  const closedAt = sent.length;
  open();
  beginGate = Promise.resolve();
  await settle();
  assert.equal(current(document), imported);
  assert.deepEqual(sent.slice(closedAt).filter((action) => action.type === "update_geometry").map((action) => action.text), [],
    "no scene update after closing (closing itself restored the gesture's preview)");
  assert.equal(sent.filter((action) => action.type === "update_geometry").at(-1).text, imported);

  // The source moved to another revision (as the text editor's Redo does) while the edit was pending.
  view = await mount(document);
  try {
    await press(view.host, "Variable R", "ArrowUp");
    const later = current(document);
    await click(view.host, "Undo");
    assert.equal(current(document), imported);
    ack = holdAcknowledgements();
    await press(view.host, "Variable A", "ArrowUp");
    const pending = sent.at(-1).text;
    await act(async () => setDraft(document.path, later));
    await settle();
    sent.length = 0;
    await ack.release();
    assert.equal(current(document), later, "the newer source is kept");
    assert.equal(geometrySent(document, later), false, "the old computed edit cannot acquire a fresh lease or overwrite the newer source owner");
    assert.equal(disabled(view.host, "Redo"), true);
    await click(view.host, "Undo");
    assert.equal(current(document), imported, "history is the two revisions it had");
    assert.notEqual(pending, later);
  } finally { await view.unmount(); }
});

test("one edit at a time per document, across Geometry surfaces", async () => {
  const document = await openZmatrix();
  const imported = current(document);
  const first = await mount(document);
  const second = await mount(document);
  try {
    const ack = holdAcknowledgements();
    await press(first.host, "Variable R", "ArrowUp");
    await press(second.host, "Variable R", "PageUp");
    await ack.release();
    const atoms = atomsOf(current(document));
    assert.ok(Math.abs(distance(atoms[0], atoms[1]) - 0.9672) < 1e-4, "the first edit applies, the second is refused");
    assert.equal(shown(document), current(document), "the refused edit never reaches the scene");
    await click(first.host, "Undo");
    assert.equal(current(document), imported, "one revision");
    assert.equal(shown(document), imported);
    assert.equal(field(second.host, "Variable R").getAttribute("aria-valuenow"), "0.9572", "the refused field springs back");
  } finally { await first.unmount(); await second.unmount(); }
});

test("a failed edit after Undo keeps the Redo branch and the source", async () => {
  const document = await openZmatrix();
  const view = await mount(document);
  try {
    await press(view.host, "Variable R", "ArrowUp");
    await press(view.host, "Variable R", "ArrowUp");
    const latest = current(document);
    await click(view.host, "Undo");
    const undone = current(document);
    let failed = false;
    viewer = async (_document, action) => {
      if (action.type === "update_geometry" && !failed) { failed = true; throw new Error("Scene unavailable"); }
    };
    await press(view.host, "Variable A", "ArrowUp");
    viewer = async () => {};
    assert.equal(view.host.querySelector('[role="alert"]').textContent, "Scene unavailable");
    assert.equal(current(document), undone, "the source keeps its text");
    assert.equal(disabled(view.host, "Redo"), false, "the Redo branch survives");
    await click(view.host, "Redo");
    assert.equal(current(document), latest);
  } finally { await view.unmount(); }
});

test("a definition-only edit is its own revision: it exports, undoes and never grows the comment", async () => {
  // U sets nothing; the reference point's distance never moves a real atom.
  const document = await openZmatrix(`${zmat}U = 1.5\n`);
  const imported = current(document);
  const atomLines = (text) => text.split("\n").slice(2);
  const exported = async (host) => {
    const blobs = [];
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => { blobs.push(blob); return "blob:zmat"; };
    try { await click(host, "Export Z-matrix"); } finally { URL.createObjectURL = createObjectURL; }
    return parseZmatrixDocument(await blobs[0].text());
  };
  const view = await mount(document);
  try {
    await press(view.host, "Variable U", "ArrowUp");
    const unused = current(document);
    assert.notEqual(unused, imported, "the draft records the definition");
    assert.deepEqual(atomLines(unused), atomLines(imported), "no atom moved");
    assert.equal((await exported(view.host)).variables.find((item) => item.name === "U").value, 2.5);
    await press(view.host, "Variable U", "ArrowUp");
    await press(view.host, "Bond of Ref 1, Å", "ArrowUp");
    const dummy = current(document);
    assert.deepEqual(atomLines(dummy), atomLines(imported));
    assert.equal((await exported(view.host)).rows[1].values[0], 1.01);
    const comment = (text) => text.split("\n")[1];
    assert.equal(comment(dummy).length, comment(unused).length, "one marker, replaced");
    assert.ok(comment(dummy).startsWith(comment(imported)), "the import token stays");

    await click(view.host, "Undo");
    await click(view.host, "Undo");
    assert.equal(current(document), unused);
    await click(view.host, "Undo");
    assert.equal(current(document), imported, "Undo reaches the import exactly");
    assert.deepEqual(await exported(view.host), parseZmatrixDocument(`${zmat}U = 1.5\n`));
    await click(view.host, "Redo");
    assert.equal(current(document), unused);

    // A geometry change needs no marker.
    await press(view.host, "Variable R", "ArrowUp");
    assert.equal(comment(current(document)), comment(imported));
  } finally { await view.unmount(); }
});

test("an XYZ whose first atoms are collinear converts to internal coordinates in place and edits in its own frame", async () => {
  // Leading C–N–O line, rotated and translated away from every axis.
  const rotation = [[0.36, -0.8, 0.48], [0.48, 0.6, 0.64], [-0.8, 0, 0.6]];
  const place = ([x, y, z]) => rotation.map((row, k) => [5, -7, 11][k] + row[0] * x + row[1] * y + row[2] * z);
  const raw = [["C", [0, 0, 0]], ["N", [1.2, 0, 0]], ["O", [2.4, 0, 0]], ["H", [1.2, 1.05, 0]], ["F", [2.4, 1.3, 0.9]]];
  const text = `5\nleading collinear chain\n${raw.map(([element, position]) => `${element} ${place(position).map((value) => value.toFixed(6)).join(" ")}`).join("\n")}\n`;
  const [document] = await actions.openStructureRecords([{ path: "chain.xyz", text, inputExtension: "xyz" }]);
  const view = await mount(document);
  try {
    const convert = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Convert to internal coordinates");
    assert.ok(convert, "Geometry offers the conversion instead of an error");
    await act(async () => convert.click());
    for (let attempt = 0; attempt < 50 && !view.host.querySelector('[aria-label="Z-matrix rows"]'); attempt++) await settle();
    assert.equal(useMoleculeStore.getState().documents.at(-1).id, document.id, "no new molecule");
    assert.equal(current(document), text, "converting changes nothing");
    const rows = [...view.host.querySelectorAll('[aria-label="Z-matrix rows"] tbody tr')].map((row) => row.querySelector("th").textContent);
    assert.deepEqual(rows, ["C1", "N2", "Ref 1", "O3", "H4", "F5"]);

    await press(view.host, "Bond of H4, Å", "ArrowUp");
    const edited = current(document);
    assert.deepEqual(edited.split("\n").slice(0, 5), text.split("\n").slice(0, 5), "the leading atoms keep their lines: no reorientation or translation");
    assert.notEqual(edited.split("\n")[5], text.split("\n")[5], "the edited atom moved");

    // The exported definition rebuilds exactly the edited source geometry.
    const blobs = [];
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => { blobs.push(blob); return "blob:zmat"; };
    try { await click(view.host, "Export Z-matrix"); } finally { URL.createObjectURL = createObjectURL; }
    const definition = parseZmatrixDocument(await blobs[0].text());
    assert.equal(definition.rows.filter((row) => row.element === "X").length, 1);
    const source = atomsOf(edited);
    placeInReferenceFrame(atomsFromZmatrixDocument(definition), source).forEach((atom, index) => assert.ok(distance(atom, source[index]) < 1e-5));
    const original = atomsOf(text);
    const bondReference = definition.rows[4].refs[0];
    const real = (row) => definition.rows.slice(0, row).filter((item) => item.element !== "X").length;
    assert.ok(definition.rows[bondReference].element !== "X");
    assert.ok(Math.abs(distance(source[3], source[real(bondReference)]) - distance(original[3], original[real(bondReference)]) - 0.01) < 1e-5);

    await click(view.host, "Undo");
    assert.equal(current(document), text, "Undo returns the file text exactly");
    await click(view.host, "Redo");
    assert.equal(current(document), edited);
  } finally { await view.unmount(); }
});

test("an imported output whose leading atoms are collinear converts in place and edits through its conversion", async () => {
  const { openScientificDocument } = await import("../apps/desktop/src/lib/workbench/open");
  const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
  const science = parseScientificFile("chain.xyz", "5\nchain\nC 0 0 0\nN 1.2 0 0\nO 2.4 0 0\nH 1.2 1.05 0\nF 2.4 1.3 0.9\n");
  await openScientificDocument(actions, "chain.out", science, "final");
  const document = useMoleculeStore.getState().documents.at(-1);
  const imported = current(document);
  const view = await mount(document);
  try {
    const convert = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Convert to internal coordinates");
    assert.ok(convert, "the import offers the conversion");
    await act(async () => convert.click());
    await settle();
    // The conversion shares the import's text and must win over the import's own data.
    assert.deepEqual([...view.host.querySelectorAll('[aria-label="Z-matrix rows"] tbody tr')].map((row) => row.querySelector("th").textContent),
      ["C1", "N2", "Ref 1", "O3", "H4", "F5"]);
    assert.equal(current(document), imported, "converting changes nothing");
    await press(view.host, "Bond of H4, Å", "ArrowUp");
    const edited = current(document);
    assert.notEqual(edited, imported);
    assert.equal(shown(document), edited);
    assert.ok(view.host.querySelector('[aria-label="Z-matrix rows"]'), "the edit is a revision of the conversion");
    await click(view.host, "Undo");
    assert.equal(current(document), imported, "Undo returns the import text exactly");
    assert.ok(view.host.querySelector('[aria-label="Z-matrix rows"]'), "and keeps the conversion");
    await click(view.host, "Redo");
    assert.equal(current(document), edited);
  } finally { await view.unmount(); }
});


test("a converted raw XYZ with a UTF8 BOM edits and undoes through its projected runtime baseline", async () => {
  const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
  const { convertToInternalCoordinates } = await import("../apps/desktop/src/lib/workbench/zmatrix-draft");
  const original = "\uFEFF3\r\nBOM water\r\nO 0 0 0\r\nH 1 0 0\r\nH 0 1 0\r\n";
  const [document] = await actions.openStructureRecords([{ path: "bom.xyz", text: original, inputExtension: "xyz" }]);
  convertToInternalCoordinates(document.id, original, parseScientificFile("bom.xyz", original));
  const view = await mount(document);
  try {
    assert.ok(view.host.querySelector('[aria-label="Z-matrix rows"]'));
    await press(view.host, "Bond of H2, Å", "ArrowUp");
    assert.ok(current(document).startsWith("\uFEFF"));
    assert.equal(shown(document), new TextDecoder().decode(new TextEncoder().encode(current(document))));
    await click(view.host, "Undo");
    assert.equal(current(document), original);
    assert.equal(shown(document), original.slice(1));
  } finally { await view.unmount(); }
});
