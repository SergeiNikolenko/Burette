import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { IDBFactory } from "fake-indexeddb";

import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";

const factory = new IDBFactory();
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, Event: browser.Event,
  HTMLInputElement: browser.HTMLInputElement, HTMLSelectElement: browser.HTMLSelectElement, HTMLButtonElement: browser.HTMLButtonElement, HTMLFormElement: browser.HTMLFormElement, CSS: browser.CSS,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  DocumentFragment: browser.DocumentFragment, NodeFilter: browser.NodeFilter, SVGElement: browser.SVGElement,
  CustomEvent: browser.CustomEvent, FocusEvent: browser.FocusEvent, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent, requestAnimationFrame: (fn: () => void) => browser.setTimeout(fn, 0), cancelAnimationFrame: (id: ReturnType<typeof browser.setTimeout>) => browser.clearTimeout(id),
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  localStorage: browser.localStorage, indexedDB: factory, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const documents = await import("../apps/desktop/src/lib/browser-dev-documents");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { detectContentSpectrumPaths } = await import("../apps/desktop/src/lib/content-spectrum-detection");
const { registerDroppedBrowserFiles } = await import("../apps/desktop/src/lib/web-demo-workspace");
const { scientificStateFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");

function deferred<T = void>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
async function fixture() {
  const original = useMoleculeStore.getState().documents, ordinary: string[] = [], errors: unknown[] = [];
  let api!: ReturnType<typeof useAppFileOpen>;
  const store = useMoleculeStore.getState(), noop = () => {};
  const options: Parameters<typeof useAppFileOpen>[0] = { ...store, preferences: { ...defaultPreferences, rendererMode: "molstar" },
    addProjectRoot: noop, detectContentSpectrumPaths, expandStructureBundles: async paths => paths,
    openDockTab: noop, openDocumentTab: path => { ordinary.push(path); }, openFepNetworkTab: noop,
    pushErrorStatus: error => { errors.push(error); }, pushStatus: noop, rememberRecentStructures: noop,
    setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop,
  };
  function Probe() { api = useAppFileOpen(options); return null; }
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement); await act(async () => root.render(<Probe />));
  return { api, ordinary, errors, async close() {
    for (const document of useMoleculeStore.getState().documents) if (!original.includes(document)) documents.deleteBrowserDevVirtualTextDocument(document.path);
    useMoleculeStore.getState().setDocuments(original); releaseClosedImports(new Set(original.map(document => document.id)));
    await act(async () => root.unmount()); host.remove();
  } };
}

const bytes = readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url));
async function settle(check: () => boolean) {
  for (let n = 0; n < 100 && !check(); n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(check()).toBe(true);
}
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { readBrowserSourceCheckpoint } = await import("../apps/desktop/src/lib/browser-source-checkpoint");
const { readBrowserScientificAttachment } = await import("../apps/desktop/src/lib/workbench/browser-mcd-attachment");
const sidecar = () => new File(["10000 -2.25 .12\r\n12000 1.5 .25\r\n9000 -.5 .1\r\n"], "selected.mcd");

const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSceneSpectra } = await import("../apps/desktop/src/lib/workbench/scene-spectra");
const { useMcdCompanionTarget } = await import("../apps/desktop/src/lib/workbench/mcd-companion-tool");
const { McdCompanionPicker } = await import("../apps/desktop/src/components/workbench/mcd-companion-picker");
const { ScientificSpectraDockContent } = await import("../apps/desktop/src/components/workbench/scientific-spectra-dock-content");
const { SceneComputeMenu } = await import("../apps/desktop/src/components/editor-area/scene-compute-menu");
async function pickerFixture(name: string, mode: "picker" | "owner" | "route" = "picker", originalBytes = bytes) {
 const paths = await registerDroppedBrowserFiles([new File([originalBytes], name)], 16 * 1024 * 1024);
 const page = await fixture(); await act(async () => page.api.openPaths(paths.paths));
 const doc = useMoleculeStore.getState().documents.find(value => value.path === paths.paths[0])!, text = documents.readBrowserDevVirtualTextDocument(doc.path)!;
 const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
 let source!: ReturnType<typeof useSourceEditingController>;
 const attached: unknown[] = [], captures: unknown[] = [], errors: unknown[] = [], dockDocuments: (string | null)[] = [];
 let setVisible!: (visible: boolean) => void;
 function Content({ current }: { current: ViewerDocument | null }) {
  const scene = useSceneSpectra(current), target = useMcdCompanionTarget(current, scene);
  return <McdCompanionPicker target={target} onAttached={value => attached.push(value)} />;
 }
 function App() {
  const current = useMoleculeStore(state => state.documents.find(value => value.path === doc.path) ?? null);
  const [visible, show] = React.useState(mode !== "route"), [dockDocument, setDockDocument] = React.useState<string | null>(doc.id); setVisible = show;
  source = useSourceEditingController({ activeDocument: current, preferences: defaultPreferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} });
  const context = React.useMemo(() => ({ ...source, captureOperation: (document: ViewerDocument) => { captures.push(document); return source.captureOperation(document); } }), [source]);
  const actions = { saveKetcherExportFile: async () => ({ status: "saved" as const, path: null }),
    setDockDocument: (_area: string, id: string | null) => { dockDocuments.push(id); setDockDocument(id); }, openDockTab: (_area: string, kind: string) => show(kind === "scientific-spectra") };
  return <SourceEditingProvider value={context}>{mode === "picker" ? <Content current={current} /> : <>
    {mode === "route" && current ? <SceneComputeMenu document={current} actions={actions as unknown as import("../apps/desktop/src/components/types").ShellActions} /> : null}
    {visible && dockDocument === current?.id ? <ScientificSpectraDockContent document={current} actions={actions} /> : null}
  </>}</SourceEditingProvider>;
 }
 await act(async () => root.render(<App />));
 await settle(() => Boolean(host.querySelector("button")));
 const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
 const choose = async (file?: File) => {
  let capturedAtChooser = -1;
  const opening = (event: Event) => { if (event.target instanceof HTMLInputElement && event.target.type === "file") capturedAtChooser = captures.length; };
  document.addEventListener("click", opening, true);
  try { await act(async () => button("Add MCD…").click()); } finally { document.removeEventListener("click", opening, true); }
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(capturedAtChooser).toBe(1); expect(captures).toHaveLength(1); expect(input.accept).toBe(".mcd,.mcd.gz");
  await act(async () => { if (file) Object.defineProperty(input, "files", { configurable: true, value: [file] }); input.dispatchEvent(new browser.Event(file ? "change" : "cancel") as unknown as Event); });
 };
 const openSpectra = async () => {
  await act(async () => host.querySelector('[aria-label="Open molecular compute menu"]')!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event));
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === "Show spectra"); expect(Boolean(item)).toBe(true);
  await act(async () => item!.click()); await settle(() => Boolean(button("Add MCD…")));
 };
 const remount = async () => { await act(async () => setVisible(false)); await act(async () => setVisible(true)); };
 const reopen = async () => {
  await act(async () => { useMoleculeStore.getState().setDocuments([]); releaseClosedImports(new Set()); documents.deleteBrowserDevVirtualTextDocument(doc.path); });
  await act(async () => page.api.openPaths([doc.path])); await settle(() => Boolean(button("Add MCD…")));
 };
 return { doc, text, page, host, button, choose, attached, captures, errors, dockDocuments, openSpectra, remount, reopen, get source() { return source; }, close: async () => { await act(async () => root.unmount()); host.remove(); await page.close(); } };
}
export { act, expect, test, browser, pickerFixture, settle, sidecar, deferred, scientificStateFor, readBrowserScientificAttachment, readBrowserSourceCheckpoint, documents, useMoleculeStore };
