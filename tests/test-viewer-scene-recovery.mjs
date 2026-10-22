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
    molstarShowHydrogens: true,
    collectionRepresentations: new WeakMap(), updateCollectionRepresentations: async () => false,
    clearCollectionRepresentations: async () => {}, tryCreateMolstarComponent: async () => ({}),
  };
  const apply = runInNewContext(extract('molstarHydrogenRepresentation') + extract('addCollectionRepresentation') + extract('applyMolstarRepresentationsToStructures') + '\napplyMolstarRepresentationsToStructures', buildContext);
  await assert.rejects(apply({ plugin }, [{}, {}], {}), /builder failed|could not build/);
}
console.log('Scene switching, hidden presets, aligned reloads and partial builder failures passed');

// Selection/All/pins must never clear or reload the receptor. Only selected
// ligand structures belong in the live hierarchy; parsed offscreen data is cached.
{
  let clears = 0, parses = 0, receptorLoads = 0, receptorStyles = 0, fail = false;
  const live = new Set(), deleted = [], children = new Map();
  const pins = new Set(), selection = new Set(), references = new Set();
  const docking = { kind: 'docking', sdfPoseOverlayAvailable: true, receptorEntry: { label: 'receptor' },
    poses: Array.from({ length: 8 }, (_, i) => ({ label: `pose${i}` })),
    poseGroups: [{ startFrame: 0, endFrame: 2 }] };
  const camera = { props: { camera: { manualReset: false } },
    view: { zoom: 3, rotation: [1, 2, 3] }, setProps(value) { Object.assign(this.props.camera, value.camera); }, commit() {} };
  const poseViewer = { plugin: { canvas3d: camera,
    clear: async () => { clears++; live.clear(); },
    state: { data: { tree: { children }, build: () => {
      const refs = [];
      return { delete(ref) { refs.push(ref); return this; }, async commit() { for (const ref of refs) { deleted.push(ref); live.delete(ref); } } };
    } } },
    builders: { data: { rawData() {} }, structure: { parseTrajectory() {}, hierarchy: { applyPreset() {} } } },
  } };
  const context = {
    activeMolstarPrepared: docking, activeConfig: { molstarStyle: 'ball-and-stick' }, activeSdfPoseMode: 'single',
    activeDockingPoseCollectionState: null,
    configuredMolstarStyle: config => config.molstarStyle,
    dockingSceneBackgroundStyle: value => value, readSdfCollectionContextStyle: () => 'match',
    readSdfCollectionContextOpacity: () => 0.2, readSdfCollectionContextColor: () => 'gray',
    xyzFrameOverlayRawSignature: () => '',
    molstarRefsStillLoaded: (_viewer, refs) => refs.length && refs.every(ref => live.has(ref)),
    dockingPinnedPoseIndices: () => pins, dockingSelectedPoseIndices: () => selection, dockingReferencePoseIndices: () => references,
    dockingPinnedPoseState: { activeHidden: false }, dockingPoseCarbonColor: (_prepared, index) => [0x111111, 0x222222][index % 2],
    molstarStructuresByRefs: (_viewer, refs) => refs, molstarStructureRefsOf: refs => refs,
    loadMolstarEntryWithStructureRefs: async () => { receptorLoads++; live.add('receptor'); return ['receptor']; },
    applySdfCollectionMolstarStyle: async (_viewer, _style, refs) => {
      if (refs.includes('receptor')) receptorStyles++;
      else if (fail) { fail = false; throw new Error('representation failed'); }
    },
    document: { querySelector: () => null }, updateStructureOverlayToggleButton() {},
    resetXyzFrameOverlayState() {}, resetSdfCollectionVisibilityState() {},
    switchCachedPoseLayer: async (_viewer, layer, index, entry, style) => {
      layer.poseCache ||= new Map();
      if (!layer.poseCache.has(index)) {
        parses++;
        layer.poseCache.set(index, { raw: { ref: `raw${index}` }, trajectories: [{ ref: `trajectory${index}` }], sourceBytes: 100 });
      }
      children.set(`trajectory${index}`, new Set([entry.label]));
      await style([entry.label]);
      live.add(entry.label);
      layer.activeIndex = index; layer.activeRefs = [entry.label];
    },
  };
  runInNewContext(extract('dockingPoseCollectionStateKey') + extract('dockingPoseCollectionStateStillLoaded')
    + extract('resyncDockingSceneAfterRestyle') + extract('applyDockingPoseCollectionVisibilityNow'), context);
  context.applyDockingPoseCollectionVisibility = context.applyDockingPoseCollectionVisibilityNow;
  const render = index => context.applyDockingPoseCollectionVisibilityNow(poseViewer, docking, index, { focus: false });
  await render(0);
  selection.add(1); await render(0);
  assert.deepEqual([...live].sort(), ['pose0', 'pose1', 'receptor']);
  selection.delete(1); await render(0);
  assert.deepEqual([...live].sort(), ['pose0', 'receptor'], 'deselected structures do not leak into exports');
  selection.add(1); await render(0);
  assert.equal(parses, 2, 'reselect reuses the parsed ligand');
  fail = true; references.add(1);
  await assert.rejects(render(0), /representation failed/);
  assert.equal(context.activeDockingPoseCollectionState.layers.get(1).appearanceKey, null);
  references.delete(1); await render(0);
  assert.equal(context.activeDockingPoseCollectionState.layers.get(1).appearanceKey, JSON.stringify(['ball-and-stick', 1, 0x222222]), 'failed restyle is retried on rollback');
  pins.add(1); await render(0);
  context.activeSdfPoseMode = 'all'; await render(0);
  assert.deepEqual([...live].sort(), ['pose0', 'pose1', 'pose2', 'receptor']);
  context.activeSdfPoseMode = 'single'; await render(0);
  fail = true; selection.add(3);
  await assert.rejects(render(0), /representation failed/);
  selection.delete(3); await render(0);
  assert.ok(deleted.includes('raw3'), 'failed builder is disposed');
  assert.deepEqual([...live].sort(), ['pose0', 'pose1', 'receptor']);
  context.dockingPinnedPoseState.activeHidden = true; await render(0);
  assert.deepEqual([...live].sort(), ['pose1', 'receptor'], 'a hidden stepper pose leaves the scene');
  context.dockingPinnedPoseState.activeHidden = false; await render(0);
  await context.resyncDockingSceneAfterRestyle(poseViewer);
  assert.deepEqual({ clears, receptorLoads, receptorStyles, camera: camera.view, manualReset: camera.props.camera.manualReset },
    { clears: 1, receptorLoads: 1, receptorStyles: 1, camera: { zoom: 3, rotation: [1, 2, 3] }, manualReset: false });
  selection.clear(); pins.clear();
  for (let i = 0; i < 8; i++) await render(i);
  assert.ok(context.activeDockingPoseCollectionState.layers.size <= 5, 'inactive parsed cache is bounded');
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


// Collapsing a file preserves pose indices and scores, and removes closed rows
// from keyboard navigation without rebuilding them.
{
  const window = new Window();
  const document = window.document;
  const fileList = document.createElement('div');
  const fileButtons = [], fileTargets = [];
  const poseGroups = [
    { label: 'gnina.sdf', startFrame: 0, frameCount: 2, poses: [{ label: 'Pose 1', score: { value: -8.1, tag: 'Affinity' } }, { label: 'Pose 2' }] },
    { label: 'crystal.sdf', startFrame: 2, frameCount: 1, poses: [{ label: 'Pose 1' }] },
  ];
  const start = source.indexOf('    if (fileList && hasPoseGroups) {');
  const end = source.indexOf('    } else if (fileList) {', start);
  assert.ok(start > 0 && end > start);
  runInNewContext(source.slice(start, end) + '}', {
    document, fileList, hasPoseGroups: true, activePose: 0, poseGroups, fileButtons, fileTargets,
    groupControls: [], prepared: {}, editPoseVisibility() {}, openPickerMenu() {}, poseActions() {}, poseDots: [],
    createPoseDot: () => document.createElement('button'),
    createPosePin: () => Object.assign(document.createElement('button'), { className: 'buret-docking-pose-pin' }),
    dockingPoseSetColor: () => 0, sceneTreeColorHex: () => '#000000',
    sceneTreeIconElement: () => document.createElement('span'), APP_ICON_DATA: {},
  });
  document.body.append(fileList);
  const toggles = [...fileList.querySelectorAll('.buret-docking-pose-group-toggle')];
  const rows = toggles.map(toggle => document.getElementById(toggle.getAttribute('aria-controls')));
  assert.deepEqual(fileTargets, [0, 1, 2]);
  assert.equal(fileButtons[0].textContent, 'Pose 1-8.10');
  toggles[0].click();
  assert.deepEqual(rows.map(row => row.inert), [true, true]);
  assert.equal(toggles[0].getAttribute('aria-expanded'), 'false');
  assert.equal(fileList.querySelectorAll('[title]').length, 0);
  assert.equal(fileList.querySelectorAll('.buret-docking-pose-pin').length, 5, 'every file and pose carries a pin');
  toggles[1].click();
  assert.deepEqual(rows.map(row => row.inert), [true, false]);
  toggles[0].click();
  assert.deepEqual(rows.map(row => row.inert), [false, false]);
  assert.equal(toggles[0].getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...rows[0].querySelectorAll('[role="menuitemcheckbox"]')], fileButtons.slice(0, 2), 'expand reuses the original pose controls');
  const root = document.createElement('div');
  root.className = 'buret-docking-poses';
  const label = document.createElement('button');
  label.className = 'buret-docking-pose-current';
  root.append(label, fileList);
  document.body.append(root);
  const scheduled = [];
  let open = true, sideMenusClosed = 0;
  const context = {
    window, document, root, label, fileList, fileButtons, fileTargets, hasPoseGroups: true,
    activePose: 0, Node: window.Node, Element: window.Element,
    isFileListOpen: () => open, setFileListOpen: value => { open = value; },
    scheduleSliderInputPose: index => scheduled.push(index), editPoseVisibility: (_action, index) => scheduled.push(index), fileListDisposer: null,
    updatePoseDots() {}, selectedPoseIndices: () => new Set(),
    isDockingPoseKeyboardTarget: () => false,
    closeSceneTreeMenu: () => { sideMenusClosed++; document.getElementById('buret-scene-tree-menu')?.remove(); },
  };
  const eventsStart = source.indexOf("    if (fileList) {\n      label.addEventListener('click'");
  const eventsEnd = source.indexOf('    if (story && storyPanel)', eventsStart);
  runInNewContext(source.slice(eventsStart, eventsEnd), context);
  fileButtons[1].dispatchEvent(new window.PointerEvent('pointerenter', { pointerType: 'mouse' }));
  assert.deepEqual(scheduled, [], 'hover must not change the molecular scene');
  fileButtons[1].click();
  assert.deepEqual({ scheduled, open, focused: document.activeElement === label }, { scheduled: [1], open: true, focused: false });
  const keysStart = source.indexOf('    const onKeyDown = (event) => {', eventsEnd);
  const keysEnd = source.indexOf('    mainRow.append(animation', keysStart);
  runInNewContext(source.slice(keysStart, keysEnd), context);
  const key = (target, value) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  const groupShows = [...fileList.querySelectorAll('.buret-docking-pose-group-show')];
  toggles[1].click();
  open = false;
  key(label, 'ArrowUp');
  assert.equal(document.activeElement, groupShows[1], 'up from a closed trigger starts at the last visible item');
  key(toggles[1], 'ArrowLeft');
  assert.equal(rows[1].inert, true);
  const sideMenu = document.createElement('div');
  sideMenu.id = 'buret-scene-tree-menu';
  sideMenu.dataset.motion = 'side';
  document.body.append(sideMenu);
  key(toggles[1], 'Escape');
  assert.deepEqual({ open, sideMenusClosed }, { open: true, sideMenusClosed: 1 }, 'Escape closes a menu beside the picker first');
  key(toggles[1], 'Escape');
  assert.equal(open, false);
  assert.equal(document.activeElement, label);
  key(label, 'ArrowDown');
  assert.equal(document.activeElement, groupShows[0]);
  key(toggles[0], 'ArrowLeft');
  groupShows[0].focus();
  key(groupShows[0], 'ArrowDown');
  assert.equal(document.activeElement, groupShows[1], 'collapsed poses are skipped');
  const tooltipControl = runInNewContext(extract('molstarTooltipControlFromEvent') + '\nmolstarTooltipControlFromEvent');
  for (const target of [label, ...toggles, ...fileButtons]) assert.equal(tooltipControl({ target }), null);
  await window.happyDOM.close();
}
console.log('Docking file disclosure preserves pose indices, scores and keyboard exclusion');

// Pose visibility edits: rows show poses for now, the stepper's pose can be
// hidden, a whole file is All, pins survive steps, and failed renders roll back.
{
  const rendered = [];
  let fail = false;
  let visible = [];
  const poseGroups = [{ startFrame: 0, endFrame: 1, frameCount: 2 }, { startFrame: 2, endFrame: 2, frameCount: 1 }];
  const context = {
    activePose: 0, activeSdfPoseMode: 'single', prepared: { poseGroups }, viewer: {}, activeMolstarPrepared: null, poseGroups,
    dockingPinnedPoseState: { indices: new Set(), selected: new Set(), activeHidden: false },
    dockingPinnedPoseIndices: () => context.dockingPinnedPoseState.indices, dockingReferencePoseIndices: () => new Set(),
    setLoopActive() {}, setPose() {}, poseUpdateQueue: Promise.resolve(), molstarStructureFocusSerial: 0,
    setSdfPoseMode: mode => { context.activeSdfPoseMode = mode; context.dockingPinnedPoseState.activeHidden = false; },
    applyDockingPoseCollectionVisibility: async (_viewer, prepared, active) => {
      visible = []; // Rebuild has already cleared the previous scene.
      if (fail) { fail = false; throw new Error('load failed'); }
      visible = [...context.dockingVisiblePoseIndices(prepared, active)].sort();
      rendered.push(visible);
    },
    updateControls() {}, notifyDockingPoseChanged() {}, notifyStructureOverlayModeChanged() {},
    sessionStorage: { setItem() {} }, trajectoryControlStorageKey: () => 'pose', activeConfig: {}, setStatus() {}, console,
  };
  context.activeStructurePoseSetter = context.setPose;
  runInNewContext(extract('dockingVisiblePoseIndices'), context);
  const selectionStart = source.indexOf('    const selectedPoseIndices = () =>');
  const selectionEnd = source.indexOf('    // Dots follow the live colours', selectionStart);
  const editStart = source.indexOf('    const editPoseVisibility = (action, target) => {');
  const editEnd = source.indexOf('    if (fileList) {', editStart);
  const edit = runInNewContext(source.slice(selectionStart, selectionEnd) + source.slice(editStart, editEnd) + '\neditPoseVisibility', context);
  const run = async (action, target) => { edit(action, target); await context.poseUpdateQueue; };
  const state = () => ({ visible, mode: context.activeSdfPoseMode, active: context.activePose, pins: [...context.dockingPinnedPoseState.indices].sort() });
  edit('toggle', 1); edit('toggle', 2);
  await context.poseUpdateQueue;
  assert.deepEqual(rendered, [[0, 1], [0, 1, 2]], 'rapid clicks preserve both ordered changes');
  await run('toggle', 0);
  assert.deepEqual(state(), { visible: [1, 2], mode: 'single', active: 0, pins: [] }, 'the stepper pose can be hidden');
  await run('toggle', [0, 1]);
  assert.deepEqual(state(), { visible: [0, 1, 2], mode: 'all', active: 0, pins: [] }, 'showing the stepper file turns All on');
  await run('toggle', 1);
  assert.deepEqual(state(), { visible: [0, 2], mode: 'single', active: 0, pins: [] }, 'hiding part of All keeps the rest');
  const before = state();
  fail = true;
  await run('only', [2]);
  assert.deepEqual(state(), before, 'rollback restores the model and the scene');
  await run('only', [2]);
  assert.deepEqual(state(), { visible: [2], mode: 'single', active: 2, pins: [] });
  await run('pin', [0, 1]);
  assert.deepEqual(state(), { visible: [0, 1, 2], mode: 'single', active: 2, pins: [0, 1] });
  await run('pin', [0, 1]);
  assert.deepEqual(state(), { visible: [0, 1, 2], mode: 'single', active: 2, pins: [] }, 'unpinned poses stay on screen for now');
}
console.log('Docking pose visibility edits follow pins, sets and All, and recover failed changes');

// All can change through the visible control or the agent action without a
// frame step. Both paths must update the mounted picker, including references.
{
  const window = new Window();
  const document = window.document;
  const root = document.createElement('div');
  root.className = 'buret-docking-poses';
  const label = document.createElement('button');
  const fileList = document.createElement('div');
  const fileButtons = [0, 1, 2].map(() => document.createElement('button'));
  fileList.append(...fileButtons);
  root.append(label, fileList);
  document.body.append(root);
  const pins = new Set([2]);
  const poseGroups = [{ startFrame: 0, endFrame: 1, frameCount: 2 }, { startFrame: 2, endFrame: 2, frameCount: 1 }];
  const prepared = { kind: 'docking', sdfPoseOverlayAvailable: true, poseCount: 3, poseGroups };
  let visible = [];
  const context = {
    window, document, Event: window.Event, root, label, fileList, fileButtons, fileTargets: [0, 1, 2],
    prepared, poseGroups, activePose: 0, activeSdfPoseMode: 'single', hasPoseGroups: true, hasTrajectorySegments: false,
    dockingPinnedPoseIndices: () => pins, dockingPinnedPoseState: { selected: new Set(), activeHidden: false },
    groupControls: [], poseDots: [], posePins: [], trajectoryControlBounds: () => ({ start: 0, end: 1, count: 2 }),
    activeMolstarViewer: () => null, sceneTreeNodes: () => [], activeDockingPoseCollectionState: null,
    activeTrajectorySegment: () => ({ index: 0, segment: poseGroups[0] }),
    applyLabel() {}, previous: {}, next: {}, slider: { dataset: {} }, storyStep: null,
    refreshNativeTrajectoryStandalonePreview() {}, postHostMessage() {}, activeConfig: {}, loopActive: false,
    updateViewportAnimateState() {}, activeViewer: {}, activeMolstarPrepared: prepared,
    structureOverlayAvailable: () => true, structureOverlayNoun: () => 'poses',
    setSdfPoseMode: mode => { context.activeSdfPoseMode = mode; },
    notifyStructureOverlayModeChanged() {}, updateSdfPoseButton() {}, setStatus() {}, readTrajectoryControlIndex: () => 0,
    notifyChemicalSpaceMolecule() {},
    applyDockingPoseCollectionVisibility: async () => { visible = [...context.selectedPoseIndices()].sort((a, b) => a - b); },
    agentActionFailure: (_command, _code, message) => { throw new Error(message); },
  };
  runInNewContext(extract('dockingVisiblePoseIndices'), context);
  const selectionStart = source.indexOf('    const selectedPoseIndices = () =>');
  const selectionEnd = source.indexOf('    const isFileListOpen =', selectionStart);
  Object.assign(context, runInNewContext(source.slice(selectionStart, selectionEnd)
    + '\n({ selectedPoseIndices, updateControls, setFileListOpen })', context));
  runInNewContext(extract('reloadSdfPoseMode') + extract('toggleSdfPoseMode') + extract('setSdfPoseModeFromAction'), context);
  const reload = context.reloadSdfPoseMode;
  let modeChange;
  context.reloadSdfPoseMode = () => (modeChange = reload());
  const checks = () => fileButtons.map(button => button.getAttribute('aria-checked'));
  try {
    context.updateControls();
    assert.deepEqual(checks(), ['true', 'false', 'true']);
    context.toggleSdfPoseMode();
    await modeChange;
    assert.deepEqual({ visible, checked: checks() }, { visible: [0, 1, 2], checked: ['true', 'true', 'true'] });
    context.toggleSdfPoseMode();
    await modeChange;
    assert.deepEqual({ visible, checked: checks() }, { visible: [0, 2], checked: ['true', 'false', 'true'] });
    await context.setSdfPoseModeFromAction({ mode: 'all' });
    assert.deepEqual(checks(), ['true', 'true', 'true']);
    await context.setSdfPoseModeFromAction({ mode: 'single' });
    assert.deepEqual(checks(), ['true', 'false', 'true']);
    context.activeSdfPoseMode = 'all';
    context.setFileListOpen(true);
    assert.deepEqual(checks(), ['true', 'true', 'true'], 'reopening the menu resynchronizes selection without a frame step');
  } finally { await window.happyDOM.close(); }
}
console.log('Docking All control and agent changes keep picker checks synchronized');
