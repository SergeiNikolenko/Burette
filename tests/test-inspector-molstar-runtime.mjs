import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const start = source.indexOf('    if (config.inspectorPreview === true) {');
const end = source.indexOf('\n  function waitForFirstPaint()', start);
const block = source.slice(start, end).replace(/\n  }\s*$/, '');
const handlers = [];
const parent = { postMessage() {} };
let release;
const gate = new Promise(resolve => { release = resolve; });
const loaded = [];
let presets = 0;
const context = {
  config: { inspectorPreview: true, inspectorChannel: 'this-inspector' }, activeConfig: {}, console,
  activeViewer: { handleResize() {}, plugin: { canvas3d: { setProps() {}, commit() {} }, animationLoop: { async tick() {}, stop() {}, start() {} }, managers: { camera: { orientAxes() {} } }, async clear() { await gate; } } },
  structureDataForMolstar: () => ({ data: 'initial' }),
  loadPreparedStructure: async (_viewer, prepared) => { loaded.push(prepared.data); },
  applyConfiguredMolstarPreset: async () => { presets++; },
  requestMolstarStructureFocus() {},
  performance: { now: () => 0 },
  document: { getElementById: () => null },
  captureMolstarTransitionFrame: () => null,
  removeMolstarTransitionFrame() {},
  window: { parent, addEventListener: (_name, handler) => handlers.push(handler) },
};
await vm.runInNewContext(`(async () => {${block}})()`, context);
const send = (molblock, channel = 'this-inspector', from = parent) => handlers[0]({ source: from, data: { source: 'burette-inspector-host', channel, molblock } });
await send('initial');
await send('ignored', 'another-inspector');
await send('ignored', null);
await send('x'.repeat(350001));
// WebKit may identify the receiver itself as source on an effect/timer send.
const first = send('second', 'this-inspector', context.window);
await send('third');
await send('latest');
release();
await first;
assert.deepEqual(loaded, ['second', 'latest']);
assert.equal(presets, 2);
console.log('Inspector shared renderer: channel isolation, WebKit sender identity, bounded payloads, latest-row coalescing and preset retention passed.');
