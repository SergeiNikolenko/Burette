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
assert.doesNotMatch(panel, /createQuickMenu/);
assert.match(panel, /createSelect\('Method'/);
assert.doesNotMatch(panel, /const methodGrid/);
assert.match(viewer, /TransformStructureConformation/);
assert.match(viewer, /window\.molstar\?\.BuretteSuperposition\?\.version !== 1/);
assert.match(viewer, /revertOnError: true, revertIfAborted: true/);
assert.match(viewer, /requestCameraReset/);
assert.match(viewer, /if \(changed\) scheduleMolstarStructureFocus\(viewer, \{ reason: 'superposition-reset', durationMs: 180, force: true \}\)/);
assert.match(viewer, /Automatically superimpose every structure onto the first one/);
assert.match(viewer, /structureAlignmentControl\?\.isAligned\(\)\s*\? structureAlignmentControl\.reset\(\)\s*:\s*structureAlignmentControl\?\.apply\(\{ method: 'auto' \}\)/);
assert.match(viewer, /SUPERPOSITION_CONTEXT_ACTION_PREFIX = 'align:context:'/);
assert.match(viewer, /contextActions\(target, mode\)/);
assert.match(viewer, /method: 'selected-atoms',[\s\S]*?useCurrentSelection: true/);
assert.match(viewer, /method: 'chains',[\s\S]*?alignSequences: true/);
assert.match(viewer, /`TM-align to \$\{reference\.label\}`/);
assert.doesNotMatch(viewer, /transformPdbCoordinates/);
assert.match(runtimeProfiles, /superposition-panel\.js/g);
assert.match(browserDevDocuments, /viewerAsset\("superposition-panel\.js"\)/);
assert.match(agentShellServer, /'superposition-panel\.js'/);

const demoNames = ['1htb-a', '1htb-a-rotated', '1htb-b', '1htb-b-rotated'];
const demoStructures = new Map(demoNames.map(name => {
  const pdb = source(`samples/structures/proteins/superposition-demo/${name}.pdb`);
  assert.match(pdb, /SOURCE PDB ID 1HTB/);
  assert.match(pdb, /RESIDUES 194 THROUGH 280/);
  const atomLines = pdb.split('\n').filter(line => line.startsWith('ATOM'));
  assert.equal(atomLines.length, 635, name);
  const backboneByResidue = new Map();
  for (const line of atomLines) {
    const residue = `${line.slice(21, 22)}:${line.slice(22, 26).trim()}`;
    const names = backboneByResidue.get(residue) || new Set();
    names.add(line.slice(12, 16).trim());
    backboneByResidue.set(residue, names);
  }
  assert.equal(backboneByResidue.size, 87, name);
  for (const names of backboneByResidue.values()) {
    for (const atomName of ['N', 'CA', 'C', 'O']) assert.ok(names.has(atomName), `${name} missing ${atomName}`);
  }
  const coordinates = pdb.split('\n')
    .filter(line => line.startsWith('ATOM') && line.slice(12, 16).trim() === 'CA')
    .map(line => [Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54))]);
  assert.equal(coordinates.length, 87, name);
  const centroid = coordinates.reduce((sum, point) => sum.map((value, axis) => value + point[axis]), [0, 0, 0])
    .map(value => value / coordinates.length);
  return [name, { coordinates, centroid }];
}));
const distanceFingerprint = coordinates => coordinates.flatMap((left, leftIndex) => coordinates.slice(leftIndex + 1).map(right => (
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
)));
for (const [referenceName, rotatedName] of [
  ['1htb-a', '1htb-a-rotated'],
  ['1htb-b', '1htb-b-rotated'],
]) {
  const referenceFingerprint = distanceFingerprint(demoStructures.get(referenceName).coordinates);
  const maximumError = Math.max(...distanceFingerprint(demoStructures.get(rotatedName).coordinates)
    .map((distance, index) => Math.abs(distance - referenceFingerprint[index])));
  assert.ok(maximumError < 0.003, `${rotatedName} must be a rigid transform of deposited coordinates`);
}
const chainAFingerprint = distanceFingerprint(demoStructures.get('1htb-a').coordinates);
const chainBDifference = Math.max(...distanceFingerprint(demoStructures.get('1htb-b').coordinates)
  .map((distance, index) => Math.abs(distance - chainAFingerprint[index])));
assert.ok(chainBDifference > 0.5, 'the experimental A/B copies must retain their conformational difference');
for (const [leftName, rightName] of demoNames.flatMap((left, index) => demoNames.slice(index + 1).map(right => [left, right]))) {
  const left = demoStructures.get(leftName).centroid;
  const right = demoStructures.get(rightName).centroid;
  assert.ok(Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) > 50, `${leftName} and ${rightName} must start visibly separated`);
}

console.log('Mol* superposition facade contract tests passed');
