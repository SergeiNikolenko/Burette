import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// The hosted shell renders the same molecular viewer HTML; each local helper
// referenced there must be shipped by the hosted asset-copy build.
const browserDocuments = readFileSync(new URL('../apps/desktop/src/lib/browser-dev-documents.ts', import.meta.url), 'utf8');
const hostedBuild = readFileSync(new URL('../apps/burette-public-plugin/scripts/build-hosted-viewer.mjs', import.meta.url), 'utf8');
const hostedFiles = new Set(JSON.parse(`[${hostedBuild.match(/const VIEWER_FILES = \[([\s\S]*?)\];/)[1].replace(/,\s*$/, '')}]`));
const localScripts = [...browserDocuments.matchAll(/<script src="\$\{viewerAsset\("([^"]+\.js)"\)\}/g)]
  .map(match => match[1]).filter(name => name !== 'molstar.js');
for (const script of localScripts) assert.ok(hostedFiles.has(script), `Hosted viewer must ship ${script}`);
const window = {};
vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/scene-file-actions.js', import.meta.url), 'utf8'), { window, TextEncoder, Set, WeakMap });
const cells = new Map([['root', { transform: { parent: 'root' } }], ['protein', { transform: { parent: 'root' }, style: 'cartoon' }]]);
const removed = [];
const viewer = { plugin: { state: { data: { cells, build: () => ({ delete(ref) { removed.push(ref); return this; }, async commit() { removed.forEach(ref => cells.delete(ref)); } }) } } } };
const camera = { position: [10, 20, 30], target: [0, 0, 0] };
let restored;
const context = { capture: () => camera, restore: (_, value) => { restored = value; }, load: async (_, source) => {
  cells.set(source.path, { transform: { parent: 'root' } });
  if (source.path === '/broken.cif') throw new Error('parse failed');
} };
const source = path => ({ path, format: 'pdb', data: 'ATOM', label: path });
const result = await window.BuretteSceneFiles.append(viewer, { sources: [source('/ligand.pdb')], existingPaths: ['/protein.pdb'] }, context);
assert.equal(result.result.added, 1);
assert.equal(cells.get('protein').style, 'cartoon');
assert.equal(restored, camera);
await assert.rejects(window.BuretteSceneFiles.append(viewer, { sources: [source('/ligand.pdb')] }, context), /already in this scene/);
await assert.rejects(window.BuretteSceneFiles.append(viewer, { sources: [source('/new.pdb'), source('/broken.cif')] }, context), /parse failed/);
assert.deepEqual([...cells.keys()], ['root', 'protein', '/ligand.pdb']);
assert.equal(restored, camera);
await window.BuretteSceneFiles.append(viewer, { sources: [source('/new.pdb')] }, context);
assert.ok(cells.has('/new.pdb'), 'failed imports must not poison duplicate detection');
console.log('Scene file imports preserve existing objects and camera, reject duplicates, and roll back partial imports');

// Grid records use names for display, but names cannot identify rows or sources.
const gridSource = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
function gridFunction(name) {
  const start = gridSource.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  const end = gridSource.indexOf('\n  function ', start + 1);
  return gridSource.slice(start, end);
}
const rows = [{ index: 0, name: 'Ligand', molblock: 'pose 1' }, { index: 1, name: 'Ligand', molblock: 'pose 2' }];
const gridState = { selected: new Set([0, 1]), remoteMode: false, all: rows };
const recordsForRow = new Function('state', 'rowReactionText', 'serializeSdfRows', `
  ${['gridDragRecordsForRow', 'gridDragRecord', 'safeStructureFileStem'].map(gridFunction).join('\n')}
  return gridDragRecordsForRow;
`)(gridState, () => '', selected => selected[0].molblock);
const records = recordsForRow(rows[0], 'collection-a');
assert.equal(new Set(records.map(record => record.path)).size, 2);
assert.deepEqual(recordsForRow(rows[0], 'collection-a'), records);
assert.notEqual(recordsForRow(rows[0], 'collection-b')[0].path, records[0].path);
assert.deepEqual(records.map(record => record.path.split('/').pop()), ['ligand.sdf', 'ligand.sdf']);
assert.deepEqual(recordsForRow(rows[0]).map(record => record.path), ['ligand.sdf', 'ligand.sdf']);
const imports = records.map(record => ({ path: record.path, data: record.text, format: record.inputExtension }));
assert.equal((await window.BuretteSceneFiles.append(viewer, { sources: imports }, context)).result.added, 2);
await assert.rejects(window.BuretteSceneFiles.append(viewer, { sources: [imports[0]] }, context), /already in this scene/);
console.log('Same-name grid poses import separately with stable source-scoped identities');
