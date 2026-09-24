import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const layout = readFileSync(new URL('../apps/desktop/src/components/app-layout.tsx', import.meta.url), 'utf8');
const visibility = layout.match(/const sidebarVisible = (.*);/)[1];
for (const native of [false, true]) for (const settingsMode of [false, true]) for (const sidebarOpen of [false, true]) {
  const visible = runInNewContext(visibility, { window: { BuretteMcpWorkspace: native }, settingsMode, hostedMcpWidget: false, state: { sidebarOpen } });
  assert.equal(visible, !native && (settingsMode || sidebarOpen));
}
assert.doesNotMatch(layout, /native-workspace-tabs/);
assert.match(layout, /useInitialSize\(sidebarVisible \? sidebarWidth : 0\)/);
assert.match(layout, /useCollapsiblePanelSync\(sidebarVisible, sidebarWidth\)/);

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const start = source.indexOf('  function molstarCurrentSelectionContext()');
const end = source.indexOf('  function installMolstarSelectionPreviewSync(', start);
const manager = { stats: { elementCount: 2 }, entries: new Map() };
const unit = { id: 1, model: {}, elements: [0, 1] };
manager.entries.set('protein', { selection: { elements: [{ unit, indices: [0, 1] }] } });
let level = 'residue';
const context = { window: {}, activeMolstarViewer: () => ({ plugin: { managers: { structure: { selection: manager } }, canvas3dContext: { canvas: {} } } }),
  molstarContextOrderedSetForEach: (indices, callback) => { for (const i of indices) if (callback(i) === false) break; },
  molstarContextAtomFromModelIndex: (_model, i) => ({ auth_asym_id: 'A', auth_seq_id: 336, auth_comp_id: 'MET', auth_atom_id: `C${i}`, atomIndex: i }),
  molstarSelectionLevel: () => level,
};
const selection = runInNewContext(source.slice(start, end) + '\nmolstarCurrentSelectionContext', context);
assert.equal(selection().residues[0].compId, 'MET', 'Protein picks must not depend on a ligand preview');
assert.equal(selection().atoms, 2);
assert.equal(selection().level, 'residue');
level = 'chain';
assert.equal(selection().level, 'chain');
manager.stats.elementCount = 150;
unit.elements = Array.from({ length: 150 }, (_, i) => i);
manager.entries.get('protein').selection.elements[0].indices = unit.elements;
assert.equal(selection().atomIdentities.length, 96);
assert.equal(selection().truncated, true);
manager.stats.elementCount = 0;
assert.equal(selection(), null, 'Deselection clears the composer selection');
console.log('Native layout, protein selection and bounded identities passed');
