// Independent sources reuse chain A / entity 1 / model 1 but carry different
// residue metadata. Exercise the production boundary with real Mol* IO twice.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePDB } from '@molstar/io/reader/pdb/parser';
import { parseCifText } from '@molstar/io/reader/cif/text/parser';
import { trajectoryFromPDB } from '@molstar/model/formats/structure/pdb';
import { trajectoryFromMmCIF } from '@molstar/model/formats/structure/mmcif';
import { Structure } from '@molstar/model/model/structure';
import { to_mmCIF } from '@molstar/model/model/structure/export/mmcif';

const points = [[0, 0, 0], [3.8, 0, 0], [5, 3.6, 0], [3, 5, 2.8]];
const fixtures = [
  { residues: ['ALA', 'GLY', 'SER', 'VAL'], sequence: 'AGSV', b: 20, points },
  { residues: ['LYS', 'ASP', 'TYR', 'THR'], sequence: 'KDYT', b: 35,
    points: points.map(([x, y, z]) => [-y + 20, x - 12, z + 7]) },
];
const entries = [];
for (const fixture of fixtures) {
  const pdb = fixture.points.map(([x, y, z], i) =>
    `ATOM  ${String(i + 1).padStart(5)}  CA  ${fixture.residues[i]} A${String(i + 1).padStart(4)}    ${[x, y, z].map(v => v.toFixed(3).padStart(8)).join('')}  1.00${fixture.b.toFixed(2).padStart(6)}           C`).join('\n') + '\nTER\nEND\n';
  const parsed = await parsePDB(pdb, 'same-name').run();
  assert.equal(parsed.isError, false);
  const trajectory = await trajectoryFromPDB(parsed.result).run();
  entries.push({ name: 'same-name', structure: Structure.ofModel(trajectory.representative) });
}
const viewer = readFileSync(process.argv[2] || new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const body = viewer.match(/\n  function molstarModifiedMmCifExportPayload\([\s\S]*?\n  \}/u)?.[0];
assert.ok(body, 'production mmCIF export boundary exists');
const exportScene = new Function('molstarExportToMmCif', 'molstarCurrentStructuresForExport', 'molstarExportFileName',
  `${body}\nreturn molstarModifiedMmCifExportPayload;`)(() => to_mmCIF, () => entries, () => 'scene.cif');

for (let round = 0; round < 2; round++) {
  const exported = exportScene();
  assert.equal(exported.count, 2);
  const parsed = await parseCifText(exported.text).run();
  assert.equal(parsed.isError, false);
  assert.equal(parsed.result.blocks.length, 2, 'independent namespaces require separate blocks');
  const reopened = [];
  for (const [index, block] of parsed.result.blocks.entries()) {
    const fixture = fixtures[index], site = block.categories.atom_site;
    assert.equal(site.rowCount, 4);
    assert.deepEqual(Array.from({ length: 4 }, (_, row) => site.getField('label_comp_id').str(row)), fixture.residues);
    assert.deepEqual(new Set(Array.from({ length: block.categories.chem_comp.rowCount }, (_, row) => block.categories.chem_comp.getField('id').str(row))), new Set(fixture.residues));
    for (let row = 0; row < 4; row++) {
      assert.equal(site.getField('B_iso_or_equiv').float(row), fixture.b);
      for (const [axis, name] of ['x', 'y', 'z'].entries()) {
        assert.ok(Math.abs(site.getField(`Cartn_${name}`).float(row) - fixture.points[row][axis]) < 1e-9);
      }
    }
    const model = (await trajectoryFromMmCIF(block).run()).representative;
    assert.equal(model.sequence.sequences.length, 1);
    const sequence = model.sequence.sequences[0].sequence;
    assert.equal(Array.from({ length: sequence.length }, (_, i) => sequence.code.value(i)).join(''), fixture.sequence);
    reopened.push({ name: 'same-name', structure: Structure.ofModel(model) });
  }
  entries.splice(0, entries.length, ...reopened);
}
console.log('mmCIF scene metadata and coordinate roundtrip passed');
