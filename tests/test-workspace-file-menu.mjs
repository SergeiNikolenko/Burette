import assert from 'node:assert/strict';
import { workspaceFileMenu } from '../apps/desktop/src/components/workspace-file-menu.ts';
import { withMenuIcons } from '../apps/desktop/src/components/menu-icons.ts';

const called = [];
const state = { documents: [], pinnedStructurePaths: [] };
const actions = new Proxy({}, { get: (_, name) => (...args) => { called.push([name, ...args]); } });
const workflows = { sceneTargets: () => [{ id: 'scene-a', title: 'Protein' }], addToScene: (...args) => called.push(['addToScene', ...args]), openAligned() {}, gridView() {}, copyNames() {} };
const run = action => action;
const openBatch = (paths, mode) => called.push(['batch', paths, mode]);
const flatten = items => items.flatMap(item => item.kind === 'submenu' ? [item, ...flatten(item.items)] : [item]);
const pdbs = ['/protein.pdb', '/variant.cif'];
const menu = withMenuIcons(workspaceFileMenu(pdbs, state, actions, workflows, [], run, openBatch));
const commands = flatten(menu);
commands.find(item => item.id === 'open-together').action();
assert.deepEqual(called.pop(), ['batch', pdbs, 'scene']);
commands.find(item => item.id === 'add-scene-0').action();
assert.deepEqual(called.pop(), ['addToScene', pdbs, { id: 'scene-a', title: 'Protein' }]);
commands.find(item => item.id === 'open-right').action();
assert.deepEqual(called.pop(), ['openDockPayload', { area: 'right', tabKind: 'files', payload: { paths: pdbs, records: [], items: [
  { kind: 'file', path: '/protein.pdb', title: 'protein.pdb' }, { kind: 'file', path: '/variant.cif', title: 'variant.cif' },
] } }]);
for (const command of commands.filter(item => item.kind === 'item' || item.kind === 'submenu')) assert.ok(command.iconUrl?.startsWith('data:image/svg+xml'), `Missing SDK icon: ${command.id}`);
const mixed = flatten(workspaceFileMenu(['/notes.txt', '/ligand.sdf'], state, actions, { ...workflows, sceneTargets: () => [] }, [], run, openBatch));
assert.ok(!mixed.some(item => ['open-together', 'open-poses', 'open-aligned', 'add-scene'].includes(item.id)));
mixed.find(item => item.id === 'open-tabs').action();
assert.deepEqual(called.pop(), ['batch', ['/notes.txt', '/ligand.sdf'], 'tabs']);
const table = flatten(workspaceFileMenu(['/library.csv'], state, actions, { ...workflows, sceneTargets: () => [], gridView: (...args) => called.push(['gridView', ...args]) }, [], run, openBatch));
table.find(item => item.id === 'open-cards').action();
assert.deepEqual(called.pop(), ['gridView', '/library.csv', 'cards']);
assert.ok(!table.some(item => item.id === 'open-3d'));
for (const extension of ['pdb', 'ent', 'cif', 'mcif', 'sdf', 'sd', 'xyz']) {
  const path = `/structure.${extension}`;
  const modes = flatten(withMenuIcons(workspaceFileMenu([path], state, actions, workflows, [], run, openBatch)));
  for (const [id, label, renderer] of [['open-3d', 'Interactive 3D', 'molstar'], ['open-xyzrender', '3D render', 'xyzrender-external']]) {
    const option = modes.find(item => item.id === id);
    assert.equal(option.text, label);
    assert.ok(option.iconUrl?.startsWith('data:image/svg+xml'));
    option.action();
    assert.deepEqual(called.pop(), ['openStructurePaths', [path], { rendererMode: renderer }]);
  }
}
assert.ok(!table.some(item => item.id === 'open-xyzrender'));
const large = Array.from({ length: 201 }, (_, index) => `/set/${index}.pdb`);
flatten(workspaceFileMenu(large, state, actions, workflows, [], run, openBatch)).find(item => item.id === 'open-together').action();
assert.deepEqual(called.pop(), ['batch', large, 'scene'], 'The batch reports its explicit size limit instead of showing an empty menu');
console.log('Workspace menus: compatible modes, actual scene targets, exact multi-file payloads and SDK icons passed');

const saved = [];
const disk = [{ kind: 'item', id: 'save-file-copy', text: 'Save file copy as…', action: () => saved.push('copy') }];
const remote = workspaceFileMenu(['/cache/ssh-previews/id/ligand.sdf'], state, actions, workflows, disk, run);
remote.find(item => item.id === 'download').action();
assert.deepEqual(saved, ['copy']);
assert.ok(!workspaceFileMenu(['/data/ligand.sdf'], state, actions, workflows, disk, run).some(item => item.id === 'download'));
