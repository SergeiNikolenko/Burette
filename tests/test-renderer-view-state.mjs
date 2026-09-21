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
const placed = { style: { left: '500px', top: '300px' } };
const automatic = { style: { left: '50%', top: '50%' } };
const viewport = { clientWidth: 1000, clientHeight: 600, querySelectorAll: () => [placed, automatic] };
const stop = viewContext.window.BuretteRendererViewState.observeSheetViewport(viewport);
viewport.clientWidth = 600; resize();
assert.deepEqual(placed.style, { left: '300px', top: '300px' }, 'opening the inspector moves the sheet with the available center');
assert.deepEqual(automatic.style, { left: '50%', top: '50%' }, 'CSS centered items must not be shifted twice');
viewport.clientWidth = 0; resize();
viewport.clientWidth = 1000; resize();
assert.equal(placed.style.left, '500px', 'hiding and restoring an iframe does not drift the sheet');
stop(); assert.equal(disconnected, true);
viewport.clientWidth = 600;
viewContext.window.BuretteRendererViewState.observeSheetViewport(viewport, { width: 1000, height: 600 });
assert.equal(placed.style.left, '300px', 'restoring at a different dock width compensates stored pixel positions');
first.save('viewport', { xyz: { ...xyz, viewport: { width: 1000, height: 600 } } });
assert.deepEqual(copy(runtime().read('viewport').xyz.viewport), { width: 1000, height: 600 });
