import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { StructureElement } from 'molstar/lib/mol-model/structure.js';
import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { setCanvasModule } from 'molstar/lib/mol-geo/geometry/text/font-atlas.js';
import { codexThemeColors } from '../apps/desktop/src/lib/codex-theme.ts';

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
const helper = ['themeTokensFor', 'resolvedCanvasBackground', 'themeCanvasHex', 'canvasBackgroundCSS',
  'canvasBackgroundColor', 'viewerHasLightBackground', 'cameraAxesParams', 'applyCameraAxesStyle', 'applyViewerBackground']
  .map(name => source.match(new RegExp(`\\n  function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'))[0]).join('');
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
  const apply = async (background, theme, themeBackground) => {
    const transparent = background === 'transparent';
    const canvasUpdates = [];
    const bindings = {
      applyDocumentBackground() {}, applyStaticRendererTheme() {},
      activeConfig: { themeTokens: { [theme]: { background: themeBackground } } },
      canvasBackground: background,
      transparentBackground: transparent, resolveViewerTheme: () => theme,
      window: { BuretteConfig: {}, BuretteNativeViewerMenus: { themeColors: codexThemeColors } },
      debug: error => errors.push(error),
    };
    const run = new Function(...Object.keys(bindings), `${helper}; return applyViewerBackground;`)(...Object.values(bindings));
    run({ plugin: { managers: plugin.managers, canvas3d: {
      props: { camera: { helper: { axes: { name: 'off' } } } },
      setProps: props => canvasUpdates.push(props), requestDraw() {},
    } } });
    await pending;
    return canvasUpdates;
  };
  for (const [background, theme, themeBackground, canvas, color] of [
    ['graphite', 'dark', undefined, 0x111111, 0xfcfcfc],
    ['white', 'light', undefined, 0xffffff, 0x0d0d0d],
    ['black', 'light', undefined, 0x000000, 0xfcfcfc],
    ['transparent', 'light', undefined, null, 0x0d0d0d],
    ['transparent', 'dark', undefined, null, 0xfcfcfc],
    ['auto', 'light', '#000000', 0x000000, 0xfcfcfc],
    ['auto', 'dark', '#ffffff', 0xffffff, 0x0d0d0d],
    ['auto', 'dark', '#111111', 0x181818, 0xfcfcfc],
    ['auto', 'dark', undefined, 0x181818, 0xfcfcfc],
    ['auto', 'dark', '#eab308', 0xeab308, 0x0d0d0d],
    ['auto', 'light', '#0000ff', 0x0000ff, 0xfcfcfc],
    ['transparent', 'light', '#000000', null, 0xfcfcfc],
    ['transparent', 'dark', '#ffffff', null, 0x0d0d0d],
    ['white', 'dark', '#000000', 0xffffff, 0x0d0d0d],
    ['graphite', 'light', '#ffffff', 0x111111, 0xfcfcfc],
  ]) {
    const canvasUpdates = await apply(background, theme, themeBackground);
    assert.deepEqual(canvasUpdates, canvas === null
      ? [{ transparentBackground: true }]
      : [{ transparentBackground: false, renderer: { backgroundColor: canvas } }]);
    assert.deepEqual(labels.map(label => label.representation.cell.transform.params), original.map(params => ({ ...params, textColor: color })));
    const added = await manager.addDistance(loci[1], loci[2]);
    assert.equal(added.representation.cell.transform.params.textColor, color, 'new measurements inherit the current theme');
    assert.equal(structure.data, structureData, 'theme changes preserve the loaded structure');
    const previousUpdates = updates;
    await apply(background, theme, themeBackground);
    assert.equal(updates, previousUpdates, 'repeated background refreshes do not feed back into Story state updates');
  }
  assert.deepEqual(errors, []);
  console.log('Mol* label theme: existing/new distance, angle, dihedral and atom labels passed');
} finally {
  plugin.dispose();
  globalThis.document = previousDocument;
  await dom.happyDOM.close();
}
