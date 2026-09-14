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
