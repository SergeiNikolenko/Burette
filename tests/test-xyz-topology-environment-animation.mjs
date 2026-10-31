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
const { AnimateCameraSpin } = await import('molstar/lib/mol-plugin-state/animation/built-in/camera-spin.js');
try {
  const source = await make(), target = await make(), tree = source.state.data.tree;
  const receipt = Environment.capture(source).owner;
  await source.managers.animation.tick(3, true); await source.managers.animation.tick(3000, true);
  assert.equal(Environment.validate(source, receipt), true, 'ordinary stopped viewer clock never revokes the receipt');
  await source.managers.animation.play(AnimateCameraSpin, { durationInMs: 8000, speed: 2, axis: [0, 1, 0] });
  await source.managers.animation.tick(100, true);
  await source.managers.animation.tick(1100, true);
  assert.equal(source.managers.animation.isAnimating, true);
  const original = structuredClone(source.managers.animation.getSnapshot()), data = structuredClone(source.state.data.getSnapshot());
  readonlyRefusal(source, () => BuretteTopologyScene.capture(source, BuretteGeometry.binding(source).lease));
  readonlyRefusal(source, () => Environment.validate(source, receipt));
  assert.deepEqual(source.state.data.getSnapshot(), data);
  assert.deepEqual(source.managers.animation.getSnapshot(), original, 'refusal never stops or rewrites the user animation');
  assert.equal(source.state.data.tree, tree);
  const targetBefore = structuredClone(target.state.data.getSnapshot());
  assert.throws(() => Environment.prepare(source, { canvasDelta: {}, contextDelta: {} }), /animation/);
  assert.deepEqual(target.state.data.getSnapshot(), targetBefore);
  await source.managers.animation.stop();
  readonlyRefusal(source, () => Environment.capture(source)); // stopped Spin still owns nondefault parameters/state
  const { AnimateModelIndex } = await import('molstar/lib/mol-plugin-state/animation/built-in/model-index.js');
  source.managers.animation.updateParams({ current: AnimateModelIndex.name });
  readonlyRefusal(source, () => Environment.validate(source, receipt)); // play/stop/reset ABA cannot revive an old receipt
  const reset = Environment.capture(source).owner;
  await source.managers.animation.start();
  readonlyRefusal(source, () => Environment.validate(source, reset));
  await source.managers.animation.stop();
  readonlyRefusal(source, () => Environment.validate(source, reset)); // same default snapshot, distinct manager state/runtime lifetime
  assert.equal(source.state.data.tree, tree);
  const stopped = Environment.capture(source).owner;
  const defaults = structuredClone(source.managers.animation.current.paramValues);
  source.managers.animation.updateCurrentParams({ duration: { name: 'fixed', params: { durationInS: 9 } } });
  readonlyRefusal(source, () => Environment.capture(source));
  source.managers.animation.updateCurrentParams(defaults);
  readonlyRefusal(source, () => Environment.validate(source, stopped));
  const current = Environment.capture(source).owner;
  const manager = source.managers.animation; source.managers.animation = target.managers.animation;
  readonlyRefusal(source, () => Environment.validate(source, current)); source.managers.animation = manager;
  assert.equal(Environment.validate(source, current), true);
  const transfer = BuretteTopologyScene.capture(source, BuretteGeometry.binding(source).lease);
  const { receipt: _receipt, ...payload } = transfer;
  await BuretteTopologyScene.restore(target, payload);
  assert.deepEqual(target.managers.animation.getSnapshot(), source.managers.animation.getSnapshot(), 'only stopped default state is admitted');
  const applying = await make(), applyingTree = applying.state.data.tree;
  const pending = applying.managers.animation.applyAsync();
  assert.equal(applying.managers.animation.isApplying, true);
  readonlyRefusal(applying, () => Environment.capture(applying)); await pending;
  assert.equal(applying.state.data.tree, applyingTree);
  const custom = await make(), catalogOwner = Environment.capture(custom).owner;
  custom.managers.animation.register({ ...AnimateModelIndex, name: 'review.foreign-animation' });
  readonlyRefusal(custom, () => Environment.capture(custom));
  readonlyRefusal(custom, () => Environment.validate(custom, catalogOwner));
  const order = await make(), orderOwner = Environment.capture(order).owner;
  order.managers.animation.animations.reverse(); readonlyRefusal(order, () => Environment.validate(order, orderOwner));
  const sameValues = Environment.capture(source).owner;
  source.managers.animation.updateCurrentParams(structuredClone(source.managers.animation.current.paramValues));
  readonlyRefusal(source, () => Environment.validate(source, sameValues));
  console.log('Native animation guard passed: real CameraSpin play/ticks refused readonly; same-tree start/stop/reset/configuration/manager replacement revoke receipts; native default still restores.');
} finally {
  for (const plugin of plugins) { await plugin.managers.animation.stop(); plugin.canvas3d = undefined; plugin.canvas3dContext = undefined; plugin.dispose(); }
  if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  await dom.happyDOM.close();
}
