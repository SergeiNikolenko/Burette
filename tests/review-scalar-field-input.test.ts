import { scalarSourceIdentity } from "../apps/desktop/src/lib/workbench/scalar-source";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { plugin as installPlugin } from 'bun';
import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { molstarStatePreconditionPlugin } from '../scripts/molstar-state-precondition.mjs';
import { molstarCubeDatasetsPlugin } from '../scripts/molstar-cube-datasets.mjs';
import { gridToCube } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import { evaluateOrbitalGrid, parseMolden } from '../apps/desktop/src/lib/molecular-workbench/gaussian';
installPlugin(molstarStatePreconditionPlugin);
// The runtime bundle reads the chosen field of a multi-field Cube; upstream reads the first.
installPlugin(molstarCubeDatasetsPlugin);
const dom = new Window(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.document });
const { PluginContext } = await import('@molstar/plugin');
const { DefaultRegistry } = await import('@molstar/plugin/default-registry');
const { StateTransforms } = await import('@molstar/viewer/state-transforms');
const { PluginStateObject: SO, PluginStateTransform } = await import('@molstar/plugin/state/objects');
const { Task } = await import('@molstar/core/task');
afterAll(async () => { await dom.happyDOM.close(); if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else Reflect.deleteProperty(globalThis, 'document'); });
const input = parseMolden(readFileSync(new URL('fixtures/quantum/dispatcher/hydrogen.molden', import.meta.url), 'utf8'));
const grid = evaluateOrbitalGrid(input, 0, { paddingAngstrom: 1, spacingAngstrom: 0.5 });
const cube = gridToCube(grid, input.atoms);
const gate = () => { let release!: () => void, enter!: () => void; return { held: new Promise<void>(r => release = r), entered: new Promise<void>(r => enter = r), release: () => release(), enter: () => enter() }; };
async function setup() {
 const plugin = new PluginContext({ registry: DefaultRegistry, behaviors: [] }); await plugin.init();
 const raw = await plugin.builders.data.rawData({ data: '1\nsource\nH 0 0 0\n' });
 const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
 const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model);
 const viewer = { plugin }; let active = viewer, load: ReturnType<typeof gate> | undefined;
 const scope: any = { molstar: { lib: { plugin: { StateTransforms } } } };
 vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/geometry-preview.js', import.meta.url), 'utf8'), { window: scope, crypto, TextEncoder, DataView, Uint8Array });
 const helper = scope.BuretteGeometryPreview;
 const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
 const start = source.indexOf("    if (type === 'show_scalar_field' || type === 'scalar_field_binding' || type === 'scalar_field_validate') {");
 const branch = source.slice(start, source.indexOf("    if (type === 'preview_geometry') {", start));
 const execute = new Function('window', 'activeMolstarViewer', 'loadScript', 'runtimeURL', `let scalarFieldRequest = 0, scalarBindingRequest = 0, geometryPreviewLoading = null; return async action => { const type = action.type; ${branch} };`)(scope, () => active, async () => { const hold = load; hold?.enter(); await hold?.held; scope.BuretteGeometryPreview = helper; }, () => 'geometry-preview.js');
 let lease = (await execute({ type: 'scalar_field_binding', expected: await scalarSourceIdentity(input, '1\nsource\nH 0 0 0\n', 'xyz') })).result.lease;
 const send = (action: object) => execute({ ...action, lease });
 const bindCube = async () => { lease = (await execute({ type: 'scalar_field_binding', expected: await scalarSourceIdentity(parseScientificFile('source.cube', cube), cube, 'cube') })).result.lease; };
 return { plugin, raw, scope, helper, send, bindCube, active: (value: typeof viewer) => active = value, delay: () => { scope.BuretteGeometryPreview = undefined; load = gate(); return load; }, close: () => plugin.dispose() };
}
const action = (text = cube, signed = true) => ({ type: 'show_scalar_field', label: 'Orbital', cube: text, isovalue: 0.03, signed, notify: false });
const fields = (plugin: InstanceType<typeof PluginContext>) => [...plugin.state.data.cells.values()].filter(cell => cell.transform.tags?.includes('burette-scalar-field'));

test('independent: a one-cell cube without its scalar value is not silently published as zero', async () => {
 const view=await setup();
 const missing="one scalar expected\nsource\n1 0 0 0\n1 1 0 0\n1 0 1 0\n1 0 0 1\n1 0 0 0 0\n\n";
 try {
  const before=view.plugin.state.data.getSnapshot();
  await expect(view.send(action(missing))).rejects.toThrow();
  expect(view.plugin.state.data.getSnapshot()).toEqual(before);
  expect(fields(view.plugin).length).toBe(0);
 } finally {view.close();}
});

const { coulombPotentialGrid, vanDerWaalsField } = await import("../apps/desktop/src/lib/molecular-workbench/electrostatic-potential");
const { gridsToCube } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
const water = [{ element: "O", x: 0, y: 0, z: 0.1173 }, { element: "H", x: 0, y: 0.7572, z: -0.4692 }, { element: "H", x: 0, y: -0.7572, z: -0.4692 }];
const potential = coulombPotentialGrid(water, [-0.834, 0.417, 0.417], 0.6);
const pair = gridsToCube([vanDerWaalsField(water, potential), potential], water);
const coloring = { min: -0.05, max: 0.05 };
const named = (plugin: InstanceType<typeof PluginContext>, name: string) => [...plugin.state.data.cells.values()].filter(cell => cell.transform.transformer.definition.name === name);

test('a surface takes its colours from the potential field of the same Cube', async () => {
 const view = await setup();
 try {
  await view.send({ ...action(pair), isovalue: 1, coloring });
  const surfaces = named(view.plugin, 'volume-representation-3d'), theme = surfaces[0].transform.params.colorTheme;
  // One isosurface of the first field; the colouring volume is the second field.
  const tint = view.plugin.state.data.cells.get(theme.params.volume.ref)!;
  expect([surfaces.length, view.plugin.state.data.cells.get(surfaces[0].transform.parent)!.transform.params.dataIndex, tint.transform.params.dataIndex]).toEqual([1, 0, 1]);
  expect([theme.name, theme.params.coloring.params.domain]).toEqual(['external-volume', { name: 'custom', params: [-0.05, 0.05] }]);
  const values = tint.obj!.data.grid.cells.data, written = Array.from(potential.values, value => Number(value.toExponential(7)));
  expect([Math.min(...values), Math.max(...values)]).toEqual([Math.min(...written), Math.max(...written)]);
 } finally { view.close(); }
});

test('a slice draws one grid plane of the field coloured by the field itself', async () => {
 const view = await setup();
 try {
  await view.send({ ...action(), isovalue: undefined, slice: { axis: 2, index: 3, min: -0.1, max: 0.1 } });
  const [plane] = named(view.plugin, 'volume-representation-3d'), params = plane.transform.params;
  expect([params.type.name, params.type.params.mode, params.type.params.dimension]).toEqual(['slice', 'grid', { name: 'z', params: 3 }]);
  // The colouring volume is the sliced volume, so the plane shows the same field.
  expect([params.colorTheme.name, params.colorTheme.params.volume.ref, params.colorTheme.params.coloring.params.domain])
    .toEqual(['external-volume', plane.transform.parent, { name: 'custom', params: [-0.1, 0.1] }]);
  expect(plane.obj?.data.repr).toBeDefined();
  await expect(view.send({ ...action(), slice: { axis: 2, index: grid.dimensions[2], min: -0.1, max: 0.1 } })).rejects.toThrow('Invalid scalar field slice');
  await expect(view.send({ ...action(pair), coloring, slice: { axis: 0, index: 0, min: -0.1, max: 0.1 } })).rejects.toThrow('Invalid scalar field slice');
 } finally { view.close(); }
});

test('a field pair without its colouring, with another field list, or with an empty range is refused', async () => {
 const view = await setup();
 try {
  await expect(view.send({ ...action(pair), isovalue: 1 })).rejects.toThrow('isosurface and the field colouring it');
  await expect(view.send({ ...action(pair.replace('\n2 1 2\n', '\n2 7 9\n')), isovalue: 1, coloring })).rejects.toThrow('two fields after the atoms');
  await expect(view.send({ ...action(pair), isovalue: 1, coloring: { min: 1, max: 1 } })).rejects.toThrow('colouring range');
  await expect(view.send({ ...action(), coloring })).rejects.toThrow('isosurface and the field colouring it');
  expect(fields(view.plugin).length).toBe(0);
 } finally { view.close(); }
});
