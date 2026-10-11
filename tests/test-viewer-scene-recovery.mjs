import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'))[0];

// A hidden frame uses the timeout; returning to it must not run a backlog of
// already-completed paint waits. Exercise both possible rAF stages and a paint.
for (const mode of ['hidden', 'hidden-after-first-frame', 'visible']) {
  let id = 0;
  const frames = new Map(), timers = new Map();
  const window = {
    requestAnimationFrame: fn => (frames.set(++id, fn), id),
    cancelAnimationFrame: key => frames.delete(key),
    setTimeout: fn => (timers.set(++id, fn), id),
    clearTimeout: key => timers.delete(key),
  };
  const fire = queue => { const [key, fn] = queue.entries().next().value; queue.delete(key); fn(); };
  const waitForPaint = new Function('window', `${extract('nextMolstarPaint')} return nextMolstarPaint;`)(window);
  for (let i = 0; i < 25; i++) {
    const pending = waitForPaint();
    if (mode !== 'hidden') fire(frames);
    fire(mode === 'visible' ? frames : timers);
    await pending;
    assert.deepEqual([frames.size, timers.size], [0, 0], mode);
  }
}

// Fail at each phase of a multi-pose restyle, then retry. An error must not
// stamp the cache as successful or skip recovery of partially changed geometry.
for (const failureStage of [1, 2, 3]) {
  let calls = 0, fail = true;
  const state = { key: 'loaded', poseRefs: [['a'], ['b'], ['c']], poseStyles: ['', 'backdrop', ''], visible: [true] };
  const work = async () => { if (++calls === failureStage && fail) throw new Error('build failed'); };
  const style = new Function('applySdfCollectionMolstarStyle', 'applyMolstarWaterLineRepresentation', `
    const dockingSceneStructuresByPose = (_viewer, refs) => refs;
    const normalizeMolstarStyle = value => value;
    ${extract('styleDockingScenePoses')}
    return styleDockingScenePoses;
  `)(work, work);
  const wanted = ['backdrop', '', undefined];
  await assert.rejects(style({}, state, wanted, {}), /build failed/);
  assert.deepEqual({ key: state.key, styles: state.poseStyles, visible: state.visible },
    { key: null, styles: ['', 'backdrop', ''], visible: null });
  fail = false; calls = 0;
  await style({}, state, wanted, {});
  assert.equal(calls, 3, 'retry performs all required phases');
  assert.deepEqual(state.poseStyles, ['backdrop', '', '']);
  await style({}, state, wanted, {});
  assert.equal(calls, 3, 'successful unchanged styles are reused');
}
// Nested batch failure must release both the progress state and draw hold.
const drawCalls = [];
const canvas = {
  pause: () => drawCalls.push('pause'), commit: () => drawCalls.push('commit'), resume: () => drawCalls.push('resume'),
  animate: () => { throw new Error('must not start another render loop'); },
};
const hold = new Function(`
  let molstarDrawHoldDepth = 0, molstarDrawHoldEndedAt = 0, busy = 0;
  const performance = { now: () => 0 };
  const beginMolstarBusy = () => busy++;
  const endMolstarBusy = () => busy--;
  ${extract('withMolstarDrawHold')}
  return {run:withMolstarDrawHold, state:()=>({depth:molstarDrawHoldDepth,busy})};
`)();
const viewer = { plugin: { canvas3d: canvas } };
await assert.rejects(hold.run(viewer, () => hold.run(viewer, () => { throw new Error('failed batch'); })), /failed batch/);
assert.deepEqual(drawCalls, ['pause', 'commit', 'resume']);
assert.deepEqual(hold.state(), { depth: 0, busy: 0 });
console.log('Hidden-frame cleanup, scene-style recovery and failed batch release passed');

// Drive the real scene lifecycle, including hidden representations, cached
// stepping, authored-style reload and alignment restoration after that reload.
const hidden = new Map();
let structures = [], loads = 0, restores = 0, failBuild = false;
const sceneViewer = { plugin: {
  clear: async () => { structures = []; hidden.clear(); },
  state: { data: { updateCellState: (ref, state) => hidden.set(ref, state.isHidden) } },
} };
const prepared = { kind: 'docking', dockingSceneMode: true, poseCount: 3, poses: ['a', 'b', 'c'] };
const context = {
  activeConfig: { style: 'line' }, activeMolstarPrepared: prepared,
  activeDockingSceneVisibilityState: null,
  dockingSceneStateKey: (_prepared, style) => style,
  molstarCurrentStructures: () => structures,
  normalizeMolstarStyle: value => value, configuredMolstarStyle: config => config.style,
  resetXyzFrameOverlayState() {}, resetSdfCollectionVisibilityState() {}, resetDockingPoseCollectionState() {},
  loadMolstarEntry: async (_viewer, ref) => {
    loads++;
    structures.push({ cell: { transform: { ref } }, aligned: false, components: [
      { cell: { transform: { ref: ref + '-component' } }, representations: [{ cell: { transform: { ref: ref + '-rep' } } }] },
    ] });
  },
  applyMolstarStyle: async () => {}, applyMolstarWaterLineRepresentation: async () => {},
  applySdfCollectionMolstarStyle: async () => { if (failBuild) throw new Error('build failed'); },
  activeStructureAlignmentControl: { restoreAfterSceneReload: async () => { restores++; structures.forEach(s => { s.aligned = true; }); } },
  dockingSceneBackgroundStyle: value => value, readSdfCollectionContextStyle: () => 'line',
  readSdfCollectionContextOpacity: () => 0.4, readSdfCollectionContextColor: () => 'gray',
  document: { querySelector: () => null }, updateStructureOverlayToggleButton() {}, scheduleMolstarStructureFocus() {},
  readTrajectoryControlIndex: () => 1,
};
const sceneFunctions = ['resetDockingSceneVisibilityState', 'molstarStructureCellRefs',
  'dockingSceneVisibilityStateStillLoaded', 'setDockingSceneRefsHidden', 'dockingSceneStructuresByPose',
  'dockingSceneStyleNeedsReload', 'styleDockingScenePoses', 'ensureDockingSceneState',
  'showDockingScenePoses', 'applyDockingSceneSinglePose', 'applyDockingSceneOverlayPoses', 'resyncDockingSceneAfterRestyle'];
runInNewContext(sceneFunctions.map(extract).join('\n'), context);
const single = index => context.applyDockingSceneSinglePose(sceneViewer, prepared, index, {});
const all = index => context.applyDockingSceneOverlayPoses(sceneViewer, prepared, index, {});
const visible = () => structures.filter(s => !hidden.get(s.cell.transform.ref)).map(s => s.cell.transform.ref);
await single(0);
assert.deepEqual(visible(), ['a']);
await all(0);
assert.deepEqual(visible(), ['a', 'b', 'c']);
await all(1);
await single(1);
await single(2);
assert.deepEqual([visible(), loads, restores], [['c'], 3, 1], 'simple styles reuse loaded poses');
context.applyDockingSceneVisibility = async () => single(1);
hidden.clear(); // A preset creates new representations visible by default.
await context.resyncDockingSceneAfterRestyle(sceneViewer);
assert.deepEqual([visible(), hidden.get('c-rep'), loads], [['b'], true, 3]);
context.activeConfig.style = 'illustrative';
await all(0);
await single(0);
const beforeReload = loads;
await single(1);
assert.equal(loads, beforeReload + 3);
assert.ok(structures.every(s => s.aligned), 'reloaded poses retain alignment, not just its button state');
failBuild = true;
await assert.rejects(all(1), /build failed/);
assert.equal(context.activeDockingSceneVisibilityState.key, null);
failBuild = false;
await all(1);
assert.deepEqual(visible(), ['a', 'b', 'c']);
assert.ok(structures.every(s => s.aligned));

// Do not turn partial representation creation into a successful cached style.
for (const failure of ['throw', 'empty']) {
  let built = 0;
  const plugin = { builders: { structure: { representation: { addRepresentation: async () => {
    if (++built === 2) { if (failure === 'throw') throw new Error('builder failed'); return null; }
    return {};
  } } } } };
  const buildContext = {
    collectionRepresentations: new WeakMap(), updateCollectionRepresentations: async () => false,
    clearCollectionRepresentations: async () => {}, tryCreateMolstarComponent: async () => ({}),
  };
  const apply = runInNewContext(extract('addCollectionRepresentation') + extract('applyMolstarRepresentationsToStructures') + '\napplyMolstarRepresentationsToStructures', buildContext);
  await assert.rejects(apply({ plugin }, [{}, {}], {}), /builder failed|could not build/);
}
console.log('Scene switching, hidden presets, aligned reloads and partial builder failures passed');

// Old controls remain alive briefly while the next scene is loading. Their
// alignment must not touch either another viewer or new data in the same one.
let alignmentCommits = 0;
const alignmentContext = {
  superpositionStructureEntries: () => [],
  commitSuperpositionPlan: async () => { alignmentCommits++; },
  document: { querySelectorAll: () => [] },
};
const createAlignment = runInNewContext(extract('createStructureSuperpositionController') + '\ncreateStructureSuperpositionController', alignmentContext);
const controller = createAlignment(sceneViewer, prepared, { classList: { toggle() {} }, setAttribute() {} });
controller.restoreMetadata({ pairs: [] });
assert.equal(await controller.restoreAfterSceneReload({}, prepared), false);
assert.equal(await controller.restoreAfterSceneReload(sceneViewer, { ...prepared }), false);
assert.equal(alignmentCommits, 0);
assert.equal(await controller.restoreAfterSceneReload(sceneViewer, prepared), true);
assert.equal(alignmentCommits, 1);
