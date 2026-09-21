import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useXyzrenderPlayback } from '../apps/desktop/src/hooks/use-xyzrender-playback.ts';
const window = new Window();
Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
let serial = 0;
const pending = new Map();
globalThis.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
globalThis.cancelAnimationFrame = id => pending.delete(id);
document.body.innerHTML = '<div id="root"></div><iframe class="viewer-iframe"></iframe>';
const paints = [];
document.querySelector('iframe').contentWindow.postMessage = message => paints.push(message.body);
const animation = { width: 1, height: 1, frames: Array.from({length: 240}, (_, i) => new Uint8ClampedArray([i, 0, 0, 255])) };
const range = [0, 239];
let renders = 0, position, scrub;
function Harness({visible}) {
  renders++;
  [position, scrub] = useXyzrenderPlayback(animation, true, 60, range, 'first', false, visible);
  return React.createElement('span', null, position);
}
const root = createRoot(document.getElementById('root'));
await act(() => root.render(React.createElement(Harness, {visible: true})));
let now = performance.now();
async function tick() {
  now += 20;
  const callbacks = [...pending.values()]; pending.clear();
  await act(() => callbacks.forEach(callback => callback(now)));
}
for (let i = 0; i < 20; i++) await tick();
assert.ok(paints.length >= 20);
assert.ok(renders < paints.length / 2, 'inspector is not rerendered on every frame');
const lastPixel = paints.at(-1).pixels[0];
await act(() => root.render(React.createElement(Harness, {visible: false})));
const hiddenRenders = renders;
for (let i = 0; i < 20; i++) await tick();
assert.equal(renders, hiddenRenders, 'background playback does not rerender hidden controls');
assert.ok(paints.at(-1).pixels[0] > lastPixel, 'background animation continues advancing');
await act(() => root.render(React.createElement(Harness, {visible: true})));
assert.equal(position, paints.at(-1).pixels[0], 'returning shows the current frame without restarting');
await act(() => root.unmount());
assert.equal(pending.size, 0);
console.log('playback: 60 fps canvas, throttled inspector, uninterrupted background playback, cleanup');

const { createAnimationBudget } = await import('../apps/desktop/src/lib/xyzrender-animation-budget.ts');
const reserve = createAnimationBudget();
const full = 640 * 640 * 240;
assert.equal(reserve('first', full), true);
assert.equal(reserve('second', full), true);
assert.equal(reserve('third', full), false);
assert.equal(reserve('first', full), true, 'revisiting does not double-charge the same animation');
assert.equal(reserve('second', 0), true);
assert.equal(reserve('third', full), true, 'removal frees capacity');
console.log('animation memory budget preserves existing movies and releases removed reservations');
