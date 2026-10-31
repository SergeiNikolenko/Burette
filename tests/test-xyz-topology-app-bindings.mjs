import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { Canvas3DParams, Canvas3DContext } from 'molstar/lib/mol-canvas3d/canvas3d.js';
import { Camera } from 'molstar/lib/mol-canvas3d/camera.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';
import { File_ } from 'molstar/lib/mol-util/nodejs-shims.js';
import { BuretteTopologyEnvironment as Environment } from '../scripts/molstar-topology-environment.js';
const dom = new Window(), previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), plugins = [], calls = [];
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.document });
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom });
const { createViewerSpec } = await import('molstar/lib/apps/viewer/plugin-spec.js');
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
const viewerSource = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const installStart = viewerSource.indexOf('    const cameraFocus =', viewerSource.indexOf('function installMolstarContextMenu(viewer)'));
const installEnd = viewerSource.indexOf('    const menuIsOpen =', installStart);
assert.ok(installStart > 0 && installEnd > installStart);
// Execute the production context-menu binding setup verbatim on the actual native handler.
const installBindings = new Function('viewer', viewerSource.slice(installStart, installEnd));
const { FocusLoci } = await import('molstar/lib/mol-plugin/behavior/dynamic/camera.js');
const bindings = plugin => plugin.state.behaviors.cells.get(FocusLoci.id).obj.data.params.bindings;
const plainBindings = plugin => JSON.parse(JSON.stringify(bindings(plugin)));
try {
  let source = await make();
  const target = await make();
  assert.equal(source.spec.behaviors.length, 35);
  const original = structuredClone(bindings(source));
  installBindings({ plugin: source }); installBindings({ plugin: target });
  assert.equal(source.state.behaviors.cells.get(FocusLoci.id).params.values.bindings, bindings(source), 'native handler and state share the app-owned binding parameters');
  const expected = plainBindings(source);
  assert.notDeepEqual(expected, JSON.parse(JSON.stringify(original)));
  for (const binding of Object.values(expected)) assert.ok(binding.triggers.every(trigger => !(Number(trigger.buttons) & 2)));
  const baselineBytes = new Uint8Array(await (await source.managers.snapshot.serialize({ type: 'molx', params: { behavior: true } })).arrayBuffer());
  const baselineReopened = await make(); await baselineReopened.managers.snapshot.open(new File_([baselineBytes], 'baseline.molx'));
  source = baselineReopened; installBindings({ plugin: source });
  const lease = BuretteGeometry.binding(source).lease;
  const { receipt, ...transfer } = BuretteTopologyScene.capture(source, lease);
  assert.equal(BuretteTopologyScene.validate(source, receipt, lease), true);
  await BuretteTopologyScene.restore(target, transfer);
  assert.deepEqual(plainBindings(target), expected);
  const bytes = new Uint8Array(await (await target.managers.snapshot.serialize({ type: 'molx', params: { behavior: true } })).arrayBuffer());
  const reopened = await make(); await reopened.managers.snapshot.open(new File_([bytes], 'burette-bindings.molx'));
  assert.deepEqual(plainBindings(reopened), expected, 'native MOLX restores the app-owned bindings');
  installBindings({ plugin: reopened });
  assert.deepEqual(plainBindings(reopened), expected, 'normal context-menu installation after reopen is idempotent');
  const reopenedLease = BuretteGeometry.binding(reopened).lease;
  const { receipt: reopenedReceipt, ...next } = BuretteTopologyScene.capture(reopened, reopenedLease);
  assert.equal(BuretteTopologyScene.validate(reopened, reopenedReceipt, reopenedLease), true);
  const edited = await make();
  await edited.clear();
  const raw = await edited.builders.data.rawData({ data: '2\nEdited\nH 0 0 0\nH 0 0 1\n' });
  const trajectory = await edited.builders.structure.parseTrajectory(raw, 'xyz');
  await edited.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
  installBindings({ plugin: edited });
  await BuretteTopologyScene.restore(edited, { ...next, atomCount: 2 });
  assert.equal(BuretteTopologyScene.capture(edited, BuretteGeometry.binding(edited).lease).atomCount, 2);
  assert.deepEqual(plainBindings(edited), expected, 'continued real topology restoration preserves app input configuration');
  for (const mutate of [b => { b.clickCenterFocus.triggers[0].buttons = 4; }, b => { b.clickCenterFocus.description = 'foreign'; }, b => { delete b.clickResetCameraOnEmpty; }, b => { b.foreign = b.clickCenterFocus; }]) {
    const altered = structuredClone(expected); mutate(altered);
    readonlyRefusal(target, () => Environment.prepare(target, { ...transfer, behaviorDelta: { ...transfer.behaviorDelta, [FocusLoci.id]: { bindings: altered } } }));
  }
  const fresh = await make(); installBindings({ plugin: fresh });
  const freshTransfer = BuretteTopologyScene.capture(fresh, BuretteGeometry.binding(fresh).lease);
  assert.deepEqual(freshTransfer.behaviorDelta[FocusLoci.id].bindings, expected, 'fresh native optional undefined keys and JSON-reopened keys have the same transferable configuration');
  const directTrigger = bindings(fresh).clickCenterFocus.triggers[0], originalButton = directTrigger.buttons;
  try {
    directTrigger.buttons = 4;
    readonlyRefusal(fresh, () => Environment.capture(fresh));
  } finally { directTrigger.buttons = originalButton; }
  const prepared = Environment.prepare(target, transfer);
  await target.state.updateBehavior(FocusLoci, p => { p.bindings = original; });
  await target.state.updateBehavior(FocusLoci, p => { p.bindings = structuredClone(expected); });
  await assert.rejects(Environment.apply(target, prepared), { code: 'UNSUPPORTED_TOPOLOGY_ENVIRONMENT' });
  const owner = Environment.capture(source).owner;
  await source.state.updateBehavior(FocusLoci, p => { p.bindings = original; });
  readonlyRefusal(source, () => Environment.validate(source, owner));
  await source.state.updateBehavior(FocusLoci, p => { p.bindings = structuredClone(expected); });
  readonlyRefusal(source, () => Environment.validate(source, owner));
  console.log('Actual app binding setup passed: Viewer35, scene capture/restore, native MOLX/reopen/continued 2-atom edit, exact-only admission and native owner ABA revocation.');
} finally {
  for (const plugin of plugins) { plugin.canvas3d = undefined; plugin.canvas3dContext = undefined; plugin.dispose(); }
  if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  await dom.happyDOM.close();
}
