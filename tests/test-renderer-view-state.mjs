import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRendererViewCheckpointStore } from '../apps/desktop/src/lib/renderer-view-state.ts';

const checkpoints = new Map();
let failWrite = false, failReadback = false;
const durable = () => ({
  getItem: key => failReadback ? null : checkpoints.get(key) ?? null,
  setItem: (key, value) => { if (failWrite) throw new Error('quota'); checkpoints.set(key, value); },
});
const host = createRendererViewCheckpointStore(durable);
for (let index = 0; index < 1000; index++) assert.equal(host.save(`/source-${index}.pdb`, { camera: { position: [index, 2, 3] } }), true);
const freshHost = createRendererViewCheckpointStore(durable);
for (let index = 0; index < 1000; index++) assert.deepEqual(JSON.parse(freshHost.read(`/source-${index}.pdb`).value).camera.position, [index, 2, 3]);
assert.equal(host.save('/source-0.pdb', { camera: { position: [99, 2, 3] } }), true);
assert.equal(host.read('/source-0.pdb').revision, 2, 'each document has an independent checkpoint generation');
failWrite = true;
assert.equal(host.save('/source-0.pdb', { camera: { position: [100, 2, 3] } }), false);
assert.deepEqual(JSON.parse(host.read('/source-0.pdb').value).camera.position, [100, 2, 3], 'a quota failure retains the live in-memory view');
failWrite = false; failReadback = true;
assert.equal(host.save('/source-1.pdb', { xyz: { scale: 2, x: 1, y: 3 } }), false, 'missing readback cannot authorize eviction');
failReadback = false;
assert.equal(host.save('/oversized', { camera: 'a'.repeat(9000) }), false);
assert.equal(host.read('/oversized'), null);

const source = readFileSync(new URL('../PreviewExtension/Web/renderer-view-state.js', import.meta.url), 'utf8');
let stored = null;
const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
function runtime() {
  const context = vm.createContext({ window: { sessionStorage: storage } });
  vm.runInContext(source, context);
  return context.window.BuretteRendererViewState;
}
const copy = value => JSON.parse(JSON.stringify(value));
const camera = { position: [12, -4, 27], target: [1, 2, 3], up: [0, 1, 0], radius: 9, fov: 0.7, mode: 'perspective' };
const xyz = { scale: 1.7, x: 42, y: -31, item: { left: 210, top: 180, width: 300, height: 250, rotation: 35 } };
const first = runtime();
first.save('molecule-a', { camera });
first.save('molecule-a', { xyz });
first.save('molecule-b', { camera: { ...camera, target: [20, 30, 40] } });
assert.deepEqual(copy(runtime().read('molecule-a')), { camera, xyz }, 'A fresh renderer iframe recovers both presentations');
assert.deepEqual(copy(runtime().read('molecule-b').camera.target), [20, 30, 40], 'Views are isolated by document');
camera.position[0] = 999;
assert.equal(first.read('molecule-a').camera.position[0], 12, 'Snapshots do not retain mutable camera arrays');
first.save('molecule-a', { camera: { ...camera, position: [Infinity, 0, 0] }, xyz: { scale: -1, x: 0, y: 0 } });
assert.equal(first.read('molecule-a').xyz.scale, 1.7, 'Invalid updates do not destroy a valid view');
for (let index = 0; index < 40; index++) first.save(`file-${index}`, { xyz });
assert.equal(Object.keys(JSON.parse(stored)).length, 32, 'Session history stays bounded');
stored = '{broken';
assert.doesNotThrow(() => runtime().read('file-0'));
console.log('Renderer view state: iframe reload, camera/2D round trip, isolation and bounded storage passed');

const parent = {};
const listeners = new Set();
const hostContext = vm.createContext({
  setTimeout, clearTimeout,
  window: { sessionStorage: storage, parent,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  },
});
vm.runInContext(source, hostContext);
const hostView = { xyz: { scale: 2, x: 3, y: 4 } };
await hostContext.window.BuretteRendererViewState.restoreFromHost('cold-source', request => {
  for (const listener of listeners) {
    const body = { ...request, type: 'rendererViewStateResponse', viewState: JSON.stringify(hostView) };
    listener({ source: {}, data: { source: 'burette-host', body } });
    assert.deepEqual(copy(hostContext.window.BuretteRendererViewState.read('cold-source')), {}, 'unrelated windows cannot inject a view');
    listener({ source: parent, data: { source: 'burette-host', body: { ...body, requestId: 'stale-request' } } });
    assert.deepEqual(copy(hostContext.window.BuretteRendererViewState.read('cold-source')), {}, 'a stale generation cannot satisfy restore');
    listener({ source: parent, data: { source: 'burette-host', body } });
  }
  return true;
});
assert.deepEqual(copy(hostContext.window.BuretteRendererViewState.read('cold-source').xyz), hostView.xyz);
assert.equal(listeners.size, 0, 'the restore listener is released after its matching response');
console.log('Durable 1,000-document view checkpoints, revision/readback failure and authenticated remount restore passed');

let resize, disconnected = false;
const viewContext = vm.createContext({ window: { sessionStorage: storage }, ResizeObserver: class {
  constructor(callback) { resize = callback; } observe() {} disconnect() { disconnected = true; }
} });
vm.runInContext(source, viewContext);
const placed = { style: {}, dataset: {}, offsetLeft: 500, offsetTop: 300, offsetWidth: 800, offsetHeight: 400 };
const viewport = { clientWidth: 1000, clientHeight: 600, querySelectorAll: () => [placed] };
const stop = viewContext.window.BuretteRendererViewState.observeSheetViewport(viewport, null);
assert.deepEqual(placed.style, { left: '500px', top: '300px', width: '800px', height: '400px' });
viewport.clientWidth = 600; resize();
assert.deepEqual(placed.style, { left: '300px', top: '300px', width: '800px', height: '400px' }, 'opening the inspector preserves dimensions and centers the sheet');
viewport.clientWidth = 0; resize();
viewport.clientWidth = 1000; resize();
assert.equal(placed.style.left, '500px', 'hidden tabs do not corrupt the previous viewport');
placed.dataset.rotation = '90'; viewport.clientHeight = 400; resize();
assert.deepEqual(placed.style, { left: '500px', top: '200px', width: '800px', height: '400px' }, 'rotation and bottom dock do not trigger auto-fit');
viewport.clientHeight = 600; resize();
assert.equal(placed.style.top, '300px');
stop(); assert.equal(disconnected, true);
first.save('viewport', { xyz: { ...xyz, viewport: { width: 1000, height: 600 } } });
assert.deepEqual(copy(runtime().read('viewport').xyz.viewport), { width: 1000, height: 600 });

// Restoring a saved sheet into a different viewport keeps its pixel geometry.
placed.offsetLeft = 500; placed.offsetTop = 300;
viewport.clientWidth = 600;
const restoredStop = viewContext.window.BuretteRendererViewState.observeSheetViewport(viewport, { width: 1000, height: 600 });
assert.deepEqual(placed.style, { left: '300px', top: '300px', width: '800px', height: '400px' });
restoredStop();

// An accidentally broadcast host command must not open another document's editor.
const viewerSource = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const branch = viewerSource.slice(viewerSource.indexOf("    if (event.source === window.parent && body.type === 'openXyzrenderEditor')"), viewerSource.indexOf("    if (event.source === window.parent && body.type === 'applyXyzrenderAnimationFrame')"));
let opened = 0;
const editorParent = {};
const editorContext = vm.createContext({ window: { parent: editorParent }, activeConfig: { documentId: 'methane' }, openXyzrender3DEditor: () => { opened++; } });
for (const [documentId, expected] of [['protein', 0], ['methane', 1], [undefined, 1]]) {
  editorContext.body = { type: 'openXyzrenderEditor', documentId };
  editorContext.event = { source: editorParent };
  vm.runInContext(`(() => { ${branch} })()`, editorContext);
  assert.equal(opened, expected);
}
console.log('Sheet resize preservation and document-scoped animation launch passed');
