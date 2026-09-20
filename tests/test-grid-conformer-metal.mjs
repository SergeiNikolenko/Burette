import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpile(readFileSync('apps/desktop/src/hooks/use-app-grid-conformer-messages.ts', 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
});
const calls = [];
let native = true, fail = false, jobs = [];
const result = { passedCount: 1, failedCount: 0, conformerCount: 1, job: { jobId: 'metal-job' }, primaryOpenPath: '/result.sdf', reportPath: '/report.md' };
const run = kind => async (...args) => {
  calls.push([kind, ...args]);
  if (fail) throw new Error('Metal unavailable');
  return result;
};
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name === 'react') return { useCallback: fn => fn };
  if (name === '@tauri-apps/api/core') return { invoke: (...args) => { throw new Error(`Unexpected legacy command: ${args[0]}`); } };
  if (name === '../lib/tauri') return { isTauriRuntime: () => native };
  if (name === '../lib/standalone-compute') return { runStandaloneConformerWorkflow: run('standalone') };
  if (name === '../lib/compute-conformer') return { runConformerWorkflow: run('grid') };
  if (name === '../lib/compute-analysis') return { runAnalysisWorkflow: run('analysis') };
  if (name === './use-app-status') return { statusErrorMessage: error => error.message };
  if (name === '../lib/conformer-generation') return { conformerGenerationPreferences: () => ({}) };
  if (name === '../lib/file-routing') return { pathExtension: () => 'smi' };
  if (name === '../lib/browser-dev-documents') return {
    generateBrowserDev3DConformer: async request => {
      calls.push(['browserMetal', request]);
      return { text: 'Mol\n\n\nM  END\n$$$$\n' };
    },
    openBrowserDevTextDocument: async () => ({ path: '/browser-result.sdf' }),
  };
  throw new Error(name);
}, exports);

async function execute(body) {
  jobs = []; calls.length = 0;
  const messages = [];
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const { handleGridConformerMessage } = exports.useAppGridConformerMessages({
    openDocuments: async paths => calls.push(['open', paths]),
    openDocumentsInActiveTab() {}, openTextDocuments() {}, rememberRecentStructures() {},
    pushErrorStatus() {}, pushStatus() {}, showGridComputeJobs() {}, preferences: {},
    setConformerJobs: update => { jobs = update(jobs); },
    postMessageToViewerSource: (_source, message) => {
      messages.push(message.body);
      if (message.body.type === 'gridGenerate3DFinished') finish();
    },
  });
  assert.equal(handleGridConformerMessage(body, null), true);
  await done;
  return messages;
}
const smiles = { title: 'ethanol.smi', extension: 'smi', textBase64: btoa('CCO'), sourceIndex: 0 };
const mol = { title: 'edited.sdf', extension: 'sdf', textBase64: btoa('mol block\nM  END'), sourceIndex: 1 };
const body = { type: 'generate3dGridSelection', title: 'selection', molecules: [smiles], documentId: 'grid-1', sourceIndexes: [0] };
await execute(body);
assert.equal(calls[0][0], 'standalone');
assert.equal(jobs[0].status, 'success');
await execute({ ...body, molecules: [smiles, mol], sourceIndexes: [0, 1] });
assert.equal(calls[0][0], 'grid');
assert.deepEqual(calls[0].slice(1, 3), ['grid-1', [0, 1]]);
assert.equal(calls[0][4].backendPolicy, 'gpuRequired');
assert.equal(calls[0][4].initialization, 'generated');
assert.equal(jobs[0].status, 'success');
await execute({ ...body, type: 'optimizeGeometryGridSelection' });
assert.equal(calls[0][4].initialization, 'inputGeometry');
assert.equal(calls[0][4].backendPolicy, 'gpuRequired');
fail = true;
const failed = await execute(body);
assert.equal(calls.length, 1, 'Metal failure must not retry Python or open a result');
assert.equal(jobs[0].status, 'failed');
assert.equal(failed.find(message => message.type === 'gridGenerate3DError').error, 'Metal unavailable');
fail = false; native = false;
await execute(body);
assert.equal(calls[0][0], 'browserMetal');
assert.equal(jobs[0].backend, 'nativeMetal');
assert.equal(jobs[0].status, 'success');
console.log('Grid Metal routing, mixed selection, optimization and failure checks passed');
