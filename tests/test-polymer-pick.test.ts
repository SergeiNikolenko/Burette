import { plugin as installPlugin } from "bun";
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";
import { molstarStatePreconditionPlugin } from "../scripts/molstar-state-precondition.mjs";
import { capturePolymerPickOwner } from "../apps/desktop/src/hooks/polymer-pick-owner";
import { requestViewerAction } from "../apps/desktop/src/lib/viewer-bridge";
import { sdfFromGraph } from "../apps/desktop/src/lib/workbench/formats";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import data from "./fixtures/polymer/propylene-reference.json";
installPlugin(molstarStatePreconditionPlugin);
const dom = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, CSS: dom.CSS, getComputedStyle: dom.getComputedStyle.bind(dom) })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
}
Object.assign(dom, { setImmediate, clearImmediate });
const { PluginContext } = await import("@molstar/plugin");
const { DefaultRegistry } = await import("@molstar/plugin/default-registry");
const { StructureElement } = await import("@molstar/model/model/structure");
const { OrderedSet } = await import("@molstar/core/data/int");
afterAll(async () => { await dom.happyDOM.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
const text = sdfFromGraph(data.atoms, data.bonds, "Propylene");
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => resolve = done); return { promise, resolve }; }
let serial = 0;
async function fixture(input = text, format: "mol" | "sdf" = "sdf", digestGate?: ReturnType<typeof deferred>) {
  const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] }); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: input }), trajectory = await plugin.builders.structure.parseTrajectory(raw, format);
  const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model);
  const viewer = { plugin }; let active = viewer;
  const doc = { id: `polymer-pick-${++serial}`, renderer: "molstar", extension: format, path: `source.${format}`, title: "source", runtimePath: "native", byteCount: input.length } as const;
  const frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = doc.id; frame.dataset.renderer = "molstar"; document.body.append(frame);
  const frameWindow = frame.contentWindow!, messages: any[] = [], nativeListeners = new Set<(event: any) => void>();
  const host = (source: string, body: unknown) => window.dispatchEvent(new dom.MessageEvent("message", { source: frameWindow as never, data: { source, body } }) as unknown as MessageEvent);
  const notify = (body: unknown) => { messages.push(body); host("burette-viewer", body); };
  const scope: any = { molstar: { lib: { structure: { StructureElement } } }, addEventListener: (_type: string, fn: (event: any) => void) => nativeListeners.add(fn), removeEventListener: (_type: string, fn: (event: any) => void) => nativeListeners.delete(fn) };
  const context = vm.createContext({ window: scope, crypto: { subtle: { digest: async (...args: Parameters<SubtleCrypto["digest"]>) => { await digestGate?.promise; return crypto.subtle.digest(...args); } } }, TextEncoder, Uint8Array, Float64Array, AbortController });
  for (const name of ["scene-file-actions", "polymer-pick"]) vm.runInContext(readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), "utf8"), context);
  const script = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8"), start = script.indexOf("    if (type === 'polymer_source_binding'");
  if (start < 0) throw new Error("Missing private polymer branch");
  const execute = new Function("window", "activeMolstarViewer", "postHostMessage", "loadScript", "runtimeURL", `return async (action,requestOwner)=>{const type=action.type;${script.slice(start,script.indexOf("    if (type === 'geometry_binding') {", start))}}`)(scope, () => active, notify, () => { throw new Error("Unexpected runtime load"); }, (_key: string, fallback: string) => fallback);
  const sent: any[] = [];
  frameWindow.postMessage = (message: any) => {
    sent.push(message);
    if (message.body.type === "agent-action-cancel") { nativeListeners.forEach(fn => fn({ source: window, data: message })); return; }
    const body = message.body;
    void execute(body.action, { source: window, id: body.id }).then((result: unknown) => host("burette-agent-viewer", { type: "agent-action-result", id: body.id, result }),
      (error: Error) => host("burette-agent-viewer", { type: "agent-action-result", id: body.id, result: { ok: false, error: { message: error.message } } }));
  };
  const root = () => plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  const loci = (source: number) => StructureElement.Loci(root(), root().units.flatMap(unit => {
    const index = Array.from(unit.elements).findIndex(atom => unit.model.atomicHierarchy.atomSourceIndex.value(atom) === source);
    return index < 0 ? [] : [{ unit, indices: OrderedSet.ofSingleton(index as never) }];
  }));
  const click = (picked: ReturnType<typeof loci>, button = 1) => plugin.behaviors.interaction.click.next({ current: { loci: picked }, button, buttons: button, modifiers: { alt: false, control: false, meta: false, shift: false } } as never);
  let retired = 0, current = true;
  const source = parseMolecule(input, format);
  const bind = (signal = new AbortController().signal, atoms = source.atoms, sourceText = input) => capturePolymerPickOwner(doc, { text: sourceText, format, atoms }, () => current, signal, () => retired++);
  return { plugin, raw, model, root, loci, click, bind, frame, sent, messages, scope, viewer, doc,
    get retired() { return retired; }, replaceViewer: () => { active = { plugin }; }, invalidateSource: () => { current = false; },
    close: () => { plugin.dispose(); frame.remove(); } };
}

test("real native atom clicks preserve interleaved source rows, camera-free scene and granularity", async () => {
  const permutation = [7, 2, 5, 0, 9, 3, 8, 1, 4, 10, 6];
  const input = sdfFromGraph(permutation.map(i => data.atoms[i]), data.bonds.map(b => ({ ...b, a: permutation.indexOf(b.a), b: permutation.indexOf(b.b) })), "Permuted");
  for (const format of ["sdf", "mol"] as const) {
    const f = await fixture(input, format);
    try {
      const owner = await f.bind(), before = f.plugin.state.data.getSnapshot(); f.plugin.managers.interactivity.setProps({ granularity: "chain" });
      for (const sourceIndex of [0, 3, 7, 8]) {
        const pending = owner.pick(new AbortController().signal); await Promise.resolve();
        expect(f.plugin.managers.interactivity.props.granularity).toBe("element");
        expect(f.plugin.selectionMode).toBe(true);
        f.click(f.loci(sourceIndex));
        expect(await pending).toBe(sourceIndex);
        expect(f.plugin.managers.interactivity.props.granularity).toBe("chain");
        expect(f.plugin.selectionMode).toBe(false);
      }
      const subset = StructureElement.Loci.toStructure(f.loci(7)), subsetLoci = StructureElement.Loci.all(subset);
      expect(subsetLoci.elements[0].unit.elements).toHaveLength(1);
      const pickSubset = owner.pick(new AbortController().signal); await Promise.resolve(); f.click(subsetLoci); expect(await pickSubset).toBe(7);
      expect(f.plugin.state.data.getSnapshot()).toEqual(before); expect(f.plugin.state.data.canUndo).toBe(false);
      expect(f.plugin.managers.interactivity.props.granularity).toBe("chain"); expect(owner.isCurrent()).toBe(true); owner.release();
    } finally { f.close(); }
  }
});

test("cancelling atom picking restores the previous level without overwriting a user change", async () => {
  const f = await fixture();
  try {
    const owner = await f.bind();
    f.plugin.managers.interactivity.setProps({ granularity: "residue" });
    for (const changed of [false, true]) {
      f.plugin.selectionMode = changed;
      const controller = new AbortController(), pending = owner.pick(controller.signal).catch(error => error.name);
      await Promise.resolve();
      expect(f.plugin.managers.interactivity.props.granularity).toBe("element");
      if (changed) f.plugin.managers.interactivity.setProps({ granularity: "chain" });
      controller.abort(); expect(await pending).toBe("AbortError");
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(f.plugin.managers.interactivity.props.granularity).toBe(changed ? "chain" : "residue");
      expect(f.plugin.selectionMode).toBe(changed);
    }
    owner.release();
  } finally { f.close(); }
});

test("foreign equivalent native model, multi-atom and non-primary clicks never assign a guessed row", async () => {
  const f = await fixture(), foreign = await fixture();
  try {
    const owner = await f.bind(), signal = new AbortController();
    const pending = owner.pick(signal.signal).catch(error => error.message); await Promise.resolve();
    f.click(StructureElement.Loci.all(f.root())); f.click(f.loci(1), 2); expect(owner.isCurrent()).toBe(true);
    f.click(foreign.loci(1)); expect(await pending).toContain("source molecule");
    const retry = owner.pick(new AbortController().signal); await Promise.resolve(); f.click(f.loci(4)); expect(await retry).toBe(4); owner.release();
  } finally { f.close(); foreign.close(); }
});

test("same-iframe native model/source edit and Undo permanently retire armed roles", async () => {
  const f = await fixture();
  try {
    const owner = await f.bind(), pending = owner.pick(new AbortController().signal).catch(error => error.name);
    await Promise.resolve(); await f.plugin.state.data.build().to(f.raw).update({ data: text.replace("Propylene", "Changed source") }).commit({ canUndo: "Source edit" });
    await f.plugin.runTask(f.plugin.state.data.undo());
    expect(await pending).toBe("AbortError"); expect(owner.isCurrent()).toBe(false); expect(f.retired).toBe(1);
    expect(f.messages.filter(m => m.type === "polymer_source_retired")).toHaveLength(1);
    const fresh = await f.bind(); const pick = fresh.pick(new AbortController().signal); await Promise.resolve(); f.click(f.loci(5)); expect(await pick).toBe(5); fresh.release();
  } finally { f.close(); }
});

test("digest admission rejects changed coordinates and source ABA while binding is pending", async () => {
  const f = await fixture();
  try {
    const atoms = parseMolecule(text, "sdf").atoms; atoms[0].x += .01;
    await expect(f.bind(undefined, atoms)).rejects.toThrow("differs");
    await expect(f.bind(undefined, parseMolecule(text, "sdf").atoms, text.replace("Propylene", "Foreign source"))).rejects.toThrow("differs");
    const gate = deferred(), held = await fixture(text, "sdf", gate);
    try {
      const binding = held.bind().catch(error => error.message); await new Promise(resolve => setTimeout(resolve, 5));
      await held.plugin.state.data.build().to(held.raw).update({ data: text.replace("Propylene", "Different") }).commit({ canUndo: "Source edit" });
      await held.plugin.runTask(held.plugin.state.data.undo()); gate.resolve(); expect(await binding).toContain("cancelled");
    } finally { gate.resolve(); held.close(); }
  } finally { f.close(); }
});

test("cancel/retry, obsolete release and source/frame retirement preserve the newer owner", async () => {
  const f = await fixture();
  try {
    const first = await f.bind(), second = await f.bind(); expect(first.isCurrent()).toBe(false); first.release();
    const abort = new AbortController(), pending = second.pick(abort.signal).catch(error => error.name); abort.abort(); expect(await pending).toBe("AbortError");
    const retry = second.pick(new AbortController().signal); await Promise.resolve(); f.click(f.loci(4)); expect(await retry).toBe(4);
    const lease = f.sent.find(m => m.body.action?.type === "polymer_source_binding").body.action.lease;
    await expect(requestViewerAction(f.doc.id, { type: "polymer_pick_atom", lease }, 1000)).rejects.toThrow("source changed"); expect(second.isCurrent()).toBe(true);
    f.frame.setAttribute("srcdoc", "replacement"); expect(second.isCurrent()).toBe(false); await expect(second.pick(new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" }); second.release();
    expect(f.sent.some(m => m.body.type === "agent-action-cancel")).toBe(true);
  } finally { f.close(); }
});

const { isRetiredGeometryActionResult } = await import("../apps/desktop/src/lib/geometry-action-status");
test("a late cancelled or timed-out native pick remains classified, then expires after bounded grace", async () => {
  for (const mode of ["cancel", "timeout"] as const) {
    const f = await fixture(), originalTimer = window.setTimeout.bind(window), descriptor = Object.getOwnPropertyDescriptor(window, "setTimeout");
    const source = f.frame.contentWindow!, post = source.postMessage.bind(source);
    source.postMessage = message => { setTimeout(() => post(message, "*"), 0); };
    try {
      const owner = await f.bind();
      // Scale production deadlines only; real native requests and their queued replies still run.
      Object.defineProperty(window, "setTimeout", { configurable: true, value: (callback: TimerHandler, ms = 0, ...args: unknown[]) => originalTimer(callback, ms >= 1000 ? ms / 1000 : ms, ...args) });
      const controller = new AbortController(), pending = owner.pick(controller.signal).catch(error => error);
      await new Promise(resolve => setTimeout(resolve, 80));
      const id = [...f.sent].reverse().find(message => message.body.action?.type === "polymer_pick_atom").body.id;
      if (mode === "cancel") controller.abort();
      const error = await pending;
      expect(mode === "cancel" ? error.name : error.message).toBe(mode === "cancel" ? "AbortError" : "The scene did not respond. Check it before retrying.");
      expect(isRetiredGeometryActionResult(id, source)).toBe(true);
      expect(isRetiredGeometryActionResult(id, window)).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(isRetiredGeometryActionResult(id, source)).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 70));
      expect(isRetiredGeometryActionResult(id, source)).toBe(false); owner.release();
    } finally {
      if (descriptor) Object.defineProperty(window, "setTimeout", descriptor); else Reflect.deleteProperty(window, "setTimeout");
      await new Promise(resolve => setTimeout(resolve, 5)); f.close();
    }
  }
});
