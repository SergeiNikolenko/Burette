import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../apps/desktop/src/lib/standalone-compute.ts', import.meta.url), 'utf8');
const code = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const jobs = [], calls = [];
let fail = false;
const module = { exports: {} };
new Function('require', 'exports', code)((name) => {
  if (name === './conformer-job-events') return { publishConformerJob: job => jobs.push(job) };
  if (name === '@tauri-apps/api/core') return { invoke: async (command, payload) => {
    calls.push([command, payload]);
    return { documentId: 'inline', sourceIndexes: [0] };
  } };
  if (name === './compute-conformer') return { runConformerWorkflow: async (_id, _indexes, progress) => {
    progress('embedding', { jobId: 'durable-job' });
    if (fail) throw new Error('service failed');
    return { passedCount: 1, failedCount: 0, primaryOpenPath: '/result.sdf', reportPath: '/report.md' };
  } };
  throw new Error(name);
}, module.exports);
const input = { title: 'Ketcher molecule', extension: 'mol', text: 'mol block' };
await module.exports.runStandaloneConformerWorkflow(input, () => {});
assert.deepEqual(jobs.map(job => job.status), ['running', 'running', 'success']);
assert.equal(new Set(jobs.map(job => job.id)).size, 1);
assert.equal(jobs[1].durableJobId, 'durable-job');
assert.equal(jobs.at(-1).primaryOpenPath, '/result.sdf');
assert.equal(calls.at(-1)[0], 'grid_close_runtime');
jobs.length = 0; fail = true;
await assert.rejects(module.exports.runStandaloneConformerWorkflow(input, () => {}), /service failed/);
assert.equal(jobs.at(-1).status, 'failed');
assert.equal(jobs.at(-1).error, 'service failed');
assert.equal(calls.at(-1)[0], 'grid_close_runtime');
console.log('Standalone conformer Jobs lifecycle and cleanup passed');
