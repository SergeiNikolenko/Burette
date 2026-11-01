import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";

// Build biological assembly, end to end through the shared workbench dialog, with the
// assembly worker replaced by a held transport: which source text and model each job
// gets, and what cancel, failure, a changed or closed source and success do with it.
// The dialog, its source hook and the dialog router compile with the React Compiler, as the app build does.
const compiledModules = new Set<string>();
const COMPILED = /apps\/desktop\/src\/(lib\/workbench\/(?:assembly-source|owned-source-text)\.ts|components\/workbench\/(assembly-dialog|assembly-dialog-host)\.tsx)$/u;
plugin({
  name: "react-compiler",
  setup(build) {
    build.onLoad({ filter: COMPILED }, ({ path }) => {
      const tsx = path.endsWith(".tsx"), compiledFunctions: string[] = [];
      const compiled = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
        parserOpts: { plugins: tsx ? ["typescript", "jsx"] : ["typescript"] }, plugins: [["babel-plugin-react-compiler", { logger: { logEvent(_filename: string, event: { kind: string; fnName?: string }) { if (event.kind === "CompileSuccess" && event.fnName) compiledFunctions.push(event.fnName); } } }]] });
      // The forwarding wrapper compiles successfully without allocating memo slots.
      if (path.endsWith("/assembly-source.ts")) assert.ok(compiledFunctions.includes("useAssemblySourceText"), `${path} compiled successfully`);
      else assert.ok(/react\/compiler-runtime/u.test(compiled.code), `${path} was compiled`);
      compiledModules.add(path.split("/").pop()!);
      return { contents: compiled.code, loader: tsx ? "tsx" : "ts" };
    });
  },
});

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
for (const [name, value] of Object.entries({
  window, self: window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLFormElement: window.HTMLFormElement, SVGElement: window.SVGElement,
  DocumentFragment: window.DocumentFragment, MutationObserver: window.MutationObserver, NodeFilter: window.NodeFilter,
  CustomEvent: window.CustomEvent, Event: window.Event, FocusEvent: window.FocusEvent, KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent, PointerEvent: window.PointerEvent, navigator: window.navigator, localStorage: window.localStorage,
  requestAnimationFrame: (callback) => window.setTimeout(callback, 0), cancelAnimationFrame: (id) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { afterAll, mock, test } = await import("bun:test");
afterAll(() => { assert.ok(compiledModules.has("owned-source-text.ts"), "Actual shared source owner was compiled"); });

// Held worker transport: each job waits for the test to settle it, and records its abort.
const jobs = [];
const abortError = () => new DOMException("Calculation cancelled.", "AbortError");
mock.module("../apps/desktop/src/lib/workbench/assembly-task", () => ({
  isAbortError: (error) => error instanceof DOMException && error.name === "AbortError",
  runAssemblyTask: (request, { signal } = {}) => new Promise((resolve, reject) => {
    const job = { request, aborted: false, resolve, reject };
    jobs.push(job);
    signal?.addEventListener("abort", () => { job.aborted = true; reject(abortError()); }, { once: true });
  }),
}));
// Files on disk, read only up to the requested size.
const files = new Map();
const reads = [];
mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureText: async (path) => files.get(path),
  readStructureTextDocument: async (path, _seed, { maxBytes } = {}) => {
    reads.push({ path, maxBytes });
    const text = files.get(path);
    return { content: text.slice(0, maxBytes), truncated: maxBytes !== undefined && text.length > maxBytes };
  },
}));
// Unsaved drafts, as the source editor holds them.
const drafts = new Map();
const draftListeners = new Set();
let draftVersion = 0;
const setDraft = (id, content) => { drafts.set(id, content); draftVersion++; draftListeners.forEach((listener) => listener()); };
mock.module("../apps/desktop/src/lib/source-editing/context", () => ({
  useSourceEditing: () => {
    const version = React.useSyncExternalStore((listener) => { draftListeners.add(listener); return () => draftListeners.delete(listener); }, () => draftVersion);
    return { version, captureOperation: () => ({ isCurrent: () => true, release() {} }), sessionForDocument: (document) => (document && drafts.has(document.id) ? { content: drafts.get(document.id) } : null) };
  },
}));
const pickedFiles = [];
mock.module("../apps/desktop/src/lib/browser-file-picker", () => ({ pickBrowserFiles: async () => pickedFiles.splice(0) }));
let tauri = false;
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => tauri }));
// The real browser preparation of a generated document, held before it returns when a test asks.
const browserDev = await import("../apps/desktop/src/lib/browser-dev-documents");
const realBrowserDev = { ...browserDev };
const prepared = [];
let preparing = null;
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({
  ...realBrowserDev,
  openBrowserDevTextDocument: async (...args) => {
    const document = await realBrowserDev.openBrowserDevTextDocument(...args);
    prepared.push(document);
    await preparing?.promise;
    return document;
  },
}));
// The desktop preparation: open_text_structure answers when the test settles it.
const invokes = [];
let nativeOpen = null;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command, args) => {
    invokes.push([command, args]);
    if (command !== "open_text_structure") return undefined;
    await nativeOpen?.promise;
    return { id: `native-${invokes.length}`, title: args.request.title, path: `/cache/ketcher/${invokes.length}/${args.request.title}`, extension: "cif", renderer: "molstar", virtual: true };
  },
}));

const { createRoot } = await import("react-dom/client");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { openWorkbenchDialog, closeWorkbenchDialog } = await import("../apps/desktop/src/lib/workbench/dialog-store");
const { AssemblyDialogHost: WorkbenchDialogs } = await import("../apps/desktop/src/components/workbench/assembly-dialog-host");
const { assemblySourceFormat } = await import("../apps/desktop/src/lib/workbench/assembly-source");
// Retained transport suite's availability adapter; real Compute/Palette routes run in test-assembly-activation.
const workbenchMenuItems = (document) => assemblySourceFormat(document) ? [{ id: "workbench-assembly" }] : [];
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");

const opened = [];
// Opening a generated document waits for this, when a test holds it.
let opening = null;
const actions = {
  openStructureRecords: async (records) => {
    await opening?.promise;
    opened.push(...records);
    return records.map((record) => ({ id: `generated-${opened.length}`, title: record.path, path: record.path, extension: record.inputExtension, renderer: "molstar" }));
  },
};
const pdb = { id: "pdb-1abc", title: "1abc.pdb", path: "/data/1abc.pdb", extension: "pdb", renderer: "molstar" };
const cif = { id: "cif-2xyz", title: "2xyz.cif", path: "/data/2xyz.cif", extension: "cif", renderer: "molstar" };
const sdf = { id: "sdf-ethanol", title: "ethanol.sdf", path: "/data/ethanol.sdf", extension: "sdf", renderer: "molstar" };
files.set(pdb.path, "HEADER 1ABC FILE\n");
files.set(cif.path, "data_2xyz\n");
files.set(sdf.path, "ethanol\n");
const listing = (models = ["1"]) => ({ assemblies: [{ id: "1", details: "author_defined_assembly", copies: 2 }, { id: "2", details: "", copies: 1 }], models });
const built = (overrides = {}) => ({ cif: "data_burette_assembly\n", atomCount: 1234, chainCount: 2, assemblyId: "1", modelNumber: "1", warnings: [], ...overrides });

const body = () => window.document.body;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
const dialog = () => body().querySelector('[role="dialog"]');
const button = (text) => [...(dialog()?.querySelectorAll("button") ?? [])].find((node) => node.textContent === text) ?? null;
const radio = (text) => [...body().querySelectorAll('[role="radio"]')].find((node) => node.closest("label")?.textContent.startsWith(text));
const alertText = () => dialog()?.querySelector('[role="alert"]')?.textContent ?? null;
const click = async (node) => { assert.ok(node, "control exists"); await act(async () => node.click()); await settle(); };
const chooseModel = async (value) => {
  const select = dialog().querySelector('select[aria-label="Model"]');
  await act(async () => { select.value = value; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
  await settle();
};
const lastJob = (action) => jobs.filter((job) => job.request.action === action).at(-1);
const finish = async (job, result) => { await act(async () => job.resolve(result)); await settle(); };
const fail = async (job, message) => { await act(async () => job.reject(new Error(message))); await settle(); };
const reset = () => { jobs.length = 0; opened.length = 0; reads.length = 0; drafts.clear(); };

async function mount(document, open = [pdb, cif, sdf], shell = <WorkbenchDialogs actions={actions} />) {
  reset();
  useMoleculeStore.setState({ documents: open });
  const host = window.document.createElement("div");
  body().append(host);
  const root = createRoot(host);
  await act(async () => root.render(shell));
  await act(async () => openWorkbenchDialog({ kind: "assembly", document }));
  await settle();
  return async () => { await act(async () => closeWorkbenchDialog()); await act(async () => root.unmount()); host.remove(); };
}

test("assemblies are offered for PDB and mmCIF documents only", () => {
  const ids = (document) => workbenchMenuItems(document, actions, new Set()).map((item) => item.id).filter((id) => id === "workbench-assembly");
  assert.deepEqual([pdb, cif, sdf].map(ids), [["workbench-assembly"], ["workbench-assembly"], []]);
});

test("the open document's current draft is the source; several models need an explicit choice; success opens a new mmCIF", async () => {
  const unmount = await mount(pdb);
  try {
    // The file is read only up to the size limit, then the draft replaces it.
    assert.deepEqual(reads, [{ path: pdb.path, maxBytes: 20_000_001 }]);
    assert.deepEqual(lastJob("assemblies").request, { action: "assemblies", text: "HEADER 1ABC FILE\n", format: "pdb" });
    await act(async () => setDraft(pdb.id, "HEADER 1ABC DRAFT\n"));
    await settle();
    assert.equal(jobs[0].aborted, true, "the listing of the replaced text is dropped");
    assert.deepEqual(lastJob("assemblies").request, { action: "assemblies", text: "HEADER 1ABC DRAFT\n", format: "pdb" });
    await finish(lastJob("assemblies"), listing(["1", "2"]));

    // Nothing is chosen for the user among several assemblies or models.
    assert.deepEqual([radio("Assembly 1").getAttribute("aria-checked"), radio("Assembly 2").getAttribute("aria-checked")], ["false", "false"]);
    assert.match(dialog().textContent, /Assembly 12 copiesauthor_defined_assembly/u);
    assert.equal(button("Build").disabled, true);
    await click(radio("Assembly 1"));
    assert.equal(button("Build").disabled, true, "a model is still required");
    await chooseModel("2");
    assert.equal(button("Build").disabled, false);

    await click(button("Build"));
    assert.deepEqual(lastJob("assembly").request, { action: "assembly", text: "HEADER 1ABC DRAFT\n", format: "pdb", assemblyId: "1", modelNumber: "2" });
    assert.ok(button("Cancel"), "a running build can be cancelled");
    assert.equal(radio("Assembly 2").disabled, true, "choices hold while the build runs");
    await finish(lastJob("assembly"), built({ modelNumber: "2", warnings: ["Anisotropic displacement tensors are not exported."] }));
    assert.deepEqual(opened, [{ path: "1abc-assembly-1-model-2.cif", inputExtension: "cif", text: "data_burette_assembly\n" }]);
    assert.equal(drafts.get(pdb.id), "HEADER 1ABC DRAFT\n", "the source keeps its text");
    assert.match(dialog().querySelector(".assembly-outcome").textContent,
      /^Opened 1abc-assembly-1-model-2\.cif: 1,234 atoms in 2 chains, model 2Anisotropic displacement tensors are not exported\.$/u);
    await click(button("Done"));
    assert.equal(dialog(), null);
  } finally { await unmount(); }
});

test("cancel, failure, a changed or closed source and a closed dialog never open a document", async () => {
  let unmount = await mount(cif);
  try {
    assert.deepEqual(lastJob("assemblies").request, { action: "assemblies", text: "data_2xyz\n", format: "cif" });
    await finish(lastJob("assemblies"), listing());
    // A single model needs no choice; an assembly still does.
    assert.equal(dialog().querySelector('select[aria-label="Model"]'), null);
    await click(radio("Assembly 2"));

    await click(button("Build"));
    await click(button("Cancel"));
    assert.equal(lastJob("assembly").aborted, true);
    assert.ok(button("Build"), "Build is offered again");

    await click(button("Build"));
    await fail(lastJob("assembly"), "Expanded biological assembly exceeds 250,000 atoms.");
    assert.equal(alertText(), "Expanded biological assembly exceeds 250,000 atoms.");

    // The source text changes while a build runs: that build is dropped and the new text listed.
    await click(button("Build"));
    const stale = lastJob("assembly");
    await act(async () => setDraft(cif.id, "data_2xyz_edited\n"));
    await settle();
    assert.equal(stale.aborted, true);
    await finish(stale, built());
    assert.deepEqual(lastJob("assemblies").request.text, "data_2xyz_edited\n");
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 2"));

    // Another file starts without the choices made for this one.
    pickedFiles.push(new File(["data_other\n"], "other.cif"));
    await click(button("Choose file…"));
    await finish(lastJob("assemblies"), listing());
    assert.deepEqual([radio("Assembly 1").getAttribute("aria-checked"), radio("Assembly 2").getAttribute("aria-checked")], ["false", "false"]);
    assert.equal(button("Build").disabled, true);
    await unmount();
    unmount = await mount(cif);
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 2"));

    // The source document closes while a build runs.
    await click(button("Build"));
    const orphaned = lastJob("assembly");
    await act(async () => useMoleculeStore.setState({ documents: [pdb, sdf] }));
    await settle();
    assert.equal(orphaned.aborted, true);
    assert.equal(dialog().querySelector('[role="radio"]'), null, "the closed document's assemblies are gone");
    assert.equal(button("Build").disabled, true);
    assert.deepEqual(opened, []);
  } finally { await unmount(); }

  // The dialog closes while a build runs.
  unmount = await mount(pdb);
  try {
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 1"));
    await click(button("Build"));
    const closed = lastJob("assembly");
    await act(async () => closeWorkbenchDialog());
    await settle();
    assert.equal(closed.aborted, true);
    assert.deepEqual(opened, []);
  } finally { await unmount(); }

  // A listing failure is shown and nothing can be built.
  unmount = await mount(pdb);
  try {
    await fail(lastJob("assemblies"), "This file has no explicit biological assembly definition.");
    assert.equal(alertText(), "This file has no explicit biological assembly definition.");
    assert.equal(button("Build").disabled, true);
  } finally { await unmount(); }
});

test("without a PDB or mmCIF document a chosen file is the source; oversized and unsupported files are refused unread", async () => {
  const unmount = await mount(sdf);
  try {
    assert.equal(jobs.length, 0, "an SDF is not an assembly source");
    assert.equal(dialog().querySelector("p, [data-slot='dialog-description']")?.textContent, "Choose a PDB or mmCIF file");

    let readLarge = false;
    const large = { name: "huge.cif", size: 20_000_001, text: async () => { readLarge = true; return ""; } };
    pickedFiles.push(large);
    await click(button("Choose file…"));
    assert.equal(alertText(), "Biological assemblies are built from PDB or mmCIF files up to 20 MB.");
    assert.equal(readLarge, false, "the oversized file is not read");

    pickedFiles.push(new File(["ligand"], "ligand.sdf"));
    await click(button("Choose file…"));
    assert.equal(alertText(), "Choose a PDB or mmCIF file.");
    assert.equal(jobs.length, 0);

    pickedFiles.push(new File(["data_4hhb\n"], "4hhb.cif"));
    await click(button("Choose file…"));
    assert.equal(alertText(), null);
    assert.deepEqual(lastJob("assemblies").request, { action: "assemblies", text: "data_4hhb\n", format: "cif" });
    await finish(lastJob("assemblies"), { assemblies: [{ id: "1", details: "", copies: 1 }], models: ["1"] });
    assert.equal(radio("Assembly 1").getAttribute("aria-checked"), "true", "the only assembly is the choice");
    await click(button("Build"));
    assert.deepEqual(lastJob("assembly").request, { action: "assembly", text: "data_4hhb\n", format: "cif", assemblyId: "1", modelNumber: "1" });
    await finish(lastJob("assembly"), built({ chainCount: 1, atomCount: 1 }));
    assert.deepEqual(opened.map(({ path, inputExtension }) => [path, inputExtension]), [["4hhb-assembly-1.cif", "cif"]]);
    assert.match(dialog().querySelector(".assembly-outcome").textContent, /^Opened 4hhb-assembly-1\.cif: 1 atom in 1 chain, model 1$/u);
  } finally { await unmount(); }
});

// A picked file whose text arrives only when the test settles it.
const heldFile = (name) => {
  const file = { name, size: 32 };
  const read = new Promise((resolve, reject) => Object.assign(file, { resolve, reject }));
  file.text = () => read;
  return file;
};
const description = () => dialog().querySelector("[data-slot='dialog-description']")?.textContent;
const statusText = () => [...dialog().querySelectorAll('[role="status"]')].map((node) => node.textContent).filter(Boolean).join("|");

test("an accepted file replaces the source before it is read; late, failed, cancelled and closed reads never revive old work", async () => {
  let unmount = await mount(cif);
  try {
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 2"));
    assert.equal(button("Build").disabled, false);

    // While a.cif is read nothing built from 2xyz.cif is offered.
    const a = heldFile("a.cif");
    pickedFiles.push(a);
    await click(button("Choose file…"));
    assert.deepEqual([description(), statusText(), dialog().querySelector('[role="radio"]'), button("Build").disabled],
      ["a.cif", "Reading assemblies", null, true]);
    await click(button("Build"));
    assert.equal(lastJob("assembly"), undefined, "the old source is never built");

    // A newer pick wins over a read still pending; the late text of a.cif is dropped.
    const b = heldFile("b.cif");
    pickedFiles.push(b);
    await click(button("Choose file…"));
    assert.equal(description(), "b.cif");
    await act(async () => a.resolve("data_a\n"));
    await settle();
    assert.equal(jobs.filter((job) => job.request.action === "assemblies").length, 1, "a.cif is never listed");
    await act(async () => b.resolve("data_b\n"));
    await settle();
    assert.deepEqual(lastJob("assemblies").request, { action: "assemblies", text: "data_b\n", format: "cif" });

    // A pick while b.cif is listed drops that listing; its failed read shows only its own error.
    const listingB = lastJob("assemblies");
    const c = heldFile("c.cif");
    pickedFiles.push(c);
    await click(button("Choose file…"));
    assert.equal(listingB.aborted, true);
    await act(async () => c.reject(new Error("Permission denied")));
    await settle();
    assert.deepEqual([description(), alertText(), dialog().querySelector('[role="radio"]'), button("Build").disabled],
      ["c.cif", "c.cif could not be read. Choose the file again.", null, true]);

    // A cancelled picker keeps the read in progress.
    const d = heldFile("d.cif");
    pickedFiles.push(d);
    await click(button("Choose file…"));
    await click(button("Choose file…"));
    assert.deepEqual([description(), alertText(), statusText()], ["d.cif", null, "Reading assemblies"]);
    await act(async () => d.resolve("data_d\n"));
    await settle();
    assert.deepEqual(lastJob("assemblies").request.text, "data_d\n");
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 1"));
    await click(button("Build"));
    assert.deepEqual(lastJob("assembly").request, { action: "assembly", text: "data_d\n", format: "cif", assemblyId: "1", modelNumber: "1" });
  } finally { await unmount(); }

  // The dialog closes while a file is read: its text starts nothing.
  unmount = await mount(cif);
  try {
    await finish(lastJob("assemblies"), listing());
    const e = heldFile("e.cif");
    pickedFiles.push(e);
    await click(button("Choose file…"));
    await act(async () => closeWorkbenchDialog());
    await settle();
    await act(async () => e.resolve("data_e\n"));
    await settle();
    assert.deepEqual([jobs.map((job) => job.request.text), opened], [["data_2xyz\n"], []]);
  } finally { await unmount(); }
});

// The app's own file opening: generated records are prepared by the real browser
// runtime (or the desktop command) and added to the real document store.
const noop = () => {};
function AppOpening() {
  const { openStructureRecords } = useAppFileOpen(new Proxy({
    preferences: { rendererMode: "auto", theme: "light" },
    addDocuments: (documents, options) => useMoleculeStore.getState().addDocuments(documents, options),
  }, { get: (target, key) => (key in target ? target[key] : noop) }));
  return <WorkbenchDialogs actions={{ openStructureRecords }} />;
}
const openIds = () => useMoleculeStore.getState().documents.map((document) => document.id);
const virtualText = (document) => browserDev.readBrowserDevVirtualTextDocument(document.path);
const buildHeld = async (assembly) => {
  preparing = Promise.withResolvers();
  const before = prepared.length;
  await click(button("Build"));
  await finish(lastJob("assembly"), built(assembly));
  assert.equal(prepared.length, before + 1, "the document is being prepared");
  return prepared.at(-1);
};
const release = async () => { await act(async () => preparing.resolve()); await settle(); };

test("a built assembly stays one cancellable build until its CIF is open; dropped while prepared, nothing opens and its text is released", async () => {
  let unmount = await mount(pdb, [pdb, cif, sdf], <AppOpening />);
  try {
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 1"));

    // Success: one busy build until the prepared document is in the store.
    const first = await buildHeld();
    assert.deepEqual([statusText(), button("Build"), !!button("Cancel"), button("Choose file…"), radio("Assembly 2").disabled],
      ["Opening assembly", null, true, null, true], "opening can be cancelled but not started twice");
    assert.equal(openIds().includes(first.id), false, "nothing is added while it is prepared");
    await release();
    assert.deepEqual(openIds(), [pdb.id, cif.id, sdf.id, first.id]);
    assert.equal(virtualText(first), "data_burette_assembly\n");
    assert.match(dialog().querySelector(".assembly-outcome").textContent, /^Opened 1abc-assembly-1\.cif/u);

    // Cancel while prepared: Build is offered at once, the late document is never added,
    // and the open document with the same generated text keeps it.
    await act(async () => setDraft(pdb.id, "HEADER 1ABC DRAFT\n"));
    await settle();
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 1"));
    const same = await buildHeld();
    assert.notEqual(same.path, first.path);
    await click(button("Cancel"));
    assert.deepEqual([statusText(), button("Build").disabled], ["", false]);
    await release();
    assert.equal(virtualText(same), null, "cancelled independent output is released");
    assert.deepEqual([openIds(), virtualText(first), alertText(), dialog().querySelector(".assembly-outcome")],
      [[pdb.id, cif.id, sdf.id, first.id], "data_burette_assembly\n", null, null]);

    const cancelled = await buildHeld({ cif: "data_cancelled\n" });
    await click(button("Cancel"));
    await release();
    assert.deepEqual([openIds().includes(cancelled.id), virtualText(cancelled)], [false, null]);

    // The source text changes while prepared: the new text is listed and the old CIF never opens.
    const changed = await buildHeld({ cif: "data_changed\n" });
    await act(async () => setDraft(pdb.id, "HEADER 1ABC SECOND DRAFT\n"));
    await settle();
    assert.equal(statusText(), "Reading assemblies");
    await release();
    assert.deepEqual([openIds().includes(changed.id), virtualText(changed), alertText(), lastJob("assemblies").request.text],
      [false, null, null, "HEADER 1ABC SECOND DRAFT\n"]);
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 1"));

    // The source closes while prepared.
    const orphaned = await buildHeld({ cif: "data_orphaned\n" });
    await act(async () => useMoleculeStore.setState({ documents: useMoleculeStore.getState().documents.filter(({ id }) => id !== pdb.id) }));
    await settle();
    await release();
    assert.deepEqual([openIds().includes(orphaned.id), virtualText(orphaned)], [false, null]);
  } finally { preparing = null; await unmount(); }

  // The dialog closes while prepared.
  unmount = await mount(pdb, [pdb, cif, sdf], <AppOpening />);
  try {
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 1"));
    const closed = await buildHeld({ cif: "data_closed\n" });
    await act(async () => closeWorkbenchDialog());
    await settle();
    await release();
    assert.deepEqual([openIds(), virtualText(closed)], [[pdb.id, cif.id, sdf.id], null]);
  } finally { preparing = null; await unmount(); }

  // A failed preparation is shown and Build is offered again.
  unmount = await mount(pdb, [pdb, cif, sdf], <AppOpening />);
  try {
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 1"));
    await click(button("Build"));
    await finish(lastJob("assembly"), built({ cif: " \n" }));
    assert.deepEqual([alertText(), button("Build").disabled, openIds()],
      ["The assembly was built but could not be opened.", false, [pdb.id, cif.id, sdf.id]]);
  } finally { await unmount(); }
});

test("on the desktop a dropped generated CIF releases its native source registration and never opens", async () => {
  const unmount = await mount(pdb, [pdb, cif, sdf], <AppOpening />);
  try {
    await finish(lastJob("assemblies"), listing());
    await click(radio("Assembly 1"));
    tauri = true;
    invokes.length = 0;
    nativeOpen = Promise.withResolvers();
    await click(button("Build"));
    await finish(lastJob("assembly"), built());
    assert.deepEqual(invokes.map(([command]) => command), ["open_text_structure"]);
    await click(button("Cancel"));
    await act(async () => nativeOpen.resolve());
    await settle();
    assert.deepEqual(invokes.map(([command, args]) => [command, command === "open_text_structure" ? args.request.title : args]),
      [["open_text_structure", "1abc-assembly-1.cif"], ["close_opened_source_documents", { documentIds: ["native-1"] }]]);
    assert.deepEqual(openIds(), [pdb.id, cif.id, sdf.id]);
  } finally { tauri = false; nativeOpen = null; await unmount(); }
});
