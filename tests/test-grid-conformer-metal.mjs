import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpile(readFileSync('apps/desktop/src/hooks/use-app-grid-conformer-messages.ts', 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
});
const calls = [];
let native = true, fail = false, failViewer = false, jobs = [];
const result = { passedCount: 1, failedCount: 0, conformerCount: 1, job: { jobId: 'metal-job' }, primaryOpenPath: '/result.sdf', reportPath: '/report.md', gridApplied: true, gridWarning: null };
const run = kind => async (...args) => {
  calls.push([kind, ...args]);
  if (fail) throw new Error('Metal unavailable');
  return result;
};
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name === 'react') return { useCallback: fn => fn };
  if (name === '@tauri-apps/api/core') return { invoke: async (command) => {
    if (command !== 'open_text_structure') throw new Error(`Unexpected legacy command: ${command}`);
    if (failViewer) throw new Error('Viewer unavailable');
    return {id:'aligned-result'};
  } };
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
    addDocuments: documents => calls.push(["add", documents]), openTextDocuments() {}, rememberRecentStructures() {},
    pushErrorStatus() {}, pushStatus() {}, showGridComputeJobs() {}, preferences: {},
    setConformerJobs: update => { jobs = update(jobs); },
    postMessageToViewerSource: (_source, message) => {
      messages.push(message.body);
      if (message.body.type.endsWith('Finished')) finish();
    },
  });
  assert.equal(handleGridConformerMessage(body, null), true);
  await done;
  return messages;
}
const smiles = { title: 'ethanol.smi', extension: 'smi', textBase64: btoa('CCO'), sourceIndex: 0 };
const mol = { title: 'edited.sdf', extension: 'sdf', textBase64: btoa('mol block\nM  END'), sourceIndex: 1 };
const body = { type: 'generate3dGridSelection', title: 'selection', molecules: [smiles], documentId: 'grid-1', sourceIndexes: [0] };
const applied = await execute(body);
assert.equal(applied.at(-1).gridApplied, true);
assert.equal(calls[0][0], 'grid');
assert.equal(jobs[0].status, 'success');
await execute({ ...body, molecules: [], sourceIndexes: [0, 300] });
assert.deepEqual(calls[0].slice(0, 3), ['grid', 'grid-1', [0, 300]], 'off-page records are resolved from the frozen grid, not the visible payload');
assert.equal(jobs[0].cancelable, false);
await execute({ ...body, documentId: '', sourceIndexes: [] });
assert.equal(calls[0][0], 'standalone', 'unregistered inputs retain the standalone route');
await execute({ ...body, molecules: [smiles, mol], sourceIndexes: [0, 1] });
assert.equal(calls[0][0], 'grid');
assert.deepEqual(calls[0].slice(1, 3), ['grid-1', [0, 1]]);
assert.equal(calls[0][4].backendPolicy, 'gpuRequired');
assert.equal(calls[0][4].initialization, 'generated');
assert.equal(jobs[0].status, 'success');
await execute({ ...body, type: 'optimizeGeometryGridSelection' });
assert.equal(calls[0][4].initialization, 'inputGeometry');
assert.equal(calls[0][4].backendPolicy, 'gpuRequired');
result.failedSourceRecords = 1;
await execute(body);
assert.equal(jobs[0].status, 'recovered');
assert.match(jobs[0].error, /1 input molecules/);
result.failedSourceRecords = 0;
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

native = true;
Object.assign(result, {scores:[{},{}], rows:[], gpuTimeMs:1, title:'aligned', alignedSdf:'sdf', backend:'nativeMetal'});
await execute({type:'alignGridPoses',documentId:'grid-1',sourceIndexes:[0,1]});
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(calls.some(call => call[0] === 'add'), 'alignment opens a separate tab instead of replacing the source collection');
failViewer = true;
const presentationFailure = await execute({type:'alignGridPoses',documentId:'grid-1',sourceIndexes:[0,1]});
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(presentationFailure.some(message => message.type === 'gridAlignmentFinished'));
assert.ok(!presentationFailure.some(message => message.type === 'gridAlignmentError'), 'viewer failures do not turn a saved calculation into a compute failure');
failViewer = false;

// Exercise the actual grid request handlers with a selection across pages.
const viewer = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
const functionSource = name => {
  const start = viewer.indexOf(`  function ${name}(`);
  return viewer.slice(start, viewer.indexOf('\n  function ', start + 1));
};
const state = { selected: new Set([301, 2]), conformerVariant: 'ETKDGv3', mmffVariant: 'MMFF94s', semiempiricalMethod: 'RM1' };
const posted = [];
const handlers = ['requestSelected3DGeneration', 'request3DGenerationForRows', 'requestSelectedPoseAlignment', 'requestSelectedGeometryOptimization', 'requestSelectedSemiempiricalEvaluation'];
const dispatch = new Function('state', 'selectedMolstarRows', 'capabilities', 'post', 'hasMolblockInput3DCoordinates', 'setStatus', 'refreshGridControls', 'setGridGenerate3DPending', 'baseName',
  handlers.map(functionSource).join('\n') + '\nreturn { ' + handlers.join(',') + ' };')(
  state, () => [{index:2,molblock:'3D'}], () => ({cluster:true}), (type, _message, body) => posted.push({type,...body}),
  () => true, () => {}, () => {}, () => {}, x => x);
const cfg = {documentId:'collection',label:'poses'};
for (const handler of handlers.filter(name => name !== 'request3DGenerationForRows')) dispatch[handler](cfg);
assert.equal(posted.length, 4);
for (const request of posted) assert.deepEqual([...request.sourceIndexes].sort((a,b)=>a-b), [2,301]);
assert.deepEqual(posted[0].molecules, [], 'native source structures never round-trip through the webview');
assert.deepEqual(posted[2].molecules, []);
console.log('Paged collection requests retain the complete selection without copying structures');

const finishedStart = viewer.indexOf("      if (body.type === 'gridGenerate3DFinished')");
const finishedEnd = viewer.indexOf("      if (body.type === 'gridGenerate3DError')", finishedStart);
let refreshes = 0;
const finished = new Function('body','setGridGenerate3DPending','refreshRemote','config', viewer.slice(finishedStart, finishedEnd));
for (const applied of [true, false, undefined]) finished({type:'gridGenerate3DFinished',gridApplied:applied},()=>{},()=>refreshes++,()=>cfg);
assert.equal(refreshes, 1, 'only a successfully applied result refreshes the source table');

const menuState = { ...state, undoStack: [], redoStack: [] };
let menuPayload;
const notifyMenu = new Function('state', 'capabilities', 'selectedMolecularGridRowCount', 'selectedGridRowCount', 'effectiveMolecularGrid', 'gridHasReactionRows', 'collectionIndexReady', 'supportsXyzrenderCards', 'post',
  'const GRID_SELECTION_BRIDGE_LIMIT = 1000, NATIVE_MOLSTAR_SELECTION_LIMIT = 256, NATIVE_KETCHER_SELECTION_LIMIT = 256, NATIVE_GENERATE_3D_SELECTION_LIMIT = 256;\n' + functionSource('notifyGridMenuState') + '\nreturn notifyGridMenuState;')(
  menuState, () => ({cluster:true, editing:true, selection:true}), () => 0, () => 0, () => true, () => false, () => true, () => false,
  (_type, _message, payload) => { menuPayload = payload; });
notifyMenu({appViewer:true});
assert.equal(menuPayload.canGenerate3dForSelection, true, 'native compute remains enabled when selected rows are outside the loaded page');
assert.deepEqual(menuPayload.selectedSourceIndexes, [301,2]);
