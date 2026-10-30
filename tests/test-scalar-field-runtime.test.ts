import { plugin as installPlugin } from 'bun';
import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { molstarStatePreconditionPlugin } from '../scripts/molstar-state-precondition.mjs';
import { gridToCube } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import { evaluateOrbitalGrid, parseMolden } from '../apps/desktop/src/lib/molecular-workbench/gaussian';
installPlugin(molstarStatePreconditionPlugin);
const dom = new Window(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.document });
const { PluginContext } = await import('molstar/lib/mol-plugin/context.js');
const { StateTransforms } = await import('molstar/lib/mol-plugin-state/transforms.js');
const { PluginStateObject: SO, PluginStateTransform } = await import('molstar/lib/mol-plugin-state/objects.js');
const { Task } = await import('molstar/lib/mol-task/index.js');
afterAll(async () => { await dom.happyDOM.close(); if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else Reflect.deleteProperty(globalThis, 'document'); });
const input = parseMolden(readFileSync(new URL('fixtures/quantum/dispatcher/hydrogen.molden', import.meta.url), 'utf8'));
const grid = evaluateOrbitalGrid(input, 0, { paddingAngstrom: 1, spacingAngstrom: 0.5 });
const cube = gridToCube(grid, input.atoms);
const gate = () => { let release!: () => void, enter!: () => void; return { held: new Promise<void>(r => release = r), entered: new Promise<void>(r => enter = r), release: () => release(), enter: () => enter() }; };
async function setup() {
 const plugin = new PluginContext({ actions: [], behaviors: [] }); await plugin.init();
 const raw = await plugin.builders.data.rawData({ data: '1\nsource\nH 0 0 0\n' });
 const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
 const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model);
 const viewer = { plugin }; let active = viewer, load: ReturnType<typeof gate> | undefined;
 const scope: any = { molstar: { lib: { plugin: { StateTransforms } } } };
 vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/geometry-preview.js', import.meta.url), 'utf8'), { window: scope });
 const helper = scope.BuretteGeometryPreview;
 const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
 const start = source.indexOf("    if (type === 'show_scalar_field') {");
 const branch = source.slice(start, source.indexOf("    if (type === 'preview_geometry') {", start));
 const send = new Function('window', 'activeMolstarViewer', 'loadScript', 'runtimeURL', `let scalarFieldRequest = 0, geometryPreviewLoading = null; return async action => { const type = action.type; ${branch} };`)(scope, () => active, async () => { const hold = load; hold?.enter(); await hold?.held; scope.BuretteGeometryPreview = helper; }, () => 'geometry-preview.js');
 return { plugin, raw, scope, helper, send, active: (value: typeof viewer) => active = value, delay: () => { scope.BuretteGeometryPreview = undefined; load = gate(); return load; }, close: () => plugin.dispose() };
}
const action = (text = cube, signed = true) => ({ type: 'show_scalar_field', label: 'Orbital', cube: text, isovalue: 0.03, signed, notify: false });
const fields = (plugin: InstanceType<typeof PluginContext>) => [...plugin.state.data.cells.values()].filter(cell => cell.transform.tags?.includes('burette-scalar-field'));

test('actual MolStar receives numeric cube and signed surfaces, then density and clear replace only its own field', async () => {
 const view = await setup();
 try {
  await view.send(action());
  const cells = [...view.plugin.state.data.cells.values()];
  const volume = cells.find(cell => cell.transform.transformer.id.endsWith('volume-from-cube'))!;
  const values = volume.obj!.data.grid.cells.data;
  expect(Array.from(values).map(value => Math.fround(Number(value)))).toEqual(Array.from(grid.values).map(value => Math.fround(Number(value.toExponential(7)))));
  const reps = cells.filter(cell => cell.transform.transformer.id.endsWith('volume-representation-3d'));
  expect(reps.map(cell => cell.transform.params.type.params.isoValue.absoluteValue)).toEqual([0.03, -0.03]);
  expect(fields(view.plugin).length).toBe(1);
  await view.send(action(cube, false));
  expect([...view.plugin.state.data.cells.values()].filter(cell => cell.transform.transformer.id.endsWith('volume-representation-3d')).length).toBe(1);
  await view.send(action('')); expect(fields(view.plugin).length).toBe(0); expect(view.raw.cell!.obj!.data).toBe('1\nsource\nH 0 0 0\n');
 } finally { view.close(); }
});

test('delayed module load cannot follow a replaced viewer or changed source and latest clear supersedes pending field', async () => {
 for (const change of ['viewer', 'source', 'clear'] as const) {
  const view = await setup();
  try {
   const hold = view.delay(); const pending = view.send(action()); const rejected = pending.then(() => 'unexpected success', (error: Error) => error.name); await hold.entered;
   let cleared: Promise<unknown> | undefined;
   if (change === 'viewer') view.active({ plugin: view.plugin });
   else if (change === 'source') await view.plugin.state.data.build().to(view.raw).update({ data: '1\nreplacement\nH 0 0 1\n' }).commit();
   else cleared = view.send(action(''));
   hold.release(); expect(await rejected).toBe('AbortError'); await cleared; expect(fields(view.plugin).length).toBe(0);
  } finally { view.close(); }
 }
});

test('queue admission rejects source replacement while an actual state transform holds the update queue', async () => {
 const view = await setup(), hold = gate();
 const Hold = PluginStateTransform.BuiltIn({ name: `scalar-hold-${crypto.randomUUID()}`, from: SO.Root, to: SO.Data.String })({ apply() { return Task.create('Held real state update', async () => { hold.enter(); await hold.held; return new SO.Data.String('held'); }); } });
 try {
  const blocked = view.plugin.state.data.build().toRoot().apply(Hold).commit(); await hold.entered;
  const replacement = view.plugin.state.data.build().to(view.raw).update({ data: '1\nchanged\nH 0 0 2\n' }).commit();
  const pending = view.send(action()); const rejected = pending.then(() => 'unexpected success', (error: Error) => error.name);
  hold.release(); await blocked; await replacement; expect(await rejected).toBe('AbortError'); expect(fields(view.plugin).length).toBe(0);
 } finally { view.close(); }
});

test('oversized header and nonfinite data reject before any scene mutation', async () => {
 const view = await setup();
 try {
  const before = view.plugin.state.data.getSnapshot();
  for (const text of [cube.replace(/\n\s*5\s/, '\n1000001 '), cube.replace(/\d\.\d+e[+-]\d+\s*$/, 'Infinity')]) await expect(view.send(action(text))).rejects.toThrow();
  expect(view.plugin.state.data.getSnapshot()).toEqual(before);
 } finally { view.close(); }
});

test('source replacement during actual representation creation removes the stale branch and preserves user undo', async () => {
 const view = await setup();
 try {
  await view.plugin.state.data.build().toRoot().apply(StateTransforms.Data.RawData, { data: 'user history' }).commit({ canUndo: 'User action' });
  const history = view.plugin.state.data.canUndo;
  const subscription = view.plugin.state.data.events.object.created.subscribe(event => {
   if (view.plugin.state.data.cells.get(event.ref)?.transform.transformer === StateTransforms.Representation.VolumeRepresentation3D) view.active({ plugin: view.plugin });
  });
  try { await expect(view.send(action())).rejects.toMatchObject({ name: 'AbortError' }); }
  finally { subscription.unsubscribe(); }
  expect(fields(view.plugin).length).toBe(0);
  expect(view.plugin.state.data.canUndo).toBe(history);
  expect([...view.plugin.state.data.cells.values()].some(cell => cell.obj?.data === 'user history')).toBe(true);
 } finally { view.close(); }
});

test('oblique scalar grid retains physical axes and origin through the real Cube volume transform', async () => {
 const { Grid } = await import('molstar/lib/mol-model/volume/grid.js');
 const { Vec3 } = await import('molstar/lib/mol-math/linear-algebra.js');
 const view = await setup();
 const data = { dimensions: [2,2,2] as [number,number,number], origin: [1,2,3] as [number,number,number],
  axes: [[0.5,0.1,0],[-0.2,0.6,0.1],[0.1,0,0.7]] as [[number,number,number],[number,number,number],[number,number,number]],
  values: new Float32Array([-1,0,1,2,-2,0,2,3]) };
 try {
  await view.send(action(gridToCube(data, input.atoms)));
  const cell = [...view.plugin.state.data.cells.values()].find(cell => cell.transform.transformer.id.endsWith('volume-from-cube'))!;
  const matrix = Grid.getGridToCartesianTransform(cell.obj!.data.grid);
  for (const [i,j,k] of [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,1]]) {
   const actual = Vec3.transformMat4(Vec3(), Vec3.create(i,j,k), matrix);
   const expected = data.origin.map((origin, axis) => origin + i*data.axes[0][axis] + j*data.axes[1][axis] + k*data.axes[2][axis]);
   expect(actual.map((value, axis) => Math.abs(value-expected[axis]) < 1e-5).every(Boolean)).toBe(true);
  }
 } finally { view.close(); }
});

test('scalar transport rejects nondecimal header and value syntax rather than reinterpreting it', async () => {
 const view = await setup();
 const one = "one scalar\nsource\n1 0 0 0\n1 1 0 0\n1 0 1 0\n1 0 0 1\n1 0 0 0 0\n0x10\n";
 try {
  const before = view.plugin.state.data.getSnapshot();
  for (const text of [one, one.replace('0x10', '1e'), one.replace('1 0 0 0\n', '0x1 0 0 0\n').replace('0x10', '1')]) await expect(view.send(action(text))).rejects.toThrow();
  expect(view.plugin.state.data.getSnapshot()).toEqual(before);
 } finally { view.close(); }
});

test('a successful transient field retires after source edit and cannot reappear through native Undo', async () => {
 const view = await setup();
 const retired = async () => { for(let i=0;i<50&&fields(view.plugin).length;i++) await new Promise(resolve=>setTimeout(resolve,1)); expect(fields(view.plugin).length).toBe(0); };
 try {
  await view.send(action());expect(fields(view.plugin).length).toBe(1);
  await view.plugin.state.data.build().to(view.raw).update({data:'1\nedited\nH 0 0 1\n'}).commit({canUndo:'Edit source'});
  await retired();expect(view.plugin.state.data.canUndo).toBe(true);
  await view.plugin.runTask(view.plugin.state.data.undo());await retired();expect(view.raw.cell!.obj!.data).toBe('1\nsource\nH 0 0 0\n');
 } finally { view.close(); }
});

test('a Cube-only volume source owns its derived surface through isovalue, hide and source replacement', async () => {
 const view = await setup();
 try {
  await view.plugin.clear();const source = await view.plugin.builders.data.rawData({data:cube});
  await view.plugin.state.data.build().to(source).apply(StateTransforms.Data.ParseCube).apply(StateTransforms.Volume.VolumeFromCube).commit();
  expect(view.plugin.managers.structure.hierarchy.current.structures.length).toBe(0);
  await view.send(action());expect(fields(view.plugin).length).toBe(1);
  await view.send({...action(),isovalue:0.05});expect(fields(view.plugin).length).toBe(1);
  await view.send(action(''));expect(fields(view.plugin).length).toBe(0);expect(view.plugin.managers.volume.hierarchy.current.volumes.length).toBe(1);
  await view.send(action());await view.plugin.state.data.build().to(source).update({data:cube.replace('Burette scalar field','Edited cube')}).commit({canUndo:'Change source'});
  for(let i=0;i<50&&fields(view.plugin).length;i++)await new Promise(resolve=>setTimeout(resolve,1));
  expect(fields(view.plugin).length).toBe(0);expect(view.plugin.managers.volume.hierarchy.current.volumes.length).toBe(1);
 } finally { view.close(); }
});
