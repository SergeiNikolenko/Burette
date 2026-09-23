import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../apps/desktop/src/lib/compute-analysis.ts', import.meta.url), 'utf8');
const code = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
for (const scenario of ['success', 'partial', 'all-failed', 'stale', 'cancel', 'cancel-race', 'failure']) {
  const jobs = [], module = { exports: {} };
  new Function('require','exports',code)(name => {
    if (name === './conformer-job-events') return { publishConformerJob: job => jobs.push(job) };
    if (name === '@tauri-apps/api/core') return { Channel: class {}, invoke: async (command, payload) => {
      if (command === 'compute_get_job') return { state: scenario.startsWith('cancel') ? 'cancelled' : 'failed' };
      payload.onProgress.onmessage({jobId:'durable',completed:0,total:2,partialReportPath:null});
      assert.equal(jobs.at(-1).cancelable, true, 'job can be cancelled before calculation finishes');
      payload.onProgress.onmessage({jobId:'durable',completed:1,total:2,partialReportPath:'/partial.jsonl'});
      if (scenario === 'cancel') throw {code:'Cancelled',message:'Calculation cancelled'};
      if (scenario === 'cancel-race') throw {code:'Conflict',message:'Revision changed'};
      if (scenario === 'failure') throw new Error('service failed');
      return {reportPath:'/final.json',backend:'nativeMetal',gridApplied:scenario !== 'stale',gridWarning:scenario === 'stale' ? 'Source changed' : null, rows: scenario === 'partial' ? [{converged:true,error:null},{converged:false,error:'SCF limit'}] : scenario === 'all-failed' ? [{converged:false,error:'SCF limit'}] : undefined};
    } };
    throw new Error(name);
  }, module.exports);
  const promise = module.exports.runAnalysisWorkflow('compute_align_grid_poses', {documentId:'test',sourceIndexes:[0,1]}, 'ensemble');
  if (['success','partial','all-failed','stale'].includes(scenario)) { await promise; assert.equal(jobs.at(-1).reportPath,'/final.json'); }
  else {
    await assert.rejects(promise, scenario.startsWith('cancel') ? {name:'AbortError'} : /service failed/);
    assert.equal(jobs.at(-1).reportPath,'/partial.jsonl');
  }
  assert.equal(new Set(jobs.map(job=>job.id)).size, 1);
  assert.equal(jobs.at(-1).status, scenario === 'success' ? 'success' : ['partial','stale'].includes(scenario) ? 'recovered' : scenario.startsWith('cancel') ? 'cancelled' : 'failed');
  assert.equal(jobs.at(-1).cancelable, false);
}
console.log('Analysis early job IDs, partial results, success, cancellation and revision races passed');
