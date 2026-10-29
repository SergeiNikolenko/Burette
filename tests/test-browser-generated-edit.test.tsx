import { expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ShellActions } from "../apps/desktop/src/components/types";
plugin({ name: "generated-edit-compiled-hooks", setup(build) {
  build.onLoad({ filter: /(?:hooks\/use-source-editing|lib\/workbench\/use-graph-draft)\.ts$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "ts",
  }));
} });
const browser = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "localStorage", "CSS"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
}
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });
let native = false;
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native }));
const { createRoot } = await import("react-dom/client");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const preferences = { ...defaultPreferences, rendererMode: "molstar" as const };
const { openGeneratedStructure, openScientificDocument } = await import("../apps/desktop/src/lib/workbench/generated-document-open");
const { openBrowserDevTextDocument, deleteBrowserDevVirtualTextDocument, readBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { structureEditAvailable } = await import("../apps/desktop/src/lib/workbench/graph-draft");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useGraphDraft } = await import("../apps/desktop/src/lib/workbench/use-graph-draft");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const source = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8");
let serial = 0;
const opened: ViewerDocument[] = [];
const actions: Pick<ShellActions, "openStructureRecords"> = { openStructureRecords: async records => {
  const documents = await Promise.all(records.map(record => {
    if (record.text === undefined) throw new Error("Expected generated source text");
    return openBrowserDevTextDocument(record.path, record.inputExtension ?? "sdf", record.text, preferences);
  }));
  opened.push(...documents); useMoleculeStore.getState().addDocuments(documents); return documents;
} };
async function generated() {
  const [document] = await openGeneratedStructure(actions, `new-ethanol-${++serial}`, "sdf", source);
  return document;
}
async function fixture(doc: ViewerDocument) {
  let controller!: ReturnType<typeof useSourceEditingController>, graph!: ReturnType<typeof useGraphDraft>;
  const errors: unknown[] = [], targets: string[] = [];
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Graph() { graph = useGraphDraft(doc); return null; }
  function Fixture() {
    controller = useSourceEditingController({ activeDocument: doc, preferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab(_area, tab) { targets.push(tab); } });
    return <SourceEditingProvider value={controller}><Graph /></SourceEditingProvider>;
  }
  await act(async () => root.render(<Fixture />));
  return { errors, targets, get controller() { return controller; }, get graph() { return graph; }, async close() { await act(async () => root.unmount()); host.remove(); } };
}
async function settle(ready: () => boolean) {
  for (let attempt = 0; attempt < 200 && !ready(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(ready()).toBe(true);
}

test("a real generated SDF opens its owned browser text in Edit and publishes one undoable graph change", async () => {
  const doc = await generated();
  expect([doc.virtual, doc.extension, doc.renderer, readBrowserDevVirtualTextDocument(doc.path)]).toEqual([true, "sdf", "molstar", source]);
  const view = await fixture(doc);
  try {
    await act(async () => view.controller.beginEditing(doc, "structure-edit"));
    expect(view.errors).toEqual([]);
    expect(structureEditAvailable(doc)).toBe(true);
    expect([view.controller.sessionForDocument(doc)?.content, view.controller.sessionForDocument(doc)?.saveLabel, view.targets]).toEqual([source, "Save copy", ["structure-edit"]]);
    await settle(() => Boolean(view.graph.history));
    const before = view.graph.history!.current;
    await act(async () => { await view.graph.apply({ kind: "edits", edits: [{ kind: "set-bond", a: 1, b: 2, order: 2 }] }); });
    expect(view.graph.error).toBeNull();
    const after = view.graph.history!.current;
    expect(after.structure.bonds.find(bond => bond.a === 1 && bond.b === 2)?.order).toBe(2);
    expect(view.controller.sessionForDocument(doc)?.content).toBe(after.text);
    await act(async () => view.graph.undo()); expect(view.controller.sessionForDocument(doc)?.content).toBe(before.text);
    await act(async () => view.graph.redo()); expect(view.controller.sessionForDocument(doc)?.content).toBe(after.text);
    expect(readBrowserDevVirtualTextDocument(doc.path)).toBe(source);
  } finally { await view.close(); deleteBrowserDevVirtualTextDocument(doc.path); }
});

test("owned MOL and SD text drafts use the same graph admission without changing the stored original", async () => {
  for (const extension of ["mol", "sd"] as const) {
    const text = extension === "mol" ? source.replace("$$$$\n", "") : source;
    const doc = await openBrowserDevTextDocument(`own-${++serial}.${extension}`, extension, text, preferences);
    const view = await fixture(doc);
    try {
      expect(structureEditAvailable(doc)).toBe(true);
      await act(async () => view.controller.beginEditing(doc, "structure-edit"));
      expect(view.errors).toEqual([]);
      expect(view.controller.sessionForDocument(doc)?.content).toBe(text);
      expect(readBrowserDevVirtualTextDocument(doc.path)).toBe(text);
    } finally { await view.close(); deleteBrowserDevVirtualTextDocument(doc.path); }
  }
});

test("foreign, expired, native, binary, collection and docking documents do not gain admission from a virtual flag", async () => {
  for (const kind of ["unknown", "external", "expired", "native", "binary", "grid", "merged", "docking", "multiple-records"] as const) {
    const owned = kind === "multiple-records"
      ? await openBrowserDevTextDocument(`multi-${++serial}.sdf`, "sdf", source + source, preferences)
      : await generated();
    if (kind === "multiple-records") {
      expect(owned.renderer).toBe("grid2d");
      expect(readBrowserDevVirtualTextDocument(owned.path)).toBe(source + source);
    }
    // Even a collection subsequently presented as 3D cannot enter the graph editor.
    let doc: ViewerDocument = kind === "multiple-records" ? { ...owned, renderer: "molstar" } : owned;
    if (kind === "unknown") doc = { ...owned, path: "burette-ketcher://unknown/foreign.sdf" };
    if (kind === "external") doc = { ...owned, path: "https://example.invalid/read-only.sdf" };
    if (kind === "expired") deleteBrowserDevVirtualTextDocument(owned.path);
    if (kind === "native") native = true;
    if (kind === "binary") doc = { ...owned, extension: "mrc" };
    if (kind === "grid") doc = { ...owned, renderer: "grid2d" };
    if (kind === "merged") doc = { ...owned, mergedCollection: { sourcePaths: ["a.sdf", "b.sdf"], format: "sdf", suggestedFileName: "merged.sdf" } };
    if (kind === "docking") doc = { ...owned, dockingRequest: { receptorPath: "protein.pdb", ligandPaths: ["ligand.sdf"] } };
    const view = await fixture(doc);
    try {
      expect(structureEditAvailable(doc), kind).toBe(false);
      await act(async () => view.controller.beginEditing(doc, "structure-edit"));
      expect(view.controller.sessionForDocument(doc), kind).toBeNull();
      expect(view.targets, kind).toEqual([]);
      expect(view.errors.length, kind).toBe(1);
      expect(view.errors[0] instanceof Error && view.errors[0].message, kind).toContain("read-only");
    } finally { await view.close(); deleteBrowserDevVirtualTextDocument(owned.path); native = false; }
  }
});

test("the real scientific opener still creates XYZ and does not opt into this graph editing lane", async () => {
  const atoms = [{ element: "C", x: 0, y: 0, z: 0 }];
  const before = opened.length;
  await openScientificDocument(actions, `scientific-${++serial}`, { format: "xyz", atoms, frames: [{ atoms }], modes: [], orbitals: [] }, "final");
  expect(opened.length).toBe(before + 1);
  const doc = opened.at(-1)!;
  const view = await fixture(doc);
  try {
    expect([doc.virtual, doc.extension, structureEditAvailable(doc)]).toEqual([true, "xyz", false]);
    await act(async () => view.controller.beginEditing(doc, "structure-edit"));
    expect(view.controller.sessionForDocument(doc)).toBeNull();
    expect(view.errors.length).toBe(1);
  } finally { await view.close(); deleteBrowserDevVirtualTextDocument(doc.path); }
});

test("ownership removed while the generated runtime is being prepared cannot fall back to an external text read", async () => {
  const doc = await generated();
  const view = await fixture(doc);
  const originalFetch = globalThis.fetch;
  let reads = 0;
  try {
    globalThis.fetch = Object.assign(async () => { reads++; throw new Error("Unexpected external read"); }, { preconnect: originalFetch.preconnect });
    await act(async () => {
      const opening = view.controller.beginEditing(doc, "structure-edit");
      deleteBrowserDevVirtualTextDocument(doc.path);
      await opening;
    });
    expect(view.controller.sessionForDocument(doc)).toBeNull();
    expect(view.targets).toEqual([]);
    expect(reads).toBe(0);
  } finally { globalThis.fetch = originalFetch; await view.close(); deleteBrowserDevVirtualTextDocument(doc.path); }
});

test("ownership must survive the source-read await before publishing a session",async()=>{
 const observed=[];
 for(const ticks of [1,2]){
  const doc=await generated(),view=await fixture(doc);
  try{await act(async()=>{const opening=view.controller.beginEditing(doc,"structure-edit");for(let i=0;i<ticks;i++)await Promise.resolve();deleteBrowserDevVirtualTextDocument(doc.path);await opening;});
  observed.push({ticks,owned:structureEditAvailable(doc),session:!!view.controller.sessionForDocument(doc),targets:view.targets});
  }finally{await view.close();deleteBrowserDevVirtualTextDocument(doc.path);}
 }
 console.log(JSON.stringify({lateCacheRemoval:observed}));
 expect(observed.map(x=>x.session)).toEqual([false,false]);
 expect(observed).toEqual([{ticks:1,owned:false,session:false,targets:[]},{ticks:2,owned:false,session:false,targets:[]}]);
});
