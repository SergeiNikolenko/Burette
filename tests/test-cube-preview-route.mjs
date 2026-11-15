import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Window } from 'happy-dom';
import { fileURLToPath } from 'node:url';
async function preview(path) {
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, ['scripts/agent-preview.mjs', path, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-20000); });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
  try {
    const deadline = Date.now() + 10000;
    let ready;
    while (Date.now() < deadline && child.exitCode === null) {
      try { ready = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)); } catch {}
      if (ready?.url) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(ready?.url, `Preview failed to start: ${stderr}`);
    const url = new URL(ready.url);
    const scripts = [];
    for (const name of ['preview-config.js', 'preview-data.js', 'viewer.js', 'molstar.js']) {
      url.pathname = '/' + name;
      const response = await fetch(url); assert.equal(response.status, 200);
      scripts.push(await response.text());
    }
    return scripts;
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  }
}
const dom = new Window({ url: "https://burette-test.invalid/" });
Object.assign(dom, { setImmediate, clearImmediate });
const context = vm.createContext({ console, assert, document: dom.document, window: dom, self: dom,
  navigator: dom.navigator, location: dom.location, crypto, TextEncoder, TextDecoder,
  Blob: dom.Blob, File: dom.File, FileReader: dom.FileReader, URL, URLSearchParams,
  ArrayBuffer, SharedArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView,
  atob, btoa, performance, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, queueMicrotask,
  requestAnimationFrame: callback => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout,
  HTMLElement: dom.HTMLElement, HTMLCanvasElement: dom.HTMLCanvasElement, HTMLImageElement: dom.HTMLImageElement,
  Image: dom.Image, Event: dom.Event, CustomEvent: dom.CustomEvent, AbortController, AbortSignal,
  viewerSource: readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8"),
});
try {
  for (const name of ['oblique-angstrom-single.cube', 'oblique-angstrom-3fields.cube']) {
    const path = fileURLToPath(new URL('./fixtures/' + name, import.meta.url));
    const scripts = await preview(path);
    for (const source of scripts.slice(0, 2)) vm.runInContext(source, context);
    context.viewerSource = scripts[2];
    if (!context.molstar) vm.runInContext(scripts[3], context, { filename: 'http-complete-built-molstar.js', timeout: 30000 });
    context.expectedText = readFileSync(path, 'utf8');
    context.expectedIdsJson = name.includes('3fields') ? '[7,11,17]' : '[0]';
    await vm.runInContext(String.raw`(async () => {
      const config = window.BuretteConfig;
      assert.equal(config.format, 'cube', 'tokenized preview must route Cube explicitly');
      assert.equal(config.binary, false);
      const extract = name => viewerSource.match(new RegExp('\\n  (?:async )?function ' + name + '\\([\\s\\S]*?\\n  \\}', 'u'))[0];
      const names = ['normalizeFormat', 'isMolViewSpecFormat', 'structureSceneEntriesFromConfig', 'rawStructureData', 'base64ToBytes', 'base64ToText', 'structureDataForMolstar', 'loadPreparedStructure'];
      // Only shell controls are inert; native parsing and both representation builders run unchanged.
      const api = new Function('window', 'installDockingPoseControls', 'let decodedStructureCache = null, activeDockingPrepared, activeMolstarPrepared; const cancelScheduledMolstarWaterRepresentation = () => {}, updateSdfPoseButton = () => {}, notifyStructureOverlayModeChanged = () => {}; ' + names.map(extract).join('\n') + '; return { prepare: structureDataForMolstar, load: loadPreparedStructure };')(window, () => {});
      const prepared = api.prepare(config);
      assert.equal(prepared.kind, 'volume'); assert.equal(prepared.data, expectedText);
      const native = globalThis.molstar;
      const { PluginContext, DefaultPluginSpec, StateTransforms } = native.lib.plugin;
      const base = DefaultPluginSpec();
      const plugin = new PluginContext({ ...base, behaviors: [...base.behaviors, ...Object.values(native.ExtensionMap)] });
      await plugin.init();
      try {
        const result = await api.load({ plugin }, prepared);
        const { format, volume, structure } = result.parsed;
        assert.deepEqual(Array.from(format.obj.data.header.dataSetIds), JSON.parse(expectedIdsJson));
        assert.equal(structure.obj.data.elementCount, 3);
        const conformation = structure.obj.data.models[0].atomicConformation;
        const actualAtoms = Array.from(conformation.x, (x, index) => [x, conformation.y[index], conformation.z[index]]);
        assert.deepEqual(actualAtoms, [[1.25,-2.5,3.75],[1.75,-2.375,3.75],[1.25,-1.75,3.625]]);
        assert.deepEqual(Array.from(volume.obj.data.grid.cells.space.dimensions), [4,3,3]);
        assert.deepEqual(Array.from(volume.obj.data.grid.transform.matrix), [.5,.125,0,0,0,.75,-.125,0,.25,0,1.5,0,1.25,-2.5,3.75,1]);
        assert.equal(volume.obj.data.grid.cells.space.get(volume.obj.data.grid.cells.data,1,1,1), 2);
        assert.ok(result.visuals.some(ref => plugin.state.data.cells.get(ref.ref)?.transform.transformer === StateTransforms.Representation.VolumeRepresentation3D), 'native provider creates a real volume representation');
        assert.ok(result.visuals.some(ref => plugin.state.data.cells.get(ref.ref)?.transform.transformer === StateTransforms.Representation.StructureRepresentation3D), 'native provider creates real atom representations');
      } finally { plugin.dispose(); }
    })()`, context);
  }
  console.log('Tokenized Cube startup passed: actual HTTP payload, viewer preparation/load, complete native IIFE provider, single/multiple fields, Angstrom atoms and volume/structure representations.');
} finally { await dom.happyDOM.close(); }
