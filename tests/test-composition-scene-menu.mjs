import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}

// Exercise the actual query splitter: opening the editor must preserve hidden
// state, representation parameters, sibling atoms and the user's selection.
const data = atoms => ({ atoms, elementCount: atoms.length });
const params = { type: { name: 'ball-and-stick', params: { alpha: 0.4 } }, colorTheme: { name: 'element-symbol' } };
const component = (ref, atoms, hidden = false) => ({
  cell: { transform: { ref }, obj: { data: data(atoms), label: ref }, state: { isHidden: hidden } },
  representations: [{ cell: { transform: { ref: `${ref}-rep`, parent: ref, transformer: 'representation', params },
    params: { values: params }, obj: { label: 'Ball & Stick' }, state: { isHidden: true } } }],
});
const original = component('both-chains', [1, 2, 3, 4], true);
const hierarchy = { cell: { obj: { data: data([1, 2, 3, 4]) } }, components: [original] };
const cells = new Map();
let selected = 'original selection';
let restored;
const selection = { getSnapshot: () => selected, setSnapshot: value => { restored = value; },
  clear() {}, fromLoci: (_, loci) => { selected = loci.atoms; } };
const manager = {
  canBeModified: () => true,
  async modifyByCurrentSelection(components) {
    for (const entry of components) entry.cell.obj.data = data(entry.cell.obj.data.atoms.filter(atom => !selected.includes(atom)));
  },
  async updateRepresentations() { throw new Error('Opening the menu must not restyle a representation'); },
};
let nextRef = 0;
const plugin = {
  managers: { structure: { component: manager, selection } },
  dataTransaction: action => action(),
  builders: { structure: {
    async tryCreateComponent(_, spec) {
      const ref = `created-${++nextRef}`;
      if (spec.type.name === 'script') return { ref, obj: { data: data([1, 2]) } };
      const entry = component(ref, spec.type.params.atoms);
      entry.representations = [];
      hierarchy.components.push(entry);
      cells.set(ref, entry.cell);
      return { ref, obj: entry.cell.obj };
    },
  } },
  state: { data: {
    cells,
    updateCellState(ref, state) { Object.assign(cells.get(ref).state, state); },
    build() {
      let parent;
      return {
        to(ref) { parent = ref; return this; },
        apply(transformer, values) {
          const entry = hierarchy.components.find(entry => entry.cell.transform.ref === parent);
          const cell = { transform: { ref: `${parent}-rep`, parent, transformer, params: structuredClone(values) },
            params: { values: structuredClone(values) }, obj: { label: 'Ball & Stick' }, state: {} };
          entry.representations.push({ cell }); cells.set(cell.transform.ref, cell); return this;
        },
        delete() { return this; }, async commit() {},
      };
    },
  } },
};
const StructureElement = { Loci: {
  remap: (loci, target) => data(loci.atoms.filter(atom => target.atoms.includes(atom))),
  size: loci => loci.elementCount, toStructure: loci => loci,
}, Bundle: { fromSubStructure: (_, subset) => subset } };
const prepare = new Function('activeMolstarViewer', 'molstarCurrentStructures', 'molstarStructureRuntime', `
  const sceneActionFailure = (command, code, message) => ({ ok: false, command, code, message });
  const normalizeSceneComponentKind = value => value;
  const representationForSceneComponentKind = () => ({});
  const scheduleSceneTreeRender = () => {};
  const sceneTreeSubtreeRefs = (_, ref) => [ref];
  const molstarCompositionQueries = new Map();
  ${functionSource('changeMolstarQueryComponents')}
  return changeMolstarQueryComponents;
`)(() => ({ plugin }), () => [hierarchy], () => ({ StructureElement,
  Structure: { toSubStructureElementLoci: (_, subset) => subset } }));
const action = { query: 'polymer and chain A', componentLabel: 'Chain A', kind: 'polymer', x: 12, y: 30 };
const result = await prepare(action, 'prepare');
assert.equal(result.ok, true);
assert.equal(result.result.splitCount, 1);
const split = hierarchy.components[1];
assert.deepEqual(hierarchy.components.map(entry => entry.cell.obj.data.atoms), [[3, 4], [1, 2]]);
assert.deepEqual(split.representations[0].cell.transform.params, params);
assert.equal(split.cell.state.isHidden, true);
assert.equal(split.representations[0].cell.state.isHidden, true);
assert.equal(restored, 'original selection');
assert.equal((await prepare(action, 'prepare')).result.splitCount, 0);
assert.equal(hierarchy.components.length, 2, 'reopening must not split or duplicate objects again');

// The adapter must invoke the real scene menu and expose every representation,
// not silently apply the first representation's settings to unrelated targets.
const window = new Window();
const document = window.document;
const opened = [];
const open = new Function('window', 'document', 'queueMolstarQueryComponentAction', 'activeMolstarViewer', 'molstarCurrentStructures', 'openSceneTreeMenu', 'sceneActionFailure', `
  ${functionSource('openCompositionSceneMenu')}
  return openCompositionSceneMenu;
`)(window, document, async () => ({ ok: true, result: { componentRefs: ['both-chains', split.cell.transform.ref] } }),
  () => ({}), () => [hierarchy], (ref, x, y) => {
    opened.push({ ref, x, y });
    document.body.innerHTML = '<div id="buret-scene-tree-menu"><div class="buret-tree-menu-header"></div></div>';
  }, (command, code) => ({ ok: false, command, code }));
assert.deepEqual(await open(action), { ok: true, command: 'open_components_menu', result: { targetCount: 2 } });
const picker = document.querySelector('select');
assert.equal(picker.options.length, 2);
picker.value = split.representations[0].cell.transform.ref;
picker.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.deepEqual(opened, [
  { ref: 'both-chains-rep', x: 12, y: 30 },
  { ref: split.representations[0].cell.transform.ref, x: 12, y: 30 },
]);
assert.equal((await open({ ...action, x: NaN })).ok, false);
console.log('Composition opens the scene editor; exact subsets preserve styles, visibility, siblings and selection');
