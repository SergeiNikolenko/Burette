import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
import reference from "./fixtures/metal-complex/reference.json";

const compiler: string[] = [];
plugin({ name: "metal-complex-ui-runtime", setup(build) {
  build.onLoad({ filter: /(?:metal-complex-builder(?:-host)?|grid-molecule-3d)\.tsx$/ }, ({ path }) => {
    let source = readFileSync(path, "utf8");
    if (path.endsWith("grid-molecule-3d.tsx")) source = source.replace(/^import bootstrapUrl[^\n]+/m, 'const bootstrapUrl = "/preview-bootstrap.js";').replace(/const assets = import\.meta\.glob[^\n]+/, "const assets: Record<string,string> = {};");
    const result = transformSync(source, { filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] });
    compiler.push(path.split("/").pop()!); return { contents: result!.code!, loader: "tsx" };
  });
} });
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ window: browser, self: browser, document: browser.document, Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement, HTMLSelectElement: browser.HTMLSelectElement, HTMLFormElement: browser.HTMLFormElement, HTMLButtonElement: browser.HTMLButtonElement,
  HTMLIFrameElement: browser.HTMLIFrameElement, SVGElement: browser.SVGElement, DocumentFragment: browser.DocumentFragment, MutationObserver: browser.MutationObserver, NodeFilter: browser.NodeFilter,
  CustomEvent: browser.CustomEvent, Event: browser.Event, FocusEvent: browser.FocusEvent, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent,
  navigator: browser.navigator, localStorage: browser.localStorage, getComputedStyle: browser.getComputedStyle.bind(browser), ResizeObserver: browser.ResizeObserver,
  requestAnimationFrame: (fn: () => void) => browser.setTimeout(fn, 0), cancelAnimationFrame: (id: ReturnType<typeof browser.setTimeout>) => browser.clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const NativeWorker = Worker, workers: { request?: unknown; terminated: boolean }[] = [];
let holdNext = false, releaseHeld: (() => void) | null = null;
class ObservedWorker extends NativeWorker {
  record = { request: undefined as unknown, terminated: false };
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options); workers.push(this.record);
    super.addEventListener("message", event => { if (holdNext) { holdNext = false; event.stopImmediatePropagation(); releaseHeld = () => this.dispatchEvent(event); } });
  }
  override postMessage(message: unknown) { this.record.request = message; super.postMessage(message); }
  override terminate() { this.record.terminated = true; return super.terminate(); }
}
previous.set("Worker", Object.getOwnPropertyDescriptor(globalThis, "Worker")); Object.defineProperty(globalThis, "Worker", { configurable: true, value: ObservedWorker });
const browserDev = await import("../apps/desktop/src/lib/browser-dev-documents"), realBrowserDev = { ...browserDev }, prepared: ViewerDocument[] = [];
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...realBrowserDev,
  openBrowserDevTextDocument: async (...args: Parameters<typeof realBrowserDev.openBrowserDevTextDocument>) => { const result = await realBrowserDev.openBrowserDevTextDocument(...args); prepared.push(result); return result; } }));
const { readBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = realBrowserDev;
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { MetalComplexBuilderDialogHost } = await import("../apps/desktop/src/components/workbench/metal-complex-builder-host");
const { openWorkbenchDialog, closeWorkbenchDialog } = await import("../apps/desktop/src/lib/workbench/dialog-store");
const { parseMolecule } = await import("../apps/desktop/src/lib/molecular-workbench/molecular-graph");
afterAll(async () => { await act(async () => new Promise(resolve => setTimeout(resolve, 30))); await browser.happyDOM.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } });

const wait = async (check: () => boolean, label: string) => { for (let i = 0; i < 200 && !check(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); expect(check(), label).toBe(true); };
const dialog = () => browser.document.querySelector('[role="dialog"]') as unknown as HTMLElement | null;
const button = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const control = <T extends Element>(tag: string, label: string) => dialog()!.querySelector<T>(`${tag}[aria-label="${label}"]`)!;
const select = async (label: string, value: string) => { const node = control<HTMLSelectElement>("select", label); await act(async () => { node.value = value; node.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event); }); };
const input = async (label: string, value: string) => {
  // A scrub field becomes a text input on Enter, as with the keyboard.
  await act(async () => { dialog()!.querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event); });
  const node = control<HTMLInputElement>("input", label);
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event); });
  await act(async () => { node.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event); });
};
const value = (tag: string, label: string) => control<HTMLSelectElement | HTMLInputElement>(tag, label).value;
const alert = () => dialog()?.querySelector('[role="alert"]')?.textContent ?? null;
const sample = (id: string) => readFileSync(new URL(`fixtures/metal-complex/samples/${id}.sdf`, import.meta.url), "utf8");
const previewText = () => { const frame = dialog()?.querySelector("iframe"); if (!frame) return null; const encoded = JSON.parse(frame.srcdoc.match(/id="burette-inspector-input">([^]*?)<\/script>/)![1]); return { text: Buffer.from(encoded.data, "base64").toString(), format: encoded.config.molstarFormat }; };

async function fixture() {
  workers.length = 0; prepared.length = 0; holdNext = false; releaseHeld = null;
  useMoleculeStore.setState({ documents: [], tabs: [], activeTabId: null });
  const opened: ViewerDocument[] = [], noop = () => {};
  function App() {
    const hook = useAppFileOpen({ preferences: defaultPreferences, addProjectRoot: noop, addBackgroundDocuments: noop, addBackgroundTextDocuments: noop,
      addDocuments: (docs, options) => { opened.push(...docs); useMoleculeStore.getState().addDocuments(docs, options); }, addTextDocuments: noop, closeDocument: noop,
      detectContentSpectrumPaths: async () => new Set<string>(), expandStructureBundles: async paths => paths, openDockTab: noop, openDocumentsInActiveTab: noop,
      openDocumentTab: noop, openFepNetworkTab: noop, openTextDocumentsInActiveTab: noop, pushErrorStatus: noop, pushStatus: noop,
      rememberRecentStructures: noop, replaceDocument: noop, setActiveDocument: noop, setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop, setDocuments: noop });
    const actions = { openStructureRecords: (...args: Parameters<ShellActions["openStructureRecords"]>) => hook.openStructureRecords(...args) };
    return <MetalComplexBuilderDialogHost actions={actions} />;
  }
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<App />));
  await act(async () => openWorkbenchDialog({ kind: "builder", builder: "metal", document: null }));
  await wait(() => Boolean(dialog()?.querySelector('select[aria-label="Metal"]')), "metal controls");
  return { opened, close: async () => {
    releaseHeld?.(); await act(async () => { closeWorkbenchDialog(); root.unmount(); }); host.remove();
    for (const doc of prepared) deleteBrowserDevVirtualTextDocument(doc.path); useMoleculeStore.setState({ documents: [], tabs: [], activeTabId: null });
  } };
}

test("tris-chelate built through the controls previews and opens the exact RDKit-verified SDF as a new document", async () => {
  const f = await fixture();
  try {
    expect([0, 1, 2, 3].map(site => value("select", `Site ${site + 1} ligand`))).toEqual(["chlorido", "chlorido", "ammine", "ammine"]);
    expect(dialog()!.querySelector('[aria-label="Total charge"]')!.textContent).toBe("0");
    await select("Metal", "Ru"); await input("Oxidation state", "2"); await select("Geometry", "octahedral");
    expect([1, 2, 3, 4].map(site => value("select", `Equatorial ${site} ligand`))).toEqual(["chlorido", "chlorido", "ammine", "ammine"]);
    await select("Equatorial 1 ligand", "bipyridine");
    expect(value("select", "Equatorial 1 chelate partner")).toBe("1"); expect(value("select", "Equatorial 2 ligand")).toBe("bipyridine");
    await select("Equatorial 3 ligand", "bipyridine"); expect(value("select", "Equatorial 3 chelate partner")).toBe("3");
    await select("Equatorial 3 chelate partner", "4"); expect(value("select", "Equatorial 4 ligand")).toBe("aqua"); expect(value("select", "Axial 5 ligand")).toBe("bipyridine");
    await select("Equatorial 4 ligand", "bipyridine"); expect(value("select", "Equatorial 4 chelate partner")).toBe("5");
    expect([...dialog()!.querySelectorAll('select[aria-label="Equatorial 4 chelate partner"] option')].map(option => option.textContent)).toEqual(["With 1", "With 3", "With 5", "With 6"]);
    for (const site of ["Equatorial 1", "Equatorial 3", "Equatorial 4"]) await input(`${site} metal–donor distance, angstrom`, "2.07");
    expect(dialog()!.querySelector('[role="spinbutton"][aria-label="Axial 6 metal–donor distance, angstrom"]')!.getAttribute("aria-valuenow")).toBe("2.07");
    expect(dialog()!.querySelector('[aria-label="Total charge"]')!.textContent).toBe("+2");
    await click("Preview"); await wait(() => previewText() !== null, "preview");
    expect(previewText()).toEqual({ text: sample("tris-bpy-ruthenium"), format: "sdf" });
    await click("Create"); await wait(() => !dialog(), "new document opened");
    expect(workers).toHaveLength(1); expect(f.opened).toHaveLength(1);
    const text = readBrowserDevVirtualTextDocument(f.opened[0].path)!;
    expect(text).toBe(sample("tris-bpy-ruthenium")); expect(f.opened[0].title).toBe("[Ru(bpy)3]2+.sdf");
    const reopened = parseMolecule(text, "sdf");
    expect({ atoms: reopened.atoms.length, bonds: reopened.bonds.length, coordination: reopened.bonds.filter(bond => bond.order === 0).length })
      .toEqual({ atoms: reference.complexes["tris-bpy-ruthenium"].rdkit.atoms, bonds: reference.complexes["tris-bpy-ruthenium"].rdkit.bonds, coordination: 6 });
    expect(compiler).toContain("metal-complex-builder.tsx"); expect(compiler).toContain("metal-complex-builder-host.tsx");
  } finally { await f.close(); }
});

test("an overlapping choice shows the reason, keeps the form, and a corrected geometry creates the complex", async () => {
  const f = await fixture();
  try {
    await select("Metal", "Fe"); await select("Geometry", "octahedral");
    for (let site = 1; site <= 6; site++) await select(`${site <= 4 ? "Equatorial" : "Axial"} ${site} ligand`, "trimethylphosphane");
    await click("Create"); await wait(() => alert() !== null, "overlap error");
    expect(alert()).toContain("overlap"); expect(f.opened).toEqual([]); expect(dialog()).not.toBeNull();
    await select("Geometry", "tetrahedral");
    expect([1, 2, 3, 4].map(site => value("select", `Site ${site} ligand`))).toEqual(Array(4).fill("trimethylphosphane"));
    expect([...dialog()!.querySelectorAll('select[aria-label="Site 1 ligand"] optgroup')].map(group => (group as HTMLOptGroupElement).label)).toEqual(["Monodentate", "Bidentate"]);
    await click("Create"); await wait(() => f.opened.length === 1, "corrected create");
    expect(f.opened[0].title).toBe("[Fe(PMe3)4]2+.sdf");
    await act(async () => openWorkbenchDialog({ kind: "builder", builder: "metal", document: null }));
    await wait(() => value("select", "Metal") === "Pt", "fresh form"); await select("Geometry", "linear");
    expect([...dialog()!.querySelectorAll('select[aria-label="Site 1 ligand"] optgroup')].map(group => [(group as HTMLOptGroupElement).label, (group as HTMLOptGroupElement).disabled])).toEqual([["Monodentate", false], ["Bidentate", true]]);
  } finally { await f.close(); }
});

test("duplicate Create is one request; Cancel terminates the held real worker and nothing opens", async () => {
  const f = await fixture();
  try {
    holdNext = true;
    const create = button("Create"); await act(async () => { create.click(); create.click(); });
    await wait(() => releaseHeld !== null, "held worker reply"); expect(workers).toHaveLength(1); expect(button("Create").disabled).toBe(true);
    await click("Cancel"); expect(workers[0].terminated).toBe(true); await act(async () => releaseHeld?.()); expect(f.opened).toEqual([]);
    await click("Create"); await wait(() => f.opened.length === 1, "retry");
    expect(readBrowserDevVirtualTextDocument(f.opened[0].path)).toBe(sample("cisplatin")); expect(f.opened[0].title).toBe("[PtCl2(NH3)2].sdf");
  } finally { await f.close(); }
});
