import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Story tree hides import plumbing and empty components without changing state', async () => {
  const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
  const body = source.match(/function sceneTreeNodes\(viewer\) \{[\s\S]*?\n  \}/)[0];
  const cells = new Map();
  const children = new Map();
  function node(ref, parent, name, transformer = '', elements) {
    cells.set(ref, { transform: { transformer: { id: transformer } }, obj: { label: ref, type: { name }, data: { elementCount: elements } }, state: {} });
    children.set(parent, [...(children.get(parent) || []), ref]);
  }
  node('receptor', 'root', 'Data');
  node('trajectory', 'receptor', 'Trajectory');
  node('model', 'trajectory', 'Model');
  node('structure', 'model', 'Structure', 'ms-plugin.structure-from-model', 2000);
  node('polymer', 'structure', 'Structure', '', 2000);
  node('cartoon', 'polymer', 'Structure 3D');
  node('empty-ligand', 'structure', 'Structure', '', 0);
  node('pocket', 'structure', 'Structure', '', 49);
  node('contacts', 'root', 'Primitive Data');
  const deps = {
    activeSdfCollectionVisibilityState: null, activeDockingPoseCollectionState: null, activeXyzFrameOverlayState: null,
    sceneTreeChildRefs: () => ({ children, rootRef: 'root' }), sceneTreeColorTargets: () => new Map(),
    isSceneTreeDecorator: () => false, molstarStoryState: () => ({ available: true }),
    sceneTreeMeasurementTargets: () => [], sceneTreeRowLabel: (cell, label) => ({ label }), sceneTreeCellHidden: () => false,
  };
  const build = new Function(...Object.keys(deps), `${body}; return sceneTreeNodes;`)(...Object.values(deps));
  const before = JSON.stringify([...cells]);
  const tree = build({ plugin: { state: { data: { cells } } } });
  assert.deepEqual(tree.map(n => [n.ref, n.children.map(c => c.ref)]), [['receptor', ['polymer', 'pocket']], ['contacts', []]]);
  assert.equal(tree[0].children[0].children[0].ref, 'cartoon');
  assert.equal(JSON.stringify([...cells]), before);
});

test('docking Story retains measured distances without residue-name labels or custom molecular styling', async () => {
  const story = JSON.parse(await readFile(new URL('../samples/mvs/docking_story.mvsj', import.meta.url), 'utf8'));
  for (const step of story.snapshots) {
    const nodes = [];
    function walk(n) { nodes.push(n); for (const c of n.children || []) walk(c); }
    walk(step.root);
    assert.equal(nodes.some(n => n.kind === 'opacity'), false);
    assert.equal(nodes.some(n => n.custom?.molstar_color_theme_params?.carbonColor), false);
    const distances = nodes.filter(n => n.kind === 'primitive');
    assert.equal(distances.length, 6);
    for (const { params } of distances) {
      assert.equal(params.kind, 'distance_measurement');
      const measured = Math.hypot(...params.start.map((value, i) => value - params.end[i]));
      assert.equal(params.label_template, `${measured.toFixed(1)} Å`);
    }
    const environment = nodes.find(n => n.ref === 'burette-environment');
    assert.ok(environment.params.selector.length > 0);
    assert.equal(environment.children, undefined);
    assert.match(step.metadata.description, /Computed contacts/);
  }
});
