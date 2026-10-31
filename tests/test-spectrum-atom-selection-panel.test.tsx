import { plugin as installPlugin } from "bun";
import { test, expect, React, act, createRoot, browser, doc } from "./geometry-foundation-fixture";
import { afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { molstarStatePreconditionPlugin } from "../scripts/molstar-state-precondition.mjs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { serializeXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { adoptLogicalSource, releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
import { addDocumentInternalCoordinates, recordImportedRevision, releaseClosedImports } from "../apps/desktop/src/lib/workbench/scientific-source-state";
installPlugin(molstarStatePreconditionPlugin);
Object.assign(browser, { setImmediate, clearImmediate });
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
const { StateTransforms } = await import("molstar/lib/mol-plugin-state/transforms.js");
const { StructureElement } = await import("molstar/lib/mol-model/structure.js");
const { OrderedSet } = await import("molstar/lib/mol-data/int.js");
const { BuretteGeometry } = await import("../scripts/molstar-geometry.js");
const { ScientificSpectraDockContent } = await import("../apps/desktop/src/components/workbench/scientific-spectra-dock-content");
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ HTMLSelectElement: browser.HTMLSelectElement, HTMLButtonElement: browser.HTMLButtonElement, HTMLFormElement: browser.HTMLFormElement, DocumentFragment: browser.DocumentFragment, SVGElement: browser.SVGElement, MouseEvent: browser.MouseEvent,
  KeyboardEvent: browser.KeyboardEvent, MessageEvent: browser.MessageEvent,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterAll(() => { for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (predicate()) return; }
  throw new Error("Selection did not settle");
}
async function fixture() {
  const current = doc(), science = parseScientificFile("nmr.out", readFileSync(new URL("./fixtures/quantum/spectra-orca-nmr.out", import.meta.url), "utf8"));
  const text = serializeXyz(science.atoms, current.id);
  adoptLogicalSource({ documentId: current.id, extension: "xyz", text }, "nmr-science", null, science.atoms.map(atom => atom.element));
  addDocumentInternalCoordinates(current.id, text, science);
  const plugin = new PluginContext({ actions: [], behaviors: [] }); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text }), trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
  const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model);
  let gate: Promise<void> | null = null, entered = false;
  const listeners = new Set<(event: unknown) => void>();
  const scope = { molstar: { BuretteGeometry, lib: { plugin: { StateTransforms }, structure: { StructureElement } } },
    addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.add(listener), removeEventListener: (_type: string, listener: (event: unknown) => void) => listeners.delete(listener) };
  const delayed = { subtle: { digest: async (...args: Parameters<SubtleCrypto["digest"]>) => { entered = true; const held = gate; gate = null; await held; return crypto.subtle.digest(...args); } } };
  vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/geometry-preview.js", import.meta.url), "utf8"), { window: scope, crypto: delayed, TextEncoder, Uint8Array, Int32Array });
  const viewer = { plugin }, code = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8"), start = code.indexOf("    if (type === 'select_source_atom') {");
  const execute = new Function("window", "activeMolstarViewer", `let geometryPreviewRequest=0;return async (action,requestOwner)=>{const type=action.type;${code.slice(start,code.indexOf("    if (type === 'preview_geometry') {", start))}};`)(scope, () => viewer);
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = current.id; frame.dataset.renderer = "molstar"; document.body.append(frame);
  const source = frame.contentWindow!, sent: string[] = [], completed: string[] = [];
  source.postMessage = value => {
    if (value.body.type === "agent-action-cancel") { listeners.forEach(listener => listener({ source: window, data: value })); return; }
    sent.push(value.body.id);
    void execute(value.body.action, { id: value.body.id, source: window }).then((result: unknown) => reply(result), (error: Error) => reply({ ok: false, error: { message: error.message } }));
    function reply(result: unknown) { completed.push(value.body.id); window.dispatchEvent(new MessageEvent("message", { source, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: value.body.id, result } } })); }
  };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const actions = { saveKetcherExportFile: async () => ({ status: "saved" as const, path: null }) };
  await act(async () => root.render(<ScientificSpectraDockContent document={current} actions={actions} />));
  await waitFor(() => host.querySelectorAll("tbody tr").length === 2 && !host.querySelector('[role="status"]'));
  const selected = () => {
    const structure = plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data, loci = plugin.managers.structure.selection.getLoci(structure);
    return loci.kind === "empty-loci" ? [] : loci.elements.flatMap(element => Array.from(OrderedSet.toArray(element.indices), index => element.unit.model.atomicHierarchy.atomSourceIndex.value(element.unit.elements[index])));
  };
  const row = (label: string) => [...host.querySelectorAll<HTMLElement>("tbody tr")].find(row => row.querySelector("th")?.textContent === label)!;
  return { host, root, current, plugin, text, science, frame, selected, row, sent, completed,
    hold: () => { entered = false; let release!: () => void; gate = new Promise<void>(resolve => release = resolve); return { release, entered: () => entered }; },
    close: async () => { await act(async () => root.unmount()); frame.remove(); host.remove(); plugin.dispose(); releaseClosedImports(new Set()); releaseClosedScienceSessions(new Set()); } };
}

test("compiled owner maps table, keyboard and plotted NMR peak to actual source atoms", async () => {
  const f = await fixture();
  try {
    const before = f.plugin.state.data.getSnapshot();
    await act(async () => f.row("H4").click()); await waitFor(() => f.completed.length === 1); expect(f.selected()).toEqual([3]);
    await act(async () => f.host.querySelector('[role="slider"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    await waitFor(() => f.completed.length === 2); expect(f.selected()).toEqual([2]); expect(f.host.querySelector('tr[aria-selected="true"] th')?.textContent).toBe("H3");
    await act(async () => f.row("H4").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await waitFor(() => f.completed.length === 3); expect(f.selected()).toEqual([3]);
    const svg = f.host.querySelector("figure svg")!; svg.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, right: 320, top: 0, bottom: 120, width: 320, height: 120, toJSON() {} });
    await act(async () => svg.dispatchEvent(new MouseEvent("click", { clientX: 76, bubbles: true })));
    await waitFor(() => f.completed.length === 4); expect(f.selected()).toEqual([2]);
    expect(f.host.querySelector('[role="alert"]')).toBeNull(); expect(f.plugin.state.data.getSnapshot()).toEqual(before);
  } finally { await f.close(); }
});

test("compiled owner cancels a held native selection on close or exact source replacement", async () => {
  for (const replacement of [false, true]) {
    const f = await fixture(), held = f.hold();
    try {
      await act(async () => f.row("H4").click()); await waitFor(held.entered);
      await act(async () => { if (replacement) adoptLogicalSource({ documentId: f.current.id, extension: "xyz", text: f.text.replace(f.current.id, "replacement") }, "replacement-science", null, f.science.atoms.map(atom => atom.element)); else f.root.render(null); });
      held.release(); await waitFor(() => f.completed.length === 1); expect(f.selected()).toEqual([]); expect(f.host.querySelector('[role="alert"]')).toBeNull();
    } finally { held.release(); await f.close(); }
  }
});

test("a native Geometry edit rejects the original NMR row without changing existing native selection", async () => {
  const f = await fixture();
  try {
    await act(async () => f.row("H3").click()); await waitFor(() => f.completed.length === 1);
    const token = BuretteGeometry.capture(f.plugin); await BuretteGeometry.update(f.plugin, f.text.replace("0.946053", "0.956053"), token);
    const structure = f.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
    f.plugin.managers.interactivity.lociSelects.selectOnly({ loci: StructureElement.Loci(structure, [{ unit: structure.units[0], indices: OrderedSet.ofSingleton(1 as import("molstar/lib/mol-model/structure/structure/element/util.js").UnitIndex) }]) }, false);
    const before = f.selected(); expect(before).toEqual([1]); await act(async () => f.row("H4").click()); await waitFor(() => f.completed.length === 2);
    expect(f.selected()).toEqual(before); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("differs");
  } finally { await f.close(); }
});


test("a later table gesture wins while the earlier native digest is pending", async () => {
  const f = await fixture(), held = f.hold();
  try {
    await act(async () => f.row("H4").click()); await waitFor(held.entered);
    await act(async () => f.row("H3").click()); await waitFor(() => f.completed.length === 1);
    held.release(); await waitFor(() => f.completed.length === 2);
    expect(f.selected()).toEqual([2]); expect(f.host.querySelector('tr[aria-selected="true"] th')?.textContent).toBe("H3");
    expect(f.host.querySelector('[role="alert"]')).toBeNull();
  } finally { held.release(); await f.close(); }
});


test("scientific revision replacement and same-turn rollback revoke pending source ownership", async () => {
  for (const change of ["replacement", "rollback", "unrelated"]) {
    const f = await fixture(), held = f.hold();
    try {
      await act(async () => f.row("H4").click()); await waitFor(held.entered);
      await act(async () => {
        if (change === "replacement") addDocumentInternalCoordinates(f.current.id, f.text, f.science);
        else if (change === "unrelated") addDocumentInternalCoordinates("other-document", "other-text", f.science);
        else { const rollback = recordImportedRevision(f.current.id, f.text, { text: f.text, document: { ...f.science } }); if (!rollback) throw new Error("Missing fixture source revision"); rollback(); }
      });
      held.release(); await waitFor(() => f.completed.length === 1);
      expect(f.selected()).toEqual(change === "unrelated" ? [3] : []); expect(f.host.querySelector('[role="alert"]')).toBeNull();
    } finally { held.release(); await f.close(); }
  }
});
