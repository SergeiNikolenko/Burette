import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { PluginSpec } from '@molstar/plugin/spec';
import { MolViewSpec } from '@molstar/mvs/behavior';
import { loadMVSData } from '@molstar/mvs/components/formats';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Canvas3DParams } from '@molstar/graphics/canvas3d/canvas3d';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { createMVSX } from '@molstar/mvs-builder/export';
import { Unzip } from '@molstar/core/util/zip/zip';
import { BuretteStory } from '../scripts/molstar-story-facade.js';

// An authored MVS focus node targets a component that the Auto presentation
// replaces. Mol* threw in collectCellBoundingSpheres for that stale ref, which
// left the widget pane blank.
const dom = new Window();
globalThis.document = dom.document;
const spec = DefaultPluginSpec();
spec.behaviors.push(PluginSpec.Behavior(MolViewSpec));
const plugin = new PluginContext(spec);
try {
  await plugin.init();
  plugin.canvas3d = {
    camera: new Camera(), props: PD.getDefaultValues(Canvas3DParams),
    setProps(props) { Object.assign(this.props, props); },
    add() {}, remove() {}, update() {}, mark() {}, syncVisibility() {},
    pause() {}, resume() {}, requestDraw() {}, requestCameraReset() {}, dispose() {},
    precompile: async () => {},
  };
  const cameras = [];
  BuretteStory.install(plugin, {
    settings: () => ({ preset: 'automatic', appearance: 'default' }),
    appearance: async () => {},
    automatic: () => BuretteStory.automatic(plugin),
    resolveCamera: camera => BuretteStory.resolveCamera(plugin, camera),
    camera: camera => { cameras.push(camera); return BuretteStory.camera(plugin, camera); },
  });

  const sample = new URL('../samples/mvs/docking_story.mvsx', import.meta.url);
  const assets = await Unzip(new Uint8Array(await readFile(sample))).run();
  const ligand = { kind: 'component', params: { selector: 'ligand' }, children: [
    { kind: 'representation', params: { type: 'ball_and_stick' } }, { kind: 'focus', params: {} }] };
  const scene = { kind: 'single', metadata: { version: '1' }, root: { kind: 'root', children: [
    { kind: 'download', params: { url: 'reflig.sdf' }, children: [{ kind: 'parse', params: { format: 'sdf' }, children: [
      { kind: 'structure', params: { type: 'model' }, children: [ligand] }] }] }] } };
  const mvsx = await createMVSX(scene, [{ name: 'reflig.sdf', content: assets['reflig.sdf'] }]);

  await loadMVSData(plugin, mvsx, 'mvsx');
  assert.equal(cameras.length, 1);
  const targets = cameras[0].focus.targets;
  assert.equal(targets.length, 1);
  assert.equal(targets[0].targetRef, undefined, 'focus must not reference a component removed by Auto');
  assert.ok(targets[0].radius > 0 && Array.from(targets[0].center).every(Number.isFinite), JSON.stringify(targets[0]));
  console.log('Story focus on a component replaced by Auto passed');
} finally {
  plugin.dispose();
  dom.happyDOM.abort();
}
