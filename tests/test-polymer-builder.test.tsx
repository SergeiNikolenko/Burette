import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync, existsSync } from "node:fs";
import React, { act } from "react";
import { Window } from "happy-dom";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { buildBrowserWorker } from "./support/browser-worker-build";
plugin({ name: "source-generation-compiler", setup(build) { build.onLoad({ filter: /(?:hooks\/use-(?:source-(?:editing|draft-recovery)|app-file-open)|workbench\/(?:polymer-source|owned-source-text))\.ts$/u }, ({ path }) => ({
  contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "ts",
})); } });
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Element: browser.Element, Node: browser.Node,
  Event: browser.Event, MessageEvent: browser.MessageEvent, CustomEvent: browser.CustomEvent, MutationObserver: browser.MutationObserver,
  MouseEvent: browser.MouseEvent, KeyboardEvent: browser.KeyboardEvent, FocusEvent: browser.FocusEvent, PointerEvent: browser.PointerEvent, DocumentFragment: browser.DocumentFragment, NodeFilter: browser.NodeFilter, HTMLInputElement: browser.HTMLInputElement, HTMLButtonElement: browser.HTMLButtonElement, HTMLSelectElement: browser.HTMLSelectElement, HTMLFormElement: browser.HTMLFormElement, SVGElement: browser.SVGElement, getComputedStyle: browser.getComputedStyle.bind(browser), ResizeObserver: browser.ResizeObserver, requestAnimationFrame: (fn: () => void) => browser.setTimeout(fn, 0), cancelAnimationFrame: (id: ReturnType<typeof browser.setTimeout>) => browser.clearTimeout(id), localStorage: browser.localStorage, CSS: browser.CSS, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} await browser.happyDOM.close(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let native = false;
let confirmSave: () => Promise<boolean> = async () => false;
let saveNative: () => Promise<unknown> = async () => ({ revision: { modifiedAt: 1, byteCount: 10, contentHash: "saved" } });
let reconcileNative: () => Promise<unknown> = async () => ({ revision: { modifiedAt: 1, byteCount: 10, contentHash: "saved" } });
const actualDialogs = await import("@tauri-apps/plugin-dialog");
mock.module("@tauri-apps/plugin-dialog", () => ({ ...actualDialogs, confirm: () => confirmSave(), message: async () => {} }));
const calls: string[] = [];
let nativeRead: () => Promise<unknown> = async () => { throw new Error("Unexpected native read"); };
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native, trackTauriListener: () => () => {} }));
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string) => { calls.push(command); if (command === "open_source_edit_session") return nativeRead(); if (command === "save_source_document") return saveNative(); if (command === "reconcile_source_commit") return reconcileNative(); if (command !== "close_source_edit_session") throw new Error(`Unexpected native IPC ${command}`); } }));
let prepare: (document: ViewerDocument) => Promise<ViewerDocument> = async document => document;
const deferredRuntime = await import("../apps/desktop/src/hooks/use-deferred-viewer-runtime");
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ ...deferredRuntime, prepareDeferredViewerRuntime: (document: ViewerDocument) => prepare(document) }));
const browserDocuments = { ...await import("../apps/desktop/src/lib/browser-dev-documents") };
let preparationGate: ReturnType<typeof deferred<void>> | null = null;
const prepared: ViewerDocument[] = [];
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browserDocuments, openBrowserDevTextDocument: async (...args: Parameters<typeof browserDocuments.openBrowserDevTextDocument>) => {
  const result = await browserDocuments.openBrowserDevTextDocument(...args); prepared.push(result); await preparationGate?.promise; return result;
} }));
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
let failOpen = false;
let actions!: Pick<import("../apps/desktop/src/components/types").ShellActions, "openStructureRecords">;
const opened: ViewerDocument[] = [], noop = () => {};
const { createRoot } = await import("react-dom/client");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { adoptLogicalSource, beginScienceSessionRestore, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");
const fixtureGraph = JSON.parse(readFileSync(new URL("fixtures/polymer/propylene-reference.json", import.meta.url), "utf8"));
const { sdfFromGraph } = await import("../apps/desktop/src/lib/workbench/formats");
const sample = sdfFromGraph(fixtureGraph.atoms, fixtureGraph.bonds, "Propylene");
const settings = { head: 0, tail: 1, headLeaving: 5, tailLeaving: 4, count: 6, bondLength: 3, tacticity: "atactic" as const };
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { usePolymerSource } = await import("../apps/desktop/src/lib/workbench/polymer-source");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
let source!: ReturnType<typeof usePolymerSource>;
function Probe() { source = usePolymerSource(currentDocument); return null; }
let serial = 0, currentDocument: ViewerDocument;
async function fixture(extension = "sdf", inputDocument?: ViewerDocument) {
  failOpen = false;
  opened.length = 0; prepared.length = 0;
  const doc: ViewerDocument = inputDocument ?? { id: `source-gen-${++serial}`, path: `/Scenes/${serial}.${extension}`, title: `scene.${extension}`, extension, byteCount: 2048, renderer: "molstar", runtimePath: "original" };
  currentDocument = doc; useMoleculeStore.setState({ documents: [doc] }); let controller!: ReturnType<typeof useSourceEditingController>;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), errors: unknown[] = [];
  const frame = document.createElement("iframe"); host.append(frame);
  function Fixture() {
    const open = useAppFileOpen({ preferences: defaultPreferences, addProjectRoot: noop, addBackgroundDocuments: noop, addBackgroundTextDocuments: noop,
      addDocuments: (docs, options) => { opened.push(...docs); useMoleculeStore.getState().addDocuments(docs, options); }, addTextDocuments: noop, closeDocument: noop,
      detectContentSpectrumPaths: async () => new Set<string>(), expandStructureBundles: async paths => paths, openDockTab: noop, openDocumentsInActiveTab: noop,
      openDocumentTab: noop, openFepNetworkTab: noop, openTextDocumentsInActiveTab: noop, pushErrorStatus: error => errors.push(error), pushStatus: noop,
      rememberRecentStructures: noop, replaceDocument: noop, setActiveDocument: noop, setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop, setDocuments: noop });
    actions = { openStructureRecords: (...args) => failOpen ? Promise.resolve([]) : open.openStructureRecords(...args) };
    controller = useSourceEditingController({ activeDocument: doc, preferences: defaultPreferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return <SourceEditingProvider value={controller}><Probe /><SceneComputeMenu document={doc} actions={actions as import("../apps/desktop/src/components/types").ShellActions} /><PolymerBuilderDialogHost actions={actions} />{LegacyDialogs ? <LegacyDialogs actions={actions as import("../apps/desktop/src/components/types").ShellActions} /> : null}</SourceEditingProvider>; }
  await act(async () => root.render(<Fixture />));
  return { doc, frame, errors, get controller() { return controller; }, async close() { await act(async () => root.unmount()); host.remove(); for (const doc of prepared) browserDocuments.deleteBrowserDevVirtualTextDocument(doc.path); releaseClosedScienceSessions(new Set()); native = false; prepare = async document => document; } };
}
function adopt(doc: ViewerDocument, text = sample) { adoptLogicalSource({ documentId: doc.id, extension: "sdf", text }, crypto.randomUUID(), null, fixtureGraph.atoms.map((a: { element: string }) => a.element)); }



const built = await buildBrowserWorker(new URL("../apps/desktop/src/lib/workbench/polymer-worker.ts", import.meta.url));
const workerPath = `${import.meta.dir}/.polymer-worker-${crypto.randomUUID()}.js`; await Bun.write(workerPath, built.outputs[0]);
const NativeWorker = Worker; let hold = false, held: (() => void) | null = null, terminated = 0, workers = 0;
const requests: any[] = [];
class CompiledWorker extends NativeWorker {
  readonly polymer: boolean;
  constructor(url: string | URL, options?: WorkerOptions) { const polymer = String(url).endsWith("polymer-worker.ts"); super(polymer ? workerPath : url, options); this.polymer = polymer; if (polymer) workers++; }
  override postMessage(message: unknown) { if (this.polymer) requests.push(message); super.postMessage(message); }
  override set onmessage(callback: ((event: MessageEvent) => void) | null) { super.onmessage = event => { if (hold && this.polymer) held = () => callback?.(event); else callback?.(event); }; }
  override terminate() { terminated++; return super.terminate(); }
}
Object.defineProperty(globalThis, "Worker", { configurable: true, value: CompiledWorker });
afterAll(() => { Object.defineProperty(globalThis, "Worker", { configurable: true, value: NativeWorker }); require("node:fs").unlinkSync(workerPath); });
async function wait(check: () => boolean) { for (let i = 0; i < 150 && !check(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); expect(check(), dialog()?.textContent ?? "No dialog").toBe(true); }


plugin({ name: "polymer-ui-compiler", setup(build) { build.onLoad({ filter: /(?:components\/(?:workbench\/polymer-builder(?:-host)?|editor-area\/scene-compute-menu|grid-molecule-3d)\.tsx|hooks\/use-polymer-builder\.ts)$/u }, ({ path }) => {
  let code = readFileSync(path, "utf8");
  if (path.endsWith("grid-molecule-3d.tsx")) code = code.replace(/^import bootstrapUrl[^\n]+/m, 'const bootstrapUrl = "/preview-bootstrap.js";').replace(/const assets = import\.meta\.glob[^\n]+/, "const assets: Record<string,string> = {};");
  return { contents: transformSync(code, { filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "tsx" };
}); } });
const legacyPath = new URL("../apps/desktop/src/components/workbench/workbench-dialogs.tsx", import.meta.url).pathname;
const LegacyDialogs: React.ComponentType<{ actions: import("../apps/desktop/src/components/types").ShellActions }> | null = existsSync(legacyPath) ? (await import(legacyPath)).WorkbenchDialogs : null;
const { PolymerBuilderDialogHost } = await import("../apps/desktop/src/components/workbench/polymer-builder-host");
const { SceneComputeMenu } = await import("../apps/desktop/src/components/editor-area/scene-compute-menu");
const { openWorkbenchDialog, closeWorkbenchDialog } = await import("../apps/desktop/src/lib/workbench/dialog-store");
const { buildShellCommands } = await import("../apps/desktop/src/lib/shell-commands");
const { attachNativePolymerSource } = await import("./polymer-native-fixture");
const permutation = [5, 1, 4, 0, 7, 2, 6, 3, 8, 9, 10];
const sourceText = sdfFromGraph(permutation.map(i => fixtureGraph.atoms[i]), fixtureGraph.bonds.map((b: { a: number; b: number; order: number }) => ({ ...b, a: permutation.indexOf(b.a), b: permutation.indexOf(b.b) })), "Interleaved propylene");
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
const pickButton = (role: string) => dialog()!.querySelector<HTMLButtonElement>(`button[aria-label^="Pick ${role}"]`)!;
async function input(label: string, value: string) {
  await act(async () => dialog()!.querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event));
  const node = dialog()!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event); });
  await act(async () => node.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event));
}
async function uiFixture(palette = false, text = sourceText) {
  const doc = await browserDocuments.openBrowserDevTextDocument("propylene.sdf", "sdf", text, { ...defaultPreferences, rendererMode: "molstar" }, undefined, undefined, { newDocument: true });
  const f = await fixture("sdf", doc); document.body.append(f.frame);
  const scene = await attachNativePolymerSource(f.frame, doc, text);
  if (palette) {
    const commands = buildShellCommands({ activeDocument: doc, documents: [doc], tabs: [], recentStructures: [], preferences: defaultPreferences } as unknown as import("../apps/desktop/src/components/types").ShellViewState, actions as import("../apps/desktop/src/components/types").ShellActions, "polymer");
    await act(async () => commands.find(command => command.id === "workbench-polymer")!.run());
  } else {
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Open molecular compute menu"]')!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event));
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === "Build polymer…")!;
    expect(item).toBeTruthy(); await act(async () => item.click());
  }
  await wait(() => Boolean(dialog()?.querySelector<HTMLFieldSetElement>("fieldset")?.disabled === false));
  return { ...f, scene, async close() { preparationGate?.resolve(); preparationGate = null; hold = false; held?.(); held = null;
    await act(async () => closeWorkbenchDialog()); await scene.close(); f.frame.remove(); await f.close(); browserDocuments.deleteBrowserDevVirtualTextDocument(doc.path); } };
}
async function choose(f: Awaited<ReturnType<typeof uiFixture>>, role: string, index: number) {
  await act(async () => pickButton(role).click()); await wait(() => pickButton(role).getAttribute("aria-pressed") === "true");
  // Real queued host dispatch arms the native BehaviorSubject after the button event.
  await act(async () => new Promise(resolve => setTimeout(resolve, 10))); await act(async () => f.scene.click(index));
  await wait(() => pickButton(role).getAttribute("aria-pressed") === "false");
}
async function choices(f: Awaited<ReturnType<typeof uiFixture>>) {
  for (const [role, index] of [["Head H", 0], ["Tail", 1], ["Head", 3], ["Tail H", 2]] as const) await choose(f, role, index);
  expect([pickButton("Head").textContent, pickButton("Head H").textContent, pickButton("Tail").textContent, pickButton("Tail H").textContent]).toEqual(["Head: C4", "Head H: H1", "Tail: C2", "Tail H: H3"]);
  await input("Repeat count", "6"); await input("Link length, angstrom", "3");
  await act(async () => { const node = dialog()!.querySelector<HTMLSelectElement>('[aria-label="Tacticity"]')!; node.value = "atactic"; node.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event); });
}

test("normal SDF Compute → explicit native role picks → cached preview and one pending Create", async () => {
  const f = await uiFixture();
  try {
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1); expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull(); expect(button("Create").disabled).toBe(true);
    await choices(f); const before = requests.filter(request => request.action === "build").length;
    await act(async () => button("Preview").click()); await wait(() => Boolean(dialog()?.querySelector("iframe")));
    const encoded = JSON.parse(dialog()!.querySelector("iframe")!.srcdoc.match(/id="burette-inspector-input">([^]*?)<\/script>/)![1]), preview = await (await fetch(encoded.dataURL)).text();
    expect(requests.filter(request => request.action === "build").length).toBe(before + 1);
    expect(requests.at(-1).options).toMatchObject({ head: 3, tail: 1, headLeaving: 0, tailLeaving: 2, count: 6, tacticity: { kind: "atactic" } });
    const previewFrame = dialog()!.querySelector("iframe")!;
    await act(async () => pickButton("Head").click());
    await wait(() => pickButton("Head").getAttribute("aria-pressed") === "true");
    expect(dialog()!.querySelector('[aria-label="Repeat count"]')).toBeNull();
    expect(previewFrame.closest("[hidden]")).not.toBeNull();
    await act(async () => pickButton("Head").click());
    await wait(() => pickButton("Head").getAttribute("aria-pressed") === "false");
    expect(dialog()!.querySelector("iframe")).toBe(previewFrame);
    expect(previewFrame.closest("[hidden]")).toBeNull();
    expect(dialog()!.querySelector('[aria-label="Repeat count"]')).not.toBeNull();
    preparationGate = deferred<void>(); const create = button("Create"); await act(async () => { create.click(); create.click(); });
    await wait(() => prepared.length === 1); expect(opened).toEqual([]); await act(async () => preparationGate!.resolve());
    await wait(() => opened.length === 1 && !dialog()); expect(requests.filter(request => request.action === "build").length).toBe(before + 1);
    expect(browserDocuments.readBrowserDevVirtualTextDocument(opened[0].path)).toBe(preview);
    expect(browserDocuments.readBrowserDevVirtualTextDocument(f.doc.path)).toBe(sourceText);
  } finally { await f.close(); }
}, 15000);

test("a failed Create keeps the exact atactic preview for a successful opening retry", async () => {
  const f = await uiFixture(true);
  try {
    await choices(f); const before = requests.filter(request => request.action === "build").length; failOpen = true;
    await act(async () => button("Create").click()); await wait(() => Boolean(dialog()?.querySelector('[role="alert"]')));
    const encoded = JSON.parse(dialog()!.querySelector("iframe")!.srcdoc.match(/id="burette-inspector-input">([^]*?)<\/script>/)![1]);
    const preview = await (await fetch(encoded.dataURL)).text(); expect(dialog()!.textContent).toContain("Try Create again"); failOpen = false;
    await act(async () => button("Create").click()); await wait(() => opened.length === 1 && !dialog());
    expect(requests.filter(request => request.action === "build").length).toBe(before + 1);
    expect(browserDocuments.readBrowserDevVirtualTextDocument(opened[0].path)).toBe(preview);
  } finally { await f.close(); }
}, 15000);

test("withheld native retirement during prepared Create still prevents publication", async () => {
  const f = await uiFixture(true);
  try {
    await choices(f); const before = requests.filter(request => request.action === "build").length; preparationGate = deferred<void>(); f.scene.holdRetirement();
    await act(async () => button("Create").click()); await wait(() => prepared.length === 1); const stale = prepared[0];
    await f.scene.plugin.state.data.build().to(f.scene.raw).update({ data: sourceText.replace("Interleaved propylene", "Changed source") }).commit({ canUndo: "Native edit" });
    await f.scene.plugin.runTask(f.scene.plugin.state.data.undo()); await act(async () => preparationGate!.resolve());
    await wait(() => Boolean(dialog()?.querySelector('[role="alert"]')?.textContent?.includes("source changed")));
    expect(opened).toEqual([]); expect(browserDocuments.readBrowserDevVirtualTextDocument(stale.path)).toBeNull();
    expect(requests.filter(request => request.action === "build").length).toBe(before + 1); expect(button("Create").disabled).toBe(true); f.scene.flushRetirement();
  } finally { await f.close(); }
}, 15000);

test("wrong atom role is recoverable; cancelling a held real build closes only its request", async () => {
  const f = await uiFixture();
  try {
    await choose(f, "Head H", 3); expect(dialog()!.textContent).toContain("singly bonded hydrogen"); expect(button("Create").disabled).toBe(true);
    await choices(f); hold = true; held = null; const before = terminated;
    await act(async () => button("Preview").click()); await wait(() => held !== null);
    await act(async () => button("Cancel").click()); expect(dialog()).toBeNull(); expect(terminated).toBe(before + 1);
    (held as (() => void) | null)?.(); expect(opened).toEqual([]); expect(browserDocuments.readBrowserDevVirtualTextDocument(f.doc.path)).toBe(sourceText);
  } finally { await f.close(); }
}, 15000);

test("changing tacticity invalidates the visible preview and prepares a new owned request", async () => {
  const f = await uiFixture(true);
  try {
    await choices(f); const before = requests.filter(request => request.action === "build").length;
    await act(async () => button("Preview").click()); await wait(() => Boolean(dialog()?.querySelector("iframe")));
    await act(async () => { const node = dialog()!.querySelector<HTMLSelectElement>('[aria-label="Tacticity"]')!; node.value = "syndiotactic"; node.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event); });
    expect(dialog()!.querySelector("iframe")).toBeNull();
    await act(async () => button("Preview").click()); await wait(() => Boolean(dialog()?.querySelector("iframe")));
    expect(requests.filter(request => request.action === "build").length).toBe(before + 2); expect(requests.at(-1).options.tacticity).toEqual({ kind: "syndiotactic" });
  } finally { await f.close(); }
}, 15000);


test("large valid native role picks produce full Preview and Create from identical cached SDF", async () => {
  const text = readFileSync("tests/fixtures/polymer/chiral-reference.sdf", "utf8"), f = await uiFixture(true, text);
  try {
    for (const [role, index] of [["Head H", 6], ["Tail H", 11], ["Head", 0], ["Tail", 5]] as const) await choose(f, role, index);
    await input("Repeat count", "500"); await input("Link length, angstrom", "3");
    const before = requests.filter(request => request.action === "build").length;
    await act(async () => button("Preview").click()); await wait(() => Boolean(dialog()?.querySelector("iframe")));
    const frame = dialog()!.querySelector("iframe")!, data = JSON.parse(frame.srcdoc.match(/id="burette-inspector-input">([^]*?)<\/script>/)![1]);
    expect([data.config.format, data.config.molstarFormat, data.data]).toEqual(["sdf", "sdf", undefined]); expect(frame.srcdoc.length).toBeLessThan(8000);
    const preview = await (await fetch(data.dataURL)).text(); expect(preview.length).toBe(444651); expect(dialog()!.textContent).toContain("6,502 atoms");
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
    await act(async () => button("Create").click()); await wait(() => opened.length === 1 && !dialog());
    expect(browserDocuments.readBrowserDevVirtualTextDocument(opened[0].path)).toBe(preview);
    expect(browserDocuments.readBrowserDevVirtualTextDocument(f.doc.path)).toBe(text);
    expect(requests.filter(request => request.action === "build").length).toBe(before + 1);
    await expect(fetch(data.dataURL)).rejects.toThrow();
  } finally { await f.close(); }
}, 15000);


test("late logical MOLX registration exposes the source-bound builder without rereading the archive", async () => {
  const f = await fixture("molx"); document.body.append(f.frame);
  const scene = await attachNativePolymerSource(f.frame, f.doc, sample);
  try {
    const commands = () => buildShellCommands({ activeDocument: f.doc, documents: [f.doc], tabs: [], recentStructures: [], preferences: defaultPreferences } as unknown as import("../apps/desktop/src/components/types").ShellViewState, actions as import("../apps/desktop/src/components/types").ShellActions, "polymer");
    expect(commands().find(command => command.id === "workbench-polymer")).toBeUndefined();
    await act(async () => adopt(f.doc));
    await act(async () => commands().find(command => command.id === "workbench-polymer")!.run());
    await wait(() => Boolean(dialog()?.querySelector<HTMLFieldSetElement>("fieldset")?.disabled === false));
    for (const [role, index] of [["Head H", 5], ["Tail H", 4], ["Head", 0], ["Tail", 1]] as const) await choose({ ...f, scene, close: f.close }, role, index);
    await input("Link length, angstrom", "3");
    await act(async () => button("Preview").click()); await wait(() => Boolean(dialog()?.querySelector("iframe")));
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull(); expect(opened).toEqual([]);
  } finally { await act(async () => closeWorkbenchDialog()); await scene.close(); f.frame.remove(); await f.close(); }
}, 15000);
