import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('apps/desktop/src/components/batch-file-operations.tsx', 'utf8');
const fragment = source.slice(source.indexOf('  const hasDirtyFile ='), source.indexOf('  const dialog ='));
const js = ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
const state = { documents: [{ id: 'edited', path: '/edited.sdf' }], dirtyGridDocuments: new Set(['edited']) };
const copied = [];
let dialogs = 0;
const items = new Function('state', 'open', 'invoke', 'menuItem', 'isTauriRuntime', `${js}\nreturn items;`)(
  state, async () => { dialogs++; return '/export'; }, async (_, payload) => copied.push(payload.request),
  (id, text, action) => ({ kind: 'item', id, text, action }), () => true,
);
const files = ['/edited.sdf', '/other.sdf'];
assert.equal(items(files)[0].disabled, true);
await assert.rejects(items(files)[0].action(), /Save changes/);
assert.equal(dialogs, 0);
assert.deepEqual(copied, []);
assert.equal(items(['/clean.sdf', '/other.sdf'])[0].disabled, false);
state.dirtyGridDocuments.clear();
assert.equal(items(files)[0].disabled, false);
await items(files)[0].action();
assert.deepEqual(copied, files.map(path => ({ operation: 'saveCopy', path, destination: '/export/' + path.split('/').pop() })));
console.log('Batch exports reject dirty selected collections and preserve clean-file copying');
