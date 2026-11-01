import { createHash } from 'node:crypto';
import { checkTopologyEnvelope } from './fixtures/topology-envelope-host.mjs';
import { unzip } from '@molstar/core/util/zip/zip';
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { Canvas3DParams, Canvas3DContext } from '@molstar/graphics/canvas3d/canvas3d';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { File_ } from '@molstar/core/util/nodejs-shims';
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
async function make(text = '1\nOriginal exact\nH 0 0 0\n') {
  const plugin = new PluginContext(createViewerSpec({ layoutIsExpanded: true, layoutShowRemoteState: false, pdbProvider: 'rcsb', emdbProvider: 'rcsb', preferWebgl1: true, disableAntialiasing: true })); plugins.push(plugin); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text, label: 'Original exact' });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
  const camera = new Camera(); camera.setState({ radius: 3 }, 0);
  // Public-shape adapters only: the native Plugin/state/archive/Camera below are real; no WebGL claim.
  plugin.canvas3d = { camera, props: structuredClone(defaults), setProps(value) { calls.push(['canvas', structuredClone(value)]); merge(this.props, value); },
    add() {}, remove() {}, commit() {}, syncVisibility() {}, mark() {}, requestCameraReset({ snapshot }) { camera.setState(snapshot, 0); } };
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
  const source = await make();
  const archive = readFileSync(new URL('./fixtures/topology-real-browser-water.molx', import.meta.url));
  const entries = await unzip(SyncRuntimeContext, archive);
  const saved = JSON.parse(new TextDecoder().decode(entries['state.json'])).entries[0].snapshot;
  // Native setSnapshot deliberately skips camera/helper settings when a camera pose exists.
  // Start with the actual Browser canvas configuration, including the app's styled axes.
  source.canvas3d.props = structuredClone(saved.canvas3d.props);
  source.canvas3dContext.props = structuredClone(saved.canvas3dContext.props);
  await source.managers.snapshot.open(new File_([archive], 'actual-browser-water.molx'));
  assert.deepEqual(source.canvas3d.props, saved.canvas3d.props);
  assert.deepEqual(source.canvas3dContext.props, saved.canvas3dContext.props);
  const root = source.managers.structure.hierarchy.current.structures[0].cell.obj.data;
  assert.equal(root.elementCount, 3);
  const lease = BuretteGeometry.binding(source).lease;
  const { receipt, ...transfer } = BuretteTopologyScene.capture(source, lease);
  assert.equal(BuretteTopologyScene.validate(source, receipt, lease), true);
  assert.equal(new TextEncoder().encode(JSON.stringify(transfer)).byteLength, 6553, 'actual Browser settings reproduce the former 6144-byte refusal');
  const current = BuretteGeometry.binding(source).text.trimEnd().split('\n');
  current[0] = '4'; current.push('H 0 0 1.2');
  const edited = await make(current.join('\n') + '\n');
  await BuretteTopologyScene.restore(edited, { ...transfer, atomCount: 4 });
  const { receipt: editedReceipt, ...retained } = BuretteTopologyScene.capture(edited, BuretteGeometry.binding(edited).lease);
  assert.deepEqual(retained, { ...transfer, atomCount: 4 }, 'every scene field survives the actual four-atom restore');
  assert.deepEqual(edited.canvas3d.props, source.canvas3d.props);
  assert.deepEqual(edited.canvas3dContext.props, source.canvas3dContext.props);
  const bytes = new Uint8Array(await (await edited.managers.snapshot.serialize({ type: 'molx', params: { behavior: true } })).arrayBuffer());
  const reopened = await make();
  reopened.canvas3d.props = structuredClone(source.canvas3d.props);
  reopened.canvas3dContext.props = structuredClone(source.canvas3dContext.props);
  await reopened.managers.snapshot.open(new File_([bytes], 'retained-four-atom.molx'));
  const { receipt: reopenedReceipt, ...reopenedTransfer } = BuretteTopologyScene.capture(reopened, BuretteGeometry.binding(reopened).lease);
  assert.deepEqual(reopenedTransfer, retained, 'native MOLX retains all fields and permits continued capture');
  const maximum = structuredClone(transfer), component = maximum.components[0];
  const tags = Array.from({ length: 16 }, (_, index) => String(index).padStart(2, '0') + '界'.repeat(98));
  component.tags = tags;
  component.representations[0].tags = tags;
  component.representations = Array.from({ length: 8 }, () => structuredClone(component.representations[0]));
  maximum.components = Array.from({ length: 32 }, () => structuredClone(component));
  assert.equal(new TextEncoder().encode(JSON.stringify(maximum)).byteLength, 1924370);
  const maximal = await make(BuretteGeometry.binding(source).text);
  await BuretteTopologyScene.restore(maximal, maximum);
  const { receipt: maximalReceipt, ...actualMaximum } = BuretteTopologyScene.capture(maximal, BuretteGeometry.binding(maximal).lease);
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(hash(actualMaximum), hash(maximum), 'all 32 components, 256 representations and maximum-length Unicode tags are retained');
  const boundary = structuredClone(maximum);
  boundary.components[0].params.label += 'x'.repeat(2 * 1024 * 1024 - new TextEncoder().encode(JSON.stringify(boundary)).byteLength);
  await BuretteTopologyScene.restore(maximal, boundary);
  const { receipt: boundaryReceipt, ...actualBoundary } = BuretteTopologyScene.capture(maximal, BuretteGeometry.binding(maximal).lease);
  assert.equal(hash(actualBoundary), hash(boundary), 'the exact 2 MiB scene boundary retains every field');
  const treeAtBoundary = maximal.state.data.tree;
  boundary.components[0].params.label += 'x';
  await assert.rejects(BuretteTopologyScene.restore(maximal, boundary), { code: 'UNSUPPORTED_TOPOLOGY_SCENE', message: 'Scene settings exceed the topology transfer limit.' });
  assert.equal(maximal.state.data.tree, treeAtBoundary);
  await BuretteTopologyScene.restore(maximal, maximum);
  const { decodeScienceSession } = await import('../apps/desktop/src/lib/science-session/codec.ts');
  const decoded = await decodeScienceSession(archive); assert.ok(decoded?.science);
  const hostTarget = await make(current.join('\n') + '\n');
  await checkTopologyEnvelope({ dom, source: maximal, targetPlugin: hostTarget, science: decoded.science,
    nextText: current.join('\n') + '\n', geometry: BuretteGeometry, scene: BuretteTopologyScene });
  for (const oversized of [
    { ...maximum, components: [...maximum.components, maximum.components[0]] },
    { ...maximum, components: [{ ...component, representations: [...component.representations, component.representations[0]] }] },
    { ...maximum, components: maximum.components.map(item => ({ ...item, representations: item.representations.map(repr => ({ ...repr, params: { ...repr.params, type: { ...repr.params.type, params: { ...repr.params.type.params, label: '界'.repeat(1024) } } } })) })) },
  ]) {
    const tree = maximal.state.data.tree;
    await assert.rejects(BuretteTopologyScene.restore(maximal, oversized), { code: 'UNSUPPORTED_TOPOLOGY_SCENE' });
    assert.equal(maximal.state.data.tree, tree, 'oversize refusal occurs before native mutation');
  }
  console.log('Real Browser archive6553 bytes and admitted32x8 objects1924370 bytes retained completely; 4-atom/native MOLX continuation and byte/object oversize refusals passed.');
} finally {
  for (const plugin of plugins) { plugin.canvas3d = undefined; plugin.canvas3dContext = undefined; plugin.dispose(); }
  if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  await dom.happyDOM.close();
}
