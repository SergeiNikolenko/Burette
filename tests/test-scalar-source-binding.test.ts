import { plugin as installPlugin } from 'bun';
import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { molstarStatePreconditionPlugin } from '../scripts/molstar-state-precondition.mjs';
import { parseScientificFile, gridToCube } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import { serializeXyz } from '../apps/desktop/src/lib/molecular-workbench/xyz';
import { scalarSourceIdentity } from '../apps/desktop/src/lib/workbench/scalar-source';
installPlugin(molstarStatePreconditionPlugin);
const dom = new Window(), documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.document });
const { PluginContext } = await import('molstar/lib/mol-plugin/context.js');
const { StateTransforms } = await import('molstar/lib/mol-plugin-state/transforms.js');
afterAll(async () => { await dom.happyDOM.close(); if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else Reflect.deleteProperty(globalThis, 'document'); });
const hydrogen = '1\nsource\nH 0 0 0\n';
const smallCube = 'Cube\noblique\n1 1 2 3\n2 1 .1 0\n2 0 1 .1\n2 .1 0 1\n1 0 0 0 0\n-1 0 1 2 -2 0 2 3\n';
async function fixture(text: string, cube = false, nativeCrypto: Pick<Crypto, 'subtle' | 'randomUUID'> = crypto) {
 const plugin = new PluginContext({ actions: [], behaviors: [] }); await plugin.init();
 const raw = await plugin.builders.data.rawData({ data: text });
 if (cube) await plugin.state.data.build().to(raw).apply(StateTransforms.Data.ParseCube).apply(StateTransforms.Volume.VolumeFromCube).commit();
 else { const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz'); const model = await plugin.builders.structure.createModel(trajectory); await plugin.builders.structure.createStructure(model); }
 const viewer = { plugin }, scope: any = { molstar: { lib: { plugin: { StateTransforms } } } };
 vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/geometry-preview.js', import.meta.url), 'utf8'), { window: scope, crypto: nativeCrypto, TextEncoder, DataView, Uint8Array });
 const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
 const start = source.indexOf("    if (type === 'show_scalar_field' || type === 'scalar_field_binding' || type === 'scalar_field_validate') {");
 const execute = new Function('window', 'activeMolstarViewer', `let scalarFieldRequest=0,scalarBindingRequest=0,geometryPreviewLoading=null;return async action=>{const type=action.type;${source.slice(start, source.indexOf("    if (type === 'preview_geometry') {", start))}};`)(scope, () => viewer);
 return { plugin, raw, execute, close: () => plugin.dispose() };
}
const bind = (view: Awaited<ReturnType<typeof fixture>>, expected: Awaited<ReturnType<typeof scalarSourceIdentity>>) => view.execute({ type: 'scalar_field_binding', expected });

test('actual scientific reader FCHK and Molden atoms match the exact generated XYZ native scene', async () => {
 for (const name of ['gaussian16-water-raman.fchk', 'dispatcher/hydrogen.molden']) {
  const text = readFileSync(new URL(`fixtures/quantum/${name}`, import.meta.url), 'utf8');
  const science = parseScientificFile(name, text), xyz = serializeXyz(science.atoms, 'source');
  const view = await fixture(xyz);
  try {
   const before = view.plugin.state.data.getSnapshot();
   const expected = await scalarSourceIdentity(science, xyz, 'xyz');
   const { result } = await bind(view, expected);
   expect(await view.execute({ type: 'scalar_field_validate', lease: result.lease })).toEqual({ ok: true });
   expect(view.plugin.state.data.getSnapshot()).toEqual(before);
   const changed = { ...science, atoms: science.atoms.map((atom, index) => index === 0 ? { ...atom, z: atom.z + 0.01 } : atom) };
   await expect(bind(view, await scalarSourceIdentity(changed, xyz, 'xyz'))).rejects.toThrow('geometry');
  } finally { view.close(); }
 }
});

test('native source ABA invalidates the retained receipt even when original bytes return', async () => {
 const view = await fixture(hydrogen);
 try {
  const expected = await scalarSourceIdentity(parseScientificFile('h.xyz', hydrogen), hydrogen, 'xyz');
  const { result } = await bind(view, expected);
  await view.plugin.state.data.build().to(view.raw).update({ data: '1\nchanged\nH 0 0 2\n' }).commit({ canUndo: 'Edit source' });
  await view.plugin.runTask(view.plugin.state.data.undo());
  expect(view.raw.cell!.obj!.data).toBe(hydrogen);
  await expect(view.execute({ type: 'scalar_field_validate', lease: result.lease })).rejects.toMatchObject({ name: 'AbortError' });
  const replacement = await bind(view, expected);
  expect(await view.execute({ type: 'scalar_field_validate', lease: replacement.result.lease })).toEqual({ ok: true });
 } finally { view.close(); }
});

test('Cube binding uses dense Float32 values, physical oblique matrix, source bytes and original atom header', async () => {
 const science = parseScientificFile('source.cube', smallCube), backing = new Float32Array(20).fill(999);
 backing.set(science.grid!.values, 5); science.grid!.values = backing.subarray(5, 13);
 const view = await fixture(smallCube, true);
 try {
  const expected = await scalarSourceIdentity(science, smallCube, 'cube');
  expect((await bind(view, expected)).ok).toBe(true);
  const altered = { ...science, grid: { ...science.grid!, values: new Float32Array(science.grid!.values) } };
  altered.grid.values[0] += 1;
  await expect(bind(view, await scalarSourceIdentity(altered, smallCube, 'cube'))).rejects.toThrow('grid');
  for (const text of [smallCube.replace('1 1 2 3', '1 2 2 3'), smallCube.replace('1 0 0 0 0', '1 0 0 0 2')]) {
   const wrong = await scalarSourceIdentity(parseScientificFile('other.cube', text), text, 'cube');
   await expect(bind(view, wrong)).rejects.toThrow('displayed source');
  }
  const next = await bind(view, expected);
  await view.plugin.state.data.build().to(view.raw).update({ data: smallCube.replace('1 0 0 0 0', '1 0 0 0 2') }).commit();
  await expect(view.execute({ type: 'scalar_field_validate', lease: next.result.lease })).rejects.toMatchObject({ name: 'AbortError' });
 } finally { view.close(); }
});

test('source change during hashing and reverse completion of bindings cannot publish stale receipts', async () => {
 let release!: () => void, entered!: () => void, held = false;
 const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => entered = resolve);
 const nativeCrypto = { randomUUID: () => crypto.randomUUID(), subtle: { digest: async (...args: Parameters<SubtleCrypto['digest']>) => { if (!held) { held = true; entered(); await gate; } return crypto.subtle.digest(...args); } } as SubtleCrypto };
 const view = await fixture(hydrogen, false, nativeCrypto);
 try {
  const expected = await scalarSourceIdentity(parseScientificFile('h.xyz', hydrogen), hydrogen, 'xyz');
  const first = bind(view, expected).then(() => 'published', (error: Error) => error.name);
  await started;
  const second = await bind(view, expected);
  release(); expect(await first).toBe('AbortError');
  expect(await view.execute({ type: 'scalar_field_validate', lease: second.result.lease })).toEqual({ ok: true });
 } finally { release(); view.close(); }
});

test('negative-count Cube unit discrepancy refuses publication until the native parser supports angstrom grids', async () => {
 const text = smallCube.replace('2 1 .1 0', '-2 1 .1 0').replace('2 0 1 .1', '-2 0 1 .1').replace('2 .1 0 1', '-2 .1 0 1');
 const view = await fixture(text, true);
 try {
  const before = view.plugin.state.data.getSnapshot();
  await expect(bind(view, await scalarSourceIdentity(parseScientificFile('a.cube', text), text, 'cube'))).rejects.toThrow('grid');
  expect(view.plugin.state.data.getSnapshot()).toEqual(before);
 } finally { view.close(); }
});

test('independent: native source mutation and Undo during digest revoke in-flight binding without altering the restored scene',async()=>{
 let entered!:()=>void,release!:()=>void,held=false;
 const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const nativeCrypto={randomUUID:()=>crypto.randomUUID(),subtle:{digest:async(...args:Parameters<SubtleCrypto['digest']>)=>{if(!held){held=true;entered();await gate;}return crypto.subtle.digest(...args);}} as SubtleCrypto};
 const view=await fixture(hydrogen,false,nativeCrypto);
 try{
  const expected=await scalarSourceIdentity(parseScientificFile('h.xyz',hydrogen),hydrogen,'xyz');
  const pending=bind(view,expected).then(()=> 'published', (error:Error)=>error.name);await ready;
  await view.plugin.state.data.build().to(view.raw).update({data:'1\nintervening source\nH 0 0 2\n'}).commit({canUndo:'Native source change'});
  await view.plugin.runTask(view.plugin.state.data.undo());
  const restored=view.plugin.state.data.getSnapshot();expect(view.raw.cell!.obj!.data).toBe(hydrogen);
  release();expect(await pending).toBe('AbortError');expect(view.plugin.state.data.getSnapshot()).toEqual(restored);
  const fresh=await bind(view,expected);expect(await view.execute({type:'scalar_field_validate',lease:fresh.result.lease})).toEqual({ok:true});
 }finally{release();view.close();}
});
