import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';

const source = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const fn = name => {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const window = new Window();
const document = window.document;
document.body.innerHTML = '<button data-buret-hydrogens></button><button data-buret-hydrogens data-buret-molecule-preview-action="hydrogens"><span class="buret-tooltip"></span></button>';
let complete;
const updates = [];
const manager = { state: { options: { hydrogens: 'all', ignoreLight: true } },
  async setOptions(options) { updates.push(options); await new Promise(resolve => { complete = resolve; }); this.state.options = options; } };
const previews = [], errors = [];
const context = { document, molstarShowHydrogens: true, molstarHydrogensPending: false,
  activeMolstarViewer: () => ({ plugin: { managers: { structure: { component: manager } } } }),
  molstarMoleculePreview: { querySelector: () => document.querySelectorAll('button')[1] },
  molstarMoleculePreviewTarget: { label: 'MOL A 1' }, showMolstarMoleculePreview: target => previews.push(target),
  setStatus: (...args) => errors.push(args), normalizeFormat: value => value,
};
const api = runInNewContext(['setTooltipLabel', 'updateMolstarHydrogenButtons', 'toggleMolstarHydrogens',
  'molstarHydrogenRepresentation', 'molstarPreviewKey', 'addCollectionRepresentation', 'updateCollectionRepresentations']
  .map(fn).join('\n') + '\n({ toggleMolstarHydrogens, molstarHydrogenRepresentation, molstarPreviewKey, addCollectionRepresentation, updateCollectionRepresentations })',
  { ...context, collectionRepresentations: new WeakMap() });
const buttons = [...document.querySelectorAll('button')];
buttons[1].focus();
const toggling = api.toggleMolstarHydrogens();
assert.ok(buttons.every(button => button.disabled));
await api.toggleMolstarHydrogens();
assert.equal(updates.length, 1, 'do not overlap updates during rapid clicks');
complete(); await toggling;
assert.ok(buttons.every(button => !button.disabled && button.getAttribute('aria-pressed') === 'false' && button.getAttribute('aria-label') === 'Show hydrogens'));
assert.equal(manager.state.options.ignoreLight, true);
assert.equal(previews.length, 1);
assert.equal(document.activeElement, buttons[1]);
const sourceEntry = Object.freeze({ format: 'sdf', data: 'source structure' });
const hiddenKey = api.molstarPreviewKey(sourceEntry);

// A new pose and a subsequent cached restyle must both retain the display choice.
let representation;
const params = { type: { name: 'ball-and-stick', params: { ignoreHydrogens: false } }, colorTheme: { params: {} } };
const plugin = { state: { data: { cells: new Map([['r', { transform: { params } }]]), build: () => ({
  to() { return this; }, update(callback) { Object.assign(params, callback(params)); }, async commit() {},
}) } }, builders: { structure: { representation: { async addRepresentation(_, props) { representation = props; return { ref: 'r' }; } } } } };
const structure = { cell: {} };
await api.addCollectionRepresentation(plugin, structure, {}, { type: 'ball-and-stick', typeParams: { sizeFactor: 0.16 }, color: 'element-symbol' }, 0);
assert.equal(representation.typeParams.ignoreHydrogens, true);
await api.updateCollectionRepresentations(plugin, [structure], [{ type: 'ball-and-stick', typeParams: { sizeFactor: 0.2 }, color: 'element-symbol' }]);
assert.equal(params.type.params.ignoreHydrogens, true);
assert.equal(params.type.params.sizeFactor, 0.2);
const restore = api.toggleMolstarHydrogens(); complete(); await restore;
assert.ok(buttons.every(button => button.getAttribute('aria-pressed') === 'true' && button.getAttribute('aria-label') === 'Hide hydrogens'));
assert.notEqual(api.molstarPreviewKey(sourceEntry), hiddenKey, 'cache entries must distinguish hydrogen visibility');
assert.equal(api.molstarHydrogenRepresentation({}).typeParams.ignoreHydrogens, false);
assert.deepEqual(sourceEntry, { format: 'sdf', data: 'source structure' });
assert.deepEqual(errors, []);
console.log('Shared H controls, rapid clicks, pose representations, cached restyling and depiction cache passed');
