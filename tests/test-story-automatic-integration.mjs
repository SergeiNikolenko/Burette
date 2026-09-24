import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { DefaultPluginSpec, PluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { MolViewSpec } from 'molstar/lib/extensions/mvs/behavior.js';
import { loadMVSData } from 'molstar/lib/extensions/mvs/components/formats.js';
import { BuretteStory } from '../scripts/molstar-story-facade.js';
import { Camera } from 'molstar/lib/mol-canvas3d/camera.js';
import { Canvas3DParams } from 'molstar/lib/mol-canvas3d/canvas3d.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';
import { setCanvasModule } from 'molstar/lib/mol-geo/geometry/text/font-atlas.js';

// State integration only; actual label rasterization is checked in the browser.
setCanvasModule({ createCanvas: () => ({ getContext: () => ({
  measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) });

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
  };
  let presets = 0;
  BuretteStory.install(plugin, {
    settings: () => ({ preset: 'automatic', appearance: 'illustrative' }),
    appearance: () => plugin.managers.structure.component.setOptions({
      ...plugin.managers.structure.component.state.options, ignoreLight: true,
    }),
    automatic: () => { presets++; return BuretteStory.automatic(plugin); },
    camera: async () => {}, // No WebGL canvas: state/preset integration, not visual acceptance.
  });
  const file = process.argv[2] || new URL('../samples/mvs/docking_story.mvsx', import.meta.url);
  await loadMVSData(plugin, new Uint8Array(await readFile(file)), 'mvsx');
  const manager = plugin.managers.snapshot;
  assert.equal(manager.state.entries.size, 5);
  const inspect = () => {
    const cells = [...plugin.state.data.cells.values()];
    const environment = cells.find(c => c.transform.tags?.includes('burette-story-environment'));
    assert.ok(environment?.obj?.data?.elementCount > 0);
    // Six authored residues, not a second radius expansion around those residues.
    assert.equal(environment.obj.data.polymerResidueCount, 6);
    assert.ok(!cells.some(c => c.transform.tags?.includes('structure-focus-surr-repr')));
    assert.ok(!cells.some(c => c.params?.values?.type?.name === 'label'));
    const reprs = cells.filter(c => c.transform.transformer.id === 'ms-plugin.structure-representation-3d');
    assert.ok(reprs.length > 0);
    assert.ok(reprs.filter(c => c.params.values.type.name !== 'label')
      .every(c => c.params.values.type.params.ignoreLight === true));
    assert.ok(cells.every(c => c.status !== 'error'));
    assert.equal(plugin.managers.structure.selection.stats.elementCount, 0);
  };
  inspect();
  await manager.applyNext(1);
  inspect();
  await manager.applyNext(-1);
  inspect();
  assert.equal(presets, 2, 'returning to an already prepared step must reuse its Auto state');
  for (let step = 1; step < 5; step++) {
    await manager.applyNext(1);
    inspect();
  }
  assert.equal(presets, 5, 'all five distinct steps are prepared once');
  await manager.applyNext(-1);
  inspect();
  assert.equal(presets, 5, 'cached steps do not rebuild molecular geometry');
  console.log('Story real Auto + six exact residues + all five steps + cached return passed');
} finally {
  plugin.dispose();
  dom.happyDOM.abort();
}
