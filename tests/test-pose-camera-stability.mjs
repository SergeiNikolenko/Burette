import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const fn = source.match(/\n  async function switchCachedPoseLayer\([\s\S]*?\n  \}/u)[0];
for (const fail of [false, true]) {
  for (const initialManualReset of [false, true]) {
    const saved = { position: [8, 3, 10], target: [1, 2, 3], up: [0, 1, 0], radius: 6 };
    let camera = structuredClone(saved);
    const canvas3d = {
      props: { camera: { manualReset: initialManualReset } },
      setProps({ camera: props }) { Object.assign(this.props.camera, props); },
      commit() {
        if (!this.props.camera.manualReset) camera = { position: [0, 0, 100], radius: 30 };
      },
    };
    const structures = [{ cell: { transform: { ref: 'new-structure' } } }];
    const viewer = { plugin: {
      canvas3d,
      state: { data: {
        cells: new Map(), tree: { children: new Map([['old-trajectory', ['old-structure']]]) },
        build: () => ({ delete() { return this; }, async commit() { canvas3d.commit(); } }),
      } },
      builders: {
        data: { rawData: async () => ({ ref: 'new-raw' }) },
        structure: { hierarchy: { applyPreset: async () => { canvas3d.commit(); } } },
      },
    } };
    const state = { activeIndex: 0, poseCache: new Map([[0, { raw: { ref: 'old-raw' }, trajectories: [{ ref: 'old-trajectory' }], sourceBytes: 100 }]]) };
    const bindings = {
      captureMolstarCameraSnapshot: () => structuredClone(camera),
      normalizeFormat: format => format,
      parseMolstarStructureTrajectories: async () => [{ ref: 'new-trajectory' }],
      molstarStructureCellRefs: () => new Set(),
      molstarCurrentStructures: () => structures,
      molstarStructureRefsOf: items => items.map(item => item.cell.transform.ref),
    };
    const switchPose = new Function(...Object.keys(bindings), `${fn}; return switchCachedPoseLayer;`)(...Object.values(bindings));
    const operation = switchPose(viewer, state, 1, { data: 'pose', format: 'pdb', label: 'Pose 2' }, async () => {
      canvas3d.commit();
      assert.deepEqual(camera, saved, 'Camera must not move while replacement geometry is built');
      // Simulate a camera drag while a frame is being rebuilt.
      camera.position = [12, 4, 9];
      if (fail) throw Error('Representation failed');
    });
    if (fail) await assert.rejects(operation, /Representation failed/);
    else {
      await operation;
      assert.equal(state.activeIndex, 1);
      assert.deepEqual(state.activeRefs, ['new-structure']);
    }
    assert.deepEqual(camera, { ...saved, position: [12, 4, 9] }, 'Live camera input must survive pose replacement');
    assert.equal(canvas3d.props.camera.manualReset, initialManualReset);
  }
}
console.log('pose camera remains stable through replacement and failure');

// WKWebView can withhold rAF callbacks while the initial canvas is hidden.
// Startup must still reveal the viewer instead of waiting for its own visibility.
{
  const createSource = source.match(/\n  async function createViewer\([\s\S]*?\n  \}/u)[0];
  const waitSource = source.match(/\n  function waitForAnimationFrame\([\s\S]*?\n  \}/u)[0];
  const classes = new Set();
  const viewer = { plugin: { spec: {}, canvas3d: { setProps() {}, requestDraw() {} } } };
  const bindings = {
    window: { molstar: { Viewer: { create: async () => viewer } } },
    document: { getElementById: () => ({ classList: { add: name => classes.add(name), remove: name => classes.delete(name) } }) },
    debug() {}, createViewerOptions: () => ({}), transparentBackground: false,
    canvasBackgroundColor: () => 0, requestAnimationFrame() {},
    setTimeout: callback => setTimeout(callback, 1),
  };
  const create = new Function(...Object.keys(bindings), `${waitSource}\n${createSource}; return createViewer;`)(...Object.values(bindings));
  let timeout;
  try {
    const result = await Promise.race([create(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Hidden canvas blocked startup')), 500); })]);
    assert.equal(result, viewer);
    assert.equal(classes.size, 0);
    assert.equal(viewer.plugin.spec.components.sequenceViewer.defaultMode, 'all');
  } finally { clearTimeout(timeout); }
}
console.log('hidden WebKit canvas does not block viewer startup');

// Grid entries must remain separate molecules and retain multiple bonds.
{
  const names = ['buildSdfGrid', 'spreadSdfCollectionMolecules', 'parseV2000SdfRecord', 'parseV3000SdfRecord', 'parseSdfAtomLine', 'parseSdfBondLine', 'normalizeSdfElement', 'normalizeSdfBondOrder', 'formatV3000Coord'];
  const functions = names.map(name => source.match(new RegExp(`\\n  function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'))[0]).join('\n');
  const build = new Function(`const MAX_SDF_GRID_MOLECULES=64, MAX_SDF_GRID_ATOMS=900, MAX_SDF_GRID_BONDS=900, SDF_GRID_PADDING=4; ${functions}; return {buildSdfGrid,parseV3000SdfRecord,spreadSdfCollectionMolecules};`)();
  const record = ['Example', '  Test', '', '  0  0  0     0  0            999 V3000', 'M  V30 BEGIN CTAB', 'M  V30 COUNTS 2 1 0 0 0', 'M  V30 BEGIN ATOM', 'M  V30 1 C 0 0 0 0', 'M  V30 2 O 1 0 0 0', 'M  V30 END ATOM', 'M  V30 BEGIN BOND', 'M  V30 1 2 1 2', 'M  V30 END BOND', 'M  V30 END CTAB', 'M  END'].join('\n');
  const prepared = build.buildSdfGrid([record, record], 'set.sdf');
  assert.equal(prepared.gridEntries.length, 2);
  const molecules = prepared.gridEntries.map(entry => build.parseV3000SdfRecord(entry.data));
  assert.deepEqual(molecules.map(m => [m.atomCount, m.bonds[0].order]), [[2, 2], [2, 2]]);
  assert.ok(molecules[1].centerX - molecules[0].centerX >= 4);
  const aligned = molecules.map(m => ({ ...m, atoms: m.atoms.map(atom => ({ ...atom, x: atom.x + 1000, y: atom.y - 1000 })) }));
  const spreadAgain = build.spreadSdfCollectionMolecules(aligned);
  assert.deepEqual(spreadAgain.map(m => m.atoms), molecules.map(m => m.atoms), 'Spread uses current aligned coordinates, not stale parsed bounds');
  const loaded = [];
  const bindings = {
    cancelScheduledMolstarWaterRepresentation() {}, updateSdfPoseButton() {}, notifyStructureOverlayModeChanged() {},
    loadMolstarEntryWithStructureRefs: async (_, entry) => loaded.push(entry),
    applyMolstarStyle: async () => {}, configuredMolstarStyle: () => 'default',
    installDockingPoseControls() {},
  };
  const loadSource = source.match(/\n  async function loadPreparedStructure\([\s\S]*?\n  \}/u)[0];
  const load = new Function(...Object.keys(bindings), `let activeMolstarPrepared, activeDockingPrepared, activeConfig; ${loadSource}; return loadPreparedStructure;`)(...Object.values(bindings));
  await load({}, prepared);
  assert.deepEqual(loaded, prepared.gridEntries);
}
console.log('grid molecules load independently with bond orders preserved');
