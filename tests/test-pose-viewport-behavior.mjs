import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
function section(start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0, start);
  const limit = source.indexOf(end, offset + start.length);
  assert.ok(limit > offset, end);
  return source.slice(offset, limit);
}
const cameraSource = section('  function captureMolstarCameraSnapshot(', '  // Used when the style switch');
const immediateRestoreSource = section('  function restoreMolstarCameraSnapshotNow(', '  async function waitForMolstarPresetPreviewDraw(');
const poseSource = section('    const performSetPose = async ', '    if (fileList) {');
const postprocessingSource = section('  async function applyMolstarNonIllustrativePostprocessing(', '  async function applyMolstarStyle(');

function poseHarness({ manualReset = false, fail = false, beforePoseCommit = async () => {} } = {}) {
  const initial = { radius: 8, radiusMax: 100, target: [3, 2, 1], position: [9, 8, 7], up: [0, 1, 0] };
  let state = structuredClone(initial);
  let pendingReset = null;
  let scenePending = false;
  const frames = [];
  const errors = [];
  let focusCalls = 0;
  // Mol* resolves camera resets only after the scene is committed, potentially
  // after the async pose setter has returned. Immediate setState cannot clear it.
  const canvas3d = {
    props: { camera: { manualReset } },
    camera: {
      getSnapshot: () => structuredClone(state),
      setState: (snapshot) => { state = structuredClone(snapshot); },
    },
    setProps: ({ camera }) => { if (camera) Object.assign(canvas3d.props.camera, camera); },
    requestDraw() {},
    requestCameraReset: ({ snapshot }) => { pendingReset = snapshot; },
    commit() {
      if (scenePending && !canvas3d.props.camera.manualReset && !pendingReset) {
        pendingReset = { ...initial, target: [90, 90, 90] };
      }
      scenePending = false;
      if (pendingReset) { state = structuredClone(pendingReset); pendingReset = null; }
      frames.push(structuredClone(state));
    },
  };
  const context = vm.createContext({
    viewer: { plugin: { canvas3d } },
    prepared: { kind: 'docking', sdfPoseOverlayAvailable: true, poseCount: 3 },
    activeMolstarPrepared: null, activePose: 0, activeConfig: {},
    previous: {}, next: {}, loopActive: false,
    sessionStorage: { setItem() {} }, trajectoryControlStorageKey: () => 'pose',
    applyLabel() {}, updateControls() {}, notifyDockingPoseChanged() {},
    console: { error: (error) => errors.push(error) },
    scheduleMolstarStructureFocus: () => { focusCalls++; },
    applyDockingPoseCollectionVisibility: async () => {
      await beforePoseCommit(canvas3d);
      scenePending = true;
      canvas3d.commit(); // A render while the new ligand is being built.
      await Promise.resolve();
      scenePending = true; // The final geometry is committed on the next frame.
      if (fail) throw new Error('pose load failed');
    },
  });
  vm.runInContext(cameraSource + immediateRestoreSource + poseSource + '\nglobalThis.setPose = performSetPose;', context);
  return { context, canvas3d, frames, initial, errors, focusCalls: () => focusCalls };
}

test('Prev/Next, Loop, and action pose selection preserve every rendered camera frame', async () => {
  for (const manualReset of [false, true]) {
    const harness = poseHarness({ manualReset });
    for (const [index, options] of [[1, { userStep: true }], [2, { loopStep: true }], [0, {}]]) {
      await harness.context.setPose(index, options);
      harness.canvas3d.commit();
      assert.equal(harness.context.activePose, index);
      assert.equal(harness.canvas3d.props.camera.manualReset, manualReset);
    }
    assert.deepEqual(harness.frames, harness.frames.map(() => harness.initial));
    assert.equal(harness.focusCalls(), 0);
    assert.deepEqual(harness.errors, []);
  }
});

test('failed pose changes also preserve the viewport and restore camera policy', async () => {
  const harness = poseHarness({ fail: true });
  await harness.context.setPose(1);
  harness.canvas3d.commit();
  assert.equal(harness.context.activePose, 0);
  assert.equal(harness.errors.length, 1);
  assert.deepEqual(harness.frames, harness.frames.map(() => harness.initial));
  assert.equal(harness.canvas3d.props.camera.manualReset, false);
});

test('explicit focus remains available', async () => {
  const harness = poseHarness();
  await harness.context.setPose(1, { focus: true });
  assert.equal(harness.focusCalls(), 1);
  assert.equal(harness.canvas3d.props.camera.manualReset, false);
});

test('pose updates keep camera input received while geometry is loading, including failures', async () => {
  for (const manualReset of [false, true]) {
    for (const fail of [false, true]) {
      let rotated;
      const harness = poseHarness({ manualReset, fail, beforePoseCommit: async (canvas) => {
        rotated = { ...canvas.camera.getSnapshot(), position: [7, 8, -9], up: [1, 0, 0] };
        canvas.camera.setState(rotated);
      } });
      await harness.context.setPose(1, { loopStep: true });
      harness.canvas3d.commit();
      assert.deepEqual(harness.canvas3d.camera.getSnapshot(), rotated);
      const firstRotatedFrame = harness.frames.findIndex(frame => frame.position[2] === -9);
      assert.ok(firstRotatedFrame >= 0, 'the user rotation must reach the renderer');
      assert.deepEqual(harness.frames.slice(firstRotatedFrame), harness.frames.slice(firstRotatedFrame).map(() => rotated));
      assert.equal(harness.canvas3d.props.camera.manualReset, manualReset);
      assert.equal(harness.context.activePose, fail ? 0 : 1);
    }
  }
});

test('Loop advances while the viewport pointer is held and serializes slow pose loads', async () => {
  let releaseLoad;
  const harness = poseHarness({ beforePoseCommit: () => new Promise(resolve => { releaseLoad = resolve; }) });
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const listeners = new Map();
  class ViewportElement { closest(selector) { return selector === '.msp-viewport' ? this : null; } }
  Object.assign(harness.context, {
    playbackRestore: null, Element: ViewportElement, onKeyDown() {},
    speed: { value: '10' }, trajectoryFpsToDelay: () => 100,
    minimumTrajectoryLoopTimerDelay: () => 16,
    trajectoryControlBounds: () => ({ start: 0, count: 3 }),
    performance: { now: () => now },
    window: {
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      addEventListener(type, callback) { listeners.set(type, callback); },
      removeEventListener(type) { listeners.delete(type); },
    },
  });
  vm.runInContext(
    section('    let loopTimer = null;', '    let poseRepeatDelayTimer = null;')
    + section('    const loopDelayMs = () => {', '    const trajectoryPlaybackControl = {')
    + section('    const setPose = (index, options = {}) => {', '    const performSetPose = async ')
    + section("    window.addEventListener('keydown', onKeyDown);", '    mainRow.append(animation, previous, label, next);')
    + '\nloopActive = true; scheduleLoopStep();', harness.context);
  listeners.get('pointerdown')?.({ target: new ViewportElement() });
  const tick = async (time) => {
    now = time;
    assert.equal(timers.size, 1, 'only one playback timer should be pending');
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
    await new Promise(resolve => setImmediate(resolve));
  };
  await tick(100);
  assert.equal(typeof releaseLoad, 'function', 'holding the scene must not block a pose load');
  assert.equal(timers.size, 0, 'a slow load must finish before the next tick is scheduled');
  releaseLoad();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.context.activePose, 1);
  await tick(200);
  releaseLoad();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.context.activePose, 2, 'playback continues without releasing the pointer');
  listeners.get('pointerup')?.({});
  await tick(300);
  releaseLoad();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.context.activePose, 0, 'playback wraps normally after the drag');
  assert.equal(harness.focusCalls(), 0);
  assert.deepEqual(harness.errors, []);
});

test('reapplying pose lighting does not update receptor and water components globally', async () => {
  let updates = 0;
  const component = {
    state: { options: { ignoreLight: false } },
    async setOptions(options) { updates++; this.state.options = options; },
  };
  const viewer = { plugin: { managers: { structure: { component } }, canvas3d: {
    props: { postprocessing: { outline: { name: 'off' }, occlusion: { name: 'off' } } },
    setProps() {},
  } } };
  const context = vm.createContext({ resetMolstarPostprocessing() {}, normalizeMolstarStyle: (style) => style,
    applyMolstarPolymerLigandRepresentationToStructures: async () => {},
    sdfCollectionCartoonRepresentation() {}, sdfCollectionLigandRepresentationForStyle() {},
  });
  vm.runInContext(postprocessingSource + section('  async function applySdfCollectionMolstarStyle(', '  function sdfCollectionAlphaHelpers('), context);
  const stylePose = (style) => context.applySdfCollectionMolstarStyle(viewer, style, [{}]);
  for (let i = 0; i < 3; i++) await stylePose('default');
  assert.equal(updates, 0, 'unchanged lighting must not touch the receptor or water');
  await stylePose('illustrative');
  assert.equal(updates, 1, 'an actual style change must still update lighting');
  for (let i = 0; i < 3; i++) await stylePose('illustrative');
  assert.equal(updates, 1);
  await stylePose('default');
  assert.equal(updates, 2);
});

test('new ligand representations inherit current options without restyling existing waters', async () => {
  const options = { hydrogens: 'only-polar', visualQuality: 'high', ignoreLight: true,
    materialStyle: { roughness: 0.5 }, clipObjects: {}, interior: {} };
  const calls = [];
  const plugin = {
    managers: { structure: { component: { state: { options } } } },
    builders: { structure: { representation: { addRepresentation: async (...args) => calls.push(args) } } },
  };
  const context = vm.createContext({ debug: (error) => { throw new Error(error); } });
  vm.runInContext(section('  async function addMolstarRepresentation(', '  async function applyMolstarUniformRepresentation('), context);
  await context.addMolstarRepresentation(plugin, { cell: 'ligand' }, { type: 'ball-and-stick', typeParams: { alpha: 0.5 } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['ligand', {
    type: 'ball-and-stick', typeParams: { ignoreHydrogens: true, ignoreHydrogensVariant: 'non-polar',
      quality: 'high', ignoreLight: true, material: options.materialStyle, clip: {}, interior: {}, alpha: 0.5 },
  }]]);
});

test('docking pose swaps retain receptor, water identity, and water visibility', async () => {
  let structures = [];
  let waterBuilds = 0;
  let clears = 0;
  const viewer = { plugin: { builders: { data: { rawData() {} }, structure: {
    parseTrajectory() {}, hierarchy: { applyPreset() {} },
  } }, clear: async () => { structures = []; clears++; } } };
  const context = vm.createContext({
    activeConfig: {}, activeSdfPoseMode: 'single', activeDockingPoseCollectionState: null,
    document: { querySelector() {} }, configuredMolstarStyle: () => 'default',
    readSdfCollectionContextStyle: () => 'line', dockingSceneBackgroundStyle: (style) => style,
    readSdfCollectionContextOpacity: () => 0.2, readSdfCollectionContextColor: () => 'gray',
    xyzFrameOverlayRawSignature: (data) => data, resetXyzFrameOverlayState() {}, resetSdfCollectionVisibilityState() {},
    molstarStructureRefsOf: (items) => items.map((item) => item.ref),
    molstarStructuresByRefs: (_, refs) => structures.filter((item) => refs.includes(item.ref)),
    molstarRefsStillLoaded: (_, refs) => refs.every((ref) => structures.some((item) => item.ref === ref)),
    removeMolstarStructures: async (_, items) => { structures = structures.filter((item) => !items.includes(item)); },
    loadMolstarEntryWithStructureRefs: async (_, entry) => {
      const structure = { ref: entry.label };
      structures.push(structure);
      return [structure];
    },
    applySdfCollectionMolstarStyle: async () => {},
    applyMolstarWaterLineRepresentation: async () => {
      waterBuilds++;
      structures[0].water = { visible: true };
    },
    updateStructureOverlayToggleButton() {}, scheduleMolstarStructureFocus() {},
  });
  vm.runInContext(section('  function dockingPoseCollectionStateKey(', '  function applyXyzFrameOverlayVisibility('), context);
  const prepared = { kind: 'docking', receptorEntry: { label: 'receptor', data: 'receptor with water' },
    poses: [{ label: 'pose-1' }, { label: 'pose-2' }, { label: 'pose-3' }] };
  const swap = (index) => context.applyDockingPoseCollectionVisibilityNow(viewer, prepared, index, { focus: false });
  await swap(0);
  const receptor = structures[0];
  const water = receptor.water;
  for (const visible of [true, false]) {
    water.visible = visible;
    for (const index of [1, 2, 0, 0]) {
      await swap(index);
      assert.equal(structures[0], receptor);
      assert.equal(receptor.water, water);
      assert.equal(water.visible, visible);
      assert.equal(structures[1].ref, prepared.poses[index].label);
    }
  }
  assert.equal(waterBuilds, 1);
  assert.equal(clears, 1);
});
