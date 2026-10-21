import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const fn = name => {
  const match = source.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'));
  assert.ok(match, name);
  return match[0];
};
const split = text => text.split('$$$$').filter(s => s.trim()).map(s => s.replace(/^\r?\n/, ''));
const records = process.argv[2] ? split(readFileSync(process.argv[2], 'utf8')) : [
  ...split(readFileSync(new URL('../samples/mini.sdf', import.meta.url), 'utf8')).slice(0, 1),
  ...split(readFileSync(new URL('../samples/ketcher-2d-benzene.sdf', import.meta.url), 'utf8')).slice(0, 1),
];
const index = process.argv[2] ? 3 : 1;
const viewer = {};
const refs = records.map((_, i) => ({ cell: { transform: { ref: `s${i}` }, obj: { data: { id: i } } } }));
const prepared = { kind: 'sdf-collection', activePose: 0, poseCount: records.length };
const state = { viewer, key: 'document-one', activeIndex: index, activeRefs: [`s${index}`], allRefsByIndex: refs.map((_, i) => [`s${i}`]) };
const context = {
  activeConfig: { documentId: 'one', format: 'sdf', label: 'collection.sdf', data: records.join('$$$$\n') },
  activeViewer: viewer, activeMolstarPrepared: prepared, activeSdfCollectionVisibilityState: state,
  activeSdfPoseMode: 'all', trajectoryControlIndices: new Map([['burette.trajectoryControl.one', index]]),
  sessionStorage: { getItem() { throw Error('SecurityError'); } },
  normalizeFormat: value => value, rawStructureData: config => config.data, splitSdfRecords: split,
  configuredMolstarStyle: () => 'illustrative', sdfCollectionStateKey: () => 'document-one',
  pdbLigandSdfEntryForResidue: () => null, pdbEntryForResidue: () => null,
  molstarSelectionExportFileName: label => `${label}.sdf`,
  TextEncoder, bytesToBase64: bytes => Buffer.from(bytes).toString('base64'),
  postHostMessage: message => { context.sent = message; return true; },
};
runInNewContext(['trajectoryControlStorageKey', 'readTrajectoryControlIndex', 'molstarStructureFromRef',
  'molstarContextSourceEntryForActiveConfig', 'molstarContextTarget', 'molstarStandaloneMoleculePreviewTarget',
  'molstarMoleculePreviewEntry', 'molstarMoleculePreviewSdfEntry', 'molstarStandaloneMoleculePreviewEntryForTarget',
  'molstarContextSdfEntryForExport', 'molstarContextSdfExportPayload', 'openMolstarMoleculePreviewInKetcher',
  'copyMolstarMoleculePreviewSmiles', 'molstarPreviewKey', 'molstarPreviewLigandIndex', 'molstarContextResidueLabel'].map(fn).join('\n'), context);

const require = createRequire(import.meta.url);
const init = new Function('require', 'module', '__dirname',
  readFileSync(new URL('../PreviewExtension/Web/rdkit/RDKit_minimal.js', import.meta.url), 'utf8') + '\nreturn initRDKitModule;'
)(require, { exports: {} }, new URL('../PreviewExtension/Web/rdkit', import.meta.url).pathname);
const rdkit = await init({ wasmBinary: readFileSync(new URL('../PreviewExtension/Web/rdkit/RDKit_minimal.wasm', import.meta.url)) });
const smiles = data => {
  const mol = rdkit.get_mol(data);
  assert.ok(mol?.is_valid());
  try { return mol.get_smiles(); } finally { mol.delete(); }
};
context.molstarPreviewInitRDKit = async () => rdkit;
context.writeTextToClipboard = async value => { context.copied = value; };
context.setStatus = () => {};
context.reportMolstarMoleculePreviewCopy = () => {};
const expected = smiles(records[index]);
const selected = context.molstarContextSourceEntryForActiveConfig(refs[index]);
console.log(JSON.stringify({ records: records.length, selectedRecord: index + 1,
  first: smiles(records[0]), expected, actual: smiles(selected.data) }));
assert.notEqual(expected, smiles(records[0]), 'Fixture must contain distinct molecules');
assert.equal(smiles(selected.data), expected, 'Popup must resolve the picked structure, not the initial pose');
Object.assign(context, {
  molstarContextStructures: () => refs,
  molstarContextPickedStructureInfo: () => ({ structure: refs[index], index }),
  molstarContextResolvedLoci: () => ({ atom: { auth_comp_id: 'MOL', auth_asym_id: 'A', auth_seq_id: 1 }, selectionBased: false }),
  molstarContextScopeForAtom: () => 'ligand', molstarContextMenuMode: 'molecule',
});
const target = context.molstarContextTarget();
assert.equal(smiles(context.molstarMoleculePreviewEntry(target).data), expected);
assert.equal(smiles(context.molstarContextSdfExportPayload(target).text), expected);
context.openMolstarMoleculePreviewInKetcher(target);
assert.equal(smiles(Buffer.from(context.sent.textBase64, 'base64').toString()), expected);
await context.copyMolstarMoleculePreviewSmiles(target);
assert.equal(context.copied, expected);
assert.equal(smiles(context.molstarStandaloneMoleculePreviewTarget(context.activeConfig).ligand.data), expected);
// In All mode a background molecule can be picked independently of the pager.
state.activeIndex = 0; state.activeRefs = ['s0'];
assert.equal(smiles(context.molstarContextSourceEntryForActiveConfig(refs[index]).data), expected);
assert.equal(smiles(context.molstarMoleculePreviewEntry(context.molstarContextTarget()).data), expected);
assert.equal(smiles(context.molstarContextSourceEntryForActiveConfig().data), smiles(records[0]));
// Single mode has no All index: resolve the displayed layer, not a queued step.
state.allRefsByIndex = []; state.activeIndex = index; state.activeRefs = [`s${index}`];
context.trajectoryControlIndices.set('burette.trajectoryControl.one', 0);
assert.equal(smiles(context.molstarContextSourceEntryForActiveConfig(refs[index]).data), expected);
assert.equal(context.molstarContextSourceEntryForActiveConfig(refs[0]), null, 'Discarded structure must not borrow current source');
context.activeConfig = { ...context.activeConfig, documentId: 'other' };
context.sdfCollectionStateKey = () => 'document-other';
assert.equal(context.molstarContextSourceEntryForActiveConfig(refs[index]), null, 'A previous document cannot supply the record');
console.log('Picked/displayed SDF record identity is shared by preview, copy, edit and export');

context.molstarMoleculePreviewTarget = { structure: refs[index], atom: { auth_comp_id: 'MOL', auth_asym_id: 'A', auth_seq_id: 1 } };
assert.equal(context.molstarPreviewLigandIndex(refs.map(structureRef => ({ structureRef, label: 'MOL A 1' }))), index,
  'Identically named residues in different collection molecules must navigate from the current structure');
assert.equal(context.molstarMoleculePreviewEntry(target), null);
assert.throws(() => context.molstarContextSdfExportPayload(target), /SDF export/);
const sentBefore = context.sent;
context.openMolstarMoleculePreviewInKetcher(target);
assert.equal(context.sent, sentBefore, 'A discarded document cannot open a different molecule for editing');
