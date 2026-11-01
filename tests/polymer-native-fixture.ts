import { plugin as installPlugin } from "bun";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { molstarStatePreconditionPlugin } from "../scripts/molstar-state-precondition.mjs";
import type { ViewerDocument } from "../apps/desktop/src/types";
installPlugin(molstarStatePreconditionPlugin);

/** Real native source plus queued host transport; optional gates retain actual messages. */
export async function attachNativePolymerSource(frame: HTMLIFrameElement, document: ViewerDocument, text: string) {
  const hostWindow = window, HostMessageEvent = MessageEvent;
  let pending = 0;
  const enqueue = (callback: () => void) => { pending++; setTimeout(() => { try { callback(); } finally { pending--; } }, 0); };
  Object.assign(hostWindow, { setImmediate, clearImmediate });
  const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
  const { StructureElement } = await import("molstar/lib/mol-model/structure.js");
  const { OrderedSet } = await import("molstar/lib/mol-data/int.js");
  const plugin = new PluginContext({ actions: [], behaviors: [] }); await plugin.init();
  const load = async () => {
    const raw = await plugin.builders.data.rawData({ data: text }), trajectory = await plugin.builders.structure.parseTrajectory(raw, "sdf");
    const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model); return raw;
  };
  const raw = await load(), viewer = { plugin };
  frame.className = "viewer-iframe"; frame.dataset.documentId = document.id; frame.dataset.renderer = "molstar";
  const source = frame.contentWindow!, listeners = new Set<(event: any) => void>();
  let holdRetirement = false, holdValidation = false;
  const retirements: (() => void)[] = [], validations: (() => void)[] = [];
  const host = (channel: string, body: unknown) => enqueue(() => hostWindow.dispatchEvent(new HostMessageEvent("message", { source, data: { source: channel, body } })));
  const notify = (body: unknown) => { const send = () => host("burette-viewer", body); if (holdRetirement) retirements.push(send); else send(); };
  const scope: any = { molstar: { lib: { structure: { StructureElement } } }, addEventListener: (_type: string, fn: (event: any) => void) => listeners.add(fn), removeEventListener: (_type: string, fn: (event: any) => void) => listeners.delete(fn) };
  const context = vm.createContext({ window: scope, crypto, TextEncoder, Uint8Array, Float64Array, AbortController });
  for (const name of ["scene-file-actions", "polymer-pick"]) vm.runInContext(readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), "utf8"), context);
  const code = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8"), start = code.indexOf("    if (type === 'polymer_source_binding'");
  if (start < 0) throw new Error("Missing polymer dispatch");
  const execute = new Function("window", "activeMolstarViewer", "postHostMessage", "loadScript", "runtimeURL", `return async(action,requestOwner)=>{const type=action.type;${code.slice(start,code.indexOf("    if (type === 'geometry_binding') {",start))}}`)(scope, () => viewer, notify, () => { throw new Error("Unexpected runtime load"); }, (_key: string, path: string) => path);
  source.postMessage = message => { enqueue(() => {
    if (message.body.type === "agent-action-cancel") { listeners.forEach(fn => fn({ source: hostWindow, data: message })); return; }
    const body = message.body;
    const reply = (result: unknown) => { const send = () => host("burette-agent-viewer", { type: "agent-action-result", id: body.id, result });
      if (holdValidation && body.action.type === "polymer_source_validate") validations.push(send); else send(); };
    pending++; void execute(body.action, { source: hostWindow, id: body.id }).then(reply, (error: Error) => reply({ ok: false, error: { message: error.message } })).finally(() => pending--);
  }); };
  const click = (sourceIndex: number) => {
    const root = plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
    const loci = StructureElement.Loci(root, root.units.flatMap(unit => { const index = Array.from(unit.elements).findIndex(atom => unit.model.atomicHierarchy.atomSourceIndex.value(atom) === sourceIndex);
      return index < 0 ? [] : [{ unit, indices: OrderedSet.ofSingleton(index as never) }]; }));
    plugin.behaviors.interaction.click.next({ current: { loci }, button: 1, buttons: 1, modifiers: { alt: false, shift: false, control: false, meta: false } } as never);
  };
  return { plugin, raw, click, holdRetirement: () => { holdRetirement = true; }, heldRetirements: () => retirements.length,
    holdValidation: () => { holdValidation = true; }, heldValidations: () => validations.length,
    flushRetirement: () => { holdRetirement = false; retirements.splice(0).forEach(send => send()); },
    flushValidation: () => { holdValidation = false; validations.splice(0).forEach(send => send()); },
    replace: async () => { await plugin.state.data.build().delete(plugin.managers.structure.hierarchy.current.structures[0].cell).commit(); await load(); },
    close: async () => { plugin.dispose(); for (let i = 0; i < 100 && pending; i++) await new Promise(resolve => setTimeout(resolve, 0)); if (pending) throw new Error("Native transport did not drain"); } };
}
