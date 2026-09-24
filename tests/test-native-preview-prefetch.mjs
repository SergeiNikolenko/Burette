import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = (await readFile(new URL('../plugins/burette-agent/ui/native-workspace-preview.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/m, '');
test('native reveal waits for a new committed, stationary draw and reports render failures', async () => {
  let onDraw, onTimeout, unsubscribed = 0;
  const bridge = { theme: 'light' };
  const window = { parent: { BuretteMcpWorkspace: bridge, addEventListener() {} }, addEventListener() {}, postMessage() {} };
  const document = { createElement: () => ({}), head: { appendChild() {} }, querySelectorAll: () => [], body: { dataset: {} } };
  runInNewContext(source.replace('export function', 'function') + '\nstartPreview(() => () => {});', {
    window, document, setTimeout: callback => { onTimeout = callback; return 1; }, clearTimeout() {},
  });
  const canvas = { notifyDidDraw: false, commitQueueSize: { value: 1 }, camera: { transition: { inTransition: true } },
    requestDraw() {}, didDraw: { subscribe(callback) { onDraw = callback; callback(0); return { unsubscribe() { unsubscribed++; } }; } },
  };
  let done = false;
  const ready = window.BuretteNativeFirstFrame({ plugin: { canvas3d: canvas } }).then(() => { done = true; });
  onDraw(1);
  await Promise.resolve();
  assert.equal(done, false, 'the initial BehaviorSubject emission and queued scene do not count');
  canvas.commitQueueSize.value = 0;
  onDraw(2);
  await Promise.resolve();
  assert.equal(done, false, 'camera transitions stay covered');
  canvas.camera.transition.inTransition = false;
  onDraw(3);
  await ready;
  assert.deepEqual({ done, unsubscribed, notify: canvas.notifyDidDraw }, { done: true, unsubscribed: 1, notify: false });
  const failed = window.BuretteNativeFirstFrame({ plugin: { canvas3d: canvas } });
  onTimeout();
  await assert.rejects(failed, /did not finish rendering/);
  assert.equal(unsubscribed, 2);
});

test('native preview fetches independent assets together and preserves script execution order', async () => {
  const requested = [], appended = [], pending = new Map();
  const scripts = ['first.js', 'second.js'].map(path => ({ dataset: { buretteScript: path }, remove() {} }));
  const links = [{ dataset: { buretteStyle: 'style.css' }, remove() {} }];
  let finished;
  const complete = new Promise(resolve => { finished = resolve; });
  const document = {
    querySelectorAll: selector => selector.startsWith('script') ? scripts : links,
    createElement: tag => ({ tag, dataset: {} }),
    head: { appendChild(element) {
      if (!element.src && !element.href) return;
      appended.push(element.src || element.href);
      queueMicrotask(() => { element.onload(); if (element.src === 'blob:second.js') finished(); });
    } },
    getElementById: () => assert.fail('No loading error expected'),
    body: { dataset: {} },
  };
  const bridge = { resolve: path => path, theme: 'light', closed: false,
    asset(path) { requested.push(path); return new Promise(resolve => pending.set(path, resolve)); },
  };
  const window = { parent: { BuretteMcpWorkspace: bridge, addEventListener() {}, postMessage() {} }, addEventListener() {}, postMessage() {} };
  runInNewContext(source.replace('export function', 'function') + '\nstartPreview(() => () => {});', { window, document, queueMicrotask, setTimeout: () => 1, clearTimeout() {} });
  assert.deepEqual(requested, ['style.css', 'first.js', 'second.js']);
  pending.get('second.js')('blob:second.js');
  pending.get('style.css')('blob:style.css');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(appended, ['blob:style.css#style.css']);
  pending.get('first.js')('blob:first.js');
  await complete;
  assert.deepEqual(appended, ['blob:style.css#style.css', 'blob:first.js', 'blob:second.js']);
});
