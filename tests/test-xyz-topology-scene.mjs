import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { Model } from '@molstar/model/model/structure/model/model';
import { setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import { PluginStateSnapshotManager } from '@molstar/plugin/state/manager/snapshots';
import { Canvas3DParams } from '@molstar/graphics/canvas3d/canvas3d';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { StructureElement } from '@molstar/model/model/structure';
import { OrderedSet } from '@molstar/core/data/int';
import { StateTransforms } from '@molstar/viewer/state-transforms';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { PluginStateTransform, PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { BuretteGeometry } from '../scripts/molstar-geometry.js';
import { BuretteTopologyScene } from '../scripts/molstar-topology-scene.js';
import { patchSceneLayers, listSceneLayers } from '../scripts/molstar-scene-layers.js';

const dom = new Window(), previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: dom.document });
const plugins = [], canvases = [];
setCanvasModule({ createCanvas: () => ({ getContext: () => ({ measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) });
const scope = { molstar: { BuretteGeometry, lib: { structure: { StructureElement } } } };
for (const name of ['scene-file-actions', 'measurement-coordinate']) vm.runInNewContext(
  readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), 'utf8'),
  { window: scope, crypto, TextEncoder, TextDecoder, Uint8Array, Float64Array, File });
const measurement = scope.BuretteMeasurementCoordinate, science = scope.BuretteSceneFiles.science;
function cameraFor(plugin) {
  if (plugin.canvas3d) return plugin.canvas3d.camera;
  const original = plugin.canvas3d, camera = new Camera(); canvases.push([plugin, original]);
  plugin.canvas3d = { camera, props: structuredClone(PD.getDefaultValues(Canvas3DParams)), setProps(props) { for (const [key, value] of Object.entries(props)) this.props[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...this.props[key], ...structuredClone(value) } : value; }, pause() {}, resume() {}, commit() {}, add() {}, remove() {}, commit() {}, syncVisibility() {}, mark() {}, requestCameraReset({ snapshot }) { camera.setState(snapshot, 0); } };
  return camera;
}
const xyz = '4\nfixture\nO 0 0 0\nH 1 0 0\nH 0 1 0\nC 0 0 1\n';
async function make(text = xyz, label = 'Original data') {
  const plugin = new PluginContext(DefaultPluginSpec()); plugins.push(plugin); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text, label });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
  cameraFor(plugin);
  const root = plugin.managers.structure.hierarchy.current.structures[0].cell;
  const component = await plugin.builders.structure.tryCreateComponentStatic(root.transform.ref, 'all');
  await plugin.builders.structure.representation.addRepresentation(component, { type: 'ball-and-stick', color: 'element-symbol', typeParams: { alpha: 0.6 } });
  const loci = indices => StructureElement.Loci(root.obj.data, [{ unit: root.obj.data.units[0], indices: OrderedSet.ofSortedArray(Int32Array.from(indices)) }]);
  return { plugin, root, raw, component, loci, lease: () => BuretteGeometry.binding(plugin).lease };
}
function payload(value) { const { receipt, ...transfer } = value; return structuredClone(transfer); }
function unchanged(view, action) {
  const before = structuredClone(view.plugin.state.data.getSnapshot()); action(); assert.deepEqual(view.plugin.state.data.getSnapshot(), before);
}
try {
  const old = await make();
  await patchSceneLayers(old.plugin, { operations: [{ type: 'create', layerId: 'oxygen-carbon', structureId: old.root.transform.ref,
    expression: { atoms: [0, 3] }, appearance: { type: 'spacefill', color: { name: 'uniform', value: '#12ab34' }, opacity: 0.4 }, label: 'Exact atoms 漢字', visible: false }],
    check() {}, resolve() { return { entry: { ref: old.root.transform.ref, data: old.root.obj.data }, loci: old.loci([0, 3]) }; } });
  const initialLease = old.lease();
  await BuretteGeometry.update(old.plugin, xyz.replace('H 1 0 0', 'H 1.1 0 0'), BuretteGeometry.capture(old.plugin, () => true, initialLease));
  const tagRoles = { raw: StateTransforms.Data.RawData, trajectory: StateTransforms.Model.TrajectoryFromXYZ, baseModel: StateTransforms.Model.ModelFromTrajectory,
    root: StateTransforms.Model.StructureFromModel, modelProperties: StateTransforms.Model.CustomModelProperties, structureProperties: StateTransforms.Model.CustomStructureProperties };
  for (const [role, type] of Object.entries(tagRoles)) {
    const node = [...old.plugin.state.data.cells.values()].find(c => c.transform.transformer === type);
    await old.plugin.state.data.build().to(node).tag(`source-fixture:${role}`).commit();
  }
  old.plugin.managers.structure.selection.fromLoci('set', old.loci([1, 3]), false);
  const sourceCamera = cameraFor(old.plugin); sourceCamera.setState({ position: [8, 9, 10], target: [1, 2, 3], radius: 4 }, 0);
  old.plugin.canvas3d.props.renderer.backgroundColor = 0x123456;
  const before = structuredClone(old.plugin.state.data.getSnapshot()), lease = old.lease(), captured = BuretteTopologyScene.capture(old.plugin, lease);
  assert.deepEqual(old.plugin.state.data.getSnapshot(), before, 'capture is read-only');
  assert.equal(BuretteTopologyScene.validate(old.plugin, captured.receipt, lease), true);
  const unchangedTree = old.plugin.state.data.tree, background = old.plugin.canvas3d.props.renderer.backgroundColor;
  old.plugin.canvas3d.props.renderer.backgroundColor = 0x654321;
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.validate(old.plugin, captured.receipt, lease), /viewer settings changed/));
  old.plugin.canvas3d.props.renderer.backgroundColor = background;
  old.plugin.managers.snapshot.add(PluginStateSnapshotManager.Entry(old.plugin.state.getSnapshot()));
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.validate(old.plugin, captured.receipt, lease), /snapshot library changed/));
  old.plugin.managers.snapshot.clear();
  assert.equal(old.plugin.state.data.tree, unchangedTree);
  const currentReceipt = BuretteTopologyScene.capture(old.plugin, lease);
  assert.equal(BuretteTopologyScene.validate(old.plugin, currentReceipt.receipt, lease), true);

  const transfer = payload(captured), layer = transfer.components.find(c => c.layerId === 'oxygen-carbon');
  assert.deepEqual(layer.indices, [0, 3]); assert.equal(layer.params.label, 'Exact atoms 漢字'); assert.equal(layer.representations[0].state.isHidden, true);
  const target = await make('5\nreordered\nC 0 0 1\nH 1 0 0\nO 0 0 0\nH 0 1 0\nHe 0 0 2\n', 'New candidate');
  const targetCamera = cameraFor(target.plugin);
  transfer.atomCount = 5; layer.indices = [0, 2]; transfer.selection = [0, 1]; // exact new→old map [3,1,0,2,-1], inverted by host
  assert.equal(await BuretteTopologyScene.restore(target.plugin, transfer), true);
  assert.deepEqual(target.plugin.canvas3d.props, old.plugin.canvas3d.props, 'C3 restores full canvas settings before final camera');
  const current = BuretteTopologyScene.capture(target.plugin, target.lease());
  assert.equal(target.root.obj.data.models[0].atomicHierarchy.atoms.label_atom_id.value(4), 'He');
  assert.equal(target.root.obj.data.models[0].atomicHierarchy.atoms.type_symbol.value(4), 'HE');
  assert.deepEqual(current.sourceTags, captured.sourceTags, 'all six native source roles retain exact provenance tags');
  const targetLayer = current.components.find(c => c.layerId === layer.layerId);
  assert.deepEqual(targetLayer, layer, 'full owned-layer parameters, label, tags and flags survive a reorder');
  assert.deepEqual(current.selection, [0, 1]); assert.equal(current.focus, null); assert.deepEqual(targetCamera.getSnapshot(), sourceCamera.getSnapshot());
  assert.deepEqual(current.components.find(c => c.kind === 'static'), transfer.components.find(c => c.kind === 'static'));
  assert.deepEqual(target.raw.cell.params.values.data, '5\nreordered\nC 0 0 1\nH 1 0 0\nO 0 0 0\nH 0 1 0\nHe 0 0 2\n', 'candidate source bytes are not rewritten by scene transfer');
  const all = [...target.plugin.state.data.cells.values()].find(c => c.transform.transformer === StateTransforms.Model.StructureComponent && c.params.values.type.name === 'static');
  assert.equal(all.obj.data.elementCount, 5, 'static all includes the inserted atom');
  assert.equal(target.raw.cell.params.values.label, 'Original data');
  assert.equal(listSceneLayers(target.plugin)[0].layerId, 'oxygen-carbon');
  assert.equal(listSceneLayers(target.plugin)[0].visible, false);
  const deleted = await make('3\ndeleted\nH 1 0 0\nO 0 0 0\nH 0 1 0\n');
  const withoutLayer = payload(captured); withoutLayer.atomCount = 3; withoutLayer.selection = [0]; withoutLayer.components = withoutLayer.components.filter(c => c.kind !== 'bundle');
  await BuretteTopologyScene.restore(deleted.plugin, withoutLayer); assert.equal(listSceneLayers(deleted.plugin).length, 0);
  const undo = await make(); await BuretteTopologyScene.restore(undo.plugin, payload(captured));
  assert.deepEqual(BuretteTopologyScene.capture(undo.plugin, undo.lease()).components, payload(captured).components, 'revision snapshot restores deleted layer on Undo');

  const hiddenReceipt = BuretteTopologyScene.capture(old.plugin, lease);
  old.plugin.state.data.updateCellState(old.component.ref, { isHidden: true });
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.validate(old.plugin, hiddenReceipt.receipt, lease), /scene changed/));
  old.plugin.state.data.updateCellState(old.component.ref, { isHidden: false });
  const cameraReceipt = BuretteTopologyScene.capture(old.plugin, lease); sourceCamera.setState({ position: [9, 9, 10] }, 0);
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.validate(old.plugin, cameraReceipt.receipt, lease), /scene changed/));
  const selectedReceipt = BuretteTopologyScene.capture(old.plugin, lease);
  old.plugin.managers.structure.selection.fromLoci('add', old.loci([1]));
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.validate(old.plugin, selectedReceipt.receipt, lease), /scene changed/));
  old.plugin.managers.structure.selection.clear();
  const focused = await make(); focused.plugin.managers.structure.focus.setFromLoci(focused.loci([0]));
  unchanged(focused, () => assert.throws(() => BuretteTopologyScene.capture(focused.plugin, focused.lease()), /Clear native focus/));
  const model = old.root.obj.data.models[0], atomNames = model.atomicHierarchy.atoms.label_atom_id, originalValue = atomNames.value;
  atomNames.value = i => i === 1 ? 'custom atom name' : originalValue(i);
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /noncanonical atom metadata/)); atomNames.value = originalValue;
  const chemical = model.properties.chemicalComponentMap.get('MOL'), chemicalName = chemical.name; chemical.name = 'Custom residue metadata';
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /noncanonical chemical metadata/)); chemical.name = chemicalName;
  model._staticPropertyData.foreignAtomMetadata = { residue: 'kept or refused' };
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /unsupported atom properties/)); delete model._staticPropertyData.foreignAtomMetadata;
  old.root.obj.data.currentPropertyData.foreign = { data: { value: ['metadata'] } };
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /Unsupported structure metadata/)); delete old.root.obj.data.currentPropertyData.foreign;
  const repr = [...old.plugin.state.data.cells.values()].find(c => c.transform.transformer === StateTransforms.Representation.StructureRepresentation3D).obj.data.repr;
  repr.setState({ transform: [1,0,0,0,0,1,0,0,0,0,1,0,2,0,0,1] });
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /Custom visual decorations/)); repr.setState({ transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] });
  const supportedVisual = repr.state.alphaFactor; repr.setState({ alphaFactor: 0.75, pickable: false });
  const visualCopy = BuretteTopologyScene.capture(old.plugin, lease);
  const visualTarget = await make(); await BuretteTopologyScene.restore(visualTarget.plugin, payload(visualCopy));
  assert.deepEqual(BuretteTopologyScene.capture(visualTarget.plugin, visualTarget.lease()).components, visualCopy.components); repr.setState({ alphaFactor: supportedVisual, pickable: true });
  const props = [...old.plugin.state.data.cells.values()].find(c => c.transform.transformer === StateTransforms.Model.CustomModelProperties);
  props.params.values.properties.foreign = { value: 1 };
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /custom property provider/)); delete props.params.values.properties.foreign;
  const unknownProvider = await make(); unknownProvider.root.obj.data.models[0].customProperties.add({ name: 'foreign-atom-property' });
  unchanged(unknownProvider, () => assert.throws(() => BuretteTopologyScene.capture(unknownProvider.plugin, unknownProvider.lease()), /unsupported atom properties/));
  const foreign = await old.plugin.state.data.build().toRoot().apply(StateTransforms.Data.RawData, { data: 'foreign state' }).commit();
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /unsupported scene object/)); await old.plugin.state.data.build().delete(foreign).commit();
  const decorator = PluginStateTransform.BuiltIn({ name: 'topology-foreign-child', from: SO.Molecule.Structure, to: SO.Molecule.Structure })({ apply({ a }) { return new SO.Molecule.Structure(a.data); } });
  const foreignChild = await old.plugin.state.data.build().to(old.component).apply(decorator).commit();
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /foreign component child/)); await old.plugin.state.data.build().delete(foreignChild).commit();
  const styleReceipt = BuretteTopologyScene.capture(old.plugin, lease); repr.setState({ alphaFactor: 0.5 });
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.validate(old.plugin, styleReceipt.receipt, lease), /scene changed/)); repr.setState({ alphaFactor: 1 });
  const malformed = payload(captured); malformed.components.find(c => c.kind === 'bundle').indices = [0, 0];
  const invalidTarget = await make(), invalidBefore = structuredClone(invalidTarget.plugin.state.data.getSnapshot());
  await assert.rejects(BuretteTopologyScene.restore(invalidTarget.plugin, malformed), /Invalid topology source indices/);
  assert.deepEqual(invalidTarget.plugin.state.data.getSnapshot(), invalidBefore);
  const reserved = payload(captured); reserved.sourceTags.raw = ['burette-scene-layer-v1:wrong-role'];
  await assert.rejects(BuretteTopologyScene.restore(invalidTarget.plugin, reserved), /Reserved source tags/);
  for (const tags of [Array.from({ length: 17 }, (_, i) => `tag${i}`), ['x'.repeat(101)], ['duplicate', 'duplicate']]) {
    const badTags = payload(captured); badTags.sourceTags.raw = tags;
    await assert.rejects(BuretteTopologyScene.restore(invalidTarget.plugin, badTags), /Invalid source role tags/);
  }
  assert.deepEqual(invalidTarget.plugin.state.data.getSnapshot(), invalidBefore);
  const huge = payload(captured); huge.components[0].params.label = 'x'.repeat(2 * 1024 * 1024 + 1);
  await assert.rejects(BuretteTopologyScene.restore(invalidTarget.plugin, huge), /transfer limit/);
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, 'stale'), /changed/));
  await old.plugin.managers.structure.measurement.addDistance(old.loci([0]), old.loci([3]), { visualParams: { customText: 'Exact paired distance' } });
  const measured = structuredClone(await measurement.capture(old, science, { sourceFormat: 'xyz', lease }));
  assert.deepEqual(measured.items.map(item => item.points), [[[0], [3]]]);
  const measuredScene = BuretteTopologyScene.capture(old.plugin, lease);
  assert.equal(BuretteTopologyScene.validate(old.plugin, measuredScene.receipt, lease), true);
  await measurement.restore(target, { version: 1, sourceFormat: 'xyz', atomCount: 5,
    targetSourceSha256: createHash('sha256').update(target.raw.cell.params.values.data).digest('hex'),
    items: measured.items.map(item => ({ ...item, points: [[2], [0]] })), group: measured.group }, science);
  const restoredMeasurements = structuredClone(await measurement.capture(target, science, { sourceFormat: 'xyz', lease: target.lease() }));
  assert.deepEqual(restoredMeasurements.items, measured.items.map(item => ({ ...item, points: [[2], [0]] })));
  assert.deepEqual(BuretteTopologyScene.capture(target.plugin, target.lease()).components, current.components, 'C3 can capture after C2 restores real native measurement cells');
  const nativeInverse = Model.getInvertedAtomSourceIndex(target.root.obj.data.models[0]);
  assert.equal(BuretteTopologyScene.capture(target.plugin, target.lease()).atomCount, 5, 'native Loci inverse-source cache is retained as derived data');
  nativeInverse.invertedIndex[0] = 1;
  unchanged(target, () => assert.throws(() => BuretteTopologyScene.capture(target.plugin, target.lease()), /atom-source cache/)); nativeInverse.invertedIndex[0] = 0;
  const group = old.plugin.managers.structure.measurement.getGroup().ref;
  await old.plugin.state.data.build().to(group).update({ label: 'Custom group', description: 'Retain metadata or refuse' }).commit();
  const groupCapture = structuredClone(await measurement.capture(old, science, { sourceFormat: 'xyz', lease }));
  assert.deepEqual(groupCapture.groupParams, { label: 'Custom group', description: 'Retain metadata or refuse' });
  const groupScene = BuretteTopologyScene.capture(old.plugin, lease), groupTarget = await make(xyz.replace('H 1 0 0', 'H 1.1 0 0'));
  await BuretteTopologyScene.restore(groupTarget.plugin, payload(groupScene));
  await measurement.restore(groupTarget, { version: 1, sourceFormat: 'xyz', atomCount: 4, targetSourceSha256: groupCapture.sourceSha256,
    items: groupCapture.items, group: groupCapture.group, groupParams: groupCapture.groupParams, groupTags: groupCapture.groupTags }, science);
  const groupRestored = structuredClone(await measurement.capture(groupTarget, science, { sourceFormat: 'xyz', lease: groupTarget.lease() }));
  assert.deepEqual([groupRestored.groupParams, groupRestored.items], [groupCapture.groupParams, groupCapture.items]);
  assert.equal(BuretteTopologyScene.capture(groupTarget.plugin, groupTarget.lease()).atomCount, 4);
  const gm = groupTarget.plugin.managers.structure.measurement, gl = groupTarget.loci;
  await gm.addAngle(gl([0]), gl([1]), gl([2])); await gm.addDihedral(gl([0]), gl([1]), gl([2]), gl([3]));
  await gm.addLabel(gl([0, 2])); await gm.addOrientation([gl([0, 1, 2, 3])]); await gm.addPlane([gl([0, 1, 2, 3])]);
  const six = structuredClone(await measurement.capture(groupTarget, science, { sourceFormat: 'xyz', lease: groupTarget.lease() }));
  assert.deepEqual(six.items.map(item => item.kind), ['Distance', 'Angle', 'Dihedral', 'Label', 'Orientation', 'Plane']);
  const sixTarget = await make(xyz.replace('H 1 0 0', 'H 1.1 0 0'));
  await BuretteTopologyScene.restore(sixTarget.plugin, payload(BuretteTopologyScene.capture(groupTarget.plugin, groupTarget.lease())));
  await measurement.restore(sixTarget, { version: 1, sourceFormat: 'xyz', atomCount: 4, targetSourceSha256: six.sourceSha256, items: six.items, group: six.group, groupParams: six.groupParams, groupTags: six.groupTags }, science);
  assert.equal(BuretteTopologyScene.capture(sixTarget.plugin, sixTarget.lease()).atomCount, 4, 'all six native constructor selections remain supported');
  assert.deepEqual(structuredClone(await measurement.capture(sixTarget, science, { sourceFormat: 'xyz', lease: sixTarget.lease() })).items, six.items);
  const nativeReopened = new PluginContext(DefaultPluginSpec()); plugins.push(nativeReopened); await nativeReopened.init();
  await nativeReopened.runTask(nativeReopened.state.data.setSnapshot(JSON.parse(JSON.stringify(sixTarget.plugin.state.data.getSnapshot()))));
  assert.equal(BuretteTopologyScene.capture(nativeReopened, BuretteGeometry.binding(nativeReopened).lease).atomCount, 4, 'native JSON data-tree reopen supports all six constructors including omitted optional groupId');
  const emptySource = await make(), emptyTarget = await make(), emptyBuilder = emptySource.plugin.managers.structure.measurement.getGroup();
  await emptyBuilder.tag('empty-group-provenance').update({ label: 'Empty group', description: 'No measurements yet' }).commit();
  const emptyCapture = structuredClone(await measurement.capture(emptySource, science, { sourceFormat: 'xyz', lease: emptySource.lease() }));
  await BuretteTopologyScene.restore(emptyTarget.plugin, payload(BuretteTopologyScene.capture(emptySource.plugin, emptySource.lease())));
  await measurement.restore(emptyTarget, { version: 1, sourceFormat: 'xyz', atomCount: 4, targetSourceSha256: emptyCapture.sourceSha256,
    items: [], group: emptyCapture.group, groupParams: emptyCapture.groupParams, groupTags: emptyCapture.groupTags }, science);
  assert.deepEqual(structuredClone(await measurement.capture(emptyTarget, science, { sourceFormat: 'xyz', lease: emptyTarget.lease() })).groupParams, emptyCapture.groupParams);
  assert.deepEqual(structuredClone(await measurement.capture(emptyTarget, science, { sourceFormat: 'xyz', lease: emptyTarget.lease() })).groupTags, emptyCapture.groupTags);
  assert.equal(BuretteTopologyScene.capture(emptyTarget.plugin, emptyTarget.lease()).atomCount, 4);
  const secondGroup = await old.plugin.state.data.build().toRoot().apply(StateTransforms.Misc.CreateGroup, { label: 'Second group' }, { tags: ['measurement-group'] }).commit();
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /Only one normal native measurement group/));
  await old.plugin.state.data.build().delete(secondGroup).commit();
  await old.plugin.state.data.build().to(group).tag('group-provenance:instrument-v2').commit();
  const taggedCapture = structuredClone(await measurement.capture(old, science, { sourceFormat: 'xyz', lease }));
  assert.deepEqual(taggedCapture.groupTags, old.plugin.state.data.cells.get(group).transform.tags);
  const taggedTarget = await make(xyz.replace('H 1 0 0', 'H 1.1 0 0'));
  await taggedTarget.plugin.managers.structure.measurement.getGroup().tag('must-be-replaced').commit();
  await BuretteTopologyScene.restore(taggedTarget.plugin, payload(BuretteTopologyScene.capture(old.plugin, lease)));
  await measurement.restore(taggedTarget, { version: 1, sourceFormat: 'xyz', atomCount: 4, targetSourceSha256: taggedCapture.sourceSha256,
    items: taggedCapture.items, group: taggedCapture.group, groupParams: taggedCapture.groupParams, groupTags: taggedCapture.groupTags }, science);
  const taggedAfter = structuredClone(await measurement.capture(taggedTarget, science, { sourceFormat: 'xyz', lease: taggedTarget.lease() }));
  assert.deepEqual(taggedAfter.groupTags, taggedCapture.groupTags, 'native group tags replace candidate metadata exactly rather than union');
  assert.equal(BuretteTopologyScene.capture(taggedTarget.plugin, taggedTarget.lease()).atomCount, 4);
  const tagReceipt = BuretteTopologyScene.capture(old.plugin, lease), groupTagArray = old.plugin.state.data.cells.get(group).transform.tags;
  groupTagArray.push('late-direct-tag');
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.validate(old.plugin, tagReceipt.receipt, lease), /scene changed/)); groupTagArray.pop();
  await old.plugin.state.data.build().to(group).tag('structure-component-static-all').commit();
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /Reserved measurement group tags/));
  const resetGroupTags = old.plugin.state.data.build();
  resetGroupTags.to(group).updateTagged(old.plugin.state.data.cells.get(group).transform.params, ['measurement-group']); await resetGroupTags.commit();
  const selectionCell = [...old.plugin.state.data.cells.values()].find(c => c.transform.transformer === StateTransforms.Model.MultiStructureSelectionFromBundle);
  await old.plugin.state.data.build().to(selectionCell).tag('unsupported-measurement-provenance').commit();
  unchanged(old, () => assert.throws(() => BuretteTopologyScene.capture(old.plugin, lease), /Custom measurement tags/));
  const resetSelectionTags = old.plugin.state.data.build(); resetSelectionTags.to(selectionCell).updateTagged(selectionCell.transform.params, []); await resetSelectionTags.commit();
  await old.plugin.state.data.build().to(group).update({ label: 'Measurements', description: '' }).commit();
  const taggedGeometry = await make();
  await BuretteGeometry.update(taggedGeometry.plugin, xyz.replace('H 1 0 0', 'H 1.1 0 0'), BuretteGeometry.capture(taggedGeometry.plugin, () => true, taggedGeometry.lease()));
  const geometryCell = [...taggedGeometry.plugin.state.data.cells.values()].find(c => c.transform.transformer.id === 'ms-plugin.burette-geometry-model');
  await taggedGeometry.plugin.state.data.build().to(geometryCell).tag('source-fixture:geometry').commit();
  const taggedLease = taggedGeometry.lease();
  unchanged(taggedGeometry, () => assert.throws(() => BuretteTopologyScene.capture(taggedGeometry.plugin, taggedLease), /Geometry decorator tags/));
  const rootMetadata = await make(); await rootMetadata.plugin.state.data.build().toRoot().tag('unsupported-scene-root-note').commit();
  const rootLease = rootMetadata.lease();
  unchanged(rootMetadata, () => assert.throws(() => BuretteTopologyScene.capture(rootMetadata.plugin, rootLease), /scene-root metadata/));
  const ForeignRaw = PluginStateTransform.BuiltIn({ name: 'topology-foreign-raw-data', from: SO.Root, to: SO.Data.String,
    params: { data: PD.Text(''), label: PD.Text(''), sourceNote: PD.Text('') },
  })({ apply({ params }) { return new SO.Data.String(params.data, { label: params.label }); } });
  const foreignPlugin = new PluginContext(DefaultPluginSpec()); plugins.push(foreignPlugin); await foreignPlugin.init();
  const foreignRaw = await foreignPlugin.state.data.build().toRoot().apply(ForeignRaw, { data: xyz, label: 'Custom import', sourceNote: 'Retain or refuse' }).commit();
  const foreignTrajectory = await foreignPlugin.builders.structure.parseTrajectory(foreignRaw, 'xyz');
  await foreignPlugin.builders.structure.hierarchy.applyPreset(foreignTrajectory, 'default', { representationPreset: 'empty' });
  const foreignLease = BuretteGeometry.binding(foreignPlugin).lease;
  unchanged({ plugin: foreignPlugin }, () => assert.throws(() => BuretteTopologyScene.capture(foreignPlugin, foreignLease), /foreign coordinate decorator/));
  console.log('XYZ topology scene contracts passed: real styles/layers/reorder/Undo, receipt invalidation and fail-closed metadata.');
} finally {
  for (const [plugin, original] of canvases) plugin.canvas3d = original;
  for (const plugin of plugins) plugin.dispose();
  if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  setCanvasModule(undefined);
  await dom.happyDOM.close();
}
