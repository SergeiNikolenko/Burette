import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const fn = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const dependencies = {
  activeSdfCollectionVisibilityState: null, activeDockingPoseCollectionState: null, activeXyzFrameOverlayState: null,
  molstarStoryState: () => ({ available: false }), sceneTreeColorTargets: () => new Map(),
  sceneTreeMeasurementTargets: () => [], sceneTreeMeasurementSource: () => '',
  sceneTreeMeasurementValue: () => undefined,
  sceneTreeRowLabel: (_cell, label) => ({ label }),
};
const read = new Function(...Object.keys(dependencies),
  ['sceneTreeChildRefs', 'isSceneTreeDecorator', 'sceneTreeCellHidden', 'sceneTreeNodes'].map(fn).join('\n') + '\nreturn sceneTreeNodes;')(...Object.values(dependencies));
const cells = new Map();
const add = (ref, parent, name, label, data = {}, transformer = '', decorator = false) => cells.set(ref, {
  transform: { ref, parent, transformer: { id: transformer, definition: { isDecorator: decorator } } },
  obj: { type: { name, typeClass: name === 'Null' ? 'Null' : 'Object' }, label, data }, state: {},
});
add('root', 'root', 'Root', 'Root');
add('file', 'root', 'Data', 'mini.pdb');
add('trajectory', 'file', 'Trajectory', 'mini.pdb', { frameCount: 1 });
add('model', 'trajectory', 'Model', 'Model 1');
add('model-props', 'model', 'Model', 'Model 1', {}, '', true);
add('structure', 'model-props', 'Structure', 'Model', { elementCount: 9 }, 'ms-plugin.structure-from-model');
add('all', 'structure', 'Structure', 'All', { elementCount: 9 });
add('rep', 'all', 'Representation', 'Ball & Stick');
add('surface', 'structure', 'Structure', 'Surface', { elementCount: 4 });
add('surface-rep', 'surface', 'Representation', 'Molecular Surface');
add('empty', 'structure', 'Null', 'Null');
add('zero', 'structure', 'Structure', 'Empty', { elementCount: 0 });
add('measurements', 'root', 'Group', 'Measurements');
add('distance', 'measurements', 'Measurement', 'Distance');
const viewer = { plugin: { state: { data: { cells } } } };
const shape = nodes => nodes.map(({ ref, children }) => [ref, shape(children)]);
const before = JSON.stringify([...cells]);
assert.deepEqual(shape(read(viewer)), [
  ['file', [['all', [['rep', []]]], ['surface', [['surface-rep', []]]]]],
  ['measurements', [['distance', []]]],
]);
assert.equal(JSON.stringify([...cells]), before, 'presentation never modifies scientific state');
cells.get('trajectory').obj.data.frameCount = 2;
add('model2', 'trajectory', 'Model', 'Model 2');
add('structure2', 'model2', 'Structure', 'Model', { elementCount: 9 }, 'ms-plugin.structure-from-model');
add('all2', 'structure2', 'Structure', 'All', { elementCount: 9 });
assert.deepEqual(shape(read(viewer))[0], ['file', [['trajectory', [
  ['model-props', [['all', [['rep', []]]], ['surface', [['surface-rep', []]]]]],
  ['model2', [['all2', []]]],
]]]]);
add('assembly', 'model2', 'Structure', 'Assembly 1', { elementCount: 18 }, 'ms-plugin.structure-from-model');
assert.deepEqual(shape(read(viewer))[0][1][0][1][1], ['model2', [
  ['structure2', [['all2', []]]], ['assembly', []],
]]);
add('named-null', 'file', 'Group', 'Null');
assert.ok(read(viewer)[0].children.some(node => node.ref === 'named-null'), 'a user label is not an empty state object');

// The visible file row holds raw data, while its geometry lives several cells
// below it. Focus must stay inside that file, even beside a much larger receptor.
const ligandSphere = { center: [2, 3, 4], radius: 3 };
const receptorSphere = { center: [0, 0, 0], radius: 40 };
const transformedSphere = { center: [12, 3, 4], radius: 3 };
cells.get('structure').obj.data.boundary = { sphere: ligandSphere };
cells.get('all').obj.data.boundary = { sphere: ligandSphere };
cells.get('surface').obj.data.boundary = { sphere: { center: [2, 3, 4], radius: 1 } };
add('receptor', 'root', 'Data', 'receptor.pdb');
add('receptor-structure', 'receptor', 'Structure', 'Receptor', { boundary: { sphere: receptorSphere } });
const focused = [];
const camera = {
  focusSpheres: (targets, sphere, options) => focused.push({ spheres: targets.map(sphere), options }),
  focusLoci: (loci, options) => focused.push({ loci, options }),
};
viewer.plugin.managers = { camera };
const focus = new Function('activeMolstarViewer', 'debug',
  ['sceneTreeChildRefs', 'isSceneTreeDecorator', 'focusSceneTreeNode'].map(fn).join('\n') + '\nreturn focusSceneTreeNode;')(() => viewer, error => { throw new Error(error); });
focus('file');
assert.deepEqual(focused.pop(), { spheres: [ligandSphere], options: { durationMs: 250 } });
focus('receptor');
assert.deepEqual(focused.pop(), { spheres: [receptorSphere], options: { durationMs: 250 } });
focus('surface');
assert.deepEqual(focused.pop().spheres, [cells.get('surface').obj.data.boundary.sphere]);
add('transformed', 'structure', 'Structure', 'Model', { boundary: { sphere: transformedSphere } }, '', true);
focus('file');
assert.deepEqual(focused.pop().spheres, [transformedSphere], 'focus uses the decorated structure coordinates');
const loci = { kind: 'element-loci', elements: [] };
cells.get('distance').obj.data = [{ loci }];
focus('distance');
assert.deepEqual(focused.pop(), { loci: [loci], options: { durationMs: 250 } });
console.log('Scene presentation: empty cells hidden, single-model plumbing flattened, multiple models and assemblies preserved');
