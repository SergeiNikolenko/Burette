import { plugin as installPlugin } from "bun";
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";
import { molstarStatePreconditionPlugin } from "../scripts/molstar-state-precondition.mjs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { serializeXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
installPlugin(molstarStatePreconditionPlugin);
const dom = new Window(), previous = Object.getOwnPropertyDescriptor(globalThis, "document");
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
const { StateTransforms } = await import("molstar/lib/mol-plugin-state/transforms.js");
const { StructureElement } = await import("molstar/lib/mol-model/structure.js");
const { OrderedSet } = await import("molstar/lib/mol-data/int.js");
const { BuretteGeometry } = await import("../scripts/molstar-geometry.js");
afterAll(async () => { await dom.happyDOM.close(); if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
const source = "4\nowned-source\nC 0 0 0\nO 1 0 0\nH 0 1 0\nH 0 0 1\n";
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), value => value.toString(16).padStart(2, "0")).join("");
async function fixture(text = source, options: { crypto?: Pick<Crypto, "subtle">; loading?: Promise<void> } = {}) {
  const plugin = new PluginContext({ actions: [], behaviors: [] }); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text }), trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
  const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model);
  const viewer = { plugin }; let active = viewer;
  const listeners = new Set<(event: unknown) => void>();
  const scope: any = { addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.add(listener), removeEventListener: (_type: string, listener: (event: unknown) => void) => listeners.delete(listener), molstar: { BuretteGeometry, lib: { plugin: { StateTransforms }, structure: { StructureElement } } } };
  vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/geometry-preview.js", import.meta.url), "utf8"), { window: scope, crypto: options.crypto ?? crypto, TextEncoder, Uint8Array, Int32Array });
  const helper = scope.BuretteGeometryPreview; if (options.loading) scope.BuretteGeometryPreview = undefined;
  const sourceCode = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
  const start = sourceCode.indexOf("    if (type === 'select_source_atom') {");
  if (start < 0) throw new Error("Missing source atom selection branch");
  const execute = new Function("window", "activeMolstarViewer", "loadScript", "runtimeURL", `let geometryPreviewRequest=0,geometryPreviewLoading=null;return async (action, requestOwner)=>{const type=action.type;${sourceCode.slice(start,sourceCode.indexOf("    if (type === 'preview_geometry') {",start))}};`)(scope, () => active, async () => { await options.loading; scope.BuretteGeometryPreview = helper; }, (_key: string, fallback: string) => fallback);
  const selected = () => {
    const structure = plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data, loci = plugin.managers.structure.selection.getLoci(structure);
    return loci.kind === "empty-loci" ? [] : loci.elements.flatMap(element => Array.from(OrderedSet.toArray(element.indices), index => element.unit.model.atomicHierarchy.atomSourceIndex.value(element.unit.elements[index])));
  };
  const action = async (atomIndex: number, frameIndex = 0, frameCount = 1, sourceText = text) => ({ type: "select_source_atom", sourceSha256: await digest(sourceText), frameIndex, frameCount, atomIndex });
  return { plugin, raw, model, execute, selected, action, cancel: (id: string, from: object) => listeners.forEach(listener => listener({ source: from, data: { source: "burette-agent-host", body: { type: "agent-action-cancel", id } } })), replaceViewer: () => { active = { plugin }; }, close: () => plugin.dispose() };
}

test("actual NMR source row selects exactly its source atom without changing geometry, camera or Undo", async () => {
  const science = parseScientificFile("nmr.out", readFileSync(new URL("./fixtures/quantum/spectra-orca-nmr.out", import.meta.url), "utf8"));
  const text = serializeXyz(science.atoms, "nmr-import-token"), view = await fixture(text);
  try {
    const before = view.plugin.state.data.getSnapshot(); view.plugin.managers.interactivity.setProps({ granularity: "chain" });
    expect(await view.execute(await view.action(3))).toEqual({ ok: true, result: { atomIndex: 3, frameIndex: 0 } });
    expect(view.selected()).toEqual([3]);
    expect(await view.execute(await view.action(1))).toEqual({ ok: true, result: { atomIndex: 1, frameIndex: 0 } });
    expect(view.selected()).toEqual([1]);
    expect(view.plugin.state.data.getSnapshot()).toEqual(before); expect(view.plugin.state.data.canUndo).toBe(false);
  } finally { view.close(); }
});

test("same geometry in another source or another trajectory frame never authorizes selection", async () => {
  const text = source + source.replace("owned-source", "frame-two"), view = await fixture(text);
  try {
    await view.execute(await view.action(2, 0, 2)); expect(view.selected()).toEqual([2]);
    await expect(view.execute(await view.action(3, 0, 2, text.replace("owned-source", "foreign-source")))).rejects.toThrow("differs");
    expect(view.selected()).toEqual([2]);
    await view.plugin.state.data.build().to(view.model).update({ modelIndex: 1 }).commit();
    await expect(view.execute(await view.action(3, 0, 2))).rejects.toThrow("source frame");
    await view.execute(await view.action(3, 1, 2)); expect(view.selected()).toEqual([3]);
    await expect(view.execute(await view.action(4, 1, 2))).rejects.toThrow("unique"); expect(view.selected()).toEqual([3]);
  } finally { view.close(); }
});

test("native Geometry editing invalidates original source text and explicit current Geometry remains selectable", async () => {
  const view = await fixture();
  try {
    const original = await view.action(0), token = BuretteGeometry.capture(view.plugin);
    const edited = source.replace("H 0 0 1", "H 0 0 2"); await BuretteGeometry.update(view.plugin, edited, token);
    await expect(view.execute(original)).rejects.toThrow("differs"); expect(view.selected()).toEqual([]);
    await view.execute(await view.action(3, 0, 1, edited)); expect(view.selected()).toEqual([3]);
  } finally { view.close(); }
});

test("native source edit/Undo during digest rejects the old request even after original bytes return", async () => {
  let release!: () => void, entered!: () => void, held = false;
  const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => entered = resolve);
  const delayed = { subtle: { digest: async (...args: Parameters<SubtleCrypto["digest"]>) => { if (!held) { held = true; entered(); await gate; } return crypto.subtle.digest(...args); } } as SubtleCrypto };
  const view = await fixture(source, { crypto: delayed });
  try {
    const pending = view.execute(await view.action(3)).then(() => "selected", (error: Error) => error.name); await started;
    await view.plugin.state.data.build().to(view.raw).update({ data: source.replace("owned-source", "other-source") }).commit({ canUndo: "Native source edit" });
    await view.plugin.runTask(view.plugin.state.data.undo()); const restored = view.plugin.state.data.getSnapshot();
    release(); expect(await pending).toBe("AbortError"); expect(view.selected()).toEqual([]); expect(view.plugin.state.data.getSnapshot()).toEqual(restored);
  } finally { release(); view.close(); }
});

test("newer row gesture and native user selection win over an older digest", async () => {
  for (const nativeSelection of [false, true]) {
    let release!: () => void, entered!: () => void, held = false;
    const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => entered = resolve);
    const delayed = { subtle: { digest: async (...args: Parameters<SubtleCrypto["digest"]>) => { if (!held) { held = true; entered(); await gate; } return crypto.subtle.digest(...args); } } as SubtleCrypto };
    const view = await fixture(source, { crypto: delayed });
    try {
      const old = view.execute(await view.action(3)).then(() => "selected", (error: Error) => error.name); await started;
      if (nativeSelection) {
        const structure = view.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data, unit = structure.units[0];
        view.plugin.managers.interactivity.lociSelects.selectOnly({ loci: StructureElement.Loci(structure, [{ unit, indices: OrderedSet.ofSingleton(1 as import("molstar/lib/mol-model/structure/structure/element/util.js").UnitIndex) }]) }, false);
      } else await view.execute(await view.action(1));
      release(); expect(await old).toBe("AbortError"); expect(view.selected()).toEqual([1]);
    } finally { release(); view.close(); }
  }
});

test("source or viewer replacement before lazy helper load cannot select anything", async () => {
  for (const replacement of ["source", "viewer"]) {
    let release!: () => void; const loading = new Promise<void>(resolve => release = resolve), view = await fixture(source, { loading });
    try {
      const pending = view.execute(await view.action(3)).then(() => "selected", (error: Error) => error.name);
      if (replacement === "source") await view.plugin.state.data.build().to(view.raw).update({ data: source.replace("owned-source", "replacement") }).commit();
      else view.replaceViewer();
      release(); expect(await pending).toBe("AbortError"); expect(view.selected()).toEqual([]);
    } finally { release(); view.close(); }
  }
});


test("host cancellation revokes only the exact pending request and sending window", async () => {
  for (const cancel of ["matching", "other-id", "other-window"]) {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => entered = resolve);
    const delayed = { subtle: { digest: async (...args: Parameters<SubtleCrypto["digest"]>) => { entered(); await gate; return crypto.subtle.digest(...args); } } as SubtleCrypto };
    const view = await fixture(source, { crypto: delayed }), sender = {};
    try {
      const pending = view.execute(await view.action(3), { id: "owned", source: sender }).then(() => "selected", (error: Error) => error.name); await started;
      view.cancel(cancel === "other-id" ? "other" : "owned", cancel === "other-window" ? {} : sender);
      release(); expect(await pending).toBe(cancel === "matching" ? "AbortError" : "selected");
      expect(view.selected()).toEqual(cancel === "matching" ? [] : [3]);
    } finally { release(); view.close(); }
  }
});
