// Live Geometry for single-model MOL/SDF: an XYZ baseline in source order, moved
// coordinates, the file's own bonds and the unchanged lease contract.
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultRegistry } from '@molstar/plugin/default-registry';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { BuretteGeometry } from '../scripts/molstar-geometry.js';

const atom = (x, y, z, symbol) => `${[x, y, z].map(v => v.toFixed(4).padStart(10)).join('')} ${symbol.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`;
const mol = [
  'chloromethane', '  fixture', '',
  '  5  4  0  0  0  0  0  0  0  0999 V2000',
  atom(0, 0, 0, 'C'), atom(1.78, 0, 0, 'Cl'), atom(-0.36, 1.03, 0, 'H'), atom(-0.36, -0.51, 0.89, 'H'), atom(-0.36, -0.51, -0.89, 'H'),
  '  1  2  1  0', '  1  3  1  0', '  1  4  1  0', '  1  5  1  0', 'M  END', '',
].join('\n');
const expected = '5\nBurette live geometry (mol)\nC 0 0 0\nCl 1.78 0 0\nH -0.36 1.03 0\nH -0.36 -0.51 0.89\nH -0.36 -0.51 -0.89\n';

const dom = new Window(), previous = globalThis.document;
globalThis.document = dom.document;
async function open(text, format) {
  const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] });
  await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, format);
  const model = await plugin.builders.structure.createModel(trajectory);
  await plugin.builders.structure.createStructure(model);
  const camera = new Camera();
  plugin.canvas3d = { camera, props: { camera: { manualReset: false } }, pause() {}, resume() {},
    setProps(props) { Object.assign(this.props.camera, props.camera); }, commit() {}, dispose() {}, remove() {} };
  return { plugin, raw, camera };
}
const unit = plugin => plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data.units[0];
const bonds = plugin => { const graph = unit(plugin).bonds; return [Array.from(graph.a), Array.from(graph.b), Array.from(graph.edgeProps.order)]; };

const opened = [];
try {
  const { plugin, raw, camera } = await open(mol, 'mol'); opened.push(plugin);
  const first = BuretteGeometry.binding(plugin);
  assert.deepEqual(first.text, expected, 'MOL atoms become one XYZ frame in source order with normalized symbols');
  const topology = bonds(plugin), view = camera.getSnapshot(), state = plugin.state.data;
  const far = expected.replace('Cl 1.78 0 0', 'Cl 4.5 0.25 0');
  await BuretteGeometry.update(plugin, far, BuretteGeometry.capture(plugin, () => true, first.lease));
  assert.deepEqual([unit(plugin).conformation.x(1), unit(plugin).conformation.y(1)], [4.5, Math.fround(0.25)]);
  assert.deepEqual(bonds(plugin), topology, 'declared MOL bonds survive stretching beyond covalent distance');
  assert.deepEqual(camera.getSnapshot(), view, 'the camera is not reset');
  assert.equal(raw.cell.obj.data, mol, 'the MOL source bytes are unchanged');
  const second = BuretteGeometry.binding(plugin);
  assert.deepEqual(second, { lease: first.lease, text: far }, 'own updates keep the lease and become the binding text');
  for (const invalid of [far.replace('Cl 4.5', 'Br 4.5'), far.replace('5\n', '4\n').replace(/H -0.36 -0.51 -0.89\n$/u, ''), `${far}${far}`]) {
    const before = state.getSnapshot();
    await assert.rejects(BuretteGeometry.update(plugin, invalid, BuretteGeometry.capture(plugin, () => true, first.lease)));
    assert.deepEqual(state.getSnapshot(), before, 'refused texts never change the scene');
  }
  assert.throws(() => BuretteGeometry.capture(plugin, () => true, 'foreign'), { name: 'AbortError' });
  await BuretteGeometry.update(plugin, first.text, BuretteGeometry.capture(plugin, () => true, first.lease));
  assert.equal(unit(plugin).conformation.x(1), Math.fround(1.78), 'restoring the baseline text restores the atoms');

  // A pin rewrites every applied text; passive updates never supersede a queued one.
  const release = BuretteGeometry.pin(plugin, text => text.replace(/^C [^\n]+$/mu, 'C 0 0 1'));
  const running = BuretteGeometry.update(plugin, far), queued = BuretteGeometry.update(plugin, first.text);
  const passive = BuretteGeometry.update(plugin, far, undefined, { passive: true });
  assert.deepEqual(await running, { ok: true });
  assert.deepEqual(await queued, { ok: true }, 'the queued host text was not superseded by the passive one');
  await passive;
  assert.equal(BuretteGeometry.binding(plugin).text, first.text.replace('C 0 0 0', 'C 0 0 1'), 'the passive text yielded to the queued host text');
  release();
  await BuretteGeometry.update(plugin, first.text);
  assert.equal(BuretteGeometry.binding(plugin).text, first.text, 'a released pin no longer rewrites texts');

  const record = `${mol}$$$$\n`;
  const sdf = await open(record, 'sdf'); opened.push(sdf.plugin);
  assert.equal(BuretteGeometry.binding(sdf.plugin).text, expected.replace('(mol)', '(sdf)'), 'a one-record SDF binds like MOL');
  const multi = await open(`${record}${record}`, 'sdf'); opened.push(multi.plugin);
  assert.throws(() => BuretteGeometry.binding(multi.plugin), /single XYZ, MOL or SDF model/u, 'multi-record SDF stays outside live Geometry');
  console.log('MOL/SDF live Geometry keeps source order, declared bonds, camera and lease.');
} finally {
  for (const plugin of opened) plugin.dispose();
  await dom.happyDOM.close();
  globalThis.document = previous;
}
