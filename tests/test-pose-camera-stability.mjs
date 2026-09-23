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
