import { readCoordinateInterchange, writeCoordinateInterchangeXyzSource } from "../scripts/coordinate-interchange.mjs";
import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, Event: browser.Event,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  localStorage: browser.localStorage, indexedDB: new IDBFactory(), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useAppOpenActions } = await import("../apps/desktop/src/hooks/use-app-open-actions");
const { useOpenDrop } = await import("../apps/desktop/src/hooks/use-open-drop");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { detectContentSpectrumPaths } = await import("../apps/desktop/src/lib/content-spectrum-detection");
const { scientificStateFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { readBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const molden = readFileSync(new URL("./fixtures/quantum/dispatcher/hydrogen.molden", import.meta.url), "utf8");
async function fixture() {
  const original = useMoleculeStore.getState().documents, ordinary: string[] = [], statuses: string[] = [];
  let chooser!: ReturnType<typeof useAppOpenActions>;
  const store = useMoleculeStore.getState(), noop = () => {};
  const options: Parameters<typeof useAppFileOpen>[0] = { ...store, preferences: { ...defaultPreferences, rendererMode: "molstar" },
    addProjectRoot: noop, detectContentSpectrumPaths, expandStructureBundles: async paths => paths,
    openDockTab: noop, openDocumentTab: path => { ordinary.push(path); }, openFepNetworkTab: noop,
    pushErrorStatus: error => { throw error; }, pushStatus: message => { statuses.push(message); }, rememberRecentStructures: noop,
    setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop,
  };
  function Probe() {
    const open = useAppFileOpen(options);
    chooser = useAppOpenActions({ openPaths: open.openPaths, openStructureRecords: open.openStructureRecords,
      pushErrorStatus: options.pushErrorStatus, pushStatus: options.pushStatus, recentStructures: [] });
    const drop = useOpenDrop(paths => open.openPaths(paths), message => statuses.push(message), { openStructureRecords: open.openStructureRecords });
    return <main className="main-stage" onDrop={drop.handleBrowserDrop} />;
  }
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement); await act(async () => root.render(<Probe />));
  const created = () => useMoleculeStore.getState().documents.filter(document => !original.includes(document));
  return { chooser, host, ordinary, statuses, created, async close() {
    for (const document of created()) deleteBrowserDevVirtualTextDocument(document.path);
    useMoleculeStore.getState().setDocuments(original); releaseClosedImports(new Set(original.map(document => document.id)));
    await act(async () => root.unmount()); host.remove();
  } };
}
const sourceState = (document: ViewerDocument) => scientificStateFor(document.id, readBrowserDevVirtualTextDocument(document.path)!);

test("the actual Open chooser sends scientific and ordinary selections through their respective owners", async () => {
  const source = new File(["\ufeff" + molden.replaceAll("\n", "\r\n")], "chooser.molden");
  const checkpoint = new File([readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url))], "chooser.fchk");
  const files = [source, new File(['{"setting":1}'], "ordinary.json"), checkpoint];
  let connected = false;
  const click = spyOn(browser.HTMLInputElement.prototype, "click").mockImplementation(function (this: InstanceType<typeof browser.HTMLInputElement>) {
    connected = this.isConnected; Object.defineProperty(this, "files", { value: files }); this.dispatchEvent(new browser.Event("change"));
  });
  const view = await fixture();
  try {
    await act(async () => { await view.chooser.chooseFiles(); });
    expect(connected).toBe(true); expect(view.ordinary).toEqual(["/OpenedFiles/ordinary.json"]);
    expect(view.created().map(document => document.extension)).toEqual(["xyz", "xyz"]);
    expect(view.created().map(document => sourceState(document).revision?.document.format)).toEqual(["molden", "fchk"]);
    expect(new Uint8Array(await sourceState(view.created()[0]).original!.file.arrayBuffer())).toEqual(new Uint8Array(await source.arrayBuffer()));
  } finally { click.mockRestore(); await view.close(); }
});

test("a real browser drop retains the ordinary XYZ route while importing scientific data", async () => {
  const source = new File([molden], "drop.molden"), xyz = new File(["1\nordinary\nHe 0 0 0\n"], "ordinary.xyz");
  const transfer = new browser.DataTransfer(); Object.defineProperty(transfer, "files", { value: [source, xyz] });
  Object.defineProperty(transfer, "types", { value: ["Files"] }); const view = await fixture();
  try {
    const event = new browser.DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    await act(async () => { view.host.querySelector("main")!.dispatchEvent(event); });
    for (let count = 0; count < 100 && view.created().length < 2; count++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(view.created()).toHaveLength(2);
    const scientific = view.created().find(document => document.path.endsWith("drop.molden"))!;
    expect(sourceState(scientific).revision?.document.format).toBe("molden");
    expect(await sourceState(scientific).original!.file.text()).toBe(molden);
    expect(view.created().some(document => document.title === "ordinary.xyz")).toBe(true);
  } finally { await view.close(); }
});


const markedPair = readCoordinateInterchange("H\nF 1 R\nR=1.25\nUNUSED=-17\n", "zmat");
markedPair.atoms = markedPair.atoms.map(atom => ({ ...atom, x: atom.x + 42, y: atom.y - 12, z: atom.z + 7 }));
const styledXyz = "\ufeff 2 \r\n  human α  \r\nH\t+4.2e1 -12.000 7\r\nF 42 -12 +8.25000";
const markedXyz = writeCoordinateInterchangeXyzSource(styledXyz, markedPair);
const withoutComment = (text: string) => text.replace(/^([^\r\n]*(?:\r\n|\r|\n))[^\r\n]*/u, "$1");
async function chooseFiles(files: File[], run: (view: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const click = spyOn(browser.HTMLInputElement.prototype, "click").mockImplementation(function (this: InstanceType<typeof browser.HTMLInputElement>) {
    Object.defineProperty(this, "files", { value: files }); this.dispatchEvent(new browser.Event("change"));
  });
  const view = await fixture();
  try { await act(async () => { await view.chooser.chooseFiles(); }); await run(view); }
  finally { click.mockRestore(); await view.close(); }
}

test("ordinary chooser admits marked XYZ with exact styled rows, full definition and uploaded Original", async () => {
  const file = new File([markedXyz], "marked.xyz");
  await chooseFiles([file], async view => {
    expect(view.created()).toHaveLength(1);
    const document = view.created()[0], text = readBrowserDevVirtualTextDocument(document.path)!;
    const state = sourceState(document), decoded = readCoordinateInterchange(text, "xyz");
    expect(withoutComment(text)).toBe(withoutComment(markedXyz));
    expect(decoded.atoms).toEqual(markedPair.atoms); expect(decoded.internalCoordinates).toEqual(markedPair.internalCoordinates);
    expect(decoded.comment).toStartWith("  human α   import-");
    expect(state.revision!.text).toBe(text); expect(state.revision!.document.internalCoordinates).toEqual(markedPair.internalCoordinates);
    expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
  });
});

test("reserved invalid XYZ metadata is refused before any ordinary structure is adopted", async () => {
  for (const text of [markedXyz.replace("V1=", "V2="), markedXyz.replace("V1=", "V1=="), markedXyz + markedXyz,
    markedXyz.replace("F 42 -12 +8.25000", "F 42 -12 8.3"), markedXyz + " ".repeat(1024 * 1024)]) {
    await chooseFiles([new File([text], "invalid.xyz")], async view => { expect(view.created()).toHaveLength(0); });
  }
  await chooseFiles([new File([markedXyz, new Uint8Array([255])], "invalid-utf8.xyz")], async view => { expect(view.created()).toHaveLength(0); });
});

test("unmarked wide, extended and multi-frame XYZ keep their ordinary chooser owner", async () => {
  const inputs = ["1\n" + "x".repeat(1024 * 1024 + 1) + "\nHe 0 0 0\n",
    '1\nProperties=species:S:1:pos:R:3:forces:R:3 force_unit=eV/angstrom\nH 1 2 3 .1 .2 .3\n',
    "1\nfirst\nH 0 0 0\n1\nsecond\nH 1 2 3\n"];
  await chooseFiles(inputs.map((text, i) => new File([text], `ordinary-${i}.xyz`)), async view => {
    expect(view.created()).toHaveLength(3);
    for (const [i, document] of view.created().entries()) {
      expect(readBrowserDevVirtualTextDocument(document.path)).toBe(inputs[i]);
      expect(sourceState(document).revision).toBeNull();
    }
  });
});
