import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Vec3, Mat4 } from 'molstar/lib/mol-math/linear-algebra/3d.js';
import { getPalette } from 'molstar/lib/mol-util/color/palette.js';

const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Missing production function ${name}`);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}
const failure = (command, code, message) => ({ ok: false, command, error: { code, message } });

test('chain coloring applies a discrete requested palette through the real Mol* palette contract', async () => {
  const updates = [];
  const component = { id: 'protein' };
  const plugin = { managers: { structure: { hierarchy: { current: { structures: [{ components: [component] }] } },
    component: { updateRepresentationsTheme: async (components, theme) => updates.push({ components, theme }) } } } };
  const color = runInNewContext(`${functionSource('colorMolstarByChain')}\ncolorMolstarByChain`, {
    activeMolstarViewer: () => ({ plugin }), sceneActionFailure: failure,
  });
  const result = await color({ palette: ['#34C759', '#AF52DE'] });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, command: 'color_by_chain', result: { componentCount: 1, color: 'chain-id', palette: ['#34c759', '#af52de'] } });
  assert.equal(updates[0].components[0], component);
  const palette = getPalette(3, updates[0].theme.colorParams);
  assert.deepEqual([palette.color(0), palette.color(1), palette.color(2)], [0x34c759, 0xaf52de, 0x34c759]);
  for (const action of [{ palette: [] }, { palette: ['green'] }, { palette: Array(33).fill('#123456') }, { color: 'element-symbol', palette: ['#123456'] }]) {
    assert.equal((await color(action)).error.code, 'INVALID_ARGS');
  }
  assert.equal(updates.length, 1, 'invalid palettes never mutate representations');
  plugin.managers.structure.component.updateRepresentationsTheme = undefined;
  plugin.managers.structure.component.updateRepresentations = () => assert.fail('Unsupported palette must not be silently discarded');
  assert.equal((await color({ palette: ['#123456'] })).error.code, 'NOT_IMPLEMENTED');
});

test('keyboard handlers follow the active viewer and do nothing after disposal', () => {
  let handler;
  const scales = [];
  const context = {
    keyboardShortcutsInstalled: false, activeViewer: { id: 'first' }, viewerUIScale: 1,
    VIEWER_UI_SCALE_STEP: 0.1, DEFAULT_VIEWER_UI_SCALE: 1,
    document: { addEventListener: (_name, next) => { handler = next; } },
    setViewerUIScale: (scale, viewer) => scales.push({ scale, viewer }),
  };
  runInNewContext(`${functionSource('initViewerKeyboardShortcuts')}\ninitViewerKeyboardShortcuts()`, context);
  const event = { metaKey: true, key: '+', preventDefault() {} };
  context.activeViewer = null;
  handler(event);
  assert.deepEqual(scales, []);
  context.activeViewer = { id: 'second' };
  handler(event);
  assert.deepEqual(scales, [{ scale: 1.1, viewer: context.activeViewer }]);
});

test('terminal layout cleanup disconnects its observer and cancels pending animation', () => {
  const events = [];
  const context = {
    floatingPanelTrackingInstalled: false, floatingPanelTrackingCleanup: null, floatingLayoutFrame: 42,
    MutationObserver: class { observe() {} disconnect() { events.push('disconnect'); } },
    window: { addEventListener() {}, removeEventListener: name => events.push(name) },
    document: { body: {}, addEventListener() {}, removeEventListener: name => events.push(name) },
    scheduleFloatingLayoutRefresh() {}, cancelAnimationFrame: id => events.push(id), setTimeout() {},
  };
  runInNewContext(`${functionSource('installMolstarFloatingPanelTracking')}\ninstallMolstarFloatingPanelTracking()`, context);
  context.floatingPanelTrackingCleanup();
  assert.deepEqual(events, ['disconnect', 'resize', 'click', 42]);
  assert.equal(context.floatingLayoutFrame, 0);
});

test('prepared-source presets load the requested style and roll configuration back on failure', async () => {
  const viewer = { plugin: { state: { data: { getSnapshot: () => null } } } };
  const original = { molstarPreset: 'automatic', molstarStyle: 'default', molstarAppearance: 'illustrative' };
  const loaded = [];
  let fail = false;
  const context = {
    activeConfig: original, activeViewer: viewer, window: {}, molstarStyleApplySerial: 0,
    normalizeMolstarPreset: value => value, normalizeMolstarAppearance: value => value,
    molstarPresetOption: value => ({ label: value, legacyStyle: value }),
    configuredMolstarPreset: config => config.molstarPreset,
    configuredMolstarStyle: config => config.molstarStyle,
    configuredMolstarAppearance: config => config.molstarAppearance,
    molstarPresetAppearance: () => 'illustrative', captureMolstarCameraSnapshot: () => null,
    captureMolstarTransitionFrame: () => null, molstarStoryState: () => ({ available: false, isPlaying: false }),
    updateMolstarPresentationConfig: (preset, appearance, style) => {
      context.activeConfig = { molstarPreset: preset, molstarAppearance: appearance, molstarStyle: style };
    },
    reloadMolstarStyle: async () => { loaded.push({ ...context.activeConfig }); if (fail) throw new Error('Geometry failed'); },
    applyMolstarAppearance: async () => {}, setStatus() {}, hideStatus() {}, setTimeout() {},
    isQuickLookHost: () => false, fadeMolstarTransitionFrame() {}, removeMolstarTransitionFrame() {}, debug() {},
  };
  const apply = runInNewContext(`${functionSource('applyMolstarPresetNow')}\napplyMolstarPresetNow`, context);
  assert.equal((await apply('ball-and-stick', { appearance: 'default' })).applied, true);
  assert.deepEqual(loaded[0], { molstarPreset: 'ball-and-stick', molstarAppearance: 'default', molstarStyle: 'ball-and-stick' });
  const beforeFailure = { ...context.activeConfig };
  fail = true;
  assert.equal((await apply('spacefill', { appearance: 'default' })).applied, false);
  assert.deepEqual(context.activeConfig, beforeFailure);
});

test('style acknowledgement waits for the real preset apply result', async () => {
  let finish;
  let settled = false;
  const pending = new Promise(resolve => { finish = resolve; });
  const requests = [];
  const handler = runInNewContext(`${functionSource('setMolstarStyleFromAction')}\nsetMolstarStyleFromAction`, {
    normalizeMolstarStyle: value => value,
    molstarPresetForLegacyStyle: () => 'polymer-cartoon',
    requestMolstarStyle: () => pending,
    requestMolstarPreset: (...args) => { requests.push(args); return pending; },
    agentActionFailure: failure,
  });
  const result = handler({ style: 'cartoon' }).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false, 'Queued work must not be reported as completed');
  finish({ applied: true, preset: 'polymer-cartoon' });
  assert.equal((await result).ok, true);
  assert.equal(requests[0][0], 'polymer-cartoon');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0][1])), { preserveCamera: true, appearance: 'default' });
});

for (const outcome of [{ applied: false, error: 'Geometry build failed' }, undefined]) {
  test(`failed or superseded style application is not success: ${JSON.stringify(outcome)}`, async () => {
    const handler = runInNewContext(`${functionSource('setMolstarStyleFromAction')}\nsetMolstarStyleFromAction`, {
      normalizeMolstarStyle: value => value,
      molstarPresetForLegacyStyle: () => 'polymer-cartoon',
      requestMolstarStyle() {}, requestMolstarPreset: async () => outcome,
      agentActionFailure: failure,
    });
    assert.equal((await handler({ style: 'cartoon' })).ok, false);
  });
}

test('agent motion uses the existing viewport controls and rejects invalid speeds', async () => {
  const calls = [];
  const handler = runInNewContext(`${functionSource('controlViewportFromAction')}\ncontrolViewportFromAction`, {
    viewportPlugin: () => ({ canvas3d: {} }),
    VIEWPORT_MOTION_SPEEDS: { spin: { min: 0.01, max: 1 }, rock: { min: 0.02, max: 1.5 } },
    setViewportMotion: (...args) => calls.push(args),
    describeViewportScene: () => ({ motion: { name: 'spin' } }),
    agentActionFailure: failure,
  });
  assert.equal((await handler({ type: 'set_scene_motion', mode: 'spin', speed: 0.2 })).ok, true);
  assert.deepEqual(calls, [['spin', 0.2]]);
  assert.equal((await handler({ type: 'set_scene_motion', mode: 'spin', speed: 100 })).ok, false);
  assert.equal((await handler({ type: 'set_scene_motion', mode: 'unknown' })).ok, false);
  assert.equal(calls.length, 1);
});

test('agent wiggle waits for the representation animation update', async () => {
  let finish;
  let settled = false;
  const pending = new Promise(resolve => { finish = resolve; });
  const handler = runInNewContext(`${functionSource('controlViewportFromAction')}\ncontrolViewportFromAction`, {
    viewportPlugin: () => ({ canvas3d: {} }),
    setViewportWiggleKind: () => pending,
    refreshViewportWiggleControls() {},
    describeViewportScene: () => ({ wiggle: { name: 'even' } }),
    agentActionFailure: failure,
  });
  const action = handler({ type: 'set_scene_wiggle', mode: 'even' }).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish();
  assert.equal((await action).ok, true);
});

test('camera rotation uses Mol* geometry without moving molecular coordinates', async () => {
  const snapshot = { position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0] };
  let updated;
  const handler = runInNewContext(`${functionSource('controlViewportFromAction')}\ncontrolViewportFromAction`, {
    viewportPlugin: () => ({ canvas3d: { camera: { getSnapshot: () => snapshot, setState: state => { updated = state; } }, requestDraw() {} } }),
    window: { molstar: { lib: { math: { LinearAlgebra: { Vec3, Mat4 } } } } },
    describeViewportScene: () => ({ camera: updated }), agentActionFailure: failure,
  });
  assert.equal((await handler({ type: 'rotate_camera', axis: [0, 1, 0], angleDegrees: 90 })).ok, true);
  assert.ok(Math.abs(updated.position[0] - 10) < 1e-9);
  assert.ok(Math.abs(updated.position[2]) < 1e-9);
  assert.deepEqual(snapshot.position, [0, 0, 10]);
  assert.equal((await handler({ type: 'rotate_camera', axis: [0, 0, 0], angleDegrees: 90 })).ok, false);
});

test('uncertainty wiggle with no spread leaves no baseline motion', async () => {
  const writes = [];
  const handler = runInNewContext(`${functionSource('setViewportWiggleKind')}\nsetViewportWiggleKind`, {
    viewportWiggleState: () => ({ name: 'off' }),
    setViewportWiggleOptions: async options => writes.push(JSON.parse(JSON.stringify(options))),
    applyViewportWiggleFromUncertainty: async () => 0,
  });
  assert.match(await handler('uncertainty'), /no B-factor or RMSF spread/);
  assert.deepEqual(writes, [{ wiggleAmplitude: 0.01, tumbleAmplitude: 0 }, { wiggleAmplitude: 0, tumbleAmplitude: 0 }]);
});
