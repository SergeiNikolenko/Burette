import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { PluginStateSnapshotManager as Snapshots } from '@molstar/plugin/state/manager/snapshots';
import { Canvas3DParams, Canvas3DContext } from '@molstar/graphics/canvas3d/canvas3d';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Asset } from '@molstar/core/util/assets';
import { File_ } from '@molstar/core/util/nodejs-shims';
import { unzip } from '@molstar/core/util/zip/zip';
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import { BuretteTopologyEnvironment as Environment } from '../scripts/molstar-topology-environment.js';
const dom = new Window(), previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), plugins = [], calls = [];
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.document });
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom });
const { createViewerSpec } = await import('@molstar/viewer/plugin-spec');
const defaults = PD.getDefaultValues(Canvas3DParams), contextDefaults = PD.getDefaultValues(Canvas3DContext.Params);
function merge(target, changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') merge(target[key], value);
    else target[key] = structuredClone(value);
  }
}
async function make() {
  const plugin = new PluginContext(createViewerSpec({ layoutIsExpanded: true, layoutShowRemoteState: false, pdbProvider: 'rcsb', emdbProvider: 'rcsb', preferWebgl1: true, disableAntialiasing: true })); plugins.push(plugin); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: '1\nOriginal exact\nH 0 0 0\n', label: 'Original exact' });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
  const camera = new Camera(); camera.setState({ radius: 3 }, 0);
  // Public-shape adapters only: the native Plugin/state/archive/Camera below are real; no WebGL claim.
  plugin.canvas3d = { camera, props: structuredClone(defaults), setProps(value) { calls.push(['canvas', structuredClone(value)]); merge(this.props, value); },
    add() {}, remove() {}, commit() {}, syncVisibility() {}, mark() {}, precompile: async () => {}, requestCameraReset({ snapshot }) { camera.setState(snapshot, 0); } };
  plugin.canvas3dContext = { props: structuredClone(contextDefaults), setProps(value) { calls.push(['context', structuredClone(value)]); merge(this.props, value); } };
  plugin.state.setSnapshotParams({ image: false, animation: false, cameraTransition: { name: 'instant', params: {} } });
  return plugin;
}
function readonlyRefusal(plugin, action) {
  const before = structuredClone(plugin.state.data.getSnapshot()), entries = plugin.managers.snapshot.state.entries;
  assert.throws(action, { code: 'UNSUPPORTED_TOPOLOGY_ENVIRONMENT' });
  assert.deepEqual(plugin.state.data.getSnapshot(), before); assert.equal(plugin.managers.snapshot.state.entries, entries);
}
const { BuretteTopologyScene } = await import('../scripts/molstar-topology-scene.js');
const { BuretteGeometry } = await import('../scripts/molstar-geometry.js');
try {
  const source = await make(), target = await make();
  assert.equal(source.spec.behaviors.length, 35); assert.equal(source.state.behaviors.cells.size, 41);
  source.managers.interactivity.setProps({ granularity: 'chain' });
  await source.managers.structure.component.setOptions({ ...source.managers.structure.component.state.options, ignoreLight: true });
  const focus = source.spec.behaviors.find(b => b.transformer.id === 'ms-plugin.create-structure-focus-representation').transformer;
  await source.state.updateBehavior(focus, p => { p.expandRadius = 8; });
  const read = plugin => JSON.parse(JSON.stringify({
    behavior: [...plugin.state.behaviors.cells.values()].map(c => [c.transform.transformer.id, c.params?.values]).sort((a,b) => a[0].localeCompare(b[0])),
    picking: plugin.managers.interactivity.props, options: plugin.managers.structure.component.state.options,
  }));
  const expected = read(source), sourceTree = source.state.data.tree;
  const { receipt, ...transfer } = BuretteTopologyScene.capture(source, BuretteGeometry.binding(source).lease);
  assert.equal(source.state.data.tree, sourceTree); await BuretteTopologyScene.restore(target, transfer);
  assert.deepEqual(read(target), expected);
  const bytes = new Uint8Array(await (await target.managers.snapshot.serialize({ type: 'molx', params: { behavior: true } })).arrayBuffer());
  const reopened = await make(); await reopened.managers.snapshot.open(new File_([bytes], 'viewer-native.molx'));
  assert.deepEqual(read(reopened), expected);
  const lease = BuretteGeometry.binding(reopened).lease, restored = BuretteTopologyScene.capture(reopened, lease);
  assert.equal(BuretteTopologyScene.validate(reopened, restored.receipt, lease), true, 'native Viewer MOLX opens and remains editable');
  const { IsMVSModelProvider } = await import('@molstar/mvs/components/is-mvs-model-prop');
  const { MVSAnnotationsProvider } = await import('@molstar/mvs/components/annotation-prop');
  const { CustomTooltipsProvider } = await import('@molstar/mvs/components/custom-tooltips-prop');
  const { MVSAnnotationTooltipsProvider } = await import('@molstar/mvs/components/annotation-tooltips-prop');
  const reopenedRoot = reopened.managers.structure.hierarchy.current.structures[0].cell.obj.data;
  // Mol* 6 always attaches these hidden providers: one native attach with the default props' empty value.
  for (const [provider, owner, empty] of [[IsMVSModelProvider, reopenedRoot.models[0], {}], [MVSAnnotationsProvider, reopenedRoot.models[0], { dict: {} }],
    [CustomTooltipsProvider, reopenedRoot, []], [MVSAnnotationTooltipsProvider, reopenedRoot, { tooltips: [] }]]) {
    const box = provider.get(owner); assert.equal(box.version, 1); assert.deepEqual(JSON.parse(JSON.stringify(box.value)), empty);
    assert.deepEqual(provider.props(owner), PD.getDefaultValues(provider.defaultParams));
  }
  for (const [provider, kind] of [[IsMVSModelProvider, 'flag'], [MVSAnnotationsProvider, 'annotation'], [CustomTooltipsProvider, 'tooltip'], [MVSAnnotationTooltipsProvider, 'annotation-tooltip']]) {
    const edited = await make(), root = edited.managers.structure.hierarchy.current.structures[0].cell.obj.data;
    const owner = kind === 'flag' || kind === 'annotation' ? root.models[0] : root;
    const prop = kind === 'flag' ? { isMvs: true } : kind === 'annotation' ? { annotations: [{ ...PD.getDefaultValues(provider.defaultParams.annotations.element), id: 'authored' }] }
      : { tooltips: [{ ...PD.getDefaultValues(provider.defaultParams.tooltips.element), ...(kind === 'tooltip' ? { text: 'authored' } : { annotationId: 'authored' }) }] };
    provider.set(owner, prop);
    const authored = structuredClone(provider.props(owner)), before = edited.state.data.tree;
    assert.throws(() => BuretteTopologyScene.capture(edited, BuretteGeometry.binding(edited).lease), { code: 'UNSUPPORTED_TOPOLOGY_SCENE' });
    assert.equal(edited.state.data.tree, before); assert.deepEqual(provider.props(owner), authored);
  }
  const foreign = await make(); foreign.customModelProperties.unregister(IsMVSModelProvider.descriptor.name);
  foreign.customModelProperties.register({ ...IsMVSModelProvider, descriptor: { ...IsMVSModelProvider.descriptor } });
  assert.throws(() => BuretteTopologyScene.capture(foreign, BuretteGeometry.binding(foreign).lease), { code: 'UNSUPPORTED_TOPOLOGY_SCENE' });
  console.log('Actual Viewer spec passed: all 35 native behaviors retained, real MOLX save/open stays editable, empty native MVS caches accepted, authored MVS and foreign provider identity refused read-only.');
} finally {
  for (const plugin of plugins) { plugin.canvas3d = undefined; plugin.canvas3dContext = undefined; plugin.dispose(); }
  if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  await dom.happyDOM.close();
}
