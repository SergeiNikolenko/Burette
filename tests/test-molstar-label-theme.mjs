import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { StructureElement } from 'molstar/lib/mol-model/structure.js';
import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { setCanvasModule } from 'molstar/lib/mol-geo/geometry/text/font-atlas.js';

// State integration only; real text rasterization is checked in the browser.
setCanvasModule({ createCanvas: () => ({ getContext: () => ({
  measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) });

const dom = new Window();
const previousDocument = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ actions: [], behaviors: [] });
const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const helper = source.match(/\n  function applyViewerBackground\([\s\S]*?\n  \}/u)[0];
const errors = [];
try {
  await plugin.init();
  const data = await plugin.builders.data.rawData({ data: readFileSync(new URL('../samples/mini.cif', import.meta.url), 'utf8') });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = await plugin.builders.structure.createStructure(model);
  const loci = [0, 1, 2, 3].map(i => StructureElement.Loci(structure.data, [{ unit: structure.data.units[0], indices: OrderedSet.ofSingleton(i) }]));
  const manager = plugin.managers.structure.measurement;
  const labels = [
    await manager.addDistance(loci[0], loci[1]),
    await manager.addAngle(...loci.slice(0, 3)),
    await manager.addDihedral(...loci),
    await manager.addLabel(loci[0], { labelParams: { customText: 'CA' } }),
  ];
  const original = labels.map(label => ({ ...label.representation.cell.transform.params }));
  const structureData = structure.data;
  // Await the actual manager update launched by the synchronous background hook.
  let pending;
  let updates = 0;
  const setOptions = manager.setOptions.bind(manager);
  manager.setOptions = options => { updates++; return (pending = setOptions(options)); };
  const apply = async (background, theme = 'dark', transparent = false) => {
    const bindings = {
      applyDocumentBackground() {}, applyStaticRendererTheme() {},
      transparentBackground: transparent, resolveViewerTheme: () => theme,
      resolvedCanvasBackground: () => background, debug: error => errors.push(error),
    };
    const run = new Function(...Object.keys(bindings), `${helper}; return applyViewerBackground;`)(...Object.values(bindings));
    run({ plugin });
    await pending;
  };
  for (const [background, theme, transparent, color] of [
    ['graphite', 'dark', false, 0xfcfcfc],
    ['white', 'light', false, 0x0d0d0d],
    ['black', 'light', false, 0xfcfcfc],
    ['transparent', 'light', true, 0x0d0d0d],
    ['transparent', 'dark', true, 0xfcfcfc],
  ]) {
    await apply(background, theme, transparent);
    assert.deepEqual(labels.map(label => label.representation.cell.transform.params), original.map(params => ({ ...params, textColor: color })));
    const added = await manager.addDistance(loci[1], loci[2]);
    assert.equal(added.representation.cell.transform.params.textColor, color, 'new measurements inherit the current theme');
    assert.equal(structure.data, structureData, 'theme changes preserve the loaded structure');
    const previousUpdates = updates;
    await apply(background, theme, transparent);
    assert.equal(updates, previousUpdates, 'repeated background refreshes do not feed back into Story state updates');
  }
  assert.deepEqual(errors, []);
  console.log('Mol* label theme: existing/new distance, angle, dihedral and atom labels passed');
} finally {
  plugin.dispose();
  globalThis.document = previousDocument;
  await dom.happyDOM.close();
}
