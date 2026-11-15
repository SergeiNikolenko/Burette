// Atom dragging against a real Mol* scene, camera and live Geometry queue.
// Only GPU picking is replaced: identify() projects atoms through the same camera.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultRegistry } from '@molstar/plugin/default-registry';
import { StructureElement } from '@molstar/model/model/structure';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Viewport } from '@molstar/graphics/canvas3d/camera/util';
import { BuretteGeometry } from '../scripts/molstar-geometry.js';

const xyz = '3\nwater\nO 0 0 0\nH 1 0 0\nH 0 1 0\n';
const dom = new Window({ url: 'http://localhost/' }), previous = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] });
const until = async (condition, message) => {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 5));
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
  camera.setState({ position: [0, 0, 20], target: [0, 0, 0], up: [0, 1, 0] }, 0);
  camera.update();
  const screen = row => {
    const unit = structure().units[0], world = [0, 0, 0], out = [0, 0, 0, 0];
    unit.conformation.position(unit.elements[row], world);
    return camera.project(out, world).slice(0, 2);
  };
  Object.defineProperty(plugin, 'canvas3dContext', { configurable: true, value: { canvas, dispose() {} } });
  Object.defineProperty(plugin, 'canvas3d', { configurable: true, value: {
    camera, props: { camera: { manualReset: false } }, pause() {}, resume() {}, commit() {}, dispose() {}, remove() {},
    setProps(props) { Object.assign(this.props.camera, props.camera); },
    identify([x, y]) {
      const row = [0, 1, 2].find(index => Math.hypot(screen(index)[0] - x, screen(index)[1] - y) < 4);
      return row === undefined ? undefined : { id: { row }, position: [0, 0, 0] };
    },
    getLoci(id) { const unit = structure().units[0]; return { loci: StructureElement.Loci(structure(), [{ unit, indices: Int32Array.of(id.row) }]) }; },
  } });

  let frames = [];
  const flush = () => { const pending = frames; frames = []; pending.forEach(callback => callback?.()); };
  Object.assign(dom, { molstar: { BuretteGeometry, lib: { structure: { StructureElement } } } });
  vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/atom-drag.js', import.meta.url), 'utf8'), {
    window: dom, requestAnimationFrame: callback => frames.push(callback), cancelAnimationFrame: id => { frames[id - 1] = null; },
  });
  const events = [], viewer = { plugin }, lease = BuretteGeometry.binding(plugin).lease;
  // Module objects come from the vm realm; compare their JSON shape.
  const plain = value => JSON.parse(JSON.stringify(value));
  const set = enabled => plain(dom.BuretteAtomDrag.set(viewer, { type: 'atom_drag', enabled, lease }, () => viewer, body => events.push(plain(body))));
  const pointer = (type, [x, y], init = {}) => {
    const event = new dom.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse', ...init });
    canvas.dispatchEvent(event);
    return event;
  };
  const rows = () => BuretteGeometry.binding(plugin).text.trimEnd().split('\n').slice(2).map(line => line.split(' ').slice(1).map(Number));
  const at = (point, dx, dy = 0) => [point[0] + dx, point[1] + dy];

  assert.throws(() => dom.BuretteAtomDrag.set(viewer, { enabled: true, lease: 'foreign' }, () => viewer, () => {}), { name: 'AbortError' });
  assert.deepEqual(set(true), { enabled: true, lease });
  assert.equal(pointer('pointerdown', [5, 5]).defaultPrevented, false, 'empty-space presses still reach the camera');
  pointer('pointerup', [5, 5]);
  assert.equal(pointer('pointerdown', screen(1), { shiftKey: true }).defaultPrevented, false, 'modifier presses keep Mol* selection bindings');
  pointer('pointerup', screen(1), { shiftKey: true });
  assert.deepEqual(events, []);

  const grab = screen(1);
  assert.equal(pointer('pointerdown', grab).defaultPrevented, true, 'an atom press never starts a camera rotation');
  pointer('pointermove', at(grab, 10)); pointer('pointermove', at(grab, 30, -10));
  flush();
  assert.deepEqual(events.map(event => event.phase), ['start', 'move'], 'pointer moves coalesce into one move per frame');
  assert.deepEqual(events[0], { type: 'atom-drag', phase: 'start', lease, atoms: [1], positions: [[1, 0, 0]] });
  await until(() => rows()[1][0] !== 1, 'the viewer applies the dragged coordinates itself');
  assert.deepEqual([rows()[0], rows()[2]], [[0, 0, 0], [0, 1, 0]], 'only the dragged atom moves');
  assert.equal(rows()[1][2], 0, 'the atom stays in the camera plane through it');
  screen(1).forEach((value, axis) => assert.ok(Math.abs(value - at(grab, 30, -10)[axis]) < 0.05, 'the atom follows the pointer'));
  assert.deepEqual(events[1].positions, [rows()[1]]);

  // A host optimizer moves the other atoms; the held atom keeps its pointer position.
  const held = rows()[1];
  await BuretteGeometry.update(plugin, '3\nwater\nO 0 0 0.5\nH 1 0 0\nH 0 1.2 0\n', BuretteGeometry.capture(plugin, () => true, lease));
  assert.deepEqual(rows(), [[0, 0, 0.5], held, [0, 1.2, 0]]);
  pointer('pointerup', at(grab, 30, -10));
  assert.deepEqual(events.at(-1), { type: 'atom-drag', phase: 'end', lease, atoms: [1], positions: [held] });
  for (let i = 0; i < 100 && rows()[1][0] !== 1; i++) {
    await BuretteGeometry.update(plugin, xyz, BuretteGeometry.capture(plugin, () => true, lease));
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.deepEqual(rows(), [[0, 0, 0], [1, 0, 0], [0, 1, 0]], 'released atoms follow host updates again');

  // A press on a selected atom drags the whole selection by one delta.
  const unit = structure().units[0];
  plugin.managers.structure.selection.fromLoci('set', StructureElement.Loci(structure(), [{ unit, indices: Int32Array.of(1, 2) }]), false);
  events.length = 0;
  const second = screen(2);
  pointer('pointerdown', second); pointer('pointermove', at(second, 0, 20)); flush();
  await until(() => rows()[2][1] !== 1, 'the selection moves');
  const [, h1, h2] = rows();
  assert.ok(Math.abs(h1[1] - (h2[1] - 1)) < 1e-5 && Math.abs(h1[0] - 1) < 1e-5 && Math.abs(h2[0]) < 1e-5, 'selected atoms share one camera-plane delta');
  assert.deepEqual(events.map(event => [event.phase, event.atoms]), [['start', [1, 2]], ['move', [1, 2]]]);

  // Escape cancels and restores the text captured at the press.
  const escape = new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  dom.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.deepEqual(events.at(-1), { type: 'atom-drag', phase: 'cancel', lease, atoms: [1, 2], positions: [[1, 0, 0], [0, 1, 0]] });
  await until(() => rows()[2][1] === 1, 'cancel restores the start');
  assert.deepEqual(rows(), [[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  pointer('pointerup', at(second, 0, 20));

  assert.deepEqual(set(false), { enabled: false, lease });
  events.length = 0;
  assert.equal(pointer('pointerdown', screen(1)).defaultPrevented, false, 'disabled drag mode leaves presses to Mol*');
  assert.deepEqual(events, []);
  console.log('Atom drag follows the pointer, holds atoms against host updates and cancels cleanly.');
} finally {
  plugin.dispose();
  await dom.happyDOM.close();
  globalThis.document = previous;
}
