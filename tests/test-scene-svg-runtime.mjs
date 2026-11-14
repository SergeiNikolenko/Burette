// Vector export against a real Mol* scene and representation themes; only the
// canvas is replaced by a camera, as in test-atom-drag-runtime.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultRegistry } from '@molstar/plugin/default-registry';
import { StructureElement } from '@molstar/model/model/structure';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Viewport } from '@molstar/graphics/canvas3d/camera/util';

// Ethanol with its hydrogens: 9 atoms, 8 bonds.
const ethanol = readFileSync(new URL('./fixtures/fragments/ethanol-cid702.sdf', import.meta.url), 'utf8');
const dom = new Window({ url: 'http://localhost/' }), previous = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] });
try {
  await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: ethanol });
  const model = await plugin.builders.structure.createModel(await plugin.builders.structure.parseTrajectory(raw, 'sdf'));
  const structure = await plugin.builders.structure.createStructure(model);
  const camera = new Camera();
  Viewport.set(camera.viewport, 0, 0, 400, 300);
  camera.setState({ position: [0, 0, 25], target: [0, 0, 0], up: [0, 1, 0] }, 0);
  camera.update();
  Object.defineProperty(plugin, 'canvas3d', { configurable: true, value: { camera, props: { renderer: { backgroundColor: 0x202020 } }, add() {}, remove() {}, update() {}, commit() {}, requestDraw() {}, dispose() {} } });
  Object.assign(dom, { molstar: { lib: { structure: { StructureElement } } } });
  vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/scene-media.js', import.meta.url), 'utf8'), { window: dom });
  const media = dom.BuretteSceneMedia;

  assert.throws(() => media.svg(plugin), /ball-and-stick, licorice and spacefill/, 'a scene without sphere views is refused');
  const sticks = await plugin.builders.structure.representation.addRepresentation(structure, { type: 'ball-and-stick', color: 'element-symbol' });
  const parse = text => new dom.DOMParser().parseFromString(text, 'image/svg+xml');
  const drawn = media.svg(plugin);
  const document = parse(drawn.svg);
  assert.deepEqual([drawn.atoms, drawn.bonds], [9, 8]);
  assert.equal(document.querySelectorAll('circle').length, 9, 'one element per atom');
  assert.equal(document.querySelectorAll('g.bond').length, 8, 'one element per bond');
  assert.deepEqual([...document.querySelectorAll('circle title')].map(title => title.textContent).sort(),
    ['C2', 'C3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'O1']);
  assert.equal(document.querySelector('rect')?.getAttribute('fill'), '#202020', 'the view background');
  assert.equal(parse(media.svg(plugin, { transparent: true }).svg).querySelectorAll('rect').length, 0);
  // Oxygen is red in the element theme, and its bonds carry a red half.
  const oxygen = [...document.querySelectorAll('circle')].find(circle => circle.querySelector('title').textContent === 'O1');
  assert.match(oxygen.getAttribute('fill'), /^url\(#a/);
  assert.ok(document.querySelector(`radialGradient#${oxygen.getAttribute('fill').slice(5, -1)}`), 'each fill has its gradient');

  // Hidden representations are skipped; spacefill gives atoms only.
  await plugin.build().to(sticks).update(old => ({ ...old, type: { name: 'spacefill', params: { ...old.type.params } } })).commit();
  const spheres = media.svg(plugin);
  assert.deepEqual([spheres.atoms, spheres.bonds], [9, 0]);
  console.log('Vector export draws one circle per atom and one group per bond from the shown representations.');
} finally {
  plugin.dispose();
  await dom.happyDOM.close();
  globalThis.document = previous;
}
