import { scalarSourceIdentity } from "../apps/desktop/src/lib/workbench/scalar-source";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
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

const settleField = async (plugin: InstanceType<typeof PluginContext>) => { for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,1));return fields(plugin); };

test('independent: a completed clear cannot be undone by an unrelated user Undo',async()=>{
 const view=await setup();
 try{
  await view.send(action());expect(fields(view.plugin).length).toBe(1);
  await view.plugin.state.data.build().toRoot().apply(StateTransforms.Data.RawData,{data:'unrelated user note'}).commit({canUndo:'User note'});
  await view.send(action(''));expect(fields(view.plugin).length).toBe(0);
  await view.plugin.runTask(view.plugin.state.data.undo());await settleField(view.plugin);
  expect([...view.plugin.state.data.cells.values()].some(cell=>cell.obj?.data==='unrelated user note')).toBe(false);
  expect(fields(view.plugin).length).toBe(0);
  expect(view.plugin.state.data.canUndo).toBe(false);
 }finally{view.close();}
});

test('independent: unrelated user Undo cannot resurrect an older isovalue after a later field request',async()=>{
 const view=await setup();
 try{
  await view.send(action());
  await view.plugin.state.data.build().toRoot().apply(StateTransforms.Data.RawData,{data:'unrelated user note'}).commit({canUndo:'User note'});
  await view.send({...action(),isovalue:0.05});
  await view.plugin.runTask(view.plugin.state.data.undo());await settleField(view.plugin);
  const reps=[...view.plugin.state.data.cells.values()].filter(cell=>cell.transform.transformer===StateTransforms.Representation.VolumeRepresentation3D);
  expect([...view.plugin.state.data.cells.values()].some(cell=>cell.obj?.data==='unrelated user note')).toBe(false);
  expect(reps.every(cell=>Math.abs(cell.transform.params.type.params.isoValue.absoluteValue)===0.05)).toBe(true);
  expect(view.plugin.state.data.canUndo).toBe(false);
 }finally{view.close();}
});
