import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpile(readFileSync('apps/desktop/src/hooks/use-app-status.ts', 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
});
const notices = [], states = [], exports = {};
new Function('require', 'exports', code)(name => {
  if (name === 'react') return { useCallback: fn => fn, useRef: current => ({current}), useState: initial => [initial, value => states.push(value)] };
  if (name === '../components/ui/toast') return {toast:{add: notice => notices.push(notice)}};
  if (name === '../lib/web-demo-analytics') return {trackWebDemoHandledError(){}};
  throw new Error(name);
}, exports);
const status = exports.useAppStatus();
const diagnostic = 'Compute filesystem failed: ' + 'long diagnostic '.repeat(50);
status.pushErrorStatus(new Error(diagnostic), '3D generation failed');
assert.equal(notices.length, 1);
assert.equal(notices[0].title, '3D generation failed');
notices[0].actionProps.onClick();
assert.deepEqual(states.at(-1), {kind:'error',details:[diagnostic]});
status.pushStatus(diagnostic, 'error');
assert.ok(notices[1].title.length <= 140);
notices[1].actionProps.onClick();
assert.equal(states.at(-1).details[0], diagnostic.trim());

// Host error acknowledgments update grid state without echoing a second toast.
const viewer = readFileSync('PreviewExtension/Web/grid-viewer.js','utf8');
const start = viewer.indexOf('  function setStatus('), end = viewer.indexOf('\n  function ',start+1);
const posts = [];
const setStatus = new Function('window','status','post',viewer.slice(start,end)+'\nreturn setStatus;')(
  {BuretteConfig:{appViewer:true}}, null, (...args) => posts.push(args));
setStatus(diagnostic, 'error', false);
assert.equal(posts.length, 0);
setStatus('A local grid error', 'error');
assert.equal(posts.length, 1);
console.log('Compact error notices retain details without grid echo notifications');

// Execute the actual clear actions with mixed histories: running jobs must keep
// their update target and queued jobs must remain available after clearing.
const shellSource = ts.createSourceFile('actions.ts', readFileSync('apps/desktop/src/hooks/use-app-shell-actions.ts','utf8'), ts.ScriptTarget.Latest, true);
const factory = shellSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createJobHistoryShellActions');
const factoryJs = ts.transpile(factory.getText(shellSource), {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});
const historyExports = {};
new Function('exports', factoryJs)(historyExports);
const mixed = ['running','queued','success','recovered','failed','cancelled'].map(status => ({id:status,status}));
let conformers = mixed.filter(job=>job.status!=="queued"), xtb = mixed;
const history = historyExports.createJobHistoryShellActions({pushStatus(){},setConformerJobs: fn => {conformers=fn(conformers);},setXtbJobs: fn => {xtb=fn(xtb);}});
history.clearConformerJobs(); history.clearXtbJobs();
assert.deepEqual(conformers.map(job=>job.id), ['running']);
assert.deepEqual(xtb.map(job=>job.id), ['running','queued']);
const databaseSource = ts.createSourceFile('database.ts',readFileSync('apps/desktop/src/hooks/use-app-database.ts','utf8'),ts.ScriptTarget.Latest,true);
let clearDatabase;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(databaseSource)==='clearDatabaseJobs') clearDatabase=node.initializer.getText(databaseSource);
  ts.forEachChild(node,visit);
}
visit(databaseSource);
let database = mixed.filter(job=>job.status!=='queued');
new Function('useCallback','setDatabaseJobs',`return ${clearDatabase}`)(fn=>fn,fn=>{database=fn(database);})();
assert.deepEqual(database.map(job=>job.id), ['running']);
console.log('Clearing completed histories preserves active and queued job update targets');
