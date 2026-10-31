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
try {
  const source = await make();
  const empty = Environment.capture(source); assert.deepEqual([empty.canvasDelta, empty.contextDelta], [{}, {}]);
  assert.equal(Environment.validate(source, empty.owner), true);
  source.canvas3d.props.renderer.backgroundColor = 0x123456;
  source.canvas3d.props.postprocessing.outline = { name: 'on', params: PD.getDefaultValues(Canvas3DParams.postprocessing.params.outline.map('on').params) };
  source.canvas3d.props.postprocessing.outline.params.scale = 2;
  source.canvas3d.props.camera.helper.axes = { name: 'on', params: PD.getDefaultValues(Canvas3DParams.camera.params.helper.params.axes.map('on').params) };
  source.canvas3dContext.props = { resolutionMode: 'scaled', pixelScale: 1.5, pickScale: 0.5, transparency: 'blended' };
  const captured = Environment.capture(source), transfer = { canvasDelta: captured.canvasDelta, contextDelta: captured.contextDelta };
  const target = await make(); target.canvas3d.props.renderer.backgroundColor = 0xabcdef; target.canvas3d.props.renderer.ambientIntensity = 0.9;
  calls.length = 0; Environment.apply(target, Environment.prepare(target, transfer));
  assert.deepEqual(target.canvas3d.props, source.canvas3d.props); assert.deepEqual(target.canvas3dContext.props, source.canvas3dContext.props);
  assert.deepEqual(calls, [['context', source.canvas3dContext.props], ['canvas', source.canvas3d.props]], 'full defaults plus delta, context first');
  const sameTree = source.state.data.tree;
  source.canvas3d.props.renderer.backgroundColor = 0; readonlyRefusal(source, () => Environment.validate(source, captured.owner));
  source.canvas3d.props.renderer.backgroundColor = 0x123456;
  source.canvas3dContext.props.pixelScale = 2; readonlyRefusal(source, () => Environment.validate(source, captured.owner)); source.canvas3dContext.props.pixelScale = 1.5;
  assert.equal(source.state.data.tree, sameTree);
  for (const invalid of [undefined, { unknown: true }, new Uint8Array([1]), { renderer: { backgroundColor: NaN } }, { renderer: { backgroundColor: Infinity } },
    { camera: { mode: 'invalid' } }, { camera: { manualReset() {} } }, { trackball: { gestureScaleFactor: new Date() } }]) {
    assert.throws(() => Environment.validateData({ canvasDelta: invalid, contextDelta: {} }), { code: 'UNSUPPORTED_TOPOLOGY_ENVIRONMENT' });
  }
  const cycle = {}; cycle.camera = cycle;
  assert.throws(() => Environment.validateData({ canvasDelta: cycle, contextDelta: {} }), /plain JSON/);
  const accessor = {}; Object.defineProperty(accessor, 'camera', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => Environment.validateData({ canvasDelta: accessor, contextDelta: {} }), /plain JSON properties/);
  for (const name of ['image', 'skybox']) {
    const props = structuredClone(defaults); props.postprocessing.background.variant = { name, params: {} };
    const old = source.canvas3d.props; source.canvas3d.props = props; readonlyRefusal(source, () => Environment.capture(source)); source.canvas3d.props = old;
  }
  const setter = source.canvas3d.setProps; source.canvas3d.setProps = undefined;
  readonlyRefusal(source, () => Environment.capture(source)); source.canvas3d.setProps = setter;
  const oldProps = source.canvas3d.props;
  const badProps = structuredClone(oldProps); Object.defineProperty(badProps, 'postprocessing', { enumerable: true, get() { throw new Error('must not execute'); } });
  source.canvas3d.props = badProps; readonlyRefusal(source, () => Environment.capture(source));
  source.canvas3d.props = undefined;
  readonlyRefusal(source, () => Environment.capture(source)); source.canvas3d.props = oldProps;
  const absent = await make(); absent.canvas3d = undefined; absent.canvas3dContext = undefined;
  assert.deepEqual(Environment.capture(absent).canvasDelta, null);
  assert.throws(() => Environment.prepare(absent, transfer), /matching settings owner/);
  // The archive writer/reader are native. The adapters provide only public canvas/context I/O.
  const blob = await source.managers.snapshot.serialize({ type: 'molx' });
  const bytes = new Uint8Array(await blob.arrayBuffer()), zip = await unzip(SyncRuntimeContext, bytes.buffer);
  const archived = JSON.parse(new TextDecoder().decode(zip['state.json']));
  assert.equal(archived.entries.length, 1); assert.equal(archived.entries[0].snapshot.canvas3d.props.renderer.backgroundColor, 0x123456);
  const reopened = await make(); await reopened.managers.snapshot.open(new File_([bytes], 'plain.molx'));
  assert.equal(reopened.managers.snapshot.defaultSnapshotId, undefined);
  assert.equal(reopened.canvas3d.props.postprocessing.outline.params.scale, 2);
  const afterOpen = Environment.capture(reopened); assert.equal(afterOpen.canvasDelta.renderer.backgroundColor, 0x123456);
  assert.deepEqual(afterOpen.contextDelta, captured.contextDelta);
  Environment.apply(reopened, Environment.prepare(reopened, transfer)); // includes the camera helper group native open suppresses
  assert.deepEqual(reopened.canvas3d.props, source.canvas3d.props);
  assert.equal(source.managers.snapshot.state.current, source.managers.snapshot.defaultSnapshotId);
  Environment.capture(source); // native syncCurrent replaceable single entry
  const unnamed = await make(); unnamed.managers.snapshot.add(Snapshots.Entry(unnamed.state.getSnapshot())); Environment.capture(unnamed);
  const owner = Environment.capture(unnamed).owner, entry = unnamed.managers.snapshot.state.entries.get(0);
  entry.timestamp += 1; readonlyRefusal(unnamed, () => Environment.validate(unnamed, owner)); entry.timestamp -= 1;
  entry.snapshot = { ...entry.snapshot }; readonlyRefusal(unnamed, () => Environment.validate(unnamed, owner));
  const named = await make();
  const file = new File_([new Uint8Array([1, 7, 9, 255])], 'user-image.bin'), asset = Asset.File(file); named.managers.asset.set(asset, file);
  for (const metadata of [{ name: 'Saved pose' }, { key: 'user-key' }, { description: 'User note' }, { descriptionFormat: 'markdown' }, { image: asset }]) {
    named.managers.snapshot.clear(); named.managers.snapshot.add(Snapshots.Entry(named.state.getSnapshot(), metadata));
    readonlyRefusal(named, () => Environment.capture(named));
  }
  assert.deepEqual([...new Uint8Array(await named.managers.asset.get(asset).file.arrayBuffer())], [1, 7, 9, 255]);
  const multiple = await make(); multiple.managers.snapshot.add(Snapshots.Entry(multiple.state.getSnapshot())); multiple.managers.snapshot.add(Snapshots.Entry(multiple.state.getSnapshot()));
  readonlyRefusal(multiple, () => Environment.capture(multiple));
  const nonreplaceable = await make(); await nonreplaceable.managers.snapshot.getStateSnapshot();
  const automaticId = nonreplaceable.managers.snapshot.state.current;
  nonreplaceable.managers.snapshot.add(Snapshots.Entry(nonreplaceable.state.getSnapshot())); nonreplaceable.managers.snapshot.remove(automaticId);
  assert.equal(nonreplaceable.managers.snapshot.state.entries.size, 1); readonlyRefusal(nonreplaceable, () => Environment.capture(nonreplaceable));
  const playback = await make(); playback.managers.snapshot.updateState({ nextSnapshotDelayInMs: 2000 }); readonlyRefusal(playback, () => Environment.capture(playback));
  playback.managers.snapshot.updateState({ nextSnapshotDelayInMs: 1500, isPlaying: true }); readonlyRefusal(playback, () => Environment.capture(playback));
  const changed = await make(), receipt = Environment.capture(changed).owner;
  changed.managers.snapshot.add(Snapshots.Entry(changed.state.getSnapshot())); readonlyRefusal(changed, () => Environment.validate(changed, receipt));
  const stored = new Map(), window = { name: 'probe', sessionStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } };
  vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/renderer-view-state.js', import.meta.url), 'utf8'), { window });
  window.BuretteRendererViewState.save('probe', { camera: source.canvas3d.camera.getSnapshot(), canvas3d: { props: source.canvas3d.props } });
  assert.deepEqual(Object.keys(window.BuretteRendererViewState.read('probe')).sort(), ['camera', 'xyz']);
  assert.equal(transfer.canvasDelta.renderer.backgroundColor, 0x123456, 'the paired scene payload, not old camera-only storage, delivers settings');
  console.log('Topology environment passed: official schema/default deltas, exact public setter delivery, real MOLX archive/open, read-only library guards and owner revocation. No WebGL/GPU claim.');
} finally {
  for (const plugin of plugins) { plugin.canvas3d = undefined; plugin.canvas3dContext = undefined; plugin.dispose(); }
  if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  await dom.happyDOM.close();
}
