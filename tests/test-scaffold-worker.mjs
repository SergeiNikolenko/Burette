import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import ts from 'typescript';
import * as ocl from 'openchemlib';
import { computeDerivedValue } from '../apps/desktop/src/lib/derived-column-compute.mjs';

// Run the actual browser worker body in a separate thread with only its
// message transport adapted. OCL runs for real, without RDKit or resources.
const source = readFileSync('apps/desktop/src/workers/scaffold.worker.ts', 'utf8')
  .replace('"openchemlib"', JSON.stringify(import.meta.resolve('openchemlib')))
  .replace('"../lib/derived-column-compute.mjs"', JSON.stringify(new URL('../apps/desktop/src/lib/derived-column-compute.mjs', import.meta.url).href));
const code = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const bootstrap = `import { parentPort } from 'node:worker_threads';
globalThis.self = {addEventListener: (_, fn) => parentPort.on('message', data => fn({data})), postMessage: data => parentPort.postMessage(data)};
${code}`;
const worker = new Worker(new URL('data:text/javascript;base64,' + Buffer.from(bootstrap).toString('base64')));
try {
  const rows = ['Cc1ccc(Cl)cc1', 'CCc1ccc(Br)cc1', 'Cc1ccncc1', 'CCCC', 'not-a-smiles(('].map(smiles => ({smiles}));
  const reply = once(worker, 'message');
  worker.postMessage({id:1,rows});
  const [result] = await reply;
  assert.deepEqual(result, {id:1,results: rows.map(row => computeDerivedValue('murcko-scaffold', {ocl}, row))});
  assert.equal(result.results[0].valueText, result.results[1].valueText);
  assert.equal(result.results[3].valueText, '');
  assert.ok(result.results[4].errorText);
  const tooMany = once(worker, 'message');
  worker.postMessage({id:2,rows:Array(201).fill({smiles:'C'})});
  assert.match((await tooMany)[0].error, /limit/);
  const tooLarge = once(worker, 'message');
  worker.postMessage({id:3,rows:[{smiles:'C'.repeat(4*1024*1024+1)}]});
  assert.match((await tooLarge)[0].error, /limit/);
} finally { await worker.terminate(); }

const clientCode = ts.transpile(readFileSync('apps/desktop/src/lib/scaffold-worker.ts', 'utf8').replaceAll('import.meta.url', '"file:///worker-test"'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
});
let fake;
class FakeWorker {
  constructor() { fake = this; }
  postMessage(request) { this.request = request; }
  terminate() { this.terminated = true; }
}
const exports = {};
new Function('exports','Worker',clientCode)(exports,FakeWorker);
const client = new exports.ScaffoldWorker();
const pending = client.compute([{smiles:'c1ccccc1', name:'unrelated', props:{wide:'x'.repeat(10000)}}]);
assert.deepEqual(fake.request.rows, [{smiles:'c1ccccc1', molblock:undefined}], 'only molecular input crosses the worker boundary');
await assert.rejects(client.compute([]), /unavailable/);
fake.onmessage({data:{id:fake.request.id,results:[{valueText:'c1ccccc1'}]}});
assert.deepEqual(await pending,[{valueText:'c1ccccc1'}]);
const interrupted = client.compute([{smiles:'C'}]);
client.dispose();
await assert.rejects(interrupted, /stopped/);
assert.equal(fake.terminated,true);
await assert.rejects(client.compute([]), /unavailable/);
console.log('Scaffold worker chemistry, input bounds, ordering and disposal passed');
