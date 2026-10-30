import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { zipSync, strToU8 } from "../apps/desktop/node_modules/fflate";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { GraphAdvancedCompute } from "../apps/desktop/src/lib/workbench/use-graph-draft";
import type { SourceEditingContextValue, SourceEditingView } from "../apps/desktop/src/lib/source-editing/context";
import { encodeScienceSession, decodeScienceSession, type EncodedScienceSession } from "../apps/desktop/src/lib/science-session/codec";
import { adoptLogicalSource, graphAtomIds, releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
plugin({ name: "mol-identity-compiler", setup(build) { build.onLoad({ filter: /(?:hooks\/use-source-editing|lib\/workbench\/use-graph-draft)\.ts$/u }, ({ path }) => ({ contents: transformSync(readFileSync(path, "utf8"), {
  filename: path, babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]],
})!.code!, loader: "ts" })); } });
const browser = new Window({ url: "http://localhost/" });
const globals = ["window", "document", "navigator", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "MessageEvent", "CustomEvent", "MutationObserver", "localStorage", "CSS", "IS_REACT_ACT_ENVIRONMENT"] as const;
const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : key === "IS_REACT_ACT_ENVIRONMENT" ? true : browser[key] });
afterAll(async () => { releaseClosedScienceSessions(new Set()); await browser.happyDOM.close(); for (const key of globals) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
let native = false;
const calls: { command: string; body: Record<string, unknown> }[] = [];
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native, trackTauriListener: () => () => {} }));
const nativeCore = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...nativeCore, invoke: async (command: string, body: Record<string, unknown>) => { calls.push({ command, body }); if (command === "open_text_structure") return { id: "staged-mol", runtimePath: "native staged MOL" }; throw new Error(`Unexpected native call ${command}`); } }));
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useGraphDraft } = await import("../apps/desktop/src/lib/workbench/use-graph-draft");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const source = "\uFEFF" + ["MOL identities", "Burette", "", "  0  0  0     0  0            999 V3000", "M  V30 BEGIN CTAB", "M  V30 COUNTS 4 3 0 0 0", "M  V30 BEGIN ATOM",
  "M  V30 1 C 0 0 0 0", "M  V30 2 H -1 0 0 0", "M  V30 3 C 1 0 0 0", "M  V30 4 O 2 0 0 0 CHG=-1", "M  V30 END ATOM", "M  V30 BEGIN BOND",
  "M  V30 1 1 1 2", "M  V30 2 2 1 3", "M  V30 3 1 3 4", "M  V30 END BOND", "M  V30 END CTAB", "M  END", ""].join("\r\n");
let serial = 0;
const until = async (ready: () => boolean) => { for (let i = 0; i < 200 && !ready(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(ready()).toBe(true); };
function archive(encoded: EncodedScienceSession) { return zipSync({ "state.json": strToU8("{}"), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id }]))), ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) }); }
async function fixture(ids: readonly string[] | null = Array.from({ length: 4 }, () => crypto.randomUUID()), advanced?: GraphAdvancedCompute) {
  const doc: ViewerDocument = { id: `mol-identity-${++serial}`, path: `/Scenes/mol-${serial}.molx`, title: "Molecule.molx", extension: "molx", renderer: "molstar", runtimePath: "scene", byteCount: 1 };
  adoptLogicalSource({ documentId: doc.id, extension: "mol", text: source }, crypto.randomUUID(), ids, ["C", "H", "C", "O"]);
  let session: SourceEditingView = { sessionId: crypto.randomUUID(), documentId: doc.id, path: doc.path, content: source, baseContent: source, editable: true, dirty: false, saving: false, status: "", diagnostic: null, previewMode: "manual", saveDisabledReason: null, sourcePreview: null };
  let writes = 0, ignore = false, live!: ReturnType<typeof useGraphDraft>;
  const context: SourceEditingContextValue = { sessionForDocument: () => session, captureOperation: () => ({ isCurrent: () => true, release() {} }), beginEditing() {}, updateDraft(_doc, content) { if (!ignore) { writes++; session = { ...session, content, dirty: true }; } }, applyPreview() {}, save() {}, stagingLoaded() {}, closeDocuments: async () => true, confirmCloseWindow: async () => true, getWindowDirtySnapshot: () => ({ dirty: false, revision: 0, closeTransitionActive: false }), hasUnsavedOrSavingSessions: false };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Probe() { live = useGraphDraft(doc, advanced); return null; }
  const render = () => root.render(<SourceEditingProvider value={context}><Probe /></SourceEditingProvider>);
  await act(async () => render()); await until(() => Boolean(live.history));
  return { doc, ids, get graph() { return live; }, get session() { return session; }, get writes() { return writes; }, ignore() { ignore = true; }, async external(text: string) { session = { ...session, content: text }; await act(async () => render()); }, async close() { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); } };
}

test("compiled MOL graph edits map real worker provenance; Undo/Redo and codec reopen retain each snapshot's ids", async () => {
  const view = await fixture();
  try {
    const first = view.graph.history!.current;
    expect(first.atomIds).toEqual(view.ids); expect(first.structure.atoms.map(atom => atom.element)).toEqual(["C", "H", "C", "O"]);
    await act(async () => { await view.graph.apply({ kind: "edits", edits: [{ kind: "add-atom", element: "Na", position: [4, 0, 0] }, { kind: "delete-atoms", indices: [1] }, { kind: "reorder-atoms", order: [3, 0, 1, 2] }] }); });
    const next = view.graph.history!.current, ids = next.atomIds!;
    expect(next.structure.sourceAtomIndices).toEqual([-1, 0, 2, 3]); expect(ids.slice(1)).toEqual([view.ids![0], view.ids![2], view.ids![3]]); expect(view.ids).not.toContain(ids[0]);
    expect(next.annotations.map(atom => atom.charge)).toEqual([0, 0, 0, -1]); expect(next.structure.bonds.map(bond => bond.order).sort()).toEqual([1, 2]);
    expect(next.metadata).toBeNull(); expect(next.text).not.toMatch(/\$\$\$\$|BURETTE_METADATA/u); expect(graphAtomIds(view.doc.id, next.text, 4)).toEqual(ids);
    for (const snapshot of [first, next]) {
      const encoded = await encodeScienceSession({ documentUuid: crypto.randomUUID(), source: { extension: "mol", text: snapshot.text }, atomIds: snapshot.atomIds, binding: { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: snapshot.structure.atoms.length }, science: null, original: { name: "original.mol", file: new Blob([source]) } });
      const decoded = (await decodeScienceSession(archive(encoded)))!; expect(decoded.source.text).toBe(snapshot.text); expect(decoded.atomIds).toEqual(snapshot.atomIds);
    }
    await act(async () => view.graph.undo()); expect(view.graph.history!.current).toBe(first); expect(view.session.content).toBe(source); expect(graphAtomIds(view.doc.id, source, 4)).toEqual(first.atomIds);
    await act(async () => view.graph.redo()); expect(view.graph.history!.current).toBe(next); expect(graphAtomIds(view.doc.id, next.text, 4)).toEqual(ids);
  } finally { await view.close(); }
});

test("MOL hydrogen removal and coordinate-only edits keep exact surviving identities", async () => {
  const view = await fixture();
  try {
    await act(async () => { await view.graph.apply({ kind: "remove-hydrogens" }); });
    expect(view.graph.history!.current.atomIds).toEqual([view.ids![0], view.ids![2], view.ids![3]]);
    const current = view.graph.history!.current;
    await act(async () => { await view.graph.apply({ kind: "positions", from: current, coordinates: current.structure.atoms.map(atom => [atom.x + 0.25, atom.y, atom.z]) }); });
    expect(view.graph.history!.current.atomIds).toEqual(current.atomIds); expect(view.graph.error).toBeNull();
  } finally { await view.close(); }
});

test("an ignored MOL draft write cannot publish computed ids or an Undo step", async () => {
  const view = await fixture();
  try {
    const first = view.graph.history!.current; view.ignore();
    await act(async () => { expect(await view.graph.apply({ kind: "edits", edits: [{ kind: "reorder-atoms", order: [3, 2, 1, 0] }] })).toBeNull(); });
    expect(view.graph.history!.current).toBe(first); expect(view.writes).toBe(0); expect(graphAtomIds(view.doc.id, source, 4)).toEqual(view.ids);
  } finally { await view.close(); }
});

test("external same-element source mutation during a pending edit cannot adopt mapped ids", async () => {
  const view = await fixture(); let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    let pending!: ReturnType<typeof view.graph.apply>;
    await act(async () => { pending = view.graph.apply({ kind: "edits", edits: [{ kind: "reorder-atoms", order: [3, 2, 1, 0] }] }, { validateBeforeWrite: async () => { entered = true; await gate; } }); });
    await until(() => entered); const external = source.replace("M  V30 2 2 1 3", "M  V30 2 1 1 3"); await view.external(external);
    await act(async () => { release(); expect(await pending).toBeNull(); }); await until(() => view.graph.history!.current.text === external);
    expect(view.writes).toBe(0); expect(view.session.content).toBe(external); expect(view.graph.history!.current.atomIds).toBeNull(); expect(graphAtomIds(view.doc.id, source, 4)).toEqual(view.ids);
  } finally { release(); await view.close(); }
});

test("restored unknown MOL identities remain unknown after mapped edits and Undo", async () => {
  const view = await fixture(null);
  try {
    expect(view.graph.history!.current.atomIds).toBeNull();
    await act(async () => { await view.graph.apply({ kind: "remove-hydrogens" }); }); expect(view.graph.history!.current.atomIds).toBeNull();
    await act(async () => view.graph.undo()); expect(graphAtomIds(view.doc.id, source, 4)).toBeNull();
  } finally { await view.close(); }
});

test("the actual source controller stages a restored logical MOL using MOL title and extension", async () => {
  native = true; const doc: ViewerDocument = { id: "mol-controller", path: "/Scenes/molecule.molx", title: "Molecule.MOLX", extension: "molx", renderer: "molstar", runtimePath: "scene", byteCount: 1 };
  adoptLogicalSource({ documentId: doc.id, extension: "mol", text: source }, crypto.randomUUID(), null, ["C", "H", "C", "O"]);
  let controller!: ReturnType<typeof useSourceEditingController>;
  const errors: unknown[] = [], host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Probe() { controller = useSourceEditingController({ activeDocument: doc, preferences: { ...defaultPreferences, rendererMode: "molstar" }, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return null; }
  try {
    await act(async () => root.render(<Probe />)); await act(async () => controller.beginEditing(doc));
    const changed = source.replace("M  V30 2 2 1 3", "M  V30 2 1 1 3"); await act(async () => controller.updateDraft(doc, changed));
    await act(async () => controller.applyPreview(doc));
    expect(errors).toEqual([]); expect(calls.map(call => ({ command: call.command, request: call.body.request }))).toEqual([{ command: "open_text_structure", request: { title: "Molecule.mol", extension: "mol", text: changed } }]);
  } finally { await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); native = false; }
});


test("replacing restored MOL identities during a pending byte-identical source edit rejects the old operation", async () => {
  const view = await fixture(); let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    let pending!: ReturnType<typeof view.graph.apply>;
    await act(async () => { pending = view.graph.apply({ kind: "edits", edits: [{ kind: "reorder-atoms", order: [3, 2, 1, 0] }] }, { validateBeforeWrite: async () => { entered = true; await gate; } }); });
    await until(() => entered); const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    await act(async () => adoptLogicalSource({ documentId: view.doc.id, extension: "mol", text: source }, crypto.randomUUID(), ids, ["C", "H", "C", "O"]));
    await act(async () => { release(); expect(await pending).toBeNull(); }); await until(() => view.graph.history?.current.atomIds === ids);
    expect(view.writes).toBe(0); expect(view.session.content).toBe(source); expect(graphAtomIds(view.doc.id, source, 4)).toEqual(ids);
  } finally { release(); await view.close(); }
});


test("MOL edits with duplicate, invalid or incomplete provenance reject before identity publication", async () => {
  for (const ids of [undefined, null]) for (const mapping of [[0, 1, 2, 2], [0, 1, 2, 9], [-2, 1, 2, 3], [0, 1.5, 2, 3], [0, 2]]) {
    const view = await fixture(ids, async (_operation, structure) => ({ structure: { ...structure, sourceAtomIndices: mapping }, outcome: null }));
    try {
      const first = view.graph.history!.current;
      await act(async () => { expect(await view.graph.apply({ kind: "add-hydrogens" })).toBeNull(); });
      expect(view.writes).toBe(0); expect(view.graph.history!.current).toBe(first); expect(graphAtomIds(view.doc.id, source, 4)).toEqual(view.ids);
    } finally { await view.close(); }
  }
});


test("independent: byte-identical restored replacement with unknown ids rejects the old pending edit", async () => {
  const view = await fixture(null); let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    let pending!: ReturnType<typeof view.graph.apply>;
    await act(async () => { pending = view.graph.apply({ kind: "edits", edits: [{ kind: "reorder-atoms", order: [3, 2, 1, 0] }] }, { validateBeforeWrite: async () => { entered = true; await gate; } }); });
    await until(() => entered);
    await act(async () => adoptLogicalSource({ documentId: view.doc.id, extension: "mol", text: source }, crypto.randomUUID(), null, ["C", "H", "C", "O"]));
    await act(async () => { release(); expect(await pending).toBeNull(); });
    expect(view.writes).toBe(0); expect(view.session.content).toBe(source);
  } finally { release(); await view.close(); }
});


test("independent actual controller: null-id MOL replacement revokes the held previous draft operation", async () => {
  native = false;
  const doc: ViewerDocument = { id: "independent-real-mol-replacement", path: "/Scenes/real-replacement.molx", title: "real-replacement.molx", extension: "molx", renderer: "molstar", runtimePath: "scene", byteCount: 1 };
  adoptLogicalSource({ documentId: doc.id, extension: "mol", text: source }, crypto.randomUUID(), null, ["C", "H", "C", "O"]);
  let controller!: ReturnType<typeof useSourceEditingController>, graph!: ReturnType<typeof useGraphDraft>;
  let release!: () => void, entered = false;
  const errors: unknown[] = [], gate = new Promise<void>(resolve => { release = resolve; });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Graph() { graph = useGraphDraft(doc); return null; }
  function Controller() { controller = useSourceEditingController({ activeDocument: doc, preferences: { ...defaultPreferences, rendererMode: "molstar" }, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} }); return <SourceEditingProvider value={controller}><Graph /></SourceEditingProvider>; }
  try {
    await act(async () => root.render(<Controller />)); await until(() => Boolean(graph.history));
    await act(async () => controller.beginEditing(doc));
    const previousSession = controller.sessionForDocument(doc);
    let pending!: ReturnType<typeof graph.apply>;
    await act(async () => { pending = graph.apply({ kind: "edits", edits: [{ kind: "reorder-atoms", order: [3, 2, 1, 0] }] }, { validateBeforeWrite: async () => { entered = true; await gate; } }); });
    await until(() => entered);
    await act(async () => adoptLogicalSource({ documentId: doc.id, extension: "mol", text: source }, crypto.randomUUID(), null, ["C", "H", "C", "O"]));
    await act(async () => { release(); expect(await pending).toBeNull(); });
    expect(previousSession?.content).toBe(source);
    expect(controller.sessionForDocument(doc)).toBeNull();
    expect(controller.getWindowDirtySnapshot().dirty).toBe(false);
    await act(async () => controller.beginEditing(doc));
    const replacementSession = controller.sessionForDocument(doc);
    expect(replacementSession?.content).toBe(source);
    expect(replacementSession?.sessionId).not.toBe(previousSession?.sessionId);
    expect(errors).toEqual([]);
  } finally { release(); await act(async () => root.unmount()); host.remove(); releaseClosedScienceSessions(new Set()); }
});


test("independent: unknown ids replacement cannot retain the previous source Undo history", async () => {
  const view = await fixture(null);
  try {
    await act(async () => { await view.graph.apply({ kind: "remove-hydrogens" }); });
    const replacementText = view.session.content;
    await act(async () => adoptLogicalSource({ documentId: view.doc.id, extension: "mol", text: replacementText }, crypto.randomUUID(), null, ["C", "C", "O"]));
    await act(async () => view.graph.undo());
    expect(view.session.content).toBe(replacementText);
  } finally { await view.close(); }
});

test("independent: unknown ids still reject malformed worker provenance before a source write", async () => {
  const view = await fixture(null, async (_operation, structure) => ({ structure: { ...structure, sourceAtomIndices: [0, 1, 2, 2] }, outcome: null }));
  try {
    await act(async () => { expect(await view.graph.apply({ kind: "add-hydrogens" })).toBeNull(); });
    expect(view.writes).toBe(0); expect(view.session.content).toBe(source);
  } finally { await view.close(); }
});


test("re-adopting the same MOL source object, UUID, bytes and null ids still revokes pending work", async () => {
  const view = await fixture(null); let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const incoming = { documentId: view.doc.id, extension: "mol" as const, text: source }, uuid = crypto.randomUUID();
  try {
    const previous = view.graph.history!.current;
    await act(async () => adoptLogicalSource(incoming, uuid, null, ["C", "H", "C", "O"]));
    await until(() => Boolean(view.graph.history && view.graph.history.current !== previous));
    let pending!: ReturnType<typeof view.graph.apply>;
    await act(async () => { pending = view.graph.apply({ kind: "edits", edits: [{ kind: "reorder-atoms", order: [3, 2, 1, 0] }] }, { validateBeforeWrite: async () => { entered = true; await gate; } }); });
    await until(() => entered);
    await act(async () => adoptLogicalSource(incoming, uuid, null, ["C", "H", "C", "O"]));
    await act(async () => { release(); expect(await pending).toBeNull(); });
    expect(view.writes).toBe(0); expect(view.session.content).toBe(source);
  } finally { release(); await view.close(); }
});
