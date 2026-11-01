import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Canvas3DParams, Canvas3DContext } from '@molstar/graphics/canvas3d/canvas3d';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { File_ } from '@molstar/core/util/nodejs-shims';
import { unzip } from '@molstar/core/util/zip/zip';
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import { BuretteTopologyScene } from '../scripts/molstar-topology-scene.js';
import { BuretteGeometry } from '../scripts/molstar-geometry.js';

const dom = new Window(), originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), plugins = [];
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.document });
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom });
const { createViewerSpec } = await import('@molstar/viewer/plugin-spec');
const code = readFileSync(process.argv[2] || new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => code.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'))[0];
const options = new Function('activeConfig', 'transparentBackground', 'canvasBackgroundCSS', 'isQuickLookHost', 'sdfGridPathForConfig', `${extract('createViewerOptions')} return createViewerOptions();`)
  ({ renderer: 'molstar' }, false, () => '#ffffff', () => false, () => undefined);
const xyz = '1\nOriginal exact\nH 0 0 0\n';
function merge(target, changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') merge(target[key], value);
    else target[key] = structuredClone(value);
  }
}
async function make() {
  const plugin = new PluginContext(createViewerSpec(options)); plugins.push(plugin); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: xyz, label: 'Original exact' });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
  const camera = new Camera(); camera.setState({ radius: 3 }, 0);
  plugin.canvas3d = { camera, props: structuredClone(PD.getDefaultValues(Canvas3DParams)), setProps(value) { merge(this.props, value); },
    add() {}, remove() {}, syncVisibility() {}, mark() {}, requestCameraReset({ snapshot }) { camera.setState(snapshot, 0); } };
  plugin.canvas3dContext = { props: structuredClone(PD.getDefaultValues(Canvas3DContext.Params)), setProps(value) { merge(this.props, value); } };
  plugin.state.setSnapshotParams({ image: false, animation: false, cameraTransition: { name: 'instant', params: {} } });
  return plugin;
}
try {
  const source = await make(), target = await make();
  const focus = source.spec.behaviors.find(b => b.transformer.id === 'ms-plugin.create-structure-focus-representation').transformer;
  const camera = source.spec.behaviors.find(b => b.transformer.id === 'ms-plugin.camera-focus-loci').transformer;
  await source.managers.structure.component.setOptions({ ...source.managers.structure.component.state.options, ignoreLight: true });
  await source.state.updateBehavior(focus, p => { p.expandRadius = 8; });
  await source.state.updateBehavior(camera, p => { p.minRadius = 10; });
  source.managers.interactivity.setProps({ granularity: 'chain' });
  assert.equal(source.state.snapshotParams.value.behavior, false, 'normal Viewer remains at the native default before this export');
  const read = p => JSON.parse(JSON.stringify({
    behavior: [...p.state.behaviors.cells.values()].map(c => [c.transform.transformer.id, c.params?.values]).sort((a,b) => a[0].localeCompare(b[0])),
    picking: p.managers.interactivity.props, options: p.managers.structure.component.state.options,
  }));
  const expected = read(source), before = source.state.data.tree;
  const unavailable = () => { throw new Error('Unexpected script load'); };
  const execute = new Function('window', 'activeMolstarViewer', 'activeConfig', 'document', 'runtimeURL', 'loadScript',
    `${extract('bytesToBase64')}\n${extract('executeBuretteAgentAction')}\nreturn executeBuretteAgentAction;`)
    ({}, () => ({ plugin: source }), { renderer: 'molstar' }, dom.document, unavailable, unavailable);
  const exported = await execute({ type: 'workspace_scene_snapshot' });
  assert.equal(exported.ok, true); assert.equal(source.state.data.tree, before); assert.deepEqual(read(source), expected);
  const bytes = new Uint8Array(Buffer.from(exported.result.dataBase64, 'base64'));
  const zip = await unzip(SyncRuntimeContext, bytes.buffer), state = JSON.parse(new TextDecoder().decode(zip['state.json']));
  assert.ok(state.entries[0].snapshot.behaviour, 'actual export route explicitly includes native behavior state');
  await target.managers.snapshot.open(new File_([bytes], 'exported.molx'));
  assert.deepEqual(read(target), expected, 'real exported archive preserves behavior configuration and manager settings');
  const raw = [...target.state.data.cells.values()].find(c => c.transform.transformer.id === 'ms-plugin.raw-data');
  assert.equal(raw.params.values.data, xyz, 'Original source bytes remain exact');
  const lease = BuretteGeometry.binding(target).lease, captured = BuretteTopologyScene.capture(target, lease);
  assert.equal(BuretteTopologyScene.validate(target, captured.receipt, lease), true, 'actual exported MOLX is still topology-editable');
  console.log('Actual workspace_scene_snapshot dispatcher and native Viewer/MOLX reader preserve behavior, picking, component settings and Original bytes.');
} finally {
  for (const plugin of plugins) { plugin.canvas3d = undefined; plugin.canvas3dContext = undefined; plugin.dispose(); }
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  await dom.happyDOM.close();
}
