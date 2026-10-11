import assert from 'node:assert/strict';
import { applyRenderingDefaults, settleRenderingDefaults } from '../apps/desktop/src/components/ketcher/rendering-defaults.ts';

const preferences = new Map();
globalThis.localStorage = { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) };
let written;
const instance = { editor: { render: { options: { fontszInPx: 13, bondThicknessInPx: 1, lineattr: { stroke: '#000' } } },
  setOptions(value) { written = JSON.parse(value); } } };
const convert = options => ({ ...options, bondThicknessInPx: options.bondThickness });
function apply(saved = {}, marker) {
  preferences.clear();
  preferences.set('ketcher-opts', JSON.stringify(saved));
  if (marker) preferences.set('burette-ketcher-rendering-defaults', marker);
  applyRenderingDefaults(instance, convert);
  return written;
}
assert.equal(apply().bondThickness, 2);
for (const size of [1, 3]) {
  const result = apply({ bondThickness: size, bondThicknessUnit: 'px', atomColoring: false });
  assert.equal(result.bondThickness, size, 'Explicit user widths survive');
  assert.equal(result.atomColoring, false, 'Scientific settings survive');
  assert.equal(result.lineattr['stroke-width'], size);
}
for (const dark of [false, true]) {
  const stroke = dark ? '#a3a3a3' : '#737373', fill = dark ? '#404040' : '#e5e5e5';
  const legacy = { bondThickness: 1, bondThicknessUnit: 'px', bondThicknessInPx: 1,
    lineattr: { 'stroke-width': 1 }, lineWidth: 1, atomSelectionPlateRadius: 13 * 0.6, radiusScaleFactor: 0.18,
    selectionStyle: { fill, stroke, 'stroke-width': 1 }, hoverStyle: { fill, stroke, 'stroke-width': 1 },
    innerHoverStyle: { fill: 'none', stroke, 'stroke-width': 1 },
    selectionStyleSimpleObject: { fill: 'none', stroke, 'stroke-width': 2, 'stroke-linecap': 'round' },
    hoverStyleSimpleObject: { fill: 'none', stroke, 'stroke-width': 1 },
    bondSnappingStyle: { fill, stroke, 'stroke-width': 1 }, arrowSnappingStyle: { fill, stroke } };
  assert.equal(apply(legacy).bondThickness, 2, 'Complete legacy defaults migrate');
  assert.equal(preferences.get('burette-ketcher-rendering-defaults'), '2');
  assert.equal(apply(legacy, '2').bondThickness, 1, 'Migration never repeats');
  assert.equal(apply({ ...legacy, radiusScaleFactor: 0.2 }).bondThickness, 1, 'Partial matches do not migrate');
}
preferences.set('ketcher-opts', '{broken');
applyRenderingDefaults(instance, convert);
assert.equal(written.bondThickness, 2);

const frames = new Map();
let nextFrame = 0, listener, unsubscribed = 0;
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const flush = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
const subscribed = { settingsService: { subscribe(callback) { listener = callback; return () => { unsubscribed++; }; } } };
let ready = false;
const pending = settleRenderingDefaults(subscribed, () => listener(), new AbortController().signal).then(() => { ready = true; });
await Promise.resolve();
assert.equal(ready, false);
flush(); await Promise.resolve(); assert.equal(ready, false, 'Wait for the committed canvas');
flush(); await pending; assert.equal(unsubscribed, 1);
const controller = new AbortController();
const cancelled = settleRenderingDefaults(subscribed, () => listener(), controller.signal);
controller.abort(); await cancelled;
assert.equal(frames.size, 0); assert.equal(unsubscribed, 2);
const alreadyAborted = new AbortController(); alreadyAborted.abort();
await settleRenderingDefaults(subscribed, () => assert.fail('Aborted initialization must not apply'), alreadyAborted.signal);
await assert.rejects(settleRenderingDefaults(subscribed, () => { listener(); throw new Error('apply failed'); }, new AbortController().signal), /apply failed/);
assert.equal(frames.size, 0); assert.equal(unsubscribed, 3);
const withoutService = settleRenderingDefaults({}, () => {}, new AbortController().signal);
flush(); flush(); await withoutService;
console.log('PASS rendering defaults, explicit preferences, guarded migration and initialization cleanup');
