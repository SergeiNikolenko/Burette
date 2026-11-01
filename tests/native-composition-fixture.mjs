import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

/** Actual built runtime and saved scene; only the display-ready gate and color UI are adapted. */
export async function nativeCompositionFixture(bytes = readFileSync(new URL('./fixtures/native/plain-peptide-PGI.molx', import.meta.url))) {
 const dom = new Window({ url: 'https://native-info.invalid/' }); Object.assign(dom, { setImmediate, clearImmediate });
 const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
 const fn = name => { const start = source.search(new RegExp('  (?:async )?function ' + name + '\\(')); assert.ok(start >= 0, name); return source.slice(start, source.indexOf('\n  }', start) + 4); };
 const names = ['compositionQueryLoci','reportMolstarCompositionVisibility','molstarCurrentStructures','normalizeSceneComponentKind','representationForSceneComponentKind','sceneTreeChildRefs','sceneTreeSubtreeRefs','changeMolstarQueryComponents'];
 if (source.includes('function molstarQueryComponentType(')) names.push('molstarQueryComponentType');
 const handlerStart = source.indexOf("    if (body?.type === 'compositionVisibilityRequest') {");
 const handler = source.slice(handlerStart, source.indexOf("    if (!body || body.type !== 'agent-action'", handlerStart));
 assert.ok(handlerStart >= 0);
 const context = vm.createContext({ console, window: dom, self: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
  crypto, TextEncoder, TextDecoder, Blob: dom.Blob, File: dom.File, FileReader: dom.FileReader, URL, URLSearchParams,
  ArrayBuffer, SharedArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView,
  atob, btoa, performance, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, queueMicrotask,
  requestAnimationFrame: cb => setTimeout(() => cb(performance.now()), 0), cancelAnimationFrame: clearTimeout,
  HTMLElement: dom.HTMLElement, HTMLCanvasElement: dom.HTMLCanvasElement, HTMLImageElement: dom.HTMLImageElement, Image: dom.Image,
  Event: dom.Event, CustomEvent: dom.CustomEvent, AbortController, AbortSignal, bytes: new Uint8Array(bytes) });
 vm.runInContext(readFileSync(new URL('../PreviewExtension/Web/molstar.js', import.meta.url), 'utf8'), context);
 vm.runInContext('window.molstar = molstar;', context);
 vm.runInContext(readFileSync(new URL('../PreviewExtension/Web/burette-agent.js', import.meta.url), 'utf8'), context);
 const native = await vm.runInContext(`(async () => {
  const { PluginContext, DefaultPluginSpec } = molstar.lib.plugin, spec = DefaultPluginSpec();
  const plugin = new PluginContext({ ...spec, behaviors: [...spec.behaviors, ...Object.values(molstar.ExtensionMap)] });
  await plugin.init(); await plugin.managers.snapshot.open(new File([bytes], 'actual-peptide.molx'));
  const viewer = { plugin, structureInteractivity: molstar.Viewer.prototype.structureInteractivity }, activeMolstarViewer = () => viewer, molstarStructureRuntime = () => molstar.lib.structure;
  const compositionQueryCache = new WeakMap(), molstarCompositionQueries = new Map(); const molstarCompositionHierarchyRequests = new Set(); let molstarCompositionVisibilitySignature = '', last = null, onPost = null;
  const sceneTreeColorState = () => ({ value: undefined }), sceneTreeColorHex = () => null;
  const sceneActionFailure = (command, code, message) => ({ ok: false, command, code, message });
  const scheduleSceneTreeRender = () => {}, sceneTreeReprTintTheme = () => {}, syncMolstarOutlineTransparency = () => {};
  const post = (type, message, body) => { last = JSON.parse(JSON.stringify(body)); onPost?.(last); };
  ${names.map(fn).join('\n')}
  const report = () => { const canvas = plugin.canvas3d; plugin.canvas3d = {}; try { reportMolstarCompositionVisibility(); } finally { plugin.canvas3d = canvas; } return last; };
  const receive = body => { const canvas = plugin.canvas3d; plugin.canvas3d = {}; try { ${handler} } finally { plugin.canvas3d = canvas; } };
  window.BuretteAgent.attach({ viewer, plugin, config: { format: 'molx' } }); window.BuretteAgent.notifyStructureLoaded();
  return { plugin, runtime: molstar, report, receive, last: () => last, onPost: fn => { onPost = fn; },
    snapshot: () => plugin.state.data.getSnapshot(), restore: snapshot => plugin.runTask(plugin.state.data.setSnapshot(snapshot)),
    edit: (action, operation) => changeMolstarQueryComponents(action, operation),
    select: action => window.BuretteAgent.run({ command: 'selectResidues', args: action }),
    dispose: () => { window.BuretteAgent.detach(); plugin.dispose(); } };
 })()`, context);
 return { ...native, close: async () => { native.dispose(); await dom.happyDOM.close(); } };
}
