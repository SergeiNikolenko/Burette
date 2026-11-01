import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Window } from 'happy-dom';
import { requestIndexedTrajectoryFrame } from '../apps/desktop/src/lib/indexed-trajectory-frame.ts';

const dom = new Window({ url: 'https://trajectory-test.invalid/' });
Object.assign(dom, { setImmediate, clearImmediate });
const globals = new Map();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, CSS: dom.CSS, getComputedStyle: dom.getComputedStyle.bind(dom) })) {
  globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
}
const bundle = readFileSync(process.argv[2] || 'PreviewExtension/Web/molstar.js');
const reordered = process.argv[4] === 'reordered';
const viewerSource = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const method = name => { const start = viewerSource.indexOf('  async function '+name+'('); assert.ok(start >= 0); return viewerSource.slice(start, viewerSource.indexOf('\n  }', start)+4); };
const fixtures = name => new Uint8Array(readFileSync(new URL(`./fixtures/trajectory/${name}`, import.meta.url)));
const f1 = fixtures('vectors.trr'), f2 = fixtures('forces-only.trr'), bytes = new Uint8Array(f1.length + f2.length);
bytes.set(f1); bytes.set(f2, f1.length);
const context = vm.createContext({ console, assert, document: dom.document, window: dom, self: dom,
  navigator: dom.navigator, location: dom.location, crypto, TextEncoder, TextDecoder, Blob: dom.Blob, File: dom.File, FileReader: dom.FileReader,
  URL, URLSearchParams, ArrayBuffer, SharedArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView,
  atob, btoa, performance, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, queueMicrotask,
  requestAnimationFrame: cb => setTimeout(() => cb(performance.now()), 0), cancelAnimationFrame: clearTimeout,
  HTMLElement: dom.HTMLElement, HTMLCanvasElement: dom.HTMLCanvasElement, HTMLImageElement: dom.HTMLImageElement, Image: dom.Image,
  Event: dom.Event, CustomEvent: dom.CustomEvent, AbortController, AbortSignal, viewerSource, bytes, loaderSource:method('loadDockingTrajectoryPair'), dispatchSource:method('executeBuretteAgentAction'),
  topologyFormat: reordered ? 'mmcif' : 'pdb',
  pdb: readFileSync(new URL(reordered ? './fixtures/trajectory/reordered-reference.cif' : './fixtures/trajectory/vector-reference.pdb', import.meta.url), 'utf8') });
let native;
try {
  vm.runInContext(bundle.toString('utf8'), context, { filename: 'built-indexed-native.js', timeout: 30000 });
  const ply = vm.runInContext('Boolean(molstar.BurettePlyExport)', context);
  if (process.argv[3] === 'root') assert.equal(ply, true, 'root PLY remains exported');
  native = await vm.runInContext(`(async () => {
    const runtime = molstar.BuretteIndexedTrajectory, { PluginContext, DefaultPluginSpec } = molstar.lib.plugin;
    const plugins = [], make = async () => { const p = new PluginContext(DefaultPluginSpec()); plugins.push(p); await p.init(); return p; };
    const plugin = await make(); let current = { plugin };
    const load = new Function('window','normalizeFormat',loaderSource+';return loadDockingTrajectoryPair;')({molstar}, x=>x);
    await load(current, { modelKind:'model-data', modelEntry:{data:pdb,format:topologyFormat,label:'Independent topology'}, coordinateEntry:{data:bytes,format:'trr',label:'Independent two-frame TRR',segmentIndex:2} }, {representationPreset:'empty'});
    const execute = new Function('window','activeMolstarViewer',dispatchSource+';return executeBuretteAgentAction;')({molstar},()=>current);
    const cell = () => { const shown=current.plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data.models[0]; return [...current.plugin.state.data.cells.values()].find(c=>c.transform.transformer.id==='ms-plugin.model-from-trajectory' && c.obj?.data===shown); };
    return { execute, state:()=>current.plugin.state.data.tree, model:()=>cell().obj.data,
      seek:async index=>{const c=cell();await current.plugin.state.updateTransform(current.plugin.state.data,c.transform.ref,{...c.params.values,modelIndex:index});},
      reopen:async()=>{const snapshot=JSON.parse(JSON.stringify(current.plugin.state.data.getSnapshot()));const fresh=await make();await fresh.runTask(fresh.state.data.setSnapshot(snapshot));current={plugin:fresh};},
      retire:()=>current.plugin.clear(), retainedPage:model=>runtime.frameData(model), close:()=>{for(const p of plugins)p.dispose();}
    };
  })()`, context);
  const frame = dom.document.createElement('iframe'); frame.className = 'viewer-iframe'; frame.dataset.documentId = 'trr-source'; dom.document.body.append(frame);
  const requests = [];
  Object.defineProperty(frame.contentWindow, 'postMessage', { configurable: true, value: async message => {
    requests.push(message.body.action); let result;
    try { result = await native.execute(message.body.action); } catch(error) { result={ok:false,error:{message:error.message}}; }
    dom.dispatchEvent(new dom.MessageEvent('message',{source:frame.contentWindow,data:{source:'burette-agent-viewer',body:{type:'agent-action-result',id:message.body.id,result:structuredClone(result)}}}));
  } });
  const read = options => requestIndexedTrajectoryFrame('trr-source', options);
  const identity = page => Object.fromEntries(['sourceId','modelId','structureRef','frameIndex','frameCount','segmentIndex'].map(k=>[k,page[k]]));
  const near = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
  const position=[[1.25,-2.5,15],[10,20,30],[-10,0,5]], velocity=[[.1,-.2,.3],[.4,0,-.6],[-.7,.8,.9]], force=[[1,-2,3],[0,.5,-.5],[.1,.2,.3]];
  // Both fixture frames share this triclinic box (rows a, b, c in Å). Mol* makes
  // molecules whole in a box, so the displayed atom is a lattice image of the file position.
  const lattice = (d) => { const k=d[2]/40, j=(d[1]-5*k)/30, i=(d[0]-2.5*j+1.25*k)/20; return [i,j,k]; };
  const check = (page,index) => {
    const displayed = native.model().atomicConformation;
    for (const atom of page.atoms) for (const n of lattice(['x','y','z'].map((axis,j)=>displayed[axis][atom.index]-atom.position[j]))) near(n, Math.round(n));
    assert.equal(page.available,true);assert.equal(page.frameIndex,index);assert.equal(page.frameCount,2);assert.equal(page.segmentIndex,2);assert.equal(page.total,3);
    assert.equal(page.time.unit,'ps');near(page.time.value,index?4.25:2.75);assert.equal(page.step,index?175:125);
    assert.equal(page.units.position,'angstrom');assert.equal(page.units.force,'kcal/mol/angstrom');assert.equal(page.units.velocity,index?undefined:'angstrom/ps');
    for(const atom of page.atoms){const s=atom.sourceAtomIndex;for(let j=0;j<3;j++){near(atom.position[j],position[s][j]);near(atom.force[j],force[s][j]*(index?2:1));if(!index)near(atom.velocity[j],velocity[s][j]);}if(index)assert.equal(atom.velocity,undefined);}
  };
  assert.deepEqual(Array.from(native.model().atomicHierarchy.atomSourceIndex.toArray()), reordered ? [2,0,1] : [0,1,2]);
  const before=native.state(), first=await read({limit:1});check(first,0);assert.deepEqual(first.summary,{});assert.equal(native.state(),before);
  const later=await read({offset:1,limit:2,expected:identity(first)});check(later,0);assert.deepEqual([...first.atoms,...later.atoms].map(a=>a.index),[0,1,2]);assert.equal(native.state(),before);
  const summary=await read({limit:1,includeSummary:true,expected:identity(first)});near(summary.summary.rmsSpeed,Math.sqrt(2.6/3));near(summary.summary.maxForce,Math.sqrt(14));near(summary.summary.rmsForce,Math.sqrt(14.64/3));
  const sent=requests.length;await assert.rejects(read({limit:101}),/1–100/);assert.equal(requests.length,sent);
  await native.seek(1);await assert.rejects(read({expected:identity(first)}),/changed/);const second=await read({limit:3,includeSummary:true});check(second,1);assert.equal(second.summary.rmsSpeed,undefined);near(second.summary.maxForce,2*Math.sqrt(14));
  await native.seek(0);const again=await read({limit:3});check(again,0);assert.equal(again.sourceId,first.sourceId);assert.notEqual(again.modelId,first.modelId);
  await native.seek(1);await native.reopen();const reopened=await read({limit:3});check(reopened,1);assert.notEqual(reopened.sourceId,first.sourceId);assert.deepEqual(reopened.atoms,second.atoms);
  const model=native.model();await native.retire();assert.equal(native.retainedPage(model),null);assert.deepEqual(await read({}),{available:false});await assert.rejects(read({expected:identity(reopened)}),/changed/);
  console.log(JSON.stringify({bundleSha256:createHash('sha256').update(bundle).digest('hex'),frames:2,atoms:3,sourceAtomIndices:first.atoms.concat(later.atoms).map(a=>a.sourceAtomIndex),numericTolerance:1e-6,rootPlyPresent:ply,
    proof:'actual built native TRR loader -> current viewer dispatcher -> typed host message bridge; units, all vectors, bounded pages, no read mutation, seek, snapshot reopen and disposed lifetime',missingVelocity:'absent, not zero'}));
} finally {
  native?.close(); await dom.happyDOM.close(); for(const [key,value]of globals)value?Object.defineProperty(globalThis,key,value):Reflect.deleteProperty(globalThis,key);
}
