import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window(), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, Event: browser.Event,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  localStorage: browser.localStorage, indexedDB: new IDBFactory(), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { createRoot } = await import("react-dom/client");
const { saveBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
const { openStoredScientificFile } = await import("../apps/desktop/src/lib/workbench/browser-import");
const { useScientificDocument } = await import("../apps/desktop/src/lib/workbench/source");
const { importedOriginalFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { writeBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");

const fixtures = [
  ["source.molden", "dispatcher/hydrogen.molden", "molden"],
  ["source.fchk", "gaussian16-water-raman.fchk", "fchk"],
  ["source.json", "qcschema-water-gradient.json", "qcschema"],
  ["source.out", "dispatcher/two-step-orca.out", "orca"],
] as const;
for (const [name, fixture, format] of fixtures) test(`normalized ${name} reads later XYZ geometry while retaining Original`, async () => {
  const raw = readFileSync(new URL(`./fixtures/quantum/${fixture}`, import.meta.url), "utf8"), file = new Blob([raw]);
  const record = await saveBrowserImport({ path: `/OpenedFiles/${name}`, name, kind: "text", file });
  const before = useMoleculeStore.getState().documents;
  const opened = await openStoredScientificFile(record.path, { ...defaultPreferences, rendererMode: "molstar" }, document => useMoleculeStore.getState().addDocuments([document]), () => true);
  expect(opened).toHaveLength(1); const document = opened![0];
  let seen: ReturnType<typeof useScientificDocument> = { document: null, text: null };
  function Probe({ document }: { document: ViewerDocument }) { seen = useScientificDocument(document); return null; }
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host as unknown as HTMLElement);
  const render = async (document: ViewerDocument, text?: string) => {
    await act(async () => root.render(<Probe document={document} />));
    for (let attempt = 0; attempt < 100 && (!seen.document || (text !== undefined && seen.text !== text)); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  };
  try {
    await render(document); expect(seen.document?.format).toBe(format);
    const edited = "1\nnew geometry\nH 0.2 0 0\n"; writeBrowserDevVirtualTextDocument(record.path, edited);
    await render({ ...document, runtimePath: document.runtimePath + "#source-replaced" }, edited);
    expect([seen.document?.format, seen.document?.atoms]).toEqual(["xyz", [{ element: "H", x: .2, y: 0, z: 0 }]]);
    expect(new Uint8Array(await importedOriginalFor(document.id)!.file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
  } finally {
    await act(async () => root.unmount()); host.remove(); deleteBrowserDevVirtualTextDocument(record.path);
    useMoleculeStore.getState().setDocuments(before); releaseClosedImports(new Set(before.map(document => document.id)));
  }
});
