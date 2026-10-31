import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { PluginStateSnapshotManager as Snapshots } from 'molstar/lib/mol-plugin-state/manager/snapshots.js';
import { Canvas3DParams, Canvas3DContext } from 'molstar/lib/mol-canvas3d/canvas3d.js';
import { Camera } from 'molstar/lib/mol-canvas3d/camera.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';
import { Asset } from 'molstar/lib/mol-util/assets.js';
import { File_ } from 'molstar/lib/mol-util/nodejs-shims.js';
import { unzip } from 'molstar/lib/mol-util/zip/zip.js';
import { SyncRuntimeContext } from 'molstar/lib/mol-task/execution/synchronous.js';
import { BuretteTopologyEnvironment as Environment } from '../scripts/molstar-topology-environment.js';
const dom = new Window(), previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), plugins = [], calls = [];
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.document });
const defaults = PD.getDefaultValues(Canvas3DParams), contextDefaults = PD.getDefaultValues(Canvas3DContext.Params);
function merge(target, changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') merge(target[key], value);
    else target[key] = structuredClone(value);
  }
}
async function make() {
  const plugin = new PluginContext(DefaultPluginSpec()); plugins.push(plugin); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: '1\nOriginal exact\nH 0 0 0\n', label: 'Original exact' });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
  const camera = new Camera(); camera.setState({ radius: 3 }, 0);
  // Public-shape adapters only: the native Plugin/state/archive/Camera below are real; no WebGL claim.
  plugin.canvas3d = { camera, props: structuredClone(defaults), setProps(value) { calls.push(['canvas', structuredClone(value)]); merge(this.props, value); },
    add() {}, remove() {}, syncVisibility() {}, mark() {}, requestCameraReset({ snapshot }) { camera.setState(snapshot, 0); } };
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
  const focus = source.spec.behaviors.find(b => b.transformer.id === 'ms-plugin.create-structure-focus-representation').transformer;
  const camera = source.spec.behaviors.find(b => b.transformer.id === 'ms-plugin.camera-focus-loci').transformer;
  const tooltip = source.spec.behaviors.find(b => b.transformer.id === 'ms-plugin.computed-accessible-surface-area-prop').transformer;
  await source.managers.structure.component.setOptions({ ...source.managers.structure.component.state.options, ignoreLight: true });
  await source.state.updateBehavior(focus, p => { p.expandRadius = 8; p.components = ['target', 'interactions']; });
  await source.state.updateBehavior(camera, p => { p.minRadius = 10; p.durationMs = 500; });
  await source.state.updateBehavior(tooltip, p => { p.showTooltip = false; });
  const read = plugin => [...plugin.state.behaviors.cells.values()].map(c => ({ type: c.transform.transformer.id, params: c.params?.values })).sort((a,b) => a.type.localeCompare(b.type));
  const expected = structuredClone(read(source)), before = source.state.data.tree;
  const { receipt, ...transfer } = BuretteTopologyScene.capture(source, BuretteGeometry.binding(source).lease);
  assert.equal(source.state.data.tree, before);
  await BuretteTopologyScene.restore(target, transfer);
  assert.deepEqual(read(target), expected, 'native style effects, focus controls, camera behavior and custom-property tooltips all survive');
  const bytes = new Uint8Array(await (await target.managers.snapshot.serialize({ type: 'molx', params: { behavior: true } })).arrayBuffer());
  const reopened = await make(); await reopened.managers.snapshot.open(new File_([bytes], 'behaviors.molx'));
  assert.deepEqual(JSON.parse(JSON.stringify(read(reopened))), JSON.parse(JSON.stringify(expected)), 'native MOLX preserves behavior JSON; native serialization omits only undefined optional binding keys');
  Environment.capture(reopened);
  const sourceOwner = Environment.capture(source).owner;
  await source.state.updateBehavior(camera, p => { p.minRadius = 12; });
  readonlyRefusal(source, () => Environment.validate(source, sourceOwner));
  await source.state.updateBehavior(camera, p => { p.minRadius = 10; });
  readonlyRefusal(source, () => Environment.validate(source, sourceOwner));
  const nativeOwner = Environment.capture(source).owner, state = source.state.behaviors;
  source.state.behaviors = reopened.state.behaviors;
  readonlyRefusal(source, () => Environment.validate(source, nativeOwner)); source.state.behaviors = state;
  const prepared = Environment.prepare(target, transfer), targetTree = target.state.data.tree;
  await target.state.updateBehavior(camera, p => { p.minRadius = 12; });
  await target.state.updateBehavior(camera, p => { p.minRadius = 10; });
  await assert.rejects(Environment.apply(target, prepared), { code: 'UNSUPPORTED_TOPOLOGY_ENVIRONMENT' });
  assert.equal(target.state.data.tree, targetTree);
  for (const behaviorDelta of [{ foreign: {} }, { [focus.id]: { unknown: true } }, { [camera.id]: { minRadius: Infinity } }, { [focus.id]: { components: ['foreign'] } }])
    readonlyRefusal(target, () => Environment.prepare(target, { ...transfer, behaviorDelta }));
  const originalFocus = structuredClone(source.state.behaviors.cells.get(focus.id).params.values);
  await source.state.updateBehavior(focus, p => { p.targetParams.type.params.alpha = 0.5; });
  readonlyRefusal(source, () => Environment.capture(source));
  await source.state.behaviors.build().to(focus.id).update(originalFocus).commit();
  const custom = await make();
  await custom.state.behaviors.build().to(camera.id).tag('authored-native-metadata').commit();
  readonlyRefusal(custom, () => Environment.capture(custom));
  const originalBindings = source.state.behaviors.cells.get(camera.id).params.values.bindings;
  await source.state.updateBehavior(camera, p => { p.bindings = {}; });
  readonlyRefusal(source, () => Environment.capture(source));
  await source.state.updateBehavior(camera, p => { p.bindings = originalBindings; });
  console.log('Native behavior contracts passed: actual scene and MOLX preservation, owner/ABA revocation, read-only invalid payload and unsupported authored-provider/binding refusals.');
} finally {
  for (const plugin of plugins) { plugin.canvas3d = undefined; plugin.canvas3dContext = undefined; plugin.dispose(); }
  if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  await dom.happyDOM.close();
}
