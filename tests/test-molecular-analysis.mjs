import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parsePDB } from 'molstar/lib/commonjs/mol-io/reader/pdb/parser.js';
import { trajectoryFromPDB } from 'molstar/lib/commonjs/mol-model-formats/structure/pdb.js';
import { Structure } from 'molstar/lib/commonjs/mol-model/structure.js';
import { to_mmCIF } from 'molstar/lib/commonjs/mol-model/structure/export/mmcif.js';
import { runMolecularAnalysis } from '../scripts/molecular-analysis.mjs';

const pdb = `HEADER    MINIMAL ANALYSIS FIXTURE
ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00 10.00           C
ATOM      2  CA  GLY A   2       4.000   0.000   0.000  1.00 10.00           C
ATOM      3  CA  SER A   3       0.000   4.000   0.000  1.00 10.00           C
TER
ATOM      4  CA  ALA B   1       0.000   0.000   3.000  1.00 10.00           C
ATOM      5  CA  GLY B   2       4.000   0.000   3.000  1.00 10.00           C
ATOM      6  CA  SER B   3       0.000   4.000   3.000  1.00 10.00           C
TER
END
`;
const selection = { documentId: 'minimal', chain: 'A' };
const target = { documentId: 'minimal', chain: 'B' };

test('Node-only PDB analysis: contacts, area, alignment, source identity and unambiguous selections', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'burette-analysis-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'source');
  await writeFile(path, pdb);
  const documents = [{ id: 'minimal', path, format: 'pdb', sha256: createHash('sha256').update(pdb).digest('hex') }];
  const run = action => runMolecularAnalysis({ documents, action });
  assert.deepEqual((await run({ type: 'inspect' })).inventory, [{ documentId: 'minimal', atomCount: 6,
    chains: [{ chain: 'A', labelChain: 'A', atomCount: 3, polymer: true }, { chain: 'B', labelChain: 'B', atomCount: 3, polymer: true }], chainCount: 2, truncated: false }]);
  const contacts = await run({ type: 'contacts', selection, target, cutoff: 4 });
  assert.equal(contacts.atomContactCount, 3);
  assert.deepEqual(contacts.contacts.map(contact => [contact.first.residue, contact.second.residue, contact.distanceAngstrom]), [[1, 1, 3], [2, 2, 3], [3, 3, 3]]);
  assert.equal(contacts.truncated, false);
  const area = await run({ type: 'buried_area', selection, target, samples: 240, probeRadius: 1.4 });
  assert.ok(area.interfaceAreaSquareAngstrom > 0);
  assert.equal(area.totalSasaLossSquareAngstrom, 2 * area.interfaceAreaSquareAngstrom);
  const aligned = await run({ type: 'align', selection, target });
  assert.equal(aligned.alignedCount, 3);
  assert.ok(aligned.rmsdAngstrom < 1e-6);
  assert.deepEqual(aligned.tmScores, { referenceNormalized: 1, movingNormalized: 1 });
  assert.ok(Math.abs(aligned.transform.matrix[14] + 3) < 1e-6);
  await assert.rejects(run({ type: 'contacts', selection, target: selection }), { code: 'OVERLAPPING_SELECTIONS' });
  await assert.rejects(run({ type: 'contacts', selection: { ...selection, residues: [999] }, target }), { code: 'SELECTION_LIMIT' });
  await writeFile(path, `${pdb}\nREMARK source changed\n`);
  await assert.rejects(run({ type: 'inspect' }), { code: 'SOURCE_CHANGED' });
});

test('mmCIF sources preserve author chains and residue selection through the same engine', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'burette-analysis-cif-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const parsed = await parsePDB(pdb).run();
  const trajectory = await trajectoryFromPDB(parsed.result).run();
  const cif = to_mmCIF('minimal', Structure.ofModel(trajectory.representative));
  const path = join(directory, 'source');
  await writeFile(path, cif);
  const result = await runMolecularAnalysis({ documents: [{ id: 'minimal', path, format: 'mmcif' }],
    action: { type: 'contacts', selection: { ...selection, residues: [2] }, target: { ...target, residues: [2] }, cutoff: 4 } });
  assert.deepEqual(result.partnerAtomCounts, [1, 1]);
  assert.equal(result.atomContactCount, 1);
  assert.equal(result.contacts[0].first.residue, 2);
});

test('alternate conformations select highest mean occupancy, prefer A on ties and retain shared atoms', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'burette-analysis-altloc-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'source'), baselinePath = join(directory, 'baseline');
  await writeFile(baselinePath, pdb);
  const line = pdb.split('\n')[1];
  const alternative = (id, occupancy, x) => line.slice(0, 16) + id + line.slice(17, 30) + x.toFixed(3).padStart(8) + line.slice(38, 54) + occupancy.toFixed(2).padStart(6) + line.slice(60);
  const conformers = occupancy => pdb.replace(line, `${alternative('A', 0.4, 20)}\n${alternative('B', occupancy, 0)}`);
  const run = (type, source = path) => runMolecularAnalysis({ documents: [{ id: 'minimal', path: source, format: 'pdb' }], action: { type, selection, target } });
  await writeFile(path, conformers(0.6));
  const contacts = await run('contacts');
  assert.equal(contacts.atomContactCount, 3);
  assert.deepEqual(contacts.partnerAtomCounts, [3, 3]);
  assert.equal(contacts.contacts[0].first.atom, 'CA');
  assert.equal(contacts.contacts[0].first.altId, 'B');
  assert.equal(contacts.sources[0].discardedAlternateAtomCount, 1);
  assert.match(contacts.conformerPolicy, /highest mean occupancy/);
  const area = await run('buried_area'), baselineArea = await run('buried_area', baselinePath);
  assert.equal(area.interfaceAreaSquareAngstrom, baselineArea.interfaceAreaSquareAngstrom);
  const alignment = await run('align');
  assert.equal(alignment.alignedCount, 3);
  assert.ok(alignment.rmsdAngstrom < 1e-6);
  await writeFile(path, conformers(0.4));
  const tie = await run('contacts');
  assert.equal(tie.atomContactCount, 2, 'Equal-occupancy conformer A moves the first residue away from the interface.');
});

const fixtureDirectory = process.env.BURETTE_SCIENTIFIC_FIXTURES;
test('source-pinned RCSB interface and conformer acceptance without a renderer', { skip: !fixtureDirectory && 'Set BURETTE_SCIENTIFIC_FIXTURES to the directory of the exact RCSB PDB files.' }, async () => {
  const hashes = { '1YCR': 'd8f23749da9ec22da2e17bb31c33803e3db6123233cd0404bdc005111196e7a3',
    '4AKE': 'ff798ee8791878eb58bac1c6bed32042f51b455512ac93b50bda8fa0ff0e7f78',
    '1AKE': '651e952f55f1317f50f4e82b7f0e99053397032cd8da5b2896f79d0af9f619a9' };
  const document = id => ({ id, path: join(fixtureDirectory, `${id}.pdb`), format: 'pdb', sha256: hashes[id] });
  for (const id of Object.keys(hashes)) assert.equal(createHash('sha256').update(await readFile(document(id).path)).digest('hex'), hashes[id]);
  const input = { documents: [document('1YCR')], action: { selection: { documentId: '1YCR', chain: 'A' }, target: { documentId: '1YCR', chain: 'B' } } };
  const contacts = await runMolecularAnalysis({ ...input, action: { ...input.action, type: 'contacts', cutoff: 4 } });
  assert.deepEqual({ count: contacts.atomContactCount, partners: contacts.partnerAtomCounts, truncated: contacts.truncated }, { count: 105, partners: [705, 113], truncated: false });
  const area = await runMolecularAnalysis({ ...input, action: { ...input.action, type: 'buried_area', probeRadius: 1.4, samples: 240 } });
  assert.ok(Math.abs(area.interfaceAreaSquareAngstrom - 735.864963) < 0.01);
  assert.ok(Math.abs(area.totalSasaLossSquareAngstrom - 1471.729925) < 0.01);
  assert.ok(Math.abs(area.firstSasaSquareAngstrom - 5287.675647) < 0.01);
  assert.ok(Math.abs(area.secondSasaSquareAngstrom - 1613.478497) < 0.01);
  assert.ok(Math.abs(area.complexSasaSquareAngstrom - 5429.424218) < 0.01);
  const result = await runMolecularAnalysis({ documents: [document('4AKE'), document('1AKE')], action: { type: 'align',
    selection: { documentId: '4AKE', chain: 'A' }, target: { documentId: '1AKE', chain: 'A' } } });
  assert.equal(result.alignedCount, 214);
  assert.ok(Math.abs(result.rmsdAngstrom - 8.043719662) < 0.00001);
  assert.ok(Math.abs(result.tmScores.referenceNormalized - 0.683847026) < 0.000001);
  assert.ok(Math.abs(result.tmScores.movingNormalized - 0.683847026) < 0.000001);
});
