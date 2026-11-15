import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultRegistry } from '@molstar/plugin/default-registry';
import { BuretteIndexedTrajectory } from '../scripts/molstar-indexed-trajectory.js';
import { indexDcdFrames, indexXtcFrames } from '../scripts/xtc-dcd-index.mjs';

// pair.* and the reference distances come from MDAnalysis 2.11.0 (see pair/make-pair.py).
const file = name => new URL(`./fixtures/trajectory/pair/${name}`, import.meta.url);
const pdb = readFileSync(file('pair.pdb'), 'utf8');
const reference = readFileSync(file('pair-distance-1-10.csv'), 'utf8').trim().split('\n').slice(1).map(row => row.split(',').map(Number));
const previousDocument = globalThis.document;
globalThis.document = new Window().document;
const plugins = [];
const makePlugin = async () => { const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] }); plugins.push(plugin); await plugin.init(); return plugin; };
const viewerSource = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const loaderSource = viewerSource.slice(viewerSource.indexOf('  async function loadDockingTrajectoryPair('), viewerSource.indexOf('  // Every atom is the same unknown carbon'));
const loadPair = vm.runInNewContext(`${loaderSource}\nloadDockingTrajectoryPair`, { window: { molstar: { BuretteIndexedTrajectory } }, normalizeFormat: value => value });
const distance = page => Math.hypot(...[0, 1, 2].map(axis => page.atoms[0].position[axis] - page.atoms[1].position[axis]));
const pair = (format, data) => ({ modelKind: 'model-data', modelEntry: { data: pdb, format: 'pdb', label: 'pair.pdb' },
  coordinateEntry: { data, format, label: `pair.${format}`, segmentIndex: 0 } });
try {
  for (const [format, column] of [['xtc', 2], ['dcd', 3]]) {
    const bytes = new Uint8Array(readFileSync(file(`pair.${format}`)));
    const plugin = await makePlugin();
    let trajectory;
    plugin.builders.structure.hierarchy.applyPreset = async selector => { trajectory = selector; };
    await loadPair({ plugin }, pair(format, bytes));
    assert.equal(trajectory.data.frameCount, 30);
    for (let frame = 0; frame < 30; frame++) {
      const model = frame ? await trajectory.data.getFrameAtIndex(frame).run() : trajectory.data.representative;
      // Atoms 1 and 10 (zero-based 0 and 9), as MDAnalysis measured them.
      const at = index => BuretteIndexedTrajectory.frameData(model, { offset: index, limit: 1 }).atoms[0];
      const page = { ...BuretteIndexedTrajectory.frameData(model, { limit: 1 }), atoms: [at(0), at(9)] };
      assert.equal(page.frameIndex, frame);
      assert.ok(Math.abs(distance(page) - reference[frame][column]) < 1e-5, `${format} frame ${frame + 1}: ${distance(page)} != ${reference[frame][column]}`);
      assert.ok(Math.abs(page.time.value - reference[frame][1]) < 1e-3, `${format} time ${page.time.value}`);
    }
    // A whole-trajectory scan reads every frame for the chosen atoms from the displayed source.
    const viewer = { plugin: { managers: { structure: { hierarchy: { current: { structures: [{ cell: { obj: { data: { models: [trajectory.data.representative] } } } }] } } } } } };
    const { sourceId } = BuretteIndexedTrajectory.frameData(trajectory.data.representative, { limit: 1 });
    const scan = await BuretteIndexedTrajectory.scanPositions(viewer, { atoms: [0, 9], offset: 0, limit: 200, expected: { sourceId } });
    assert.equal(scan.frames.length, 30);
    for (const item of scan.frames) {
      const value = Math.hypot(...[0, 1, 2].map(axis => item.positions[0][axis] - item.positions[1][axis]));
      assert.ok(Math.abs(value - reference[item.frameIndex][column]) < 1e-5, `${format} scan frame ${item.frameIndex + 1}`);
    }
    await assert.rejects(BuretteIndexedTrajectory.scanPositions(viewer, { atoms: [0, 9], offset: 0, limit: 200, expected: { sourceId: 'another' } }), /changed/u);
    // A fresh plugin restores the raw bytes and the format from the state tree alone.
    const snapshot = JSON.parse(JSON.stringify(plugin.state.data.getSnapshot()));
    const restored = await makePlugin();
    await restored.runTask(restored.state.data.setSnapshot(snapshot));
    const cell = [...restored.state.data.cells.values()].find(cell => cell.transform.transformer.id === 'ms-plugin.burette-browser-trr-trajectory');
    assert.equal(cell.status, 'ok'); assert.equal(cell.transform.params.format, format); assert.equal(cell.obj.data.frameCount, 30);
    // Truncated files are refused before anything is shown.
    assert.throws(() => (format === 'xtc' ? indexXtcFrames : indexDcdFrames)(bytes.subarray(0, bytes.length - 7)), /Truncated|truncated/u);
  }
} finally { for (const plugin of plugins) plugin.dispose(); globalThis.document = previousDocument; }
console.log('Browser XTC and DCD: every frame and a whole-trajectory scan match MDAnalysis, times, snapshot restoration and truncation refusal passed');
