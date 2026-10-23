import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker as Thread } from 'node:worker_threads';
const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => {
  const match = source.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'));
  assert.ok(match, name); return match[0];
};
let active = 0;
class Worker {
  constructor(url) {
    active += 1;
    this.ready = fetch(url).then(r => r.text()).then(code => {
      this.thread = new Thread(`const {parentPort}=require('node:worker_threads'); const self={postMessage:data=>parentPort.postMessage(data)}; ${code}; parentPort.on('message',data=>self.onmessage({data}));`, {eval:true});
      this.thread.on('message', data => this.onmessage?.({data}));
      this.thread.on('error', error => this.onerror?.({message:error.message}));
      if (this.stopped) void this.thread.terminate();
    });
  }
  postMessage(data) { void this.ready.then(()=>{if(!this.stopped)this.thread.postMessage(data);}); }
  terminate() { if(this.stopped)return; this.stopped=true; active-=1; void this.thread?.terminate(); }
}
const harness = new Function('Worker', `
 let activeMolstarPrepared = {};
 const setStatus = () => {};
 ${['largestEigenvectorSymmetric4','pdbRigidAlignment','xyzFrameElementSignature','xyzFramesAlignable','alignXyzFramesToFirst'].map(extract).join('\n')}
 return {align:alignXyzFramesToFirst, replace:()=>{activeMolstarPrepared={};}};
`)(Worker);
const frame = points => ({atoms: points.map(([x,y,z])=>({element:'C',x,y,z}))});
const original = frame([[0,0,0],[2,0,0],[0,3,0],[0,0,1]]);
const moved = frame(original.atoms.map(a=>[-a.y+8,a.x-5,a.z+2]));
const aligned = await harness.align([original,moved], new AbortController().signal);
assert.ok(aligned.averageRmsd < 1e-6);
for(let i=0;i<4;i++) for(const axis of ['x','y','z']) assert.ok(Math.abs(aligned.frames[1].atoms[i][axis]-original.atoms[i][axis])<1e-6);
assert.equal(active,0);
const large = frame(Array.from({length:10000},(_,i)=>[i,0,0]));
const controller = new AbortController();
const cancelled = harness.align([large,large],controller.signal);
setTimeout(()=>controller.abort(),10);
await assert.rejects(cancelled,{name:'AbortError'});
assert.equal(active,0,'cancel terminates the calculation worker');
const stale = harness.align([large,large],new AbortController().signal);
harness.replace();
await assert.rejects(stale,{name:'AbortError'});
assert.equal(active,0,'document replacement terminates the old calculation');
const queue = new Function(`let molstarSceneRebuildChain=Promise.resolve(); const pendingSceneAppearance=new Map(); const activeViewer=null; let molstarDrawHoldDepth=0, molstarDrawHoldEndedAt=0; ${extract('withMolstarDrawHold')} ${extract('queueMolstarSceneRebuild')} return queueMolstarSceneRebuild;`)();
let release; const gate=new Promise(r=>release=r); const calls=[];
const blocker=queue(()=>gate);
const old=queue(()=>calls.push('old'),'same-document');
const latest=queue(()=>calls.push('latest'),'same-document');
release(); await Promise.all([blocker,old,latest]);
assert.deepEqual(calls,['latest']);
console.log('Worker alignment parity, cancellation, document replacement and appearance coalescing passed');

// Different molecules superimpose on their shared substructure: toluene and a
// renumbered, rotated phenol share the ring; the methyl carbon and the hydroxyl
// oxygen stay unmatched, and a molecule with nothing to match keeps its place.
const matching = new Function('Worker', `
 let activeMolstarPrepared = {};
 const setStatus = () => {};
 ${['largestEigenvectorSymmetric4','pdbRigidAlignment','xyzFrameElementSignature','xyzFramesAlignable','alignXyzFramesToFirst',
   'sdfMoleculeMatchGraph','sdfMatchSimilarity','sdfAtomsCompatible','growSdfAtomMatch','sdfCollectionAtomMatch','sdfCollectionAtomPairs'].map(extract).join('\n')}
 return {align:alignXyzFramesToFirst, pairs:sdfCollectionAtomPairs};
`)(Worker);
const ring = Array.from({length:6},(_,i)=>[1.4*Math.cos(i*Math.PI/3),1.4*Math.sin(i*Math.PI/3),0]);
const ringBonds = Array.from({length:6},(_,i)=>({a:i+1,b:(i+1)%6+1,order:i%2?2:1}));
const toluene = {atoms:[...ring,[2.9,0,0]].map(([x,y,z])=>({element:'C',x,y,z})), bonds:[...ringBonds,{a:1,b:7,order:1}]};
const order = [6,2,4,0,5,1,3];
const rotate = ([x,y,z]) => [-y+4,x-1,z+3];
const phenolAtoms = [...ring,[2.8,0,0]].map((p,i)=>({element:i===6?'O':'C',...Object.fromEntries(rotate(p).map((v,k)=>['xyz'[k],v]))}));
const phenol = {atoms:order.map(i=>phenolAtoms[i]), bonds:[...ringBonds,{a:1,b:7,order:1}].map(({a,b,order:o})=>({a:order.indexOf(a-1)+1,b:order.indexOf(b-1)+1,order:o}))};
const oxygen = {atoms:[{element:'O',x:9,y:9,z:9},{element:'O',x:10,y:9,z:9}], bonds:[{a:1,b:2,order:2}]};
const molecules = [toluene, phenol, oxygen];
const atomPairs = await matching.pairs(molecules, new AbortController().signal);
assert.equal(atomPairs[1].length, 6);
assert.equal(atomPairs[2], null);
const asFrame = m => ({atoms:m.atoms.map(a=>({symbol:a.element,x:a.x,y:a.y,z:a.z}))});
const fitted = await matching.align(molecules.map(asFrame), new AbortController().signal, atomPairs);
assert.ok(fitted.averageRmsd < 1e-6);
assert.deepEqual([fitted.atomCount, fitted.skipped], [6, 1]);
for (const atom of fitted.frames[1].atoms.filter(a=>a.symbol==='C')) {
  assert.ok(ring.some(([x,y,z])=>Math.hypot(atom.x-x,atom.y-y,atom.z-z)<1e-6), 'ring carbons land on the reference ring');
}
assert.deepEqual(fitted.frames[2], asFrame(oxygen));
console.log('Shared-substructure alignment of different molecules passed');

// Rebuilding aligned or individual XYZ frames must retain the selected appearance.
const appearances = [];
const styledLayers = [];
const styleFrame = new Function('applyMolstarRepresentationsToStructures', 'applyMolstarAppearance', `
 let activeConfig = { molstarAppearance: 'illustrative' };
 const configuredMolstarAppearance = config => config.molstarAppearance;
 const xyzFrameRepresentationStyle = style => style;
 const sdfCollectionRepresentationForStyle = (style, alpha, colorMode) => ({style, alpha, colorMode});
 ${extract('applyXyzFrameMolstarStyle')}
 return {apply: applyXyzFrameMolstarStyle, standard: () => {activeConfig.molstarAppearance = 'standard';}};
`)(async (_viewer, structures, representation) => styledLayers.push({structures, representation}),
   async (_viewer, appearance) => appearances.push(appearance));
await styleFrame.apply({}, 'ball-and-stick', ['aligned-frame'], 1, 'colored');
await styleFrame.apply({}, 'line', ['background-frame'], 0.2, 'gray');
styleFrame.standard();
await styleFrame.apply({}, 'ball-and-stick', ['original-frame'], 1, 'colored');
assert.deepEqual(appearances, ['illustrative', 'illustrative', 'standard']);
assert.deepEqual(styledLayers, [
 {structures: ['aligned-frame'], representation: {style: 'ball-and-stick', alpha: 1, colorMode: 'colored'}},
 {structures: ['background-frame'], representation: {style: 'line', alpha: 0.2, colorMode: 'gray'}},
 {structures: ['original-frame'], representation: {style: 'ball-and-stick', alpha: 1, colorMode: 'colored'}}
]);
