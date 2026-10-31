import { afterAll, afterEach, expect, test } from "bun:test";
import { plugin as installPlugin } from "bun";
import React, { act } from "react";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { molstarMolV3000Plugin } from "../scripts/molstar-mol-v3000.mjs";
import { molstarV3000ChargesPlugin } from "../scripts/molstar-v3000-charges.mjs";
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
Object.assign(browser, { setImmediate, clearImmediate });
for (const [name, value] of Object.entries({ window: browser, self: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, HTMLInputElement: browser.HTMLInputElement,
  HTMLSelectElement: browser.HTMLSelectElement, HTMLButtonElement: browser.HTMLButtonElement, HTMLFormElement: browser.HTMLFormElement,
  DocumentFragment: browser.DocumentFragment, NodeFilter: browser.NodeFilter, SVGElement: browser.SVGElement,
  CustomEvent: browser.CustomEvent, Event: browser.Event, FocusEvent: browser.FocusEvent, KeyboardEvent: browser.KeyboardEvent,
  MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent, MutationObserver: browser.MutationObserver, CSS: browser.CSS,
  indexedDB: new IDBFactory(), localStorage: browser.localStorage, getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 0), cancelAnimationFrame: clearTimeout,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });
installPlugin(molstarMolV3000Plugin); installPlugin(molstarV3000ChargesPlugin);
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
const { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
const { createRoot } = await import("react-dom/client");
const { openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { isScientificFile } = await import("../apps/desktop/src/lib/workbench/scientific-files");
const { useSceneSpectra } = await import("../apps/desktop/src/lib/workbench/scene-spectra");
const { ScientificSpectraDockContent } = await import("../apps/desktop/src/components/workbench/scientific-spectra-dock-content");
const { openBrowserDevTextDocument, readBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { scientificStateFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { prepareSceneScienceExport } = await import("../apps/desktop/src/lib/science-session/export");
const { restoreScienceSession } = await import("../apps/desktop/src/lib/science-session/restore");
const { releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const { decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
const { sha256Hex } = await import("../apps/desktop/src/lib/source-editing/source-identity");
const runtime: Record<string, any> = {};
vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/scene-file-actions.js", import.meta.url), "utf8"), { window: runtime, crypto, TextEncoder, TextDecoder, Set, WeakMap, File, Uint8Array, Float64Array });
const scienceRuntime = runtime.BuretteSceneFiles.science;
const before = useMoleculeStore.getState().documents, opened: ViewerDocument[] = [];
afterEach(() => { for (const doc of opened.splice(0)) deleteBrowserDevVirtualTextDocument(doc.path); useMoleculeStore.setState({ documents: before }); releaseClosedImports(new Set(before.map(doc => doc.id))); releaseClosedScienceSessions(new Set()); });
const actions = { openStructureRecords: async (records: Array<{ path: string; inputExtension: string; text: string }>) => {
  const docs = await Promise.all(records.map(record => openBrowserDevTextDocument(record.path, record.inputExtension, record.text, { ...defaultPreferences, rendererMode: "molstar" })));
  opened.push(...docs); useMoleculeStore.setState(state => ({ documents: [...state.documents, ...docs] })); return docs;
} };
function source(active = 0) {
  const input = JSON.parse(readFileSync(new URL("./fixtures/quantum/spectra-native-nmr.cjson", import.meta.url), "utf8"));
  // Authored multi-set variant of the retained producer graph/NMR extract.
  const first = input.atoms.coords["3d"];
  input.atoms.coords["3dSets"] = Array.from({ length: 7 }, (_, set) => first.map((n: number, i: number) => n + (i % 3 === 0 ? set : 0)));
  input.atoms.coords["3dSetsActive"] = active;
  return input;
}
async function imported(active = 0, compressed = false) {
  const text = "\uFEFF" + JSON.stringify(source(active), null, 2).replaceAll("\n", "\r\n");
  const file = new File([compressed ? gzipSync(text) : text], compressed ? "nmr.cjson.gz" : "nmr.cjson");
  expect(await isScientificFile(file)).toBe(true); await openScientificFiles(actions, [file]);
  const document = opened.at(-1)!; if (!document) throw new Error("No imported MOL document");
  const mol = readBrowserDevVirtualTextDocument(document.path)!;
  return { file, document, mol, state: scientificStateFor(document.id, mol) };
}

test("ordinary compressed CJSON import materializes explicit MOL and keeps distinct exact source owners", async () => {
  const one = await imported(2, true), two = await imported(2, true);
  expect([one.document.extension, two.document.extension]).toEqual(["mol", "mol"]);
  expect(one.mol).not.toBe(two.mol); expect(one.state.revision).not.toBe(two.state.revision);
  expect(one.state.revision!.document.graph).toEqual({ molfile: one.mol, activeFrameIndex: 2 });
  expect(one.state.revision!.document.frames).toHaveLength(7);
  expect(new Uint8Array(await one.state.original!.file.arrayBuffer())).toEqual(new Uint8Array(await one.file.arrayBuffer()));
  expect(one.mol).toContain("M  V30 1 2 1 2");
  expect(scientificStateFor(one.document.id, one.mol + "\n").revision).toBeNull();
});

test("normal MOL NMR panel uses explicit active source set, including first of seven, and closes cleanly", async () => {
  for (const active of [0, 2]) {
    const current = await imported(active), host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    function Probe({ current }: { current: ViewerDocument | null }) {
      const spectra = useSceneSpectra(current);
      return <><output>{spectra ? `${spectra.index}/${spectra.science.frames.length}` : "none"}</output><ScientificSpectraDockContent document={current} actions={{ saveKetcherExportFile: async () => ({ status: "cancelled", path: null }) }} /></>;
    }
    try {
      await act(async () => root.render(<Probe current={current.document} />));
      for (let i = 0; i < 100 && !host.querySelector("table tbody tr"); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(host.querySelector("output")!.textContent).toBe(`${active}/7`);
      expect([...host.querySelectorAll('table[aria-label="NMR source values"] tbody th')].map(node => node.textContent)).toEqual(["H3", "H4"]);
      await act(async () => root.render(<Probe current={null} />));
      expect(host.querySelector("output")!.textContent).toBe("none"); expect(host.querySelector("table")).toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  }
});

test("normal CJSON host export and actual native MOLX reopen/restore/reexport preserve graph, source sets and Original", async () => {
  const importedSource = await imported(2), native = new PluginContext(DefaultPluginSpec()), reopened = new PluginContext(DefaultPluginSpec());
  try {
    await native.init(); await reopened.init();
    const raw = await native.builders.data.rawData({ data: importedSource.mol });
    const trajectory = await native.builders.structure.parseTrajectory(raw, "mol");
    await native.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
    const request = (plugin: typeof native) => async (_id: string, action: Record<string, unknown>) => {
      if (action.type === "workspace_scene_state") return { ready: true };
      if (action.type === "scene_science_binding") return scienceRuntime.graphBinding({ plugin }, action.sourceExtension);
      if (action.type === "scene_science_restore_ack") return { adopted: await scienceRuntime.adoptValidated({ plugin }, action) };
      throw new Error(`Unexpected action ${action.type}`);
    };
    const options = (plugin: typeof native) => ({ sourceEditing: null, sceneFileCount: 1, isOpen: () => true, request: request(plugin) });
    const prepared = await prepareSceneScienceExport(importedSource.document, options(native));
    if (prepared?.kind !== "science") throw new Error("CJSON graph did not prepare scientific export");
    const blob: Blob = await scienceRuntime.serialize({ plugin: native }, prepared.action.science, { type: "molx", params: { camera: false, image: false } }); await prepared.confirm();
    const bytes = new Uint8Array(await blob.arrayBuffer()), decoded = (await decodeScienceSession(bytes))!;
    expect(decoded.science).toEqual(importedSource.state.revision!.document);
    const token = scienceRuntime.beginImport(reopened);
    await reopened.managers.snapshot.open(new File([bytes as BlobPart], "nmr.molx")); expect(scienceRuntime.completeImport(reopened, token)).toBe(true);
    const restored: ViewerDocument = { ...importedSource.document, id: "restored-cjson", extension: "molx", path: "/nmr.molx", byteCount: bytes.length };
    expect(await restoreScienceSession(restored, { readBytes: async () => bytes, request: request(reopened), isOpen: () => true })).toBe("restored");
    const again = await prepareSceneScienceExport(restored, options(reopened)); if (again?.kind !== "science") throw new Error("No restored scientific export");
    const resaved: Blob = await scienceRuntime.serialize({ plugin: reopened }, again.action.science, { type: "molx", params: { camera: false, image: false } }); await again.confirm();
    const after = (await decodeScienceSession(new Uint8Array(await resaved.arrayBuffer())))!;
    expect(after.science).toEqual(decoded.science); expect(after.source).toEqual(decoded.source); expect(after.atomIds).toEqual(decoded.atomIds);
    expect(await sha256Hex(new Uint8Array(await after.original!.file.arrayBuffer()))).toBe(await sha256Hex(new Uint8Array(await importedSource.file.arrayBuffer())));
  } finally { native.dispose(); reopened.dispose(); }
});

test("ordinary unsupported CJSON never falls back to guessed geometry", async () => {
  for (const mutate of [(value: any) => { value.bonds.order[0] = 4; }, (value: any) => { value.unitCell = { a: 10 }; }]) {
    const value = source(); mutate(value); await openScientificFiles(actions, [new File([JSON.stringify(value)], "invalid.cjson")]);
    expect(opened).toHaveLength(0);
  }
});


test("durable ordinary browser open reparses CJSON as MOL with fresh ownership and exact stored Original", async () => {
  const { saveBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
  const { openStoredScientificFile } = await import("../apps/desktop/src/lib/workbench/browser-import");
  const file = new File([JSON.stringify(source(2))], "durable.cjson"), path = "/OpenedFiles/durable.cjson";
  await saveBrowserImport({ path, name: file.name, kind: "text", scientific: true, file });
  const first = await openStoredScientificFile(path, defaultPreferences, document => {
    opened.push(document); useMoleculeStore.setState(state => ({ documents: [...state.documents, document] }));
  }, () => true);
  expect(first).toHaveLength(1); expect(first![0].extension).toBe("mol"); expect(first![0].path).toBe(path);
  const text = readBrowserDevVirtualTextDocument(path)!;
  const state = scientificStateFor(first![0].id, text);
  expect(state.revision!.document.graph).toEqual({ molfile: text, activeFrameIndex: 2 });
  expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
  expect(await openStoredScientificFile(path, defaultPreferences, () => { throw new Error("Cancelled source published"); }, () => false)).toEqual([]);
});
