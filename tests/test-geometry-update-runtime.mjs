import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { PluginStateObject as SO, PluginStateTransform } from 'molstar/lib/mol-plugin-state/objects.js';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { Task } from 'molstar/lib/mol-task/index.js';
import { Camera } from 'molstar/lib/mol-canvas3d/camera.js';
import { BuretteGeometry } from '../scripts/molstar-geometry.js';

const xyz = '4\noriginal comment\nO 0 0 0\nH 1 0 0\nH 0 1 0\nH 0 1 1\n';
const text = distance => xyz.replace('H 1 0 0', `H ${distance} 0 0`);
const gate = () => {
  let release, start;
  return { waiting: new Promise(resolve => { release = resolve; }), entered: new Promise(resolve => { start = resolve; }),
    release: () => release(), start: () => start() };
};
const dom = new Window(), previous = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ actions: [], behaviors: [] });
let hold, failure = false;
const Probe = PluginStateTransform.BuiltIn({ name: 'geometry-runtime-test-probe', from: [SO.Molecule.Structure, SO.Data.String], to: SO.Data.String })({
  apply() { return Task.create('Dependent geometry work', async () => {
    const pending = hold; hold = null;
    if (pending) { pending.start(); await pending.waiting; }
    if (failure) { failure = false; throw new Error('dependent representation failed'); }
    return new SO.Data.String('dependent');
  }); },
});
try {
  await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: xyz });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = await plugin.builders.structure.createStructure(model);
  const state = plugin.state.data, root = () => plugin.managers.structure.hierarchy.current.structures[0].cell;
  await state.build().to(structure).apply(Probe).commit();
  const camera = new Camera();
  let pauses = 0;
  plugin.canvas3d = { camera, props: { camera: { manualReset: false } }, pause() { pauses++; }, resume() { pauses--; },
    setProps(props) { Object.assign(this.props.camera, props.camera); }, commit() {}, dispose() {}, remove() {} };
  const viewer = { plugin }, window = { molstar: { BuretteGeometry }, BuretteAgent: { run() { throw new Error('No generic agent route'); } } };
  const helper = readFileSync(new URL('../PreviewExtension/Web/geometry-preview.js', import.meta.url), 'utf8');
  vm.runInNewContext(helper, { window, Int32Array });
  const runtime = window.BuretteGeometryPreview;
  const update = (value, token) => runtime.update(viewer, { text: value }, token);
  const position = () => root().obj.data.units[0].conformation.x(1);
  const beforeBinding = root().obj.data.models[0].sourceData;
  const metadata = { source: 'immutable provenance', value: [1, 2, 3] };
  root().obj.data.models[0]._staticPropertyData.reviewMetadata = metadata;
  const builder = state.build(), seed = builder.toRoot().apply(StateTransforms.Data.RawData, { data: 'user' });
  seed.apply(Probe); await builder.commit({ canUndo: 'User scene edit' });
  const unguarded = state.getSnapshot();
  await assert.rejects(plugin.runTask(state.updateTree(state.tree, { buretteKeepHistory: true })), /conditional admission/);
  assert.deepEqual(state.getSnapshot(), unguarded);
  assert.equal(state.latestUndoLabel, 'User scene edit');
  const originalCamera = camera.getSnapshot();
  await update(text(1.2));
  assert.deepEqual(camera.getSnapshot(), originalCamera);
  assert.equal(state.latestUndoLabel, 'User scene edit', 'previews preserve native Undo without adding frame entries');
  assert.equal(root().obj.data.models[0].sourceData, beforeBinding);
  assert.equal(root().obj.data.models[0]._staticPropertyData.reviewMetadata, metadata);
  assert.equal(raw.cell.obj.data, xyz, 'raw Original bytes and source provenance stay unchanged');
  vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/scene-file-actions.js', import.meta.url), 'utf8'), { window });
  const binding = window.BuretteSceneFiles.science.binding(viewer);
  assert.deepEqual([binding.structureRef, binding.modelRef, binding.trajectoryRef, binding.positions[3]], [structure.ref, model.ref, trajectory.ref, Math.fround(1.2)]);
  for (const invalid of [text('NaN'), text('1e300'), text('0x10'), text(1).replace('H 1 0 0', 'C 1 0 0'), `${xyz}${xyz}`]) {
    const before = state.getSnapshot();
    await assert.rejects(update(invalid));
    assert.deepEqual(state.getSnapshot(), before);
    assert.equal(state.latestUndoLabel, 'User scene edit');
  }
  failure = true;
  const validBefore = state.getSnapshot();
  await assert.rejects(update(text(1.3)));
  assert.deepEqual(state.getSnapshot(), validBefore, 'actual dependent-transform failure rolls back the complete candidate');
  assert.equal(state.latestUndoLabel, 'User scene edit');
  await update(text(1.4));
  assert.equal(position(), Math.fround(1.4), 'failure does not poison later valid updates');

  hold = gate(); const held = hold;
  const first = update(text(1.5)); await held.entered;
  const displaced = update(text(1.6)).then(() => 'false success', error => error.name);
  const latest = update(text(1.7));
  camera.setState({ position: [17, 18, 19], target: [2, 3, 4] }, 0);
  const newerCamera = camera.getSnapshot();
  held.release();
  assert.deepEqual(await Promise.all([first, displaced, latest]), [{ ok: true }, 'AbortError', { ok: true }]);
  assert.equal(position(), Math.fround(1.7));
  assert.deepEqual(camera.getSnapshot(), newerCamera, 'in-flight coordinate work cannot overwrite a newer camera');

  hold = gate(); const cancelGate = hold;
  const running = update(text(1.8)); await cancelGate.entered;
  const rollback = update(xyz); cancelGate.release();
  assert.deepEqual(await Promise.all([running, rollback]), [{ ok: true }, { ok: true }]);
  assert.equal(position(), 1, 'queued cancellation restores exact original coordinates');
  assert.equal(pauses, 0);
  assert.equal(plugin.canvas3d.props.camera.manualReset, false);

  hold = gate(); const queueGate = hold;
  const foreign = state.build().to(seed).update({ data: 'newer user edit' }).commit({ canUndo: 'Foreign scene edit' });
  await queueGate.entered;
  let ownsFrame = true;
  const waiting = update(text(3), BuretteGeometry.capture(plugin, () => ownsFrame));
  const rejectedAdmission = waiting.then(() => false, error => error.name);
  ownsFrame = false; queueGate.release(); await foreign;
  assert.equal(await rejectedAdmission, 'AbortError');
  assert.equal(position(), 1, 'a replaced owner waiting in the actual state queue cannot mutate');
  assert.equal(state.latestUndoLabel, 'Foreign scene edit', 'late rejection preserves newer native history');

  // Exercise the actual viewer dispatcher and its real message ACK wrapper.
  const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
  const declaration = source.match(/\n  async function executeBuretteAgentAction\(action\) \{[\s\S]*?\n  \}/u)[0];
  const globals = source.slice(source.indexOf('  let geometryPreviewRequest ='), source.indexOf(declaration));
  const start = source.indexOf("  window.addEventListener('message', event => {", source.indexOf(declaration));
  const end = source.indexOf('  window.BuretteViewerActions =', start);
  const actionFailure = source.match(/\n  function agentActionFailure\(command, code, message\) \{[\s\S]*?\n  \}/u)[0];
  let active = viewer, loader = async () => { window.BuretteGeometryPreview = runtime; }, listener;
  window.addEventListener = (_name, callback) => { listener = callback; };
  const receive = new Function('window', 'activeMolstarViewer', 'loadScript', 'runtimeURL',
    `${globals}\n${declaration}\n${actionFailure}\n${source.slice(start, end)}\nreturn executeBuretteAgentAction;`)(window, () => active, (...args) => loader(...args), (_key, fallback) => fallback);
  let runtimeBinding;
  const read = async () => { runtimeBinding = (await receive({ type: 'geometry_binding' })).result; };
  const message = (id, value) => new Promise(resolve => listener({ data: { source: 'burette-agent-host', body: { type: 'agent-action', id,
    action: { type: 'update_geometry', text: value, lease: runtimeBinding.lease, label: 'fixture', notify: false } } }, source: { postMessage: resolve } }));
  await read();
  window.BuretteGeometryPreview = undefined;
  let load = gate(); loader = async () => { load.start(); await load.waiting; window.BuretteGeometryPreview = runtime; };
  const replacedViewer = message('old-viewer', text(2)); await load.entered;
  active = { plugin }; load.release();
  const rejectedViewer = await replacedViewer;
  assert.equal(rejectedViewer.body.id, 'old-viewer'); assert.equal(rejectedViewer.body.result.ok, false);
  assert.equal(position(), 1, 'same atoms in a replacement viewer cannot authorize a stale request');
  active = viewer; window.BuretteGeometryPreview = undefined; load = gate();
  const replacedSource = message('old-source', text(2)); await load.entered;
  await state.build().to(raw).update({ data: xyz.replace('original comment', 'new source') }).commit({ canUndo: 'New source' });
  load.release();
  assert.equal((await replacedSource).body.result.ok, false);
  assert.equal(position(), 1);
  assert.equal(state.latestUndoLabel, 'New source');
  window.BuretteGeometryPreview = undefined; loader = async () => { throw new Error('module load failed'); };
  assert.equal((await message('load-fail', text(2))).body.result.ok, false);
  loader = async () => { window.BuretteGeometryPreview = runtime; };
  await read();
  assert.equal((await message('retry', text(2))).body.result.ok, true);
  assert.equal(position(), 2);

  hold = gate(); const ownerGate = hold;
  const lateOwner = message('mid-commit', text(1.9)); await ownerGate.entered;
  active = { plugin };
  camera.setState({ position: [31, 32, 33] }, 0);
  const replacementCamera = camera.getSnapshot(); ownerGate.release();
  assert.equal((await lateOwner).body.result.ok, false, 'an owner replaced during commit never receives a success ACK');
  assert.deepEqual(camera.getSnapshot(), replacementCamera);
  active = viewer;
  assert.equal((await message('new-owner', xyz)).body.result.ok, true);
  assert.equal(position(), 1);
  assert.equal(state.latestUndoLabel, 'New source');
  await plugin.runTask(state.undo());
  assert.equal(raw.cell.obj.data, xyz, 'the real pre-existing source Undo remains usable after live coordinates');
  assert.equal(state.latestUndoLabel, 'Foreign scene edit');
  await plugin.runTask(state.undo());
  assert.equal(state.latestUndoLabel, 'User scene edit');
  await plugin.runTask(state.undo());
  assert.equal(state.cells.has(seed.ref), false);
  assert.equal(state.canUndo, false);
  assert.equal(pauses, 0);
  const parserOwner = BuretteGeometry.capture(plugin);
  await state.build().to(raw).update({ data: text(2) }).commit({ canUndo: 'Native source' });
  await plugin.runTask(state.undo());
  await assert.rejects(update(text(1.8), parserOwner), /changed/, 'native source Undo cannot revive a parser/model StateObject owner');
  await update(text(1.2));
  await state.build().toRoot().apply(StateTransforms.Data.RawData, { data: 'native user edit' }).commit({ canUndo: 'Native edit' });
  await update(text(1.5));
  const staleGeometry = BuretteGeometry.capture(plugin), savedGeometry = state.getSnapshot(), reusedRootVersion = root().transform.version;
  window.BuretteGeometryPreview = undefined; load = gate();
  loader = async () => { load.start(); await load.waiting; window.BuretteGeometryPreview = runtime; };
  await read();
  const beforeUndo = message('before-native-undo', text(1.8)); await load.entered;
  await plugin.runTask(state.undo());
  assert.equal(root().transform.version, reusedRootVersion, 'native Undo can reuse the root version');
  assert.equal(position(), Math.fround(1.2));
  const undone = state.getSnapshot(); load.release();
  assert.equal((await beforeUndo).body.result.ok, false, 'Geometry ownership includes its own transform before lazy-load ACK');
  await assert.rejects(update(text(1.8), staleGeometry), /changed/);
  assert.deepEqual(state.getSnapshot(), undone);
  await plugin.runTask(state.setSnapshot(savedGeometry));
  await assert.rejects(update(text(1.8), staleGeometry), /changed/, 'restoring the same Geometry version cannot revive an old StateObject owner');
  assert.equal(position(), Math.fround(1.5));
  await read();
  assert.equal((await message('after-native-undo', xyz)).body.result.ok, true, 'a fresh owner remains usable after native Undo/snapshot restore');
  await state.build().toRoot().apply(StateTransforms.Data.RawData, { data: 'ordinary undo' }).commit({ canUndo: 'Ordinary' });
  await state.build().toRoot().apply(StateTransforms.Data.RawData, { data: 'ordinary update' }).commit();
  assert.equal(state.canUndo, false, 'unguarded ordinary updates retain the pinned default history behavior');
  const sameSnapshot = state.getSnapshot(), oldCell = root();
  window.BuretteGeometryPreview = undefined; load = gate();
  loader = async () => { load.start(); await load.waiting; window.BuretteGeometryPreview = runtime; };
  const beforeReopen = message('before-identical-reopen', text(2)); await load.entered;
  await plugin.clear(); await plugin.runTask(state.setSnapshot(sameSnapshot));
  assert.notEqual(root(), oldCell, 'restoring identical transform versions recreates a real source owner');
  load.release(); assert.equal((await beforeReopen).body.result.ok, false);
  await read();
  assert.equal((await message('reopened-identical', text(1.1))).body.result.ok, true);
  const sourceXYZ = '3\nsource\nH 0 0 0\nC 1 0 0\nO 2 0 0\n', editedXYZ = '3\nsource\nH 11 0 0\nC 22 0 0\nO 33 0 0\n';
  for (const original of [sourceXYZ, sourceXYZ.replaceAll('\n', '\r\n'), sourceXYZ.replaceAll('\n', '\r'), '\uFEFF' + sourceXYZ]) {
    await plugin.clear();
    const input = await plugin.builders.data.rawData({ data: original });
    const frames = await plugin.builders.structure.parseTrajectory(input, 'xyz');
    const atoms = await plugin.builders.structure.createModel(frames);
    const parsed = await plugin.builders.structure.createStructure(atoms);
    assert.equal(parsed.data.elementCount, 3, 'the real XYZ provider accepts this source');
    await update(editedXYZ);
    const unit = root().obj.data.units[0];
    assert.deepEqual(Array.from(unit.elements, atom => [unit.model.atomicHierarchy.atomSourceIndex.value(atom), unit.conformation.x(atom)]), [[0, 11], [1, 22], [2, 33]]);
    assert.equal(input.cell.obj.data, original, 'accepted XYZ line endings/BOM preserve exact Original bytes');
  }
  window.BuretteGeometryPreview = undefined; load = gate();
  loader = async () => { load.start(); await load.waiting; window.BuretteGeometryPreview = runtime; };
  await read();
  const disposed = message('disposed', text(2)); await load.entered;
  plugin.dispose(); load.release();
  assert.equal((await disposed).body.result.ok, false, 'a disposed runtime cannot acknowledge an update');
  console.log('Geometry runtime contracts passed: exact owner ACK, queue/cancel/rollback, native Undo, science source and camera.');
} finally {
  plugin.dispose(); globalThis.document = previous; await dom.happyDOM.close();
}
