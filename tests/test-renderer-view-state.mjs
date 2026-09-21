import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

let resize, disconnected = false;
const viewContext = vm.createContext({ window: { sessionStorage: storage }, ResizeObserver: class {
  constructor(callback) { resize = callback; } observe() {} disconnect() { disconnected = true; }
} });
vm.runInContext(source, viewContext);
const placed = { dataset: {}, offsetLeft: 500, offsetTop: 300, offsetWidth: 800, offsetHeight: 400 };
const viewport = { clientWidth: 1000, clientHeight: 600, querySelectorAll: () => [placed] };
let fitted;
const stop = viewContext.window.BuretteRendererViewState.observeSheetViewport(viewport, null, view => { fitted = view; });
assert.equal(fitted.scale, 1.17);
viewport.clientWidth = 600; resize();
assert.deepEqual(copy(fitted), { scale: 0.67, x: -134, y: 24 }, 'opening the inspector fits and centers the entire sheet');
assert.equal(300 + fitted.x + fitted.scale * (placed.offsetLeft - 300), 300);
viewport.clientWidth = 0; resize();
viewport.clientWidth = 1000; resize();
assert.equal(fitted.scale, 1.17, 'closing the inspector uses the newly available space');
placed.dataset.rotation = '90'; viewport.clientWidth = 900; resize();
assert.ok(Math.abs(fitted.scale - 0.59) < 1e-10, 'rotated bounds fit vertically');
stop(); assert.equal(disconnected, true);
first.save('viewport', { xyz: { ...xyz, viewport: { width: 1000, height: 600 } } });
assert.deepEqual(copy(runtime().read('viewport').xyz.viewport), { width: 1000, height: 600 });
