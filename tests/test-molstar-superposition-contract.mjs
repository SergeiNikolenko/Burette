#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BuretteSuperposition } from '../scripts/molstar-superposition-facade.js';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const entry = source('scripts/molstar-viewer-entry.js');
const facade = source('scripts/molstar-superposition-facade.js');
const vendor = source('scripts/vendor-molstar.mjs');
const bundle = source('PreviewExtension/Web/molstar.js');
const panel = source('PreviewExtension/Web/superposition-panel.js');
const viewer = source('PreviewExtension/Web/viewer.js');
const runtimeProfiles = source('config/web-runtime-profiles.json');
const browserDevDocuments = source('apps/desktop/src/lib/browser-dev-documents.ts');
const agentShellServer = source('scripts/agent-shell-server.mjs');

assert.equal(BuretteSuperposition.version, 1);
assert.equal(BuretteSuperposition.defaultTmAlignMaxDpCells, 1_000_000);
for (const method of [
  'polymerChains',
  'alignChains',
  'alignAtoms',
  'alignWithTM',
  'hasSifts',
  'canAlignWithSifts',
  'alignWithSifts',
]) {
  assert.equal(typeof BuretteSuperposition[method], 'function', method);
}

assert.match(entry, /export \{ BuretteSuperposition \} from '\.\/molstar-superposition-facade\.js'/);
assert.match(facade, /const DEFAULT_TM_ALIGN_MAX_DP_CELLS = 1_000_000/);
assert.match(facade, /\(referenceLength \+ 1\) \* \(movingLength \+ 1\)/);
assert.match(facade, /options\.traceOnly !== false/);
assert.match(facade, /alignAndSuperposeWithSIFTSMapping\(input, \{ traceOnly: true \}\)/);
assert.match(facade, /result\.entries\.length !== input\.length - 1/);
assert.doesNotMatch(facade, /sequenceIdentity/);

assert.match(vendor, /Bun\.build\(\{/);
assert.match(entry, /globalThis\.molstar = Object\.assign\(\s*\{\},\s*globalThis\.molstar \|\| \{\}/);
assert.match(vendor, /loader: \{ '\.jpg': 'dataurl' \}/);
assert.match(vendor, /entrypoints: \[viewerEntry\]/);
assert.match(bundle, /BuretteSuperposition/);
assert.match(bundle, /defaultTmAlignMaxDpCells/);

for (const method of ['auto', 'atoms', 'sequence', 'binding-site', 'chains', 'tm-align', 'uniprot', 'selected-atoms']) {
  assert.match(panel, new RegExp(`\\['${method}',`), method);
}
assert.match(panel, /Reference chain/);
assert.match(panel, /Moving structures/);
assert.match(panel, /referenceNormalized/);
assert.match(panel, /function createQuickMenu\(options\)/);
assert.match(panel, /\['tm-align', 'TM-align'\]/);
assert.match(panel, /\['advanced', 'Advanced…'\]/);
assert.match(panel, /createSelect\('Method'/);
assert.doesNotMatch(panel, /const methodGrid/);
assert.match(viewer, /TransformStructureConformation/);
assert.match(viewer, /window\.molstar\?\.BuretteSuperposition\?\.version !== 1/);
assert.match(viewer, /revertOnError: true, revertIfAborted: true/);
assert.match(viewer, /requestCameraReset/);
assert.match(viewer, /structureAlignmentControl\.apply\(\{ method: action \}\)/);
assert.match(viewer, /Automatically superimpose every structure onto the first one/);
assert.doesNotMatch(viewer, /transformPdbCoordinates/);
assert.match(runtimeProfiles, /superposition-panel\.js/g);
assert.match(browserDevDocuments, /viewerAsset\("superposition-panel\.js"\)/);
assert.match(agentShellServer, /'superposition-panel\.js'/);

const demoNames = ['reference', 'rotated', 'flipped', 'flexed'];
const demoCoordinates = new Map(demoNames.map(name => {
  const pdb = source(`samples/structures/proteins/superposition-demo/${name}.pdb`);
  const coordinates = pdb.split('\n')
    .filter(line => line.startsWith('ATOM') && line.slice(12, 16).trim() === 'CA')
    .map(line => [Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54))]);
  assert.equal(coordinates.length, 10, name);
  return [name, coordinates];
}));
const distanceFingerprint = coordinates => coordinates.flatMap((left, leftIndex) => coordinates.slice(leftIndex + 1).map(right => (
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
)));
const referenceFingerprint = distanceFingerprint(demoCoordinates.get('reference'));
for (const name of ['rotated', 'flipped']) {
  const maximumError = Math.max(...distanceFingerprint(demoCoordinates.get(name)).map((distance, index) => Math.abs(distance - referenceFingerprint[index])));
  assert.ok(maximumError < 1e-9, `${name} must be a rigid transform`);
}
const flexedDifference = Math.max(...distanceFingerprint(demoCoordinates.get('flexed')).map((distance, index) => Math.abs(distance - referenceFingerprint[index])));
assert.ok(flexedDifference > 1, 'flexed fixture must retain a measurable conformation change');

console.log('Mol* superposition facade contract tests passed');
