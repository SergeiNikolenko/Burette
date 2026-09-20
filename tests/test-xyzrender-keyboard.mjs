import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
const source = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const start = source.indexOf('  function installExternalArtifactKeyboard(');
const end = source.indexOf('\n  function ', start + 10);
const code = source.slice(start, end);
function setup() {
  const window = new Window(), document = window.document;
  const root = document.createElement('div'); document.body.append(root);
  let now = 0, serial = 0;
  const queue = new Map(), samples = [];
  const cleanup = new Function('window', 'document', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', `${code}; return installExternalArtifactKeyboard;`)(window, document, { now: () => now }, cb => { queue.set(++serial, cb); return serial; }, id => queue.delete(id))(root, (motion, dt) => samples.push({ motion, dt }));
  const key = (type, code, options = {}, target = root) => target.dispatchEvent(new window.KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...options }));
  const step = dt => { now += dt; const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(cb => cb(now)); };
  const total = axis => samples.reduce((sum, s) => sum + s.motion[axis] * s.dt, 0);
  return { window, document, root, cleanup, key, step, samples, total, queue };
}
function travel(hz, repeat) {
  const h = setup(); h.key('keydown', 'KeyW');
  for (let i = 0; i < hz; i++) { if (repeat) h.key('keydown', 'KeyW', { repeat: true }); h.step(1000 / hz); }
  h.key('keyup', 'KeyW'); const result = h.total('zoom');
  const count = h.samples.length; h.step(1000); assert.equal(h.samples.length, count);
  h.cleanup(); return result;
}
assert.ok(Math.abs(travel(60, false) - travel(144, true)) < 1e-10);
for (const stop of ['blur', 'visibilitychange', 'pointerdown', 'focusin']) {
  const h = setup(); h.key('keydown', 'KeyE'); h.step(16);
  (stop === 'blur' ? h.window : h.document).dispatchEvent(new h.window.Event(stop));
  const count = h.samples.length; h.step(100); assert.equal(h.samples.length, count); h.cleanup();
}
{
  const h = setup(); const input = h.document.createElement('input'); h.root.append(input);
  h.key('keydown', 'KeyW', {}, input); h.key('keydown', 'KeyW', { metaKey: true }); assert.equal(h.samples.length, 0);
  h.key('keydown', 'KeyA'); h.key('keydown', 'KeyR'); h.step(50);
  assert.ok(Math.hypot(h.samples.at(-1).motion.x, h.samples.at(-1).motion.y) <= 1);
  h.cleanup(); assert.equal(h.queue.size, 0);
}
console.log('xyzrender keyboard: frame-rate independence, repeat, release, focus and shortcut isolation passed');
