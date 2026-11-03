import { afterAll, mock, test, expect } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
export { React, act, test, expect };
export const compiler: string[] = [];
plugin({ name: "nucleic-ui-runtime", setup(build) {
  build.onLoad({ filter: /(?:nucleic-builder(?:-host)?|grid-molecule-3d)\.tsx$/ }, ({ path }) => {
    let source = readFileSync(path, "utf8");
    if (path.endsWith("grid-molecule-3d.tsx")) source = source.replace(/^import bootstrapUrl[^\n]+/m, 'const bootstrapUrl = "/preview-bootstrap.js";').replace(/const assets = import\.meta\.glob[^\n]+/, "const assets: Record<string,string> = {};");
    const result = transformSync(source, { filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] });
    compiler.push(path.split("/").pop()!); return { contents: result!.code!, loader: "tsx" };
  });
} });
export const browser = new Window({ url: "http://localhost/" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ window: browser, self: browser, document: browser.document, Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement, HTMLSelectElement: browser.HTMLSelectElement, HTMLFormElement: browser.HTMLFormElement, HTMLButtonElement: browser.HTMLButtonElement,
  HTMLIFrameElement: browser.HTMLIFrameElement, SVGElement: browser.SVGElement, DocumentFragment: browser.DocumentFragment, MutationObserver: browser.MutationObserver, NodeFilter: browser.NodeFilter,
  CustomEvent: browser.CustomEvent, Event: browser.Event, FocusEvent: browser.FocusEvent, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent,
  navigator: browser.navigator, localStorage: browser.localStorage, getComputedStyle: browser.getComputedStyle.bind(browser), ResizeObserver: browser.ResizeObserver,
  requestAnimationFrame: (fn: () => void) => browser.setTimeout(fn, 0), cancelAnimationFrame: (id: ReturnType<typeof browser.setTimeout>) => browser.clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const NativeWorker = Worker;
export const workers: { request?: unknown; terminated: boolean }[] = [];
let holdNext = false, releaseHeld: (() => void) | null = null;
class ObservedWorker extends NativeWorker {
  record = { request: undefined as unknown, terminated: false };
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options); workers.push(this.record);
    if (String(url).endsWith("nucleic-worker.ts")) super.addEventListener("message", event => {
      if (holdNext) { holdNext = false; event.stopImmediatePropagation(); releaseHeld = () => this.dispatchEvent(event); }
    });
  }
  override postMessage(message: unknown) { this.record.request = message; super.postMessage(message); }
  override terminate() { this.record.terminated = true; return super.terminate(); }
}
previous.set("Worker", Object.getOwnPropertyDescriptor(globalThis, "Worker")); Object.defineProperty(globalThis, "Worker", { configurable: true, value: ObservedWorker });
export const holdWorker = () => { holdNext = true; releaseHeld = null; };
export const workerHeld = () => releaseHeld !== null;
export const releaseWorker = () => { const fn = releaseHeld; releaseHeld = null; fn?.(); };
const browserDev = await import("../apps/desktop/src/lib/browser-dev-documents");
const realBrowserDev = { ...browserDev };
export const prepared: ViewerDocument[] = [];
let preparationGate: { promise: Promise<void>; resolve: () => void } | null = null;
export const holdPreparation = () => { preparationGate = Promise.withResolvers<void>(); };
export const releasePreparation = () => { preparationGate?.resolve(); preparationGate = null; };
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...realBrowserDev,
  openBrowserDevTextDocument: async (...args: Parameters<typeof realBrowserDev.openBrowserDevTextDocument>) => {
    const result = await realBrowserDev.openBrowserDevTextDocument(...args); prepared.push(result); await preparationGate?.promise; return result;
  },
}));
export const { readBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = realBrowserDev;
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
export const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { NucleicBuilderDialogHost } = await import("../apps/desktop/src/components/workbench/nucleic-builder-host");
export const { openWorkbenchDialog, closeWorkbenchDialog } = await import("../apps/desktop/src/lib/workbench/dialog-store");
export const wait = async (check: () => boolean, label: string) => { for (let i = 0; i < 150 && !check(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); expect(check(), label).toBe(true); };
export const dialog = () => browser.document.querySelector('[role="dialog"]') as unknown as HTMLElement | null;
export const button = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
export const click = async (label: string) => { await act(async () => button(label).click()); };
export const input = async (label: string, value: string) => {
  const node = dialog()!.querySelector(`input[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event); });
};
export const select = async (label: string, value: string) => {
  const node = dialog()!.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => { node.value = value; node.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event); });
};
export async function fixture() {
  workers.length = 0; prepared.length = 0; holdNext = false; releaseHeld = null; releasePreparation();
  useMoleculeStore.setState({ documents: [], tabs: [], activeTabId: null });
  let actions: ShellActions; const opened: ViewerDocument[] = []; let failOpen = false;
  const noop = () => {};
  function App() {
    const hook = useAppFileOpen({ preferences: defaultPreferences, addProjectRoot: noop, addBackgroundDocuments: noop, addBackgroundTextDocuments: noop,
      addDocuments: (docs, options) => { opened.push(...docs); useMoleculeStore.getState().addDocuments(docs, options); }, addTextDocuments: noop, closeDocument: noop,
      detectContentSpectrumPaths: async () => new Set<string>(), expandStructureBundles: async paths => paths, openDockTab: noop, openDocumentsInActiveTab: noop,
      openDocumentTab: noop, openFepNetworkTab: noop, openTextDocumentsInActiveTab: noop, pushErrorStatus: noop, pushStatus: noop,
      rememberRecentStructures: noop, replaceDocument: noop, setActiveDocument: noop, setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop, setDocuments: noop });
    actions = { openStructureRecords: (...args) => failOpen ? Promise.resolve([]) : hook.openStructureRecords(...args) } as ShellActions;
    return <NucleicBuilderDialogHost actions={actions} />;
  }
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<App />));
  const open = async () => { await act(async () => openWorkbenchDialog({ kind: "builder", builder: "nucleic", document: null })); await wait(() => Boolean(dialog()?.querySelector('input[aria-label="Sequence"]')), "nucleic controls"); };
  await open();
  return { actions: actions!, open, opened, failOpen: (value: boolean) => { failOpen = value; }, close: async () => {
    releasePreparation(); releaseWorker(); await act(async () => { closeWorkbenchDialog(); root.unmount(); }); host.remove();
    for (const doc of prepared) deleteBrowserDevVirtualTextDocument(doc.path); useMoleculeStore.setState({ documents: [], tabs: [], activeTabId: null });
  } };
}
afterAll(async () => { await act(async () => new Promise(resolve => setTimeout(resolve, 30))); await browser.happyDOM.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } });
