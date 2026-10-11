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
console.log('Scene presentation: empty cells hidden, single-model plumbing flattened, multiple models and assemblies preserved');
