import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';

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

// A representation preset must not invalidate the receptor+SDF pose cache.
// The next step should replace only the foreground at the existing camera.
{
  const docking = { kind: 'docking', sdfPoseOverlayAvailable: true, poses: [{ label: 'Pose 1' }, { label: 'Pose 2' }] };
  const poseViewer = { plugin: {
    clear: async () => { throw Error('Preset must not reload the scene'); },
    builders: { data: { rawData() {} }, structure: { parseTrajectory() {}, hierarchy: { applyPreset() {} } } },
  } };
  const state = { viewer: poseViewer, key: 'old-style', receptorRefs: ['receptor'], backgroundRefs: [], activeRefs: ['ligand-1'], activeIndex: 0 };
  const context = {
    activeMolstarPrepared: docking, activeConfig: { molstarStyle: 'ball-and-stick' }, activeSdfPoseMode: 'single',
    activeDockingPoseCollectionState: state,
    configuredMolstarStyle: config => config.molstarStyle,
    dockingSceneBackgroundStyle: value => value, readSdfCollectionContextStyle: () => 'match',
    readSdfCollectionContextOpacity: () => 0.2, readSdfCollectionContextColor: () => 'gray',
    xyzFrameOverlayRawSignature: () => '',
    dockingPoseCollectionStateStillLoaded: () => true,
    dockingPinnedPoseIndices: () => new Set(), syncDockingPinnedPoseVisibility() {},
    molstarStructuresByRefs: () => [], applySdfCollectionMolstarStyle: async () => {},
    document: { querySelector: () => null }, updateStructureOverlayToggleButton() {},
    applyMolstarWaterLineRepresentation: async () => {},
    switchCachedPoseLayer: async (_viewer, target, index) => { target.activeIndex = index; target.activeRefs = [`ligand-${index + 1}`]; },
  };
  runInNewContext(extract('dockingPoseCollectionStateKey') + extract('resyncDockingSceneAfterRestyle') + extract('applyDockingPoseCollectionVisibilityNow'), context);
  context.applyDockingPoseCollectionVisibility = context.applyDockingPoseCollectionVisibilityNow;
  await context.resyncDockingSceneAfterRestyle(poseViewer);
  await context.applyDockingPoseCollectionVisibilityNow(poseViewer, docking, 1, { focus: false });
  assert.deepEqual({ key: state.key, receptor: state.receptorRefs, active: state.activeRefs, index: state.activeIndex }, {
    key: context.dockingPoseCollectionStateKey(docking, 'ball-and-stick', false, 'match', 1), receptor: ['receptor'], active: ['ligand-2'], index: 1,
  });
}

// Light/outline appearance is independent of the geometric representation.
for (const appearance of ['illustrative', 'lit']) {
  const applied = [];
  const context = {
    activeConfig: { appearance }, normalizeMolstarStyle: value => value,
    sdfCollectionRepresentationForStyle: () => ({}),
    applyMolstarRepresentationsToStructures: async () => applied.push('geometry'),
    configuredMolstarAppearance: config => config.appearance,
    applyMolstarAppearance: async (_viewer, value) => applied.push(value),
  };
  const apply = runInNewContext(extract('applySdfCollectionMolstarStyle') + '\napplySdfCollectionMolstarStyle', context);
  await apply({}, 'ball-and-stick', [{}]);
  assert.deepEqual(applied, ['geometry', appearance]);
}
console.log('Docking preset keeps receptor/pose cache and independent appearance');

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


// Collapsing a file only hides its rows: indices, scores and independent pins
// must survive reopening the group and the surrounding menu.
{
  const window = new Window();
  const document = window.document;
  const fileList = document.createElement('div');
  const fileButtons = [], fileTargets = [], pins = [];
  const poseGroups = [
    { label: 'gnina.sdf', startFrame: 0, frameCount: 2, poses: [{ label: 'Pose 1', score: { value: -8.1, tag: 'Affinity' } }, { label: 'Pose 2' }] },
    { label: 'crystal.sdf', startFrame: 2, frameCount: 1, poses: [{ label: 'Pose 1' }] },
  ];
  const start = source.indexOf('    if (fileList && hasPoseGroups) {');
  const end = source.indexOf('    } else if (fileList) {', start);
  assert.ok(start > 0 && end > start);
  runInNewContext(source.slice(start, end) + '}', {
    document, fileList, hasPoseGroups: true, canPinPoses: true, poseGroups, fileButtons, fileTargets,
    sceneTreeIconElement: () => document.createElement('span'), APP_ICON_DATA: {},
    pinButton: indices => {
      const pin = document.createElement('button');
      pin.className = 'buret-docking-pose-pin';
      pin.onclick = () => pins.push([...indices]);
      return pin;
    },
  });
  document.body.append(fileList);
  const toggles = [...fileList.querySelectorAll('.buret-docking-pose-group-toggle')];
  const rows = toggles.map(toggle => document.getElementById(toggle.getAttribute('aria-controls')));
  assert.deepEqual(fileTargets, [0, 1, 2]);
  assert.equal(fileButtons[0].textContent, 'Pose 1-8.10');
  toggles[0].click();
  assert.deepEqual(rows.map(row => row.hidden), [true, false]);
  assert.equal(toggles[0].getAttribute('aria-expanded'), 'false');
  fileList.querySelector('.buret-docking-pose-group-label .buret-docking-pose-pin').click();
  assert.deepEqual(pins, [[0, 1]]);
  assert.equal(rows[0].hidden, true, 'pinning a collapsed file must not toggle its disclosure');
  toggles[0].click();
  assert.deepEqual(rows.map(row => row.hidden), [false, false]);
  assert.equal(toggles[0].getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...rows[0].querySelectorAll('[role="option"]')], fileButtons.slice(0, 2), 'expand reuses the original pose controls');
  await window.happyDOM.close();
}
console.log('Docking file disclosure preserves pose indices, scores and independent pins');
