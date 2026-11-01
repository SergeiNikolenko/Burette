import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { BuretteIndexedTrajectory } from '../scripts/molstar-indexed-trajectory.js';

const fixture = name => new Uint8Array(readFileSync(new URL(`./fixtures/trajectory/${name}`, import.meta.url)));
const first = fixture('vectors.trr'), second = fixture('forces-only.trr');
const bytes = new Uint8Array(first.length + second.length); bytes.set(first); bytes.set(second, first.length);

const previousDocument = globalThis.document;
globalThis.document = new Window().document;
const plugins = [];
const makePlugin = async () => { const plugin = new PluginContext({ actions: [], behaviors: [] }); plugins.push(plugin); await plugin.init(); return plugin; };
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-6, `${value} != ${expected}`);
try {
  const plugin = await makePlugin();
  let trajectory;
  plugin.builders.structure.hierarchy.applyPreset = async selector => { trajectory = selector; };
  const viewerSource = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
  const loaderSource = viewerSource.slice(viewerSource.indexOf('  async function loadDockingTrajectoryPair('), viewerSource.indexOf('  // Every atom is the same unknown carbon'));
  const loadOrdinaryPair = vm.runInNewContext(`${loaderSource}\nloadDockingTrajectoryPair`, {
    window: { molstar: { BuretteIndexedTrajectory } }, normalizeFormat: value => value,
  });
  await loadOrdinaryPair({ plugin }, {
    modelKind: 'model-data',
    modelEntry: { data: readFileSync(new URL('./fixtures/trajectory/vector-reference.pdb', import.meta.url), 'utf8'), format: 'pdb', label: 'Vector reference' },
    coordinateEntry: { data: bytes, format: 'trr', label: 'Two TRR frames', segmentIndex: 0 },
  });
  assert.equal(trajectory.data.frameCount, 2);
  let page = BuretteIndexedTrajectory.frameData(trajectory.data.representative);
  assert.equal(page.frameIndex, 0); assert.equal(page.total, 3);
  near(page.atoms[0].velocity[0], .1); near(page.atoms[2].force[2], .3);
  const model = await trajectory.data.getFrameAtIndex(1).run();
  page = BuretteIndexedTrajectory.frameData(model);
  assert.equal(page.frameIndex, 1); assert.equal(page.time.value, 4.25);
  assert.equal(page.atoms[0].velocity, undefined); near(page.atoms[0].force[0], 2);

  // The real state tree serializes raw bytes and both dependencies. A fresh
  // plugin restores vectors with no native request callback or previous reader.
  const snapshot = JSON.parse(JSON.stringify(plugin.state.data.getSnapshot()));
  const restored = await makePlugin();
  await restored.runTask(restored.state.data.setSnapshot(snapshot));
  const cell = [...restored.state.data.cells.values()].find(cell => cell.transform.transformer.id === 'ms-plugin.burette-browser-trr-trajectory');
  assert.equal(cell.status, 'ok'); assert.equal(cell.obj.data.frameCount, 2);
  const reopened = await cell.obj.data.getFrameAtIndex(1).run();
  const restoredPage = BuretteIndexedTrajectory.frameData(reopened);
  assert.equal(restoredPage.time.value, page.time.value);
  assert.deepEqual(restoredPage.atoms.map(({ sourceAtomIndex, velocity, force }) => ({ sourceAtomIndex, velocity, force })), page.atoms.map(({ sourceAtomIndex, velocity, force }) => ({ sourceAtomIndex, velocity, force })));
  assert.equal(restoredPage.units.velocity, undefined);
  assert.notEqual(restoredPage.sourceId, page.sourceId, 'restored source has a fresh lifetime');
} finally { for (const plugin of plugins) plugin.dispose(); globalThis.document = previousDocument; }
console.log('Browser TRR: real topology, optional vectors, bounded index and fresh-plugin snapshot restoration passed');
