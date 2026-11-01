import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import ts from 'typescript-compiler-api';

const source = readFileSync('apps/desktop/vite/browser-dev/native-compute.ts', 'utf8');
const compile = code => ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
const runWithStdin = new Function('spawn', compile(source.slice(source.indexOf('function runWithStdin('))) + '\nreturn runWithStdin;')(spawn);
const controller = new AbortController();
const running = runWithStdin(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], '', process.cwd(), 10000, {}, controller.signal);
controller.abort();
await assert.rejects(running, { name: 'AbortError' });

// Backpressure exposes stdin errors when the child exits before consuming input.
// This script is isolated by vp-contract, so an unhandled EPIPE fails the test.
const largeInput = 'x'.repeat(1024 * 1024);
const earlyExitCancellation = new AbortController();
const earlyExit = runWithStdin('/usr/bin/true', [], largeInput, process.cwd(), 1000, {}, earlyExitCancellation.signal);
earlyExitCancellation.abort();
await assert.rejects(earlyExit, { name: 'AbortError' });
await assert.rejects(
  runWithStdin('/usr/bin/true', [], largeInput, process.cwd(), 1000),
  error => error.code === 'EPIPE',
  'a broken stdin without cancellation must remain an observable failure',
);

const declaration = source.slice(source.indexOf('export function registerBrowserDevNativeComputeRoute('), source.indexOf('\nasync function runMolecularRepresentation('));
const exports = {};
let nativeRoute;
let receivedSignal;
let started;
const ready = new Promise(resolve => { started = resolve; });
new Function('exports', 'readJsonBody', 'REQUEST_LIMIT_BYTES', 'chemicalSpaceCacheKey', 'runNativeCompute', 'sendJsonError', compile(declaration))(
  exports, async () => ({ operation: 'chemicalSpace' }), 12 * 1024 * 1024, () => null,
  async (_root, _input, signal) => {
    receivedSignal = signal;
    started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  }, () => assert.fail('a disconnected request must not receive an error response'),
);
exports.registerBrowserDevNativeComputeRoute({ middlewares: { use(path, handler) {
  if (path === '/__burette/native-compute') nativeRoute = handler;
} } }, process.cwd());
const req = Object.assign(new EventEmitter(), { method: 'POST' });
const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
const pending = nativeRoute(req, res);
await ready;
res.destroyed = true;
res.emit('close');
await pending;
assert.ok(receivedSignal.aborted);
assert.equal(req.listenerCount('aborted'), 0);
assert.equal(res.listenerCount('close'), 0);
console.log('Browser native compute disconnect cancels its subprocess and releases listeners');
