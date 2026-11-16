import { expect, test, afterAll } from "bun:test";
import React, { act } from "react";
import { imported, browser } from "./test-cjson-import.test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { OrderedSet } from "@molstar/core/data/int";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { recordImportedRevision, scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { prepareSceneScienceExport } from "../apps/desktop/src/lib/science-session/export";
import { restoreScienceSession } from "../apps/desktop/src/lib/science-session/restore";
import { sha256Hex } from "../apps/desktop/src/lib/source-editing/source-identity";
import { requestViewerAction } from "../apps/desktop/src/lib/viewer-bridge";
const { createRoot } = await import("react-dom/client");
const { ScientificSpectraDockContent } = await import("../apps/desktop/src/components/workbench/scientific-spectra-dock-content");
const bundle = readFileSync(new URL("../PreviewExtension/Web/molstar.js", import.meta.url), "utf8"), previousMolstar = Object.getOwnPropertyDescriptor(globalThis, "molstar");
vm.runInThisContext(bundle, { filename: "actual-built-molstar.js" });
type Built = typeof import("@molstar/viewer/lib") & typeof import("@molstar/viewer/extensions");
const built = (globalThis as unknown as { molstar: Built }).molstar;
console.log(JSON.stringify({ actualBuiltMolstarSha256: createHash("sha256").update(bundle).digest("hex") }));
const parserInput = built.lib.plugin.PluginStateTransform.BuiltIn({ name: "nmr-parser-input-proof", display: { name: "Parser input" },
  from: built.lib.plugin.PluginStateObject.Data.String, to: built.lib.plugin.PluginStateObject.Data.String })({
  apply({ a }) { if (typeof a.data !== "string") throw new Error("Expected string parser input"); return new built.lib.plugin.PluginStateObject.Data.String(a.data.replace("\nBurette", "\nDerived")); },
});
afterAll(() => { if (previousMolstar) Object.defineProperty(globalThis, "molstar", previousMolstar); else Reflect.deleteProperty(globalThis, "molstar"); });
const runtimeText = (name: string) => readFileSync(new URL("../PreviewExtension/Web/" + name, import.meta.url), "utf8");
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (predicate()) return; }
  throw new Error("CJSON selection did not settle");
}
async function fixture(active = 0, restore = false, parser: "mol" | "sdf" = "mol", derived = false) {
  const original = await imported(active); let documentValue = original.document;
  const plugins: InstanceType<typeof built.lib.plugin.PluginContext>[] = [];
  const makePlugin = async () => { const spec = built.lib.plugin.DefaultPluginSpec(), plugin = new built.lib.plugin.PluginContext({ ...spec, behaviors: [...spec.behaviors, ...Object.values(built.ExtensionMap)] }); plugins.push(plugin); await plugin.init(); return plugin; };
  let plugin = await makePlugin(); const raw = await plugin.builders.data.rawData({ data: original.mol });
  const input = derived ? await plugin.state.data.build().to(raw).apply(parserInput).commit() : raw;
  const trajectory = await plugin.builders.structure.parseTrajectory(input, parser); await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
  const listeners = new Set<(event: unknown) => void>(), scope: Record<string, any> = { molstar: built,
    addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.add(listener), removeEventListener: (_type: string, listener: (event: unknown) => void) => listeners.delete(listener) };
  let gate: Promise<void> | null = null, entered = false;
  const delayed = { subtle: { digest: async (...args: Parameters<SubtleCrypto["digest"]>) => { entered = true; const held = gate; gate = null; await held; return crypto.subtle.digest(...args); } } };
  vm.runInNewContext(runtimeText("scene-file-actions.js"), { window: scope, crypto, TextEncoder, TextDecoder, File, Uint8Array, Float64Array });
  if (restore) {
    const request = async (_id: string, action: Record<string, unknown>) => {
      if (action.type === "workspace_scene_state") return { ready: true };
      if (action.type === "scene_science_binding") return scope.BuretteSceneFiles.science.graphBinding({ plugin }, action.sourceExtension);
      if (action.type === "scene_science_restore_ack") return { adopted: await scope.BuretteSceneFiles.science.adoptValidated({ plugin }, action) };
      throw new Error("Unexpected restore action");
    };
    const prepared = await prepareSceneScienceExport(original.document, { sourceEditing: null, sceneFileCount: 1, isOpen: () => true, request });
    if (prepared?.kind !== "science") throw new Error("No graph scientific export");
    const blob: Blob = await scope.BuretteSceneFiles.science.serialize({ plugin }, prepared.action.science, { type: "molx", params: { camera: false, image: false } }); await prepared.confirm();
    const bytes = new Uint8Array(await blob.arrayBuffer()); plugin.dispose(); plugins.splice(plugins.indexOf(plugin), 1); plugin = await makePlugin();
    const token = scope.BuretteSceneFiles.science.beginImport(plugin); await plugin.managers.snapshot.open(new File([bytes], "nmr.molx")); scope.BuretteSceneFiles.science.completeImport(plugin, token);
    documentValue = { ...original.document, id: original.document.id + "-restored", path: "/nmr.molx", extension: "molx", byteCount: bytes.length } as ViewerDocument;
    expect(await restoreScienceSession(documentValue, { readBytes: async () => bytes, request, isOpen: () => true })).toBe("restored");
  }
  vm.runInNewContext(runtimeText("geometry-preview.js"), { window: scope, crypto: delayed, TextEncoder, Uint8Array, Int32Array });
  const viewer = { plugin }, code = runtimeText("viewer.js"), start = code.indexOf("    if (type === 'select_source_atom') {");
  const execute = new Function("window", "activeMolstarViewer", "let geometryPreviewRequest=0;return async (action,requestOwner)=>{const type=action.type;" + code.slice(start, code.indexOf("    if (type === 'preview_geometry') {", start)) + "};")(scope, () => viewer);
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = documentValue.id; frame.dataset.renderer = "molstar"; document.body.append(frame);
  const source = frame.contentWindow!, sent: { atomIndex: number; frameIndex: number; frameCount: number; sourceSha256: string }[] = [], completed: unknown[] = [];
  source.postMessage = value => {
    if (value.body.type === "agent-action-cancel") { listeners.forEach(listener => listener({ source: window, data: value })); return; }
    sent.push(value.body.action);
    void execute(value.body.action, { id: value.body.id, source: window }).then((result: unknown) => reply(result), (error: Error) => reply({ ok: false, error: { message: error.message } }));
    function reply(result: unknown) { completed.push(result); window.dispatchEvent(new browser.MessageEvent("message", { source: source as never, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: value.body.id, result } } }) as unknown as MessageEvent); }
  };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<ScientificSpectraDockContent document={documentValue} actions={{ saveKetcherExportFile: async () => ({ status: "saved", path: null }) }} />));
  await waitFor(() => host.querySelectorAll("tbody tr").length === 2 && !host.querySelector('[role="status"]'));
  const selected = () => { const structure = plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data, loci = plugin.managers.structure.selection.getLoci(structure);
    return loci.kind === "empty-loci" ? [] : loci.elements.flatMap(element => Array.from(OrderedSet.toArray(element.indices), index => element.unit.model.atomicHierarchy.atomSourceIndex.value(element.unit.elements[index]))); };
  const row = (label: string) => [...host.querySelectorAll<HTMLElement>("tbody tr")].find(row => row.querySelector("th")?.textContent === label)!;
  return { host, root, plugin, raw, document: documentValue, mol: original.mol, sent, completed, selected, row,
    hold: () => { entered = false; let release!: () => void; gate = new Promise<void>(resolve => release = resolve); return { release, entered: () => entered }; },
    close: async () => { await act(async () => root.unmount()); frame.remove(); host.remove(); for (const plugin of plugins) plugin.dispose(); } };
}

test("ordinary CJSON source sets 0/5 use built native MOL frame 0/1 and exact NMR source rows", async () => {
  for (const active of [0, 5]) {
    const f = await fixture(active);
    try {
      const science = scientificStateFor(f.document.id, f.mol).revision!.document;
      expect([science.graph!.activeFrameIndex, science.frames.length]).toEqual([active, 7]);
      const snapshot = f.plugin.state.data.getSnapshot(); f.plugin.managers.interactivity.setProps({ granularity: "chain" });
      await act(async () => f.row("H3").click()); await waitFor(() => f.completed.length === 1); expect(f.selected()).toEqual([2]);
      await act(async () => f.host.querySelector('[role="slider"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
      await waitFor(() => f.completed.length === 2); expect(f.selected()).toEqual([3]);
      const svg = f.host.querySelector("figure svg")!; svg.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, right: 320, top: 0, bottom: 120, width: 320, height: 120, toJSON() {} });
      await act(async () => svg.dispatchEvent(new MouseEvent("click", { clientX: 76, bubbles: true }))); await waitFor(() => f.completed.length === 3); expect(f.selected()).toEqual([2]);
      expect(f.sent.map(({ atomIndex, frameIndex, frameCount }) => ({ atomIndex, frameIndex, frameCount }))).toEqual([{ atomIndex: 2, frameIndex: 0, frameCount: 1 }, { atomIndex: 3, frameIndex: 0, frameCount: 1 }, { atomIndex: 2, frameIndex: 0, frameCount: 1 }]);
      expect(f.sent.every(action => action.sourceSha256 === f.sent[0].sourceSha256)).toBe(true); expect(f.sent[0].sourceSha256).toBe(await sha256Hex(f.mol));
      expect(f.plugin.state.data.getSnapshot()).toEqual(snapshot); expect(f.host.querySelector('[role="alert"]')?.textContent ?? null).toBeNull();
      await act(async () => f.root.render(null));
      await act(async () => f.root.render(<ScientificSpectraDockContent document={f.document} actions={{ saveKetcherExportFile: async () => ({ status: "saved", path: null }) }} />));
      await waitFor(() => Boolean(f.host.querySelector('tr[aria-selected="true"]'))); expect(f.sent).toHaveLength(3); expect(f.selected()).toEqual([2]);
    } finally { await f.close(); }
  }
});

test("ordinary CJSON scientific MOLX restore selects the same source atom through the built runtime", async () => {
  const f = await fixture(5, true);
  try {
    const science = scientificStateFor(f.document.id, f.mol).revision!.document;
    expect([science.graph!.molfile, science.graph!.activeFrameIndex, science.frames.length]).toEqual([f.mol, 5, 7]);
    await act(async () => f.row("H4").click()); await waitFor(() => f.completed.length === 1); expect(f.selected()).toEqual([3]);
    expect(f.host.querySelector('[role="alert"]')?.textContent ?? null).toBeNull();
  } finally { await f.close(); }
});

test("built MOL selection cancels native/source ABA, close, newer row and request timeout", async () => {
  for (const change of ["native-undo", "source-rollback", "close", "new-row", "timeout"]) {
    const f = await fixture(5);
    try {
      await act(async () => f.row("H3").click()); await waitFor(() => f.completed.length === 1);
      const held = f.hold(); let expected = f.selected();
      try {
        const timed = change === "timeout" ? requestViewerAction(f.document.id, { type: "select_source_atom", sourceSha256: await sha256Hex(f.mol), atomIndex: 3, frameIndex: 0, frameCount: 1 }, 10).catch(error => error.message as string) : null;
        if (!timed) await act(async () => f.row("H4").click()); await waitFor(held.entered);
        if (change === "native-undo") { await f.plugin.state.data.build().to(f.raw).update({ data: f.mol.replace("\nBurette", "\nChanged") }).commit({ canUndo: "Source edit" }); await f.plugin.runTask(f.plugin.state.data.undo()); expected = f.selected(); }
        else if (change === "source-rollback") await act(async () => { const science = scientificStateFor(f.document.id, f.mol).revision!.document; const rollback = recordImportedRevision(f.document.id, f.mol, { text: f.mol, document: { ...science } }); if (!rollback) throw new Error("No source"); rollback(); });
        else if (change === "close") await act(async () => f.root.render(null));
        else if (change === "new-row") { await act(async () => f.row("H3").click()); await waitFor(() => f.completed.length === 2); }
        else expect(await timed).toContain("did not respond");
        held.release(); await waitFor(() => f.completed.length === (change === "new-row" ? 3 : 2)); expect(f.selected()).toEqual(expected); expect({ change, error: f.host.querySelector('[role="alert"]')?.textContent ?? null }).toEqual({ change, error: change === "native-undo" ? "The spectrum source or selection changed." : null });
      } finally { held.release(); }
    } finally { await f.close(); }
  }
});

test("same-geometry changed MOL text and a different native parser do not gain source authority", async () => {
  for (const parser of ["mol", "sdf"] as const) {
    const f = await fixture(0, false, parser);
    try {
      if (parser === "mol") await f.plugin.state.data.build().to(f.raw).update({ data: f.mol.replace("\nBurette", "\nChanged") }).commit();
      const before = f.selected(); await act(async () => f.row("H4").click()); await waitFor(() => f.completed.length === 1);
      expect(f.selected()).toEqual(before); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain(parser === "mol" ? "differs" : "source frame");
    } finally { await f.close(); }
  }
});

test("MOL identity hashes the exact parser input rather than an upstream RawData ancestor", async () => {
  const f = await fixture(0, false, "mol", true);
  try {
    await act(async () => f.row("H4").click()); await waitFor(() => f.completed.length === 1);
    expect(f.selected()).toEqual([]); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("differs");
    await requestViewerAction(f.document.id, { type: "select_source_atom", sourceSha256: await sha256Hex(f.mol.replace("\nBurette", "\nDerived")), atomIndex: 3, frameIndex: 0, frameCount: 1 });
    expect(f.selected()).toEqual([3]);
    for (const [atomIndex, frameIndex, frameCount, message] of [[3, 5, 7, "source frame"], [4, 0, 1, "unique"]] as const) {
      await expect(requestViewerAction(f.document.id, { type: "select_source_atom", sourceSha256: await sha256Hex(f.mol.replace("\nBurette", "\nDerived")), atomIndex, frameIndex, frameCount })).rejects.toThrow(message);
      expect(f.selected()).toEqual([3]);
    }
  } finally { await f.close(); }
});
