import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const viewer = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const start = viewer.indexOf('  async function applyExternalTrajectorySmoothingFromAction(');
const end = viewer.indexOf('  async function setTrajectorySmoothingViewFromAction(', start);
const topology = { format: 'pdb', data: 'original topology', label: 'protein' };
const originalCoordinates = { format: 'dcd', data: new Uint8Array([1]), label: 'MD' };
const original = { kind: 'docking', entries: [topology, originalCoordinates],
  trajectoryPair: { modelEntry: topology, coordinateEntry: originalCoordinates,
    coordinateEntries: [originalCoordinates], modelKind: 'model-data' } };
const bytes = new Uint8Array([4, 3, 2, 1]);
const messages = [];
let loaded;
const context = vm.createContext({
  activeMolstarPrepared: original, trajectorySmoothingState: null, activeConfig: { documentId: 'test' },
  Uint8Array, TextDecoder,
  loadPayloadBytes: async path => { assert.equal(path, 'mdsmooth-1.dcd'); return bytes; },
  isDockingTrajectoryPairEntry: (entry, pair) => entry === pair.modelEntry || pair.coordinateEntries.includes(entry),
  replaceTrajectorySmoothingPrepared: async prepared => { loaded = prepared; },
  updateTrajectorySmoothingButtons: () => {}, postHostMessage: message => messages.push(message),
  agentActionFailure: (command, code, message) => ({ ok: false, command, error: { code, message } }),
});
vm.runInContext(`${viewer.slice(start, end)}\nglobalThis.apply = applyExternalTrajectorySmoothingFromAction;`, context);
const result = await context.apply({ sourceUrl: 'mdsmooth-1.dcd', sourceFormat: 'dcd', frameCount: 148 });
assert.equal(result.ok, true);
assert.equal(loaded.kind, 'docking');
assert.equal(loaded.trajectoryPair.modelEntry, topology);
assert.equal(loaded.trajectoryPair.coordinateEntry.data, bytes);
assert.equal(loaded.trajectoryPair.coordinateEntry.format, 'dcd');
assert.equal(loaded.entries.length, 2, 'old coordinates must not remain as a second trajectory');
assert.equal(loaded.entries[0], topology);
assert.equal(loaded.entries[1], loaded.trajectoryPair.coordinateEntry);
assert.equal(context.trajectorySmoothingState.originalPrepared, original);
assert.equal(messages[0].view, 'smoothed');

const previousState = context.trajectorySmoothingState;
context.replaceTrajectorySmoothingPrepared = async () => { throw new Error('invalid DCD'); };
const failed = await context.apply({ sourceUrl: 'mdsmooth-1.dcd', sourceFormat: 'dcd', frameCount: 148 });
assert.equal(failed.ok, false);
assert.equal(context.trajectorySmoothingState, previousState);
assert.equal(messages.length, 1, 'no smoothing success message after load failure');

// Exercise the actual Info-card async handler: a completed calculation is not
// sufficient to light up On; the viewer must acknowledge loading the result.
const panel = readFileSync(new URL('../apps/desktop/src/components/structure-info-panel.tsx', import.meta.url), 'utf8');
const buildStart = panel.indexOf('  const build = async () => {');
const buildEnd = panel.indexOf('  const selectPreset = ', buildStart);
const buildSource = panel.slice(buildStart, buildEnd).replaceAll('import.meta.env.VITE_BURETTE_WEB_DEMO', 'undefined');
let rejectLoad;
let request;
const state = { built: false, view: 'original', error: null, running: false };
const ui = vm.createContext({
  running: false, built: false, settingsSignature: 'v1', requestSerial: { current: 0 },
  latestSettingsSignature: { current: 'v1' }, failedAutoUpdate: { current: null }, updatedTimer: { current: null },
  document: { id: 'test', runtimePath: '/cache/viewer/session/index.html', extension: 'cms' },
  crypto: { randomUUID: () => 'unique' }, latestPlayback: { current: null }, playback: null, frameCount: 148, targetFrames: 50, referenceFrame: 1, align: true,
  signal: 'rmsd', mode: 'extrema', preset: 'balanced', rmsdFilter: 'frames', filterOrder: 5,
  cutoffFrequency: .1, powerRetained: .95, includeEnds: true, lagFrames: 7, kineticStates: 5,
  isTauriRuntime: () => true,
  trajectoryPathsFor: () => ({ trajectoryPath: '/cache/input.dcd', topologyPath: '/cache/input.pdb' }),
  runMdsmooth: async value => { request = value; return { frameCount: 148, keyframes: [0, 147], outputFormat: 'dcd' }; },
  requestViewerAction: async (_id, action) => {
    assert.equal(action.sourceUrl, 'mdsmooth-1-unique.dcd');
    assert.equal(state.built, false);
    return new Promise((_resolve, reject) => { rejectLoad = reject; });
  },
  setRunning: value => { state.running = value; },
  setError: value => { state.error = value; },
  setBuilt: value => { state.built = value; }, setView: value => { state.view = value; },
  setResult: () => {},
});
vm.runInContext(`${buildSource}\nglobalThis.build = build;`, ui);
const build = ui.build();
await new Promise(resolve => setImmediate(resolve));
assert.equal(request.outputPath, '/cache/viewer/session/mdsmooth-1-unique.dcd');
assert.equal(state.running, true);
rejectLoad(new Error('Viewer rejected the trajectory'));
await build;
assert.equal(state.built, false);
assert.equal(state.view, 'original');
assert.equal(state.running, false);
assert.match(state.error, /Viewer rejected/);
console.log('native smoothing handoff tests passed (binary pairing, scoped path, viewer acknowledgement)');

// A failed replacement must recover the real prior scene, not only return ok:false.
const replaceStart = viewer.indexOf('  async function replaceTrajectorySmoothingPrepared(');
const replaceEnd = viewer.indexOf('  async function applyTrajectorySmoothingFromAction(', replaceStart);
const snapshot = { frameIndex: 12, fps: '20', playing: false };
const order = [];
let scene = original;
const recovery = vm.createContext({
  activeViewer: { plugin: { clear: async () => { scene = null; order.push('clear'); },
    managers: { animation: { stop: async () => order.push('native-stop') } } }, handleResize() {} },
  activeMolstarPrepared: original, trajectorySmoothingSwitchPending: false,
  activeTrajectoryPlaybackControl: { stop: async () => order.push('stop') },
  pendingTrajectoryPlaybackRestore: null,
  currentTrajectoryPlaybackSnapshot: () => snapshot,
  loadPreparedStructure: async (_viewer, prepared) => {
    if (prepared !== original) { order.push('reject'); throw new Error('bad DCD'); }
    scene = prepared; order.push('recover');
  },
  restoreTrajectoryPlaybackSnapshot: async value => { assert.equal(value, snapshot); order.push('restore'); },
  applyLayoutState() {}, scheduleLayoutStateReapply() {},
});
vm.runInContext(`${viewer.slice(replaceStart, replaceEnd)}\nglobalThis.replace = replaceTrajectorySmoothingPrepared;`, recovery);
await assert.rejects(recovery.replace({ bad: true }), /bad DCD/);
assert.equal(scene, original);
assert.equal(recovery.pendingTrajectoryPlaybackRestore, null);
assert.deepEqual(order, ['stop', 'native-stop', 'clear', 'reject', 'stop', 'clear', 'recover', 'restore']);
console.log('failed scene replacement restores original coordinates and playback snapshot');

// On/Off follows the currently displayed frame, not the build-time frame.
const switchStart = viewer.indexOf('  async function setTrajectorySmoothingViewFromAction(');
const switchEnd = viewer.indexOf('  function updateTrajectorySmoothingButtons(', switchStart);
const switcher = vm.createContext({
  trajectorySmoothingState: { view: 'smoothed', originalFrameIndex: 10, originalSegmentStartFrame: 51,
    originalFrameCount: 148, originalPrepared: { poseCount: 501 }, smoothedPrepared: { poseCount: 148 } },
  currentTrajectoryPlaybackSnapshot: () => ({ frameIndex: 90, playing: false }),
  replaceTrajectorySmoothingPrepared: async (_prepared, snapshot) => { assert.equal(snapshot.frameIndex, 141); },
  updateTrajectorySmoothingButtons() {}, postHostMessage() {}, activeConfig: {},
  agentActionFailure: (_c, _e, message) => { throw new Error(message); }
});
vm.runInContext(`${viewer.slice(switchStart, switchEnd)}\nglobalThis.switchView = setTrajectorySmoothingViewFromAction;`, switcher);
assert.equal((await switcher.switchView({ view: 'original' })).ok, true);
console.log('smoothed frame 90 maps to original frame 141 in segment starting at 51');
