// Manipulate and bond-centric drags against a real Mol* scene, camera and live
// Geometry queue; only GPU picking is replaced, as in test-atom-drag-runtime.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultRegistry } from '@molstar/plugin/default-registry';
import { Bond, StructureElement } from '@molstar/model/model/structure';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Viewport } from '@molstar/graphics/canvas3d/camera/util';
import { BuretteGeometry } from '../scripts/molstar-geometry.js';
import { measureGeometry } from '../scripts/molecular-geometry.js';

// Anti butane carbons: C–C 1.54 Å, C–C–C 112°, C1–C2–C3–C4 180°.
const c = 1.54, t = 112 * Math.PI / 180;
const carbons = [[-c * Math.cos(Math.PI - t), c * Math.sin(Math.PI - t), 0], [0, 0, 0], [c, 0, 0], [c + c * Math.cos(Math.PI - t), -c * Math.sin(Math.PI - t), 0]];
const xyz = `4\nbutane\n${carbons.map(p => `C ${p.map(v => v.toFixed(4)).join(' ')}`).join('\n')}\n`;
const dom = new Window({ url: 'http://localhost/' }), previous = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] });
// The scene is briefly not 'ok' while a Geometry update rebuilds it.
const settled = condition => { try { return condition(); } catch { return false; } };
const until = async (condition, message) => {
  for (let i = 0; i < 400 && !settled(condition); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), message);
};
try {
  await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: xyz });
  const model = await plugin.builders.structure.createModel(await plugin.builders.structure.parseTrajectory(raw, 'xyz'));
  await plugin.builders.structure.createStructure(model);
  const structure = () => plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data;
  const canvas = dom.document.createElement('canvas');
  canvas.width = 200; canvas.height = 200; dom.document.body.appendChild(canvas);
  const camera = new Camera();
  Viewport.set(camera.viewport, 0, 0, 200, 200);
  camera.setState({ position: [0.77, 0, 20], target: [0.77, 0, 0], up: [0, 1, 0] }, 0);
  camera.update();
  const screen = row => { const unit = structure().units[0], world = [0, 0, 0]; unit.conformation.position(unit.elements[row], world); return camera.project([0, 0, 0, 0], world).slice(0, 2); };
  const middle = (a, b) => screen(a).map((value, axis) => (value + screen(b)[axis]) / 2);
  Object.defineProperty(plugin, 'canvas3dContext', { configurable: true, value: { canvas, dispose() {} } });
  Object.defineProperty(plugin, 'canvas3d', { configurable: true, value: {
    camera, props: { camera: { manualReset: false } }, pause() {}, resume() {}, commit() {}, dispose() {}, remove() {},
    setProps(props) { Object.assign(this.props.camera, props.camera); },
    identify([x, y]) {
      const near = point => Math.hypot(point[0] - x, point[1] - y) < 4;
      const row = [0, 1, 2, 3].find(index => near(screen(index)));
      if (row !== undefined) return { id: { row }, position: [0, 0, 0] };
      return near(middle(1, 2)) ? { id: { bond: [1, 2] }, position: [0, 0, 0] } : undefined;
    },
    getLoci(id) {
      const s = structure(), unit = s.units[0];
      return { loci: id.bond ? Bond.Loci(s, [Bond.Location(s, unit, id.bond[0], s, unit, id.bond[1])]) : StructureElement.Loci(s, [{ unit, indices: Int32Array.of(id.row) }]) };
    },
  } });

  let frames = [];
  const flush = () => { const pending = frames; frames = []; pending.forEach(callback => callback?.()); };
  Object.assign(dom, { molstar: { BuretteGeometry, lib: { structure: { StructureElement, Bond } } } });
  vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/atom-drag.js', import.meta.url), 'utf8'), {
    window: dom, requestAnimationFrame: callback => frames.push(callback), cancelAnimationFrame: id => { frames[id - 1] = null; },
  });
  const events = [], viewer = { plugin }, lease = BuretteGeometry.binding(plugin).lease;
  const plain = value => JSON.parse(JSON.stringify(value));
  const set = (enabled, manipulate) => plain(dom.BuretteAtomDrag.set(viewer, { type: 'atom_drag', enabled, lease, manipulate }, () => viewer, body => events.push(plain(body))));
  const pointer = (type, [x, y], init = {}) => {
    const event = new dom.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse', ...init });
    canvas.dispatchEvent(event);
    return event;
  };
  const rows = () => BuretteGeometry.binding(plugin).text.trimEnd().split('\n').slice(2).map(line => line.split(' ').slice(1).map(Number));
  const measure = atoms => measureGeometry(['', '', 'distance', 'angle', 'dihedral'][atoms.length], atoms.map(i => ({ id: i, position: rows()[i] }))).value;
  const reset = async () => {
    for (let i = 0; i < 100 && Math.abs(rows()[3][1] - carbons[3][1]) > 1e-3; i++) {
      await BuretteGeometry.update(plugin, xyz, BuretteGeometry.capture(plugin, () => true, lease));
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  const drag = async (from, dx, init = {}) => {
    events.length = 0;
    pointer('pointerdown', from, init); pointer('pointermove', [from[0] + dx, from[1]], init); flush();
    pointer('pointerup', [from[0] + dx, from[1]], init);
    await until(() => events.at(-1)?.phase === 'end', 'the drag ends');
    return events.at(-1);
  };

  // Without manipulate, a bond press and ⌥ presses stay with Mol*.
  assert.deepEqual(set(true, false), { enabled: true, lease });
  assert.equal(pointer('pointerdown', middle(1, 2)).defaultPrevented, false);
  pointer('pointerup', middle(1, 2));
  assert.equal(pointer('pointerdown', screen(3), { altKey: true }).defaultPrevented, false);
  pointer('pointerup', screen(3), { altKey: true });
  assert.deepEqual(events, []);

  assert.deepEqual(set(true, true), { enabled: true, lease });
  const lengths = () => [[0, 1], [1, 2], [2, 3]].map(measure), angles = () => [[0, 1, 2], [1, 2, 3]].map(measure);
  const [l0, a0, d0] = [lengths(), angles(), measure([0, 1, 2, 3])];
  assert.ok(Math.abs(Math.abs(d0) - 180) < 0.01);

  // A drag on C2–C3 turns one end: only the C1–C2–C3–C4 dihedral changes, by 90° for 180 px.
  const torsion = await drag(middle(1, 2), 180);
  assert.equal(torsion.atoms.length, 2, 'the smaller side moves');
  await until(() => Math.abs(Math.abs(measure([0, 1, 2, 3])) - 90) < 0.05, 'the dihedral follows the pointer');
  lengths().forEach((value, i) => assert.ok(Math.abs(value - l0[i]) < 2e-4, 'bond lengths stay'));
  angles().forEach((value, i) => assert.ok(Math.abs(value - a0[i]) < 0.02, 'bond angles stay'));
  await reset();

  // ⌥-drag on the bond stretches it along its axis; the angles and the dihedral stay.
  await drag(middle(1, 2), 20, { altKey: true });
  await until(() => measure([1, 2]) > l0[1] + 0.1, 'the bond stretches');
  assert.ok(Math.abs(measure([0, 1]) - l0[0]) < 2e-4 && Math.abs(measure([2, 3]) - l0[2]) < 2e-4);
  angles().forEach((value, i) => assert.ok(Math.abs(value - a0[i]) < 0.02));
  assert.ok(Math.abs(Math.abs(measure([0, 1, 2, 3])) - 180) < 0.05);
  await reset();

  // ⌥-drag on a selected atom rotates the selection rigidly about its centre.
  const unit = structure().units[0];
  plugin.managers.structure.selection.fromLoci('set', StructureElement.Loci(structure(), [{ unit, indices: Int32Array.of(2, 3) }]), false);
  const before = measure([2, 3]), centre = [2, 3].map(i => rows()[i]).reduce((sum, point) => sum.map((v, k) => v + point[k] / 2), [0, 0, 0]);
  const rotation = await drag(screen(3), 60, { altKey: true });
  assert.deepEqual(rotation.atoms, [2, 3]);
  await until(() => Math.abs(rows()[3][2]) > 0.1, 'the selection turns out of the plane');
  assert.ok(Math.abs(measure([2, 3]) - before) < 2e-4, 'the rotation is rigid');
  const after = [2, 3].map(i => rows()[i]).reduce((sum, point) => sum.map((v, k) => v + point[k] / 2), [0, 0, 0]);
  after.forEach((value, k) => assert.ok(Math.abs(value - centre[k]) < 2e-4, 'about the centre'));
  assert.deepEqual([rows()[0], rows()[1]].map(p => p.map(v => Number(v.toFixed(3)))), [carbons[0], carbons[1]].map(p => p.map(v => Number(v.toFixed(3)))));
  set(false, true);
  console.log('Manipulate turns a bond side, stretches a bond and rotates a selection, changing only the intended coordinates.');
} finally {
  plugin.dispose();
  await dom.happyDOM.close();
  globalThis.document = previous;
}
