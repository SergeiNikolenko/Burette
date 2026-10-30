import assert from "node:assert/strict";
import { afterAll } from "bun:test";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { StructureDragRecord } from "../apps/desktop/src/lib/structure-drag";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import { Window, type HTMLElement as BrowserElement } from "happy-dom";
import React, { act } from "react";

const window = new Window({ url: "http://localhost/" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window, self: window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement, DocumentFragment: window.DocumentFragment, MutationObserver: window.MutationObserver,
  CustomEvent: window.CustomEvent, Event: window.Event, KeyboardEvent: window.KeyboardEvent, MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent, navigator: window.navigator, localStorage: window.localStorage,
  requestAnimationFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0), cancelAnimationFrame: (id: ReturnType<typeof window.setTimeout>) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterAll(async () => { await window.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });

const { test } = await import("bun:test");
const { createRoot } = await import("react-dom/client");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { writeBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { openScientificDocument, openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { releaseClosedImports, useImportedOriginal, useScientificDocument } = await import("../apps/desktop/src/lib/workbench/source");
const { BrowserStructureDownload } = await import("../apps/desktop/src/components/browser-structure-download");

const molden = (energy: number) => `[Molden Format]\r\n[Atoms] AU\r\nH 1 1 0 0 0\r\n[GTO]\r\n1 0\r\ns 1 1.00\r\n1.0D+00 1.0\r\n[MO]\r\nEne= ${energy}\r\nSpin= Alpha\r\nOccup= 1\r\n1 1.0\r\n`;
let opened = 0;
// What the browser open does: a virtual text document named by the record, added to the
// open documents, and the documents this call opened as its result.
function addDocument(record: StructureDragRecord): ViewerDocument {
  const id = `doc-${++opened}`;
  const path = `burette-ketcher://${id}/${record.path}`;
  writeBrowserDevVirtualTextDocument(path, record.text);
  const document: ViewerDocument = { id, title: record.path, path, runtimePath: path, byteCount: new TextEncoder().encode(record.text).length, extension: record.inputExtension, renderer: "molstar" };
  useMoleculeStore.setState((state) => ({ documents: [...state.documents, document] }));
  return document;
}
const actions = { openStructureRecords: async (records: StructureDragRecord[]) => records.map(addDocument) };
const bytes = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];
const latest = () => useMoleculeStore.getState().documents.at(-1)!;

type Seen = { science: ReturnType<typeof useScientificDocument>["document"]; text: ReturnType<typeof useScientificDocument>["text"]; original: ReturnType<typeof useImportedOriginal> };
function Probe({ document, report }: { document: ViewerDocument; report: (seen: Seen) => void }) {
  const { document: science, text } = useScientificDocument(document);
  report({ science, text, original: useImportedOriginal(document.id) });
  return null;
}
async function read(document: ViewerDocument) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  let seen: Seen | null = null;
  const peek = (): Seen | null => seen;
  const render = () => act(async () => root.render(<Probe document={document} report={(value) => { seen = value; }} />));
  await render();
  for (let attempt = 0; attempt < 50 && !peek()?.science; attempt++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  return { seen: () => { assert.ok(seen); return seen; }, rerender: (next: ViewerDocument) => { document = next; return render(); }, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test("an imported quantum output keeps its exact file through edits until its document closes", async () => {
  await openScientificFiles(actions, [new File([molden(-0.5)], "h.molden"), new File([molden(-0.7)], "h.molden")]);
  const [first, second] = useMoleculeStore.getState().documents.slice(-2);
  assert.deepEqual([first.title, second.title], ["h.xyz", "h.xyz"]);

  // Same name, same geometry: two distinct imports, each with its own data and file.
  const a = await read(first);
  const b = await read(second);
  assert.deepEqual([a.seen().science!.orbitals[0].energyHartree, b.seen().science!.orbitals[0].energyHartree], [-0.5, -0.7]);
  assert.deepEqual([a.seen().original!.name, await a.seen().original!.file.text(), b.seen().original!.name, await b.seen().original!.file.text()],
    ["h.molden", molden(-0.5), "h.molden", molden(-0.7)]);

  // The download menu saves the uploaded file exactly, line endings included.
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const blobs: Blob[] = [];
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = (blob) => { if (!(blob instanceof Blob)) throw new Error("Expected Blob download"); blobs.push(blob); return "blob:test"; };
  try {
    await act(async () => root.render(<BrowserStructureDownload file={{ path: second.path, label: second.title }} document={second} />));
    const trigger = host.querySelector<BrowserElement>('[aria-label="Download file"]')!;
    await act(async () => { trigger.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    const items = [...window.document.body.querySelectorAll<BrowserElement>('[role="menuitem"]')];
    assert.deepEqual(items.map((item) => item.textContent), ["Geometry · h.xyz", "Original · h.molden"]);
    await act(async () => { items[1].click(); });
    assert.equal(await blobs[0].text(), molden(-0.7));
  } finally {
    URL.createObjectURL = createObjectURL;
    await act(async () => root.unmount());
    host.remove();
  }

  // Editing the geometry drops the parsed orbitals but keeps the file retrievable.
  writeBrowserDevVirtualTextDocument(first.path, "1\nedited\nH 0.1 0 0\n");
  await a.rerender({ ...first, runtimePath: "edited" });
  for (let attempt = 0; attempt < 50 && a.seen().science?.format !== "xyz"; attempt++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(a.seen().science!.format, "xyz");
  assert.deepEqual(a.seen().science!.orbitals, []);
  assert.equal(await a.seen().original?.file.text(), molden(-0.5));

  // Closing the first document releases only its import.
  await act(async () => releaseClosedImports(new Set([second.id])));
  assert.equal(a.seen().original, null);
  assert.equal(b.seen().original?.name, "h.molden");
  await a.unmount();
  await b.unmount();
});

test("an open that creates no document leaves no import behind, even while other documents open", async () => {
  const records: StructureDragRecord[] = [];
  await openScientificFiles({ openStructureRecords: async (items: StructureDragRecord[]) => {
    records.push(...items);
    // Unrelated documents open meanwhile; none of them is this import's.
    addDocument({ path: "one.xyz", inputExtension: "xyz", text: "1\none\nHe 0 0 0\n" });
    addDocument({ path: "two.xyz", inputExtension: "xyz", text: "1\ntwo\nHe 0 0 0\n" });
    return [];
  } }, [new File([molden(-0.5)], "lost.molden")]);
  assert.equal(records.length, 1);
  // The same generated text opened later is an ordinary XYZ: the failed import's data and file are gone.
  await actions.openStructureRecords(records);
  const view = await read(latest());
  assert.equal(view.seen().science!.format, "xyz");
  assert.deepEqual(view.seen().science!.orbitals, []);
  assert.equal(view.seen().original, null);
  await view.unmount();
});

test("overlapping same-name imports each keep their own original", async () => {
  const science: ScientificDocument = { format: "fchk", atoms: [{ element: "He", x: 0, y: 0, z: 0 }], frames: [{ atoms: [{ element: "He", x: 0, y: 0, z: 0 }] }], modes: [], orbitals: [] };
  let finishA!: () => void;
  const gate = new Promise<void>((resolve) => { finishA = resolve; });
  let documentA!: ViewerDocument;
  let documentB!: ViewerDocument;
  // A starts first but its document appears only after B has fully opened.
  const a = openScientificDocument({ openStructureRecords: async (records: StructureDragRecord[]) => { await gate; documentA = addDocument(records[0]); return [documentA]; } },
    "same.fchk", science, "final", { name: "same.fchk", file: new Blob(["ORIGINAL A"]) });
  await openScientificDocument({ openStructureRecords: async (records: StructureDragRecord[]) => { documentB = addDocument(records[0]); return [documentB]; } },
    "same.fchk", science, "final", { name: "same.fchk", file: new Blob(["ORIGINAL B"]) });
  finishA();
  await a;
  const viewA = await read(documentA);
  const viewB = await read(documentB);
  assert.deepEqual([await viewA.seen().original!.file.text(), await viewB.seen().original!.file.text()], ["ORIGINAL A", "ORIGINAL B"]);
  await viewA.unmount();
  await viewB.unmount();
});

test("the original keeps the uploaded bytes, a UTF-8 byte order mark included", async () => {
  const upload = new File([new Uint8Array([0xef, 0xbb, 0xbf]), molden(-0.5)], "bom.molden");
  const twin = new File([molden(-0.5)], "bom.molden");
  await openScientificFiles(actions, [upload, twin]);
  const [first, second] = useMoleculeStore.getState().documents.slice(-2);
  const viewFirst = await read(first);
  const viewSecond = await read(second);
  // It parsed despite the mark, and each same-name original is its own file.
  assert.equal(viewFirst.seen().science!.orbitals[0].energyHartree, -0.5);
  assert.deepEqual(await bytes(viewFirst.seen().original!.file), await bytes(upload));
  assert.deepEqual((await bytes(viewFirst.seen().original!.file)).slice(0, 3), [0xef, 0xbb, 0xbf]);
  assert.deepEqual(await bytes(viewSecond.seen().original!.file), await bytes(twin));
  await viewFirst.unmount();
  await viewSecond.unmount();
});

test("a document closed before its open returns keeps no import", async () => {
  let closed!: ViewerDocument;
  await openScientificFiles({ openStructureRecords: async (records: StructureDragRecord[]) => {
    closed = addDocument(records[0]);
    // The user closes it and the dock's close cleanup runs while the open is still settling.
    useMoleculeStore.setState((state) => ({ documents: state.documents.filter((item) => item.id !== closed.id) }));
    releaseClosedImports(new Set(useMoleculeStore.getState().documents.map((item) => item.id)));
    return [closed];
  } }, [new File([molden(-0.5)], "closed.molden")]);
  const view = await read(closed);
  assert.equal(view.seen().original, null);
  // Its exact text read later is plain XYZ: the parsed data went with the document.
  assert.equal(view.seen().science!.format, "xyz");
  assert.deepEqual(view.seen().science!.orbitals, []);
  await view.unmount();
});
