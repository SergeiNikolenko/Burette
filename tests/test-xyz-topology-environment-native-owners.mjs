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
  source.managers.interactivity.setProps({ granularity: 'chain' });
  const settings = structuredClone(source.managers.structure.component.state.options);
  Object.assign(settings, { hydrogens: 'only-polar', visualQuality: 'high', ignoreLight: true });
  settings.materialStyle.roughness = 0.3; settings.interior.color = 0xabcdef;
  settings.animation.wiggleAmplitude = 0.7; settings.interactions.contacts.lineOfSightDistFactor = 0.9;
  await source.managers.structure.component.setOptions(settings);
  const read = plugin => ({ interactivity: structuredClone(plugin.state.getSnapshot().interactivity), component: structuredClone(plugin.state.getSnapshot().structureComponentManager) });
  const expected = read(source), before = source.state.data.tree;
  const capture = BuretteTopologyScene.capture(source, BuretteGeometry.binding(source).lease);
  const { receipt, ...transfer } = capture;
  assert.equal(source.state.data.tree, before);
  await BuretteTopologyScene.restore(target, transfer);
  assert.deepEqual(read(target), expected, 'native manager values survive actual scene replacement');
  const bytes = new Uint8Array(await (await target.managers.snapshot.serialize({ type: 'molx' })).arrayBuffer());
  const reopened = await make(); await reopened.managers.snapshot.open(new File_([bytes], 'owners.molx'));
  assert.deepEqual(read(reopened), expected, 'native MOLX export/open retains both official owners');
  const owner = Environment.capture(source).owner;
  source.managers.interactivity.setProps({ granularity: 'atom' });
  readonlyRefusal(source, () => Environment.validate(source, owner));
  source.managers.interactivity.setProps({ granularity: 'chain' });
  readonlyRefusal(source, () => Environment.validate(source, owner));
  const componentOwner = Environment.capture(source).owner;
  await source.managers.structure.component.setOptions({ ...settings, ignoreLight: false });
  await source.managers.structure.component.setOptions(settings);
  readonlyRefusal(source, () => Environment.validate(source, componentOwner));
  const originalManager = source.managers.interactivity, replacedOwner = Environment.capture(source).owner;
  source.managers.interactivity = reopened.managers.interactivity;
  readonlyRefusal(source, () => Environment.validate(source, replacedOwner)); source.managers.interactivity = originalManager;
  const originalComponent = source.managers.structure.component, replacedComponent = Environment.capture(source).owner;
  source.managers.structure.component = reopened.managers.structure.component;
  readonlyRefusal(source, () => Environment.validate(source, replacedComponent)); source.managers.structure.component = originalComponent;
  const staged = Environment.prepare(target, transfer), targetBefore = read(target);
  target.managers.interactivity.setProps({ granularity: 'atom' }); target.managers.interactivity.setProps({ granularity: 'chain' });
  readonlyRefusal(target, () => Environment.apply(target, staged)); assert.deepEqual(read(target), targetBefore);
  for (const delta of [{ granularity: 'made-up' }, { unknown: true }, { granularity: null }])
    readonlyRefusal(target, () => Environment.prepare(target, { ...transfer, interactivityDelta: delta }));
  for (const delta of [{ ignoreLight: 1 }, { materialStyle: { roughness: Infinity } }, { unknown: true }])
    readonlyRefusal(target, () => Environment.prepare(target, { ...transfer, componentDelta: delta }));
  const noOp = Environment.capture(source).owner;
  source.managers.interactivity.setProps({ granularity: 'chain' });
  assert.equal(Environment.validate(source, noOp), true, 'native no-op picking updates do not create an artificial revision');
  console.log('Native owner roundtrip/real MOLX, picking and options ABA, replaced managers, candidate revision guard and malformed transfer contracts passed.');
} finally {
  for (const plugin of plugins) { plugin.canvas3d = undefined; plugin.canvas3dContext = undefined; plugin.dispose(); }
  if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  await dom.happyDOM.close();
}
