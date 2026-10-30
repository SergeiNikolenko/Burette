import { ensureGeometryViewerFrame } from "./fixtures/geometry-viewer-frame";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";

// Geometry edits (Z-matrix and Cartesian) through the real source-editing controller: an
// edit counts only once the controller's session holds its draft. Panels and the import owner compile with the React
// Compiler, as the app build does.
const COMPILED = /apps\/desktop\/src\/(components\/workbench\/geometry-fields\.tsx|lib\/workbench\/source\.ts|components\/workbench\/zmatrix-panel\.tsx|components\/geometry-panel\.tsx)$/u;
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
const { readBrowserDevVirtualTextDocument, writeBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
// Only source I/O is replaced: opening a session reads the file, which can fail.
let sourceReadable = true;
mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureText: async (path) => readBrowserDevVirtualTextDocument(path),
  readStructureTextDocument: async (path) => {
    if (!sourceReadable) throw new Error("Source file unavailable");
    return { content: readBrowserDevVirtualTextDocument(path), truncated: false };
  },
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
const { TextFileViewer } = await import("../apps/desktop/src/components/text-file-viewer");
const { EditorView } = await import("@codemirror/view");

const zmat = "O\r\nX 1 1.0\r\nH 1 R 2 A\r\nH 1 R 2 A 3 180\r\n\r\nR = 0.9572\r\nA = 52.26\r\n";
let opened = 0;
const sent = [];
let viewer = async () => {};
const actions = {
  runStructureViewerAction: (document, action) => { sent.push({ id: document.id, ...action }); return viewer(document, action); },
  openStructureRecords: async (records) => records.map((record) => {
    const id = `zmat-session-${++opened}`;
    const path = `burette-ketcher://${id}/${record.path}`;
    writeBrowserDevVirtualTextDocument(path, record.text);
    const document = { id, title: record.path, path, extension: record.inputExtension, renderer: "molstar", virtual: true };
    useMoleculeStore.setState((state) => ({ documents: [...state.documents, document] }));
    return document;
  }),
};
let controller;
const sourceErrors = [];
// The right dock shows one tab at a time: Geometry, or the source Text wired as the dock wires it.
function Fixture({ document, tab = "geometry" }) {
  ensureGeometryViewerFrame(document);
  controller = useSourceEditingController({ activeDocument: document, preferences: { rendererMode: "molstar" }, pushErrorStatus: (error) => sourceErrors.push(error), setDockOpen() {}, setDockActiveTab() {} });
  const session = controller.sessionForDocument(document);
  const content = session?.content ?? readBrowserDevVirtualTextDocument(document.path);
  const text = { id: document.id, path: document.path, title: document.title, extension: document.extension, language: "text", byteCount: content.length, content, truncated: false };
  return (
    <SourceEditingProvider value={controller}>
      {tab === "text" ? (
        <TextFileViewer document={text} sourceEditing={{ sessionId: session?.sessionId, editable: Boolean(session?.editable), content, status: "", dirty: Boolean(session?.dirty), saving: false,
          onChange: (next) => controller.updateDraft(document, next) }} />
      ) : <GeometryPanel document={document} actions={actions} />}
    </SourceEditingProvider>
  );
}
const current = (document) => controller?.sessionForDocument(document)?.content ?? readBrowserDevVirtualTextDocument(document.path);
const shown = (document) => sent.filter((action) => action.id === document.id && action.type === "update_geometry").at(-1)?.text;
const bond = (text) => {
  const [o, h] = text.trim().split("\n").slice(2, 4).map((line) => line.trim().split(/\s+/u).slice(1).map(Number));
  return Math.hypot(...o.map((value, axis) => value - h[axis]));
};
const settle = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  // The source I/O fixture completes the real staged preview handshake after typing.
  for (const document of useMoleculeStore.getState().documents) {
    const session = controller?.sessionForDocument(document), preview = session?.sourcePreview;
    const identity = preview?.slots[preview.activeSlot === "primary" ? "secondary" : "primary"]?.identity;
    if (!identity || session.previewState !== "staging") continue;
    const frame = { contentWindow: {} };
    controller.stagingLoaded(document, identity, frame);
    const event = new window.Event("message");
    Object.defineProperty(event, "source", { value: frame.contentWindow });
    Object.defineProperty(event, "data", { value: { source: "burette-viewer", body: { type: "ready", renderer: "molstar", molstarStructureCount: 1 } } });
    window.dispatchEvent(event);
  }
});

async function mount(document) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  // The same panel instance, shown for another document, or another dock tab.
  const render = async (next, tab = "geometry") => {
    await act(async () => root.render(<Fixture document={next} tab={tab} />));
    for (let attempt = 0; attempt < 50 && !host.querySelector('[aria-label="Z-matrix rows"], .geometry-table, .cm-editor'); attempt++) await settle();
  };
  await render(document);
  return { host, render, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
// A key press as a user makes it: down, then up, which ends the field's interaction.
const press = async (host, label, key) => {
  await act(async () => host.querySelector(`[role="spinbutton"][aria-label="${label}"]`).dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key })));
  await act(async () => window.dispatchEvent(new window.KeyboardEvent("keyup", { key })));
  await settle();
};
const disabled = (host, label) => host.querySelector(`[aria-label="${label}"]`).disabled;
async function openWater() {
  await openScientificFiles(actions, [new File([zmat], "water.zmat")]);
  return useMoleculeStore.getState().documents.at(-1);
}
const xyz = "3\nwater\nO 0 0 0\nH 0.9572 0 0\nH -0.24 0.927 0\n";
const openXyz = async () => (await actions.openStructureRecords([{ path: "water.xyz", text: xyz, inputExtension: "xyz" }]))[0];
// Acknowledgements the scene holds back, per document, until a test releases them.
const held = [];
const holdAcks = () => { viewer = async (document, action) => { if (action.type === "update_geometry") await new Promise((resolve) => held.push({ id: document.id, resolve })); }; };
const release = async (document) => {
  await act(async () => held.filter((ack) => ack.id === document.id).forEach((ack) => { held.splice(held.indexOf(ack), 1); ack.resolve(); }));
  await settle();
};

test("a source that cannot open for editing keeps the edit out of the scene and the history; once it opens, the edit applies", async () => {
  const document = await openWater();
  const imported = current(document);
  const view = await mount(document);
  try {
    sourceReadable = false;
    await press(view.host, "Variable R", "ArrowUp");
    assert.match(sourceErrors.at(-1)?.message ?? "", /Source file unavailable/u, "the controller reports the opening failure");
    assert.equal(controller.sessionForDocument(document), null);
    assert.equal(view.host.querySelector('[role="alert"]')?.textContent, "The source could not be opened for editing.");
    assert.deepEqual([current(document), shown(document), disabled(view.host, "Undo"), disabled(view.host, "Redo")], [imported, imported, true, true],
      "source, scene and history stay at the import");
    assert.equal(view.host.querySelector('[role="spinbutton"][aria-label="Variable R"]').getAttribute("aria-valuenow"), "0.9572", "the field springs back");

    sourceReadable = true;
    await press(view.host, "Variable R", "ArrowUp");
    const edited = current(document);
    assert.notEqual(edited, imported);
    assert.ok(Math.abs(bond(edited) - 0.9672) < 1e-4);
    assert.deepEqual([controller.sessionForDocument(document).content, shown(document), disabled(view.host, "Undo")], [edited, edited, false]);
  } finally { sourceReadable = true; await view.unmount(); }
});

test("a session closed while the scene takes the edit leaves no revision and shows the source again", async () => {
  const document = await openWater();
  const imported = current(document);
  const view = await mount(document);
  try {
    // Open the session first, so only the close races the acknowledgement.
    await act(async () => controller.beginEditing(document, "geometry"));
    await settle();
    const acks = [];
    viewer = async (_document, action) => { if (action.type === "update_geometry") await new Promise((resolve) => acks.push(resolve)); };
    await press(view.host, "Variable R", "ArrowUp");
    assert.equal(acks.length > 0, true, "the edit waits for the scene");
    assert.equal(await act(async () => controller.closeDocuments([document.id])), true);
    viewer = async () => {};
    await act(async () => acks.splice(0).forEach((resolve) => resolve()));
    await settle();
    assert.equal(controller.sessionForDocument(document), null);
    assert.deepEqual([current(document), shown(document), disabled(view.host, "Redo")], [imported, imported, true]);
    assert.equal(view.host.querySelector('[aria-label="Undo"]').disabled, true, "no revision was recorded");
  } finally { viewer = async () => {}; await view.unmount(); }
});

test("an edit still settling for one Z-matrix leaves the next document's panel free, and never clears that document's own edit", async () => {
  const first = await openWater();
  const second = await openWater();
  const imported = current(first);
  const view = await mount(first);
  try {
    await act(async () => { await controller.beginEditing(first, "geometry"); await controller.beginEditing(second, "geometry"); });
    await settle();
    holdAcks();
    await press(view.host, "Variable R", "ArrowUp");
    assert.equal(disabled(view.host, "Variable R"), true, "the first document is applying");

    // The same Geometry panel now shows the second document; then the first edit settles.
    await view.render(second);
    assert.equal(disabled(view.host, "Variable R"), false);
    await release(first);
    assert.deepEqual([disabled(view.host, "Variable R"), disabled(view.host, "Undo")], [false, true], "the second document is free and has no history");
    assert.equal(current(first), imported, "the first edit is not written after its panel moved on");

    // The second document's own edit stays busy while the first one's acknowledgement is late.
    await view.render(first);
    await press(view.host, "Variable R", "ArrowUp");
    await view.render(second);
    await press(view.host, "Variable R", "ArrowUp");
    assert.equal(disabled(view.host, "Variable R"), true, "the second document is applying");
    await release(first);
    assert.equal(disabled(view.host, "Variable R"), true, "the first edit settling does not clear the second one");
    viewer = async () => {};
    await release(second);
    assert.deepEqual([disabled(view.host, "Variable R"), disabled(view.host, "Undo")], [false, false]);
    assert.ok(Math.abs(bond(current(second)) - 0.9672) < 1e-4);
    assert.equal(controller.sessionForDocument(second).content, current(second));
    assert.equal(current(first), imported);
  } finally { viewer = async () => {}; held.splice(0).forEach((ack) => ack.resolve()); await view.unmount(); }
});

test("Cartesian Geometry: a source that cannot open for editing keeps the edit out of the scene and its Undo", async () => {
  const document = await openXyz();
  const view = await mount(document);
  try {
    sourceReadable = false;
    await press(view.host, "Bond of H2, Å", "ArrowUp");
    assert.match(sourceErrors.at(-1)?.message ?? "", /Source file unavailable/u);
    assert.equal(controller.sessionForDocument(document), null);
    assert.equal(view.host.querySelector('[role="alert"]')?.textContent, "The source could not be opened for editing.");
    assert.equal(current(document), xyz);
    assert.ok(shown(document) === undefined || Math.abs(bond(shown(document)) - 0.9572) < 1e-6, "the scene keeps the source geometry");
    assert.equal(disabled(view.host, "Undo"), true);
    assert.equal(view.host.querySelector('[role="spinbutton"][aria-label="Bond of H2, Å"]').getAttribute("aria-valuenow"), "0.9572");

    sourceReadable = true;
    await press(view.host, "Bond of H2, Å", "ArrowUp");
    assert.ok(Math.abs(bond(controller.sessionForDocument(document).content) - 0.9672) < 1e-4);
    assert.deepEqual([shown(document), disabled(view.host, "Undo")], [controller.sessionForDocument(document).content, false]);
  } finally { sourceReadable = true; await view.unmount(); }
});

test("Cartesian Geometry: a session closed while the scene takes the edit leaves no Undo and shows the source again", async () => {
  const document = await openXyz();
  const view = await mount(document);
  try {
    await act(async () => controller.beginEditing(document, "geometry"));
    await settle();
    holdAcks();
    await press(view.host, "Bond of H2, Å", "ArrowUp");
    assert.equal(held.length > 0, true, "the edit waits for the scene");
    assert.equal(await act(async () => controller.closeDocuments([document.id])), true);
    viewer = async () => {};
    await release(document);
    assert.equal(controller.sessionForDocument(document), null);
    assert.equal(view.host.querySelector('[role="alert"]')?.textContent, "The source did not take this edit.");
    assert.ok(Math.abs(bond(shown(document)) - 0.9572) < 1e-6, "the scene shows the source again");
    assert.deepEqual([current(document), disabled(view.host, "Undo")], [xyz, true]);
  } finally { viewer = async () => {}; held.splice(0).forEach((ack) => ack.resolve()); await view.unmount(); }
});

// The platform's command key, as CodeMirror reads it: Meta on macOS, Control elsewhere.
const mac = /Mac/u.test(navigator.platform);
const textKey = async (host, key, shiftKey = false) => {
  const init = { bubbles: true, cancelable: true, key: shiftKey ? key.toUpperCase() : key, shiftKey, metaKey: mac, ctrlKey: !mac };
  await act(async () => host.querySelector(".cm-content").dispatchEvent(new window.KeyboardEvent("keydown", init)));
  await settle();
};
const undoText = (host) => textKey(host, "z");
const redoText = (host) => (mac ? textKey(host, "z", true) : textKey(host, "y"));
const typeText = async (host, from, to, insert) => {
  const editor = EditorView.findFromDOM(host.querySelector(".cm-editor"));
  await act(async () => editor.dispatch({ changes: { from, to, insert }, userEvent: "input.type" }));
  await settle();
};

test("source Text: the command key undoes and redoes typing, across a dock tab switch, never over a newer Geometry edit", async () => {
  const document = await openWater();
  const imported = current(document);
  const view = await mount(document);
  // The Z-matrix definitions belong to the exact imported text; its comment line is part of it.
  const comment = imported.indexOf("\n") + 1;
  const zmatrixRows = () => Boolean(view.host.querySelector('[aria-label="Z-matrix rows"]'));
  try {
    await act(async () => controller.beginEditing(document));
    await view.render(document, "text");
    await typeText(view.host, imported.length, imported.length, " ");
    assert.equal(current(document), `${imported} `);
    await undoText(view.host);
    assert.equal(current(document), imported, "Undo restores the exact source");
    await redoText(view.host);
    assert.equal(current(document), `${imported} `);
    await undoText(view.host);

    // The typed change is undone after Geometry was shown in between, and the definitions come back.
    await typeText(view.host, comment, comment, "x");
    await view.render(document);
    assert.equal(zmatrixRows(), false, "the typed source is no longer the import");
    await view.render(document, "text");
    await undoText(view.host);
    assert.equal(current(document), imported);
    await view.render(document);
    assert.equal(zmatrixRows(), true, "Geometry reads the restored Z-matrix");

    // A Geometry edit made after typing is newer than the Text history, so Undo there leaves it.
    await view.render(document, "text");
    await typeText(view.host, comment, comment, "x");
    const typed = current(document);
    await view.render(document);
    await press(view.host, "Bond of H2, Å", "ArrowUp");
    const geometryEdit = current(document);
    assert.notEqual(geometryEdit, typed);
    await view.render(document, "text");
    await undoText(view.host);
    assert.equal(current(document), geometryEdit);

    // So is a change that reaches the open editor from elsewhere.
    await typeText(view.host, 0, 0, "\n");
    const elsewhere = `${geometryEdit}\n`;
    await act(async () => controller.updateDraft(document, elsewhere));
    await settle();
    await undoText(view.host);
    assert.equal(current(document), elsewhere);
  } finally { await view.unmount(); }
});
