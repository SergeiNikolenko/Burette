// The 3D lasso against a real Mol* scene and camera: an atom drawn above the
// centre of the view is taken by a lasso drawn above the centre.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultRegistry } from '@molstar/plugin/default-registry';
import { StructureElement } from '@molstar/model/model/structure';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Viewport } from '@molstar/graphics/canvas3d/camera/util';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const functionSource = name => source.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];
// Formyl chloride in the screen plane: O above the carbon, H below right, Cl below left.
const atoms = [['C', 0, 0, 0], ['O', 0, 1.21, 0], ['H', 0.94, -0.54, 0], ['Cl', -1.5, -0.87, 0]];
const molfile = ['', '  test', '', '  4  3  0  0  0  0  0  0  0  0999 V2000',
  ...atoms.map(([element, ...position]) => `${position.map(value => value.toFixed(4).padStart(10)).join('')} ${element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`),
  '  1  2  2  0', '  1  3  1  0', '  1  4  1  0', 'M  END', ''].join('\n');

const dom = new Window({ url: 'http://localhost/' }), previous = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] });
try {
  await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: molfile });
  const model = await plugin.builders.structure.createModel(await plugin.builders.structure.parseTrajectory(raw, 'mol'));
  const structure = await plugin.builders.structure.createStructure(model);
  await plugin.builders.structure.tryCreateComponentStatic(structure, 'all');
  const camera = new Camera();
  Viewport.set(camera.viewport, 0, 0, 400, 300);
  camera.setState({ position: [0, 0, 25], target: [0, 0, 0], up: [0, 1, 0] }, 0);
  camera.update();
  Object.defineProperty(plugin, 'canvas3d', { configurable: true, value: { camera, add() {}, remove() {}, update() {}, commit() {}, requestDraw() {}, dispose() {} } });
  const lasso = new Function('activeMolstarViewer', 'molstarStructureRuntime', 'window', 'MOLSTAR_LASSO_PROJECTION_YIELD_INTERVAL', 'MOLSTAR_LASSO_COMPONENT_TAG',
    `${['molstarCurrentStructures', 'molstarStructureFromRef', 'molstarLassoYield', 'molstarLassoBounds', 'molstarPointInPolygon', 'molstarLassoProjectionSources', 'molstarLassoProjectedLoci'].map(functionSource).join('\n')}\n  return molstarLassoProjectedLoci;`)(
    () => ({ plugin }), () => ({ StructureElement }), { setTimeout }, 4096, 'burette-lasso');
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) };
  const taken = async (left, top, right, bottom) => {
    const loci = await lasso({ canvas, points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }] });
    const symbols = [];
    for (const item of loci) StructureElement.Loci.forEachLocation(item, location => symbols.push(location.unit.model.atomicHierarchy.atoms.type_symbol.value(location.element)));
    return symbols.sort();
  };
  // The view is 400 × 300 px with the carbon at its centre and +y up.
  assert.deepEqual(await taken(190, 110, 210, 145), ['O'], 'a lasso above the centre takes the atom above the centre');
  assert.deepEqual(await taken(150, 155, 260, 190), ['CL', 'H'], 'a lasso below the centre takes the atoms below it');
  assert.deepEqual(await taken(100, 50, 300, 250), ['C', 'CL', 'H', 'O']);
  console.log('The 3D lasso takes the atoms drawn inside it.');
} finally {
  plugin.dispose();
  await dom.happyDOM.close();
  globalThis.document = previous;
}
