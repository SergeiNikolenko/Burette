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
const molfile = (atoms, bonds) => [
  '', '  test', '', `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
  ...atoms.map(([element, ...position]) => `${position.map(value => value.toFixed(4).padStart(10)).join('')} ${element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`),
  ...bonds.map(bond => `${bond.map(value => String(value).padStart(3)).join('')}  0`), 'M  END', '',
].join('\n');
const dom = new Window({ url: 'http://localhost/' }), previous = globalThis.document;
globalThis.document = dom.document;
const plugins = [];
// A scene with one structure, seen from +z with +y up.
async function open(data, format) {
  const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] });
  plugins.push(plugin);
  await plugin.init();
  const raw = await plugin.builders.data.rawData({ data });
  const model = await plugin.builders.structure.createModel(await plugin.builders.structure.parseTrajectory(raw, format));
  const structure = await plugin.builders.structure.createStructure(model);
  const camera = new Camera();
  Viewport.set(camera.viewport, 0, 0, 400, 300);
  camera.setState({ position: [0, 0, 25], target: [0, 0, 0], up: [0, 1, 0] }, 0);
  camera.update();
  Object.defineProperty(plugin, 'canvas3d', { configurable: true, value: { camera, props: { renderer: { backgroundColor: 0x202020 } }, add() {}, remove() {}, update() {}, commit() {}, requestDraw() {}, dispose() {} } });
  return { plugin, structure };
}
try {
  const { plugin, structure } = await open(ethanol, 'sdf');
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

  // Formaldehyde in the screen plane: a bond stroke starts where its cylinder leaves the
  // atom's sphere, so the nearer atom's disc is not painted over by the bond's end.
  const flat = await open(molfile([['C', 0, 0, 0], ['O', 0, 1.21, 0], ['H', 0.94, -0.54, 0], ['H', -0.94, -0.54, 0]], [[1, 2, 2], [1, 3, 1], [1, 4, 1]]), 'mol');
  await flat.plugin.builders.structure.representation.addRepresentation(flat.structure, { type: 'ball-and-stick', color: 'element-symbol' });
  const planar = parse(media.svg(flat.plugin).svg);
  const discs = Object.fromEntries([...planar.querySelectorAll('circle')].map(circle => [circle.querySelector('title').textContent,
    { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')), r: Number(circle.getAttribute('r')) }]));
  const groups = [...planar.querySelectorAll('g.bond')].map(group => [...group.querySelectorAll('line')]
    .flatMap(line => [[line.getAttribute('x1'), line.getAttribute('y1')], [line.getAttribute('x2'), line.getAttribute('y2')]].map(point => point.map(Number))));
  assert.deepEqual(groups.map(ends => ends.length / 4).sort(), [1, 1, 2], 'two single bonds and one double bond');
  const reach = (ends, disc) => Math.min(...ends.map(([x, y]) => Math.hypot(x - disc.x, y - disc.y)));
  for (const ends of groups) {
    const partner = ['O2', 'H3', 'H4'].map(name => discs[name]).sort((p, q) => reach(ends, p) - reach(ends, q))[0];
    for (const disc of [discs.C1, partner]) {
      assert.ok(reach(ends, disc) >= 0.5 * disc.r - 0.02, 'a bond stroke does not start at the atom centre');
      assert.ok(reach(ends, disc) <= disc.r + 0.02, 'a bond stroke starts under the atom disc');
    }
  }
  console.log('Vector export draws one circle per atom and one group per bond from the shown representations.');
} finally {
  for (const plugin of plugins) plugin.dispose();
  await dom.happyDOM.close();
  globalThis.document = previous;
}
