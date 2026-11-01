import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript-compiler-api';

const calls = [];
let timer;
const source = readFileSync(new URL('../apps/desktop/src/lib/action-journal.ts', import.meta.url), 'utf8');
const module = { exports: {} };
new Function('require', 'exports', 'window', ts.transpile(source, {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}))((name) => {
  if (name === '@tauri-apps/api/core') return { invoke: async (command, payload) => calls.push({ command, payload }) };
  if (name === './tauri') return { isTauriRuntime: () => true };
  throw new Error(name);
}, module.exports, { setTimeout: (callback) => { timer = callback; return 1; }, clearTimeout() {} });

for (let i = 0; i < 350; i++) module.exports.journalAction('job', `job-${i}`);
timer();
assert.deepEqual(calls.map(call => call.payload.entries.length), [200, 150]);
assert.ok(calls.every(call => call.command === 'append_action_journal'));
const persisted = calls.flatMap(call => call.payload.entries.slice(0, 200));
assert.deepEqual(persisted.map(entry => entry.action), Array.from({ length: 350 }, (_, i) => `job-${i}`));
calls.length = 0;
for (let i = 0; i < 450; i++) module.exports.journalAction('job', `overflow-${i}`);
timer();
assert.deepEqual(calls.flatMap(call => call.payload.entries).map(entry => entry.action),
  Array.from({ length: 400 }, (_, i) => `overflow-${i + 50}`));
console.log('Action journal preserves bounded native batches');
