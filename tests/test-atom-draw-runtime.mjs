// Draw mode against a real Mol* scene and camera; only GPU picking is replaced:
// identify() projects atoms and bond midpoints through the same camera.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultRegistry } from '@molstar/plugin/default-registry';
import { Bond, StructureElement } from '@molstar/model/model/structure';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Viewport } from '@molstar/graphics/canvas3d/camera/util';

const xyz = '3\nwater\nO 0 0 0\nH 1 0 0\nH 0 1 0\n';
const dom = new Window({ url: 'http://localhost/' }), previous = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] });
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
  const project = world => camera.project([0, 0, 0, 0], world).slice(0, 2);
  const screen = row => { const unit = structure().units[0], world = [0, 0, 0]; unit.conformation.position(unit.elements[row], world); return project(world); };
  const middle = (a, b) => screen(a).map((value, axis) => (value + screen(b)[axis]) / 2);
  Object.defineProperty(plugin, 'canvas3dContext', { configurable: true, value: { canvas, dispose() {} } });
  Object.defineProperty(plugin, 'canvas3d', { configurable: true, value: {
    camera, props: { camera: { manualReset: false } }, pause() {}, resume() {}, commit() {}, dispose() {}, remove() {},
    identify([x, y]) {
      const near = point => Math.hypot(point[0] - x, point[1] - y) < 4;
      const row = [0, 1, 2].find(index => near(screen(index)));
      if (row !== undefined) return { id: { row }, position: [0, 0, 0] };
      return near(middle(0, 1)) ? { id: { bond: [0, 1] }, position: [0, 0, 0] } : undefined;
    },
    getLoci(id) {
      const s = structure(), unit = s.units[0];
      return { loci: id.bond ? Bond.Loci(s, [Bond.Location(s, unit, id.bond[0], s, unit, id.bond[1])]) : StructureElement.Loci(s, [{ unit, indices: Int32Array.of(id.row) }]) };
    },
  } });

  Object.assign(dom, { molstar: { lib: { structure: { StructureElement, Bond } } } });
  vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/atom-drag.js', import.meta.url), 'utf8'), {
    window: dom, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  });
  const events = [], viewer = { plugin }, lease = 'draw-lease';
  const plain = value => JSON.parse(JSON.stringify(value));
  const draw = enabled => plain(dom.BuretteAtomDrag.draw(viewer, { type: 'atom_draw', enabled, lease }, () => viewer, body => events.push(plain(body))));
  const pointer = (type, [x, y], init = {}) => {
    const event = new dom.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse', ...init });
    canvas.dispatchEvent(event);
    return event;
  };
  const near = (a, b, message) => a.forEach((value, axis) => assert.ok(Math.abs(value - b[axis]) < 0.05, `${message}: ${a} vs ${b}`));
  const overlay = () => dom.document.querySelector('svg[aria-hidden="true"]');

  assert.deepEqual(draw(true), { enabled: true, lease });
  assert.equal(canvas.style.cursor, 'crosshair');

  // A click on empty space places an atom under the pointer in the plane through the camera target.
  assert.equal(pointer('pointerdown', [40, 150]).defaultPrevented, false, 'empty-space presses still reach the camera');
  pointer('pointerup', [40, 150]);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].type, events[0].lease, events[0].gesture], ['atom-draw', lease, 'empty']);
  near(project(events[0].position), [40, 150], 'the new atom is under the pointer');
  assert.ok(Math.abs(events[0].position[2]) < 1e-6, 'and at the depth of the camera target');
  // Dragging empty space rotates the view and draws nothing.
  pointer('pointerdown', [40, 150]); pointer('pointermove', [80, 150]); pointer('pointerup', [80, 150]);
  assert.equal(events.length, 1);

  // A click on an atom, a click on a bond.
  assert.equal(pointer('pointerdown', screen(1)).defaultPrevented, true, 'an atom press never starts a camera rotation');
  pointer('pointerup', screen(1));
  assert.deepEqual(events.at(-1), { type: 'atom-draw', lease, gesture: 'atom', atoms: [1] });
  pointer('pointerdown', middle(0, 1)); pointer('pointerup', middle(0, 1));
  assert.deepEqual(events.at(-1), { type: 'atom-draw', lease, gesture: 'bond-click', atoms: [0, 1] });

  // A drag from an atom into space shows a line and reports the point at the atom's depth.
  const from = screen(2), to = [from[0] + 30, from[1] - 20];
  pointer('pointerdown', from); pointer('pointermove', to);
  assert.equal(overlay().style.display, '', 'the drag line is shown');
  pointer('pointerup', to);
  assert.equal(overlay().style.display, 'none');
  const drag = events.at(-1);
  assert.deepEqual([drag.gesture, drag.atoms], ['drag', [2]]);
  near(project(drag.position), to, 'the drag ends under the pointer');
  assert.ok(Math.abs(drag.position[2]) < 1e-6);

  // A drag from one atom onto another joins them.
  pointer('pointerdown', screen(1)); pointer('pointermove', screen(2)); pointer('pointerup', screen(2));
  assert.deepEqual(events.at(-1), { type: 'atom-draw', lease, gesture: 'bond', atoms: [1, 2] });

  // Escape drops the stroke in progress.
  const count = events.length;
  pointer('pointerdown', screen(1)); pointer('pointermove', to);
  dom.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  pointer('pointerup', to);
  assert.equal(events.length, count);

  assert.deepEqual(draw(false), { enabled: false, lease });
  assert.equal(pointer('pointerdown', screen(1)).defaultPrevented, false, 'disabled draw mode leaves presses to Mol*');
  pointer('pointerup', screen(1));
  assert.equal(events.length, count);
  assert.equal(canvas.style.cursor, '');
  assert.equal(overlay(), null);
  console.log('Draw mode reports clicks, drags and bond clicks in source atoms and model coordinates.');
} finally {
  plugin.dispose();
  await dom.happyDOM.close();
  globalThis.document = previous;
}
