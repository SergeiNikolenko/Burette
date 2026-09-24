import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { Structure, StructureElement } from 'molstar/lib/mol-model/structure.js';
import { SymmetryOperator } from 'molstar/lib/mol-math/geometry.js';
import { Mat4 } from 'molstar/lib/mol-math/linear-algebra.js';
import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { PluginStateTransform, PluginStateObject as SO } from 'molstar/lib/mol-plugin-state/objects.js';
import { Task } from 'molstar/lib/mol-task/index.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';
import { StateBuilder } from 'molstar/lib/mol-state/state/builder.js';
import vm from 'node:vm';
import { BuretteSelection } from '../../scripts/molstar-selection-facade.js';
import { listSceneLayers, patchSceneLayers } from '../../scripts/molstar-scene-layers.js';

const dom = new Window(); globalThis.document = dom.document;
const plugin = new PluginContext(DefaultPluginSpec());
let agent;
try {
  await plugin.init();
  const cif = await readFile(new URL('../../samples/mini.cif', import.meta.url), 'utf8');
  const objects = [];
  for (let i = 0; i < 2; i++) {
    const data = await plugin.builders.data.rawData({ data: cif });
    const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
    const model = await plugin.builders.structure.createModel(trajectory);
    objects.push(await plugin.builders.structure.createStructure(model));
  }
  const state = plugin.state.data;
  const userComponent = await plugin.builders.structure.tryCreateComponentStatic(objects[0], 'all');
  const userRepresentation = await plugin.builders.structure.representation.addRepresentation(userComponent, { type: 'ball-and-stick' });
  let revision = 1;
  for (const event of [state.events.changed, state.events.cell.stateUpdated]) event.subscribe(() => revision++);
  const resolve = operation => {
    const entry = objects.find(object => object.ref === operation.structureId);
    assert.ok(entry);
    const indices = operation.expression.indices;
    return { entry, loci: StructureElement.Loci(entry.data, [{ unit: entry.data.units[0], indices: OrderedSet.ofSortedArray(Int32Array.from(indices)) }]) };
  };
  const patch = (operations, options = {}) => {
    const expectedRevision = revision;
    return patchSceneLayers(plugin, { operations, resolve, check() { assert.equal(revision, expectedRevision, 'STALE_REVISION'); }, ...options });
  };
  const appearance = { type: 'ball-and-stick', color: { name: 'uniform', value: '#ff0000' }, opacity: 1 };
  const create = (layerId, object = 0, indices = [0, 1]) => ({ type: 'create', layerId, structureId: objects[object].ref,
    expression: { indices }, appearance });
  const snapshot = () => state.getSnapshot();
  const unchanged = async action => {
    const before = snapshot(), beforeRevision = revision;
    await action();
    assert.deepEqual(snapshot(), before); assert.equal(revision, beforeRevision);
  };
  const seedHistory = async () => {
    for (let i = 1; i <= 5; i++) await state.build().toRoot().apply(StateTransforms.Data.RawData, { data: String(i) }).commit({ canUndo: String(i) });
  };
  const drainHistory = async expected => {
    const labels = [];
    while (state.canUndo) { labels.push(state.latestUndoLabel); await plugin.runTask(state.undo()); }
    assert.deepEqual(labels, expected);
  };
  await unchanged(() => patch([create('a')], { dryRun: true }));
  await plugin.runTask(state.transaction(async () => {
    await unchanged(() => assert.rejects(patch([create('a')]), /independent Undo/));
  }));
  for (const operations of [[create('a'), create('a')], [create('a', 0, [])], [{ ...create('a'), appearance: { ...appearance, type: 'nonexistent' } }], [{ type: 'delete', layerId: 'missing' }]]) {
    await unchanged(() => assert.rejects(patch(operations)));
  }
  await patch([create('a'), { ...create('b', 0, [1, 2]), appearance: { ...appearance, type: 'spacefill' } }, create('c', 1)]);
  const layers = listSceneLayers(plugin);
  assert.equal(layers.length, 3);
  for (let i = 0; i < 3; i++) {
    const layer = layers[i], cell = state.cells.get(layer.componentRef);
    assert.equal(layer.parentRef, objects[i === 2 ? 1 : 0].ref);
    assert.deepEqual(Array.from(cell.obj.data.units[0].elements), i === 1 ? [1, 2] : [0, 1]);
    assert.equal(state.cells.get(layer.representationRef).transform.parent, layer.componentRef);
  }
  await unchanged(() => patch([{ type: 'update', layerId: 'a', visible: true }]));
  const beforeSelection = snapshot();
  await patch([{ type: 'update', layerId: 'b', structureId: objects[0].ref, expression: { indices: [2, 3] }, label: 'Updated subset' }]);
  const changedLayer = listSceneLayers(plugin)[1];
  assert.deepEqual(Array.from(state.cells.get(changedLayer.componentRef).obj.data.units[0].elements), [2, 3]);
  assert.equal(changedLayer.appearance.type, 'spacefill');
  assert.equal(changedLayer.label, 'Updated subset');
  await plugin.runTask(state.undo()); assert.deepEqual(snapshot(), beforeSelection);
  const userBefore = [state.cells.get(userComponent.ref).transform, state.cells.get(userRepresentation.ref).params.values,
    state.cells.get(userRepresentation.ref).obj.data.repr.props];
  const beforeUserEdit = snapshot();
  await state.build().toRoot().apply(StateTransforms.Data.RawData, { data: 'user-note' }).commit({ canUndo: 'User note' });
  const beforeMixed = snapshot();
  await patch([create('d'), { type: 'update', layerId: 'b', appearance: { ...appearance, opacity: 0.3 }, visible: false }, { type: 'delete', layerId: 'c' }]);
  assert.deepEqual(listSceneLayers(plugin).map(layer => layer.layerId), ['a', 'b', 'd']);
  const hidden = listSceneLayers(plugin).find(layer => layer.layerId === 'b');
  assert.equal(hidden.visible, false); assert.equal(hidden.representationVisible, false);
  assert.deepEqual([state.cells.get(userComponent.ref).transform, state.cells.get(userRepresentation.ref).params.values,
    state.cells.get(userRepresentation.ref).obj.data.repr.props], userBefore);
  await plugin.runTask(state.undo());
  assert.deepEqual(snapshot(), beforeMixed);
  assert.ok(listSceneLayers(plugin).every(layer => layer.visible && layer.representationVisible));
  assert.equal(state.latestUndoLabel, 'User note');
  await plugin.runTask(state.undo()); assert.deepEqual(snapshot(), beforeUserEdit);
  const beforeVisibility = snapshot(), beforeRevision = revision;
  await patch([{ type: 'update', layerId: 'a', visible: false }]);
  assert.equal(listSceneLayers(plugin)[0].representationVisible, false); assert.ok(revision > beforeRevision);
  await plugin.runTask(state.undo());
  assert.deepEqual(snapshot(), beforeVisibility); assert.equal(listSceneLayers(plugin)[0].representationVisible, true);

  // Both children and reverse dependencies outside the layer must survive.
  const foreign = PluginStateTransform.BuiltIn({ name: 'layer-foreign-fixture', from: [SO.Molecule.Structure], to: SO.Molecule.Structure })({
    apply({ a }) { return new SO.Molecule.Structure(a.data); },
  });
  const implicitForeign = PluginStateTransform.BuiltIn({ name: 'layer-implicit-dependency-fixture', from: SO.Molecule.Structure,
    to: SO.Molecule.Structure, params: { sourceRef: PD.Text('') } })({
    getDependencies: params => [params.sourceRef],
    apply({ a }) { return new SO.Molecule.Structure(a.data); },
  });
  const own = listSceneLayers(plugin)[0];
  for (const setup of [
    () => state.build().to(own.componentRef).apply(foreign).commit(),
    () => state.build().to(objects[1]).apply(foreign, {}, { dependsOn: [own.representationRef] }).commit(),
    () => state.build().to(objects[1]).apply(implicitForeign, { sourceRef: own.representationRef }).commit(),
  ]) {
    const external = await setup();
    for (const type of ['update', 'delete']) for (const dryRun of [false, true]) {
      await unchanged(() => assert.rejects(patch([{ type, layerId: 'a', ...(type === 'update' ? { visible: false } : {}) }], { dryRun }), /foreign/));
    }
    await state.build().delete(external).commit();
  }

  // Admission after queued work must include in-place UI visibility edits.
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const blocker = PluginStateTransform.BuiltIn({ name: 'layer-queue-fixture', from: [SO.Molecule.Structure], to: SO.Molecule.Structure })({
    apply({ a }) { return Task.create('Hold layer fixture', async () => { started(); await gate; return new SO.Molecule.Structure(a.data); }); },
  });
  await seedHistory();
  const queued = state.build().to(objects[1]).apply(blocker).commit({ canUndo: 'Hold' });
  await waiting;
  const stale = patch([{ type: 'update', layerId: 'a', visible: false }]);
  const mutableTree = state.tree;
  state.updateCellState(userRepresentation.ref, { isHidden: true });
  assert.equal(state.tree, mutableTree);
  release(); await queued;
  await assert.rejects(stale, /STALE_REVISION/);
  assert.equal(state.cells.get(userRepresentation.ref).state.isHidden, true);
  assert.equal(listSceneLayers(plugin)[0].visible, true);
  await drainHistory(['Hold', '5', '4', '3', '2']);

  // A later representation failure must revert earlier create/update/delete.
  const registry = plugin.representation.structure.registry;
  const originalProvider = registry.get('spacefill');
  let failOnce = true;
  let beforeLateFailure;
  registry.remove(originalProvider);
  registry.add({ ...originalProvider, factory(...args) {
    if (failOnce) {
      beforeLateFailure = { alpha: state.cells.get(own.representationRef).obj.data.repr.props.alpha,
        deleted: !state.cells.has(layers[2].componentRef) };
      failOnce = false; throw new Error('deliberate late layer failure');
    }
    return originalProvider.factory(...args);
  } });
  try {
    await seedHistory();
    const beforeFailure = snapshot();
    const propsBefore = state.cells.get(own.representationRef).obj.data.repr.props.alpha;
    await assert.rejects(patch([
      { type: 'update', layerId: 'a', appearance: { ...appearance, opacity: 0.2 }, visible: false },
      { type: 'delete', layerId: 'c' },
      { ...create('failing'), appearance: { ...appearance, type: 'spacefill' } },
    ]), /failed|reverted/);
    assert.deepEqual(beforeLateFailure, { alpha: 0.2, deleted: true });
    assert.deepEqual(snapshot(), beforeFailure);
    assert.equal(state.cells.get(own.representationRef).obj.data.repr.props.alpha, propsBefore);
    assert.equal(listSceneLayers(plugin)[0].representationVisible, true);
    await drainHistory(['5', '4', '3', '2', '1']);
    await patch([create('fresh')]);
  } finally { registry.remove(registry.get('spacefill')); registry.add(originalProvider); }
  const context = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, window: { molstar: { BuretteSelection } } };
  vm.createContext(context);
  vm.runInContext(await readFile(new URL('../../PreviewExtension/Web/burette-agent.js', import.meta.url), 'utf8'), context);
  agent = context.window.BuretteAgent;
  agent.attach({ viewer: { plugin }, plugin, config: { documentId: 'scene-layers-fixture' } });
  agent.notifyStructureLoaded();
  const run = async (command, args) => {
    const reply = await agent.run({ command, args }); assert.equal(reply.ok, true, JSON.stringify(reply.error)); return reply.result;
  };
  const query = () => run('queryAtoms', { selectionVersion: 1, expression: { kind: 'all' } });
  const layerArgs = page => ({ selectionVersion: 1, sceneId: page.sceneId, expectedRevision: page.revision });
  const originalAtoms = await query(), exactAtom = originalAtoms.atoms.find(atom => atom.structureId === objects[0].ref);
  await run('patchSceneLayers', { ...layerArgs(originalAtoms), operations: [{ type: 'create', layerId: 'exact-facade',
    structureId: objects[0].ref, expression: { ids: [exactAtom.id] }, appearance }] });
  const exactLayer = (await run('listSceneLayers', { selectionVersion: 1 })).layers.find(layer => layer.layerId === 'exact-facade');
  assert.equal(exactLayer.atomCount, 1);
  assert.equal(exactLayer.parentRef, objects[0].ref);
  assert.deepEqual(Array.from(state.cells.get(exactLayer.componentRef).obj.data.units[0].elements), [exactAtom.atom_index]);
  const stalePatch = await agent.run({ command: 'patchSceneLayers', args: { ...layerArgs(originalAtoms),
    operations: [{ type: 'delete', layerId: 'exact-facade' }] } });
  assert.equal(stalePatch.error.code, 'STALE_REVISION');
  const delta = Mat4.identity(); delta[12] = 7;
  const externalTransform = await state.build().to(objects[0]).insert(StateTransforms.Model.TransformStructureConformation,
    { transform: { name: 'matrix', params: { data: delta, transpose: false } } }).commit();
  const alignedAtoms = await query();
  await run('patchSceneLayers', { ...layerArgs(alignedAtoms), operations: [{ type: 'update', layerId: 'exact-facade',
    structureId: objects[0].ref, expression: { ids: [exactAtom.id] }, appearance: { ...appearance, opacity: 0.7 } }] });
  const alignedLayer = (await run('listSceneLayers', { selectionVersion: 1 })).layers.find(layer => layer.layerId === 'exact-facade');
  assert.equal(alignedLayer.componentRef, exactLayer.componentRef);
  assert.equal(state.cells.get(alignedLayer.componentRef).obj.data.units[0].conformation.operator.matrix[12], 7);
  assert.deepEqual(Array.from((await query()).atoms, atom => atom.position), Array.from(alignedAtoms.atoms, atom => atom.position));
  await state.build().to(externalTransform).update({ transform: { name: 'matrix', params: { data: Mat4.identity(), transpose: false } } }).commit();
  // Equal per-unit index sets get regrouped by Bundle; membership must survive.
  const copies = Structure.create([0, 1, 2].map(id => {
    const matrix = Mat4.identity(); matrix[12] = id * 10;
    return objects[0].data.units[0].applyOperator(id, SymmetryOperator.create(`copy-${id}`, matrix));
  }));
  const copiesTransform = PluginStateTransform.BuiltIn({ name: 'layer-unit-copies-fixture', from: SO.Root, to: SO.Molecule.Structure })({
    apply() { return new SO.Molecule.Structure(copies); },
  });
  const copiesEntry = await state.build().toRoot().apply(copiesTransform).commit();
  const copyLoci = StructureElement.Loci(copies, copies.units.map((unit, i) => ({ unit, indices: OrderedSet.ofSingleton(i === 1 ? 1 : 0) })));
  const rawRoundTrip = StructureElement.Bundle.toLoci(StructureElement.Bundle.fromLoci(copyLoci), copies);
  assert.equal(StructureElement.Loci.areEqual(copyLoci, rawRoundTrip), false);
  await patch([{ ...create('operator-copies'), structureId: copiesEntry.ref }], { resolve: () => ({ entry: copiesEntry, loci: copyLoci }) });
  const copyLayer = listSceneLayers(plugin).find(layer => layer.layerId === 'operator-copies');
  assert.deepEqual(state.cells.get(copyLayer.componentRef).obj.data.units.map(unit => [unit.id, Array.from(unit.elements)]), [[0, [0]], [1, [1]], [2, [0]]]);
  const nearLimit = state.build();
  for (let i = state.tree.transforms.size; i < 9999; i++) nearLimit.toRoot().apply(StateTransforms.Data.RawData, { data: '' });
  // Only admission is under test here: avoid executing 9900 unrelated raw-data
  // transformers. Use the real immutable Mol* tree and original structure cells.
  const boundaryTree = nearLimit.getTree();
  const boundaryState = { tree: boundaryTree, cells: state.cells, burettePreconditionVersion: 1,
    build: () => new StateBuilder.Root(boundaryTree), updateTree() { assert.fail('Overflow must never reach commit'); } };
  const boundaryPlugin = { state: { data: boundaryState }, representation: plugin.representation };
  for (const dryRun of [true, false]) await unchanged(() => assert.rejects(patchSceneLayers(boundaryPlugin,
    { operations: [create('overflow', 1)], resolve, check() {}, dryRun }), /10000 state nodes/));
  console.log('Scene layer contracts passed');
} finally { agent?.detach(); plugin.dispose(); dom.happyDOM.abort(); }
