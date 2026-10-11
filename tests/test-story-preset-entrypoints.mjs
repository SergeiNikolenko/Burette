import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = (start, end, context) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'viewer entrypoint must exist');
  return runInNewContext(source.slice(a, b) + '\n' + start.match(/function (\w+)/)[1], context);
};

test('Auto toolbar uses the current Story snapshot after setting presentation, not a bare provider', async () => {
  for (const story of [true, false]) {
    const calls = [];
    const snapshot = { id: 'current' };
    const viewer = {
      __buretteAutomaticStory: story,
      plugin: { state: {
        data: { getSnapshot: () => ({}) },
        setSnapshot: async value => { assert.equal(value, snapshot); calls.push('story'); },
      }, managers: { snapshot: { state: { entries: [{ snapshot }], current: 'current' } } } },
    };
    const context = {
      activeViewer: viewer, activeConfig: {}, window: {}, molstarStyleApplySerial: 0,
      normalizeMolstarPreset: x => x,
      molstarPresetOption: () => ({ provider: 'auto', label: 'Auto' }),
      molstarPresetAppearance: () => 'illustrative',
      configuredMolstarPreset: () => 'ball-and-stick',
      configuredMolstarStyle: () => 'illustrative',
      configuredMolstarAppearance: () => 'illustrative',
      captureMolstarCameraSnapshot: () => null, captureMolstarTransitionFrame: () => null,
      molstarStoryState: () => ({ available: story, isPlaying: false }),
      updateMolstarPresentationConfig: () => calls.push('config'),
      applyMolstarProviderPreset: async () => calls.push('provider'),
      applyMolstarWaterLineRepresentation: async () => {},
      applyMolstarAppearance: async () => calls.push('appearance'),
      fadeMolstarTransitionFrame: () => calls.push('shown'),
      removeMolstarTransitionFrame: () => calls.push('failed'),
      setStatus: (message, level) => { assert.notEqual(level, 'error', message); },
      debug: message => assert.fail(message), hideStatus() {}, setTimeout() {}, isQuickLookHost: () => false,
    };
    const apply = extract('  async function applyMolstarPresetNow(', '  async function applyConfiguredMolstarPreset(', context);
    assert.equal(await apply('automatic'), true);
    assert.ok(calls.includes('shown'));
    assert.equal(calls.includes('story'), story);
    assert.equal(calls.includes('provider'), !story);
    if (story) assert.ok(calls.indexOf('config') < calls.indexOf('story'));
  }
});

test('preset hover preview reaches the provider and screenshot without an undefined variable', async () => {
  const calls = [];
  const viewer = { plugin: { runTask: async () => {}, state: { data: { setSnapshot: () => ({}) } }, canvas3d: {} }, handleResize() {} };
  const preview = { classList: { remove() {}, add() {} }, removeAttribute() {} };
  const context = {
    activeViewer: { plugin: { state: { data: { getSnapshot: () => ({}) } } } },
    activeConfig: {}, window: {}, molstarPresetPreviewSerial: 1,
    molstarPresetOption: () => ({ provider: 'auto' }),
    captureMolstarCameraSnapshot: () => null, copyMolstarPresetPreviewCanvasProps() {},
    applyMolstarProviderPreset: async () => calls.push('provider'),
    molstarPresetAppearance: () => 'illustrative', applyMolstarAppearance: async () => {},
    applyViewerBackground() {}, waitForAnimationFrame: async () => {},
    waitForMolstarPresetPreviewDraw: async () => {},
    captureMolstarPresetPreview: async () => calls.push('capture'),
    molstarPresetPreviewElements: () => ({ preview, caption: {} }),
    hideFailedMolstarPresetPreview: error => { throw error; },
  };
  const render = extract('  async function renderMolstarPresetPreview(', '  function scheduleMolstarPresetPreview(', context);
  await render(viewer, { item: {}, preset: 'automatic', serial: 1 });
  assert.deepEqual(calls, ['provider', 'capture']);
});

test('failed preset restores the scene without invalidating its backdrop metadata', async () => {
  const calls = [];
  const snapshot = {};
  let fail = true;
  const context = {
    activeViewer: { plugin: { state: { data: {
      getSnapshot: () => snapshot,
      setSnapshot: value => { assert.equal(value, snapshot); calls.push('rollback'); },
    } }, runTask: async () => {} } },
    activeConfig: {}, window: {}, molstarStyleApplySerial: 0,
    normalizeMolstarPreset: x => x, molstarPresetOption: () => ({ provider: 'auto', label: 'Auto' }),
    molstarPresetAppearance: () => 'illustrative', configuredMolstarPreset: () => 'automatic',
    configuredMolstarStyle: () => 'illustrative', configuredMolstarAppearance: () => 'illustrative',
    captureMolstarCameraSnapshot: () => null, captureMolstarTransitionFrame: () => null,
    molstarStoryState: () => ({ available: false, isPlaying: false }),
    updateMolstarPresentationConfig() {}, applyMolstarWaterLineRepresentation: async () => {},
    applyMolstarProviderPreset: async () => { if (fail) throw new Error('build failed'); },
    applyMolstarAppearance: async () => {}, restoreMolstarCameraSnapshotNow() {},
    fadeMolstarTransitionFrame() {}, removeMolstarTransitionFrame() {},
    setStatus() {}, debug() {}, hideStatus() {}, setTimeout() {}, isQuickLookHost: () => false,
    beginMolstarBusy: () => calls.push('busy'), endMolstarBusy: () => calls.push('idle'),
    nextMolstarPaint: async () => {}, ensureMolstarPresetPreviewController: () => null,
    resyncDockingSceneAfterRestyle: async () => calls.push('resync'),
  };
  context.applyMolstarPresetNow = extract('  async function applyMolstarPresetNow(', '  async function applyConfiguredMolstarPreset(', context);
  const request = extract('  async function requestMolstarPreset(', '  async function applyMolstarPresetNow(', context);
  assert.equal(await request('automatic'), false);
  assert.deepEqual(calls, ['busy', 'rollback', 'idle']);
  calls.length = 0;
  fail = false;
  assert.equal(await request('automatic'), true);
  assert.deepEqual(calls, ['busy', 'resync', 'idle']);
});
