import assert from 'node:assert/strict';
import { workspaceFileMenu } from '../apps/desktop/src/components/workspace-file-menu.ts';
import { withMenuIcons } from '../apps/desktop/src/components/menu-icons.ts';

const called = [];
const state = { documents: [], pinnedStructurePaths: [] };
const actions = new Proxy({}, { get: (_, name) => (...args) => { called.push([name, ...args]); } });
const workflows = { sceneTargets: () => [{ id: 'scene-a', title: 'Protein' }], addToScene: (...args) => called.push(['addToScene', ...args]), openAligned() {}, gridView() {}, copyNames() {} };
const run = action => action;
const flatten = items => items.flatMap(item => item.kind === 'submenu' ? [item, ...flatten(item.items)] : [item]);
const pdbs = ['/protein.pdb', '/variant.cif'];
const menu = withMenuIcons(workspaceFileMenu(pdbs, state, actions, workflows, [], run));
const commands = flatten(menu);
commands.find(item => item.id === 'open-together').action();
assert.deepEqual(called.pop(), ['openDockingDocument', '/protein.pdb', ['/variant.cif'], { sceneMode: 'structureAll' }]);
commands.find(item => item.id === 'add-scene-0').action();
assert.deepEqual(called.pop(), ['addToScene', pdbs, { id: 'scene-a', title: 'Protein' }]);
commands.find(item => item.id === 'open-right').action();
assert.deepEqual(called.pop(), ['openDockPayload', { area: 'right', tabKind: 'files', payload: { paths: pdbs, records: [], items: [
  { kind: 'file', path: '/protein.pdb', title: 'protein.pdb' }, { kind: 'file', path: '/variant.cif', title: 'variant.cif' },
] } }]);
for (const command of commands.filter(item => item.kind === 'item' || item.kind === 'submenu')) assert.ok(command.iconUrl?.startsWith('data:image/svg+xml'), `Missing SDK icon: ${command.id}`);
const mixed = flatten(workspaceFileMenu(['/notes.txt', '/ligand.sdf'], state, actions, { ...workflows, sceneTargets: () => [] }, [], run));
assert.ok(!mixed.some(item => ['open-together', 'open-poses', 'open-aligned', 'add-scene'].includes(item.id)));
mixed.find(item => item.id === 'open-tabs').action();
assert.deepEqual(called.pop(), ['openPaths', ['/notes.txt', '/ligand.sdf']]);
const table = flatten(workspaceFileMenu(['/library.csv'], state, actions, { ...workflows, sceneTargets: () => [], gridView: (...args) => called.push(['gridView', ...args]) }, [], run));
table.find(item => item.id === 'open-cards').action();
assert.deepEqual(called.pop(), ['gridView', '/library.csv', 'cards']);
assert.ok(!table.some(item => item.id === 'open-3d'));
assert.deepEqual(workspaceFileMenu(Array(201).fill('/x.pdb'), state, actions, workflows, [], run), []);
console.log('Workspace menus: compatible modes, actual scene targets, exact multi-file payloads and SDK icons passed');
