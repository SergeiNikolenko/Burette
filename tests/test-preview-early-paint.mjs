import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const html = readFileSync(new URL('../PreviewExtension/Web/index.html', import.meta.url), 'utf8');

for (const outcome of ['error', 'unhandledrejection', 'timeout']) {
  test(`preview reveals diagnostics after early ${outcome}`, async () => {
    const window = new Window();
    const document = new window.DOMParser().parseFromString(html, 'text/html');
    const listeners = new Map();
    const timers = [];
    const firstScript = document.querySelector('script');
    assert.ok(document.documentElement.classList.contains('buret-viewer-booting'));
    assert.ok(html.indexOf('<style>') < html.indexOf('<link'));
    assert.ok(html.indexOf('<script>') < html.indexOf('<link'));
    vm.runInNewContext(firstScript.textContent, {
      document,
      window: {
        setTimeout: (callback) => timers.push(callback),
        addEventListener: (name, callback) => listeners.set(name, callback),
      },
    });
    if (outcome === 'timeout') timers[0]();
    else listeners.get(outcome)({ message: 'Asset unavailable', reason: new Error('Asset unavailable') });
    assert.equal(document.documentElement.classList.contains('buret-viewer-booting'), false);
    if (outcome !== 'timeout') assert.equal(document.getElementById('status').textContent, 'Preview could not be updated.');
    await window.happyDOM.close();
  });
}
