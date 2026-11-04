import assert from 'node:assert/strict';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { SymmetryOperator } from '@molstar/core/math/geometry/symmetry-operator';
import { SortedArray } from '@molstar/core/data/int';
import { parseCifText } from '@molstar/io/reader/cif/text/parser';
import { parsePDB } from '@molstar/io/reader/pdb/parser';
import { trajectoryFromMmCIF } from '@molstar/model/formats/structure/mmcif';
import { trajectoryFromPDB } from '@molstar/model/formats/structure/pdb';
import { Structure } from '@molstar/model/model/structure';
import { to_mmCIF } from '@molstar/model/model/structure/export/mmcif';

const components = ['1][1', '2][2', '3][3', '1][2', '1][3', '2][3'];
const original = [.1, .2, .3, .01, .02, .03];
const rotated = [.2, .1, .3, -.01, -.03, .02];
const atomFields = ['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id', 'label_entity_id', 'label_seq_id', 'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv', 'auth_seq_id', 'auth_comp_id', 'auth_asym_id', 'auth_atom_id', 'pdbx_PDB_model_num'];
const cif = `data_fixture
loop_
${atomFields.map(f => `_atom_site.${f}`).join('\n')}
ATOM 7 C CA . ALA A 1 1 ? 0 0 0 1 10 1 ALA A CA 1
ATOM 13 C CA . ALA A 1 2 ? 2 0 0 1 10 2 ALA A CA 1
ATOM 31 C CA . ALA A 1 3 ? 2 3 0 1 10 3 ALA A CA 1
#
loop_
_atom_site_anisotrop.id
${components.map(c => `_atom_site_anisotrop.U[${c}]`).join('\n')}
13 .1 .2 .3 .01 .02 .03
31 .4 .5 .6 .04 .05 .06
#
`;
async function parse(text) {
  const result = await parseCifText(text).run();
  assert.equal(result.isError, false);
  return result.result.blocks[0];
}
async function structureFrom(text) {
  return Structure.ofModel((await trajectoryFromMmCIF(await parse(text)).run()).representative);
}
async function exported(structure, options = {}) {
  return parse(to_mmCIF('export', structure, false, { copyAllCategories: true, ...options }));
}
function tensor(block, row, prefix = 'U') {
  return components.map(c => block.categories.atom_site_anisotrop.getField(`${prefix}[${c}]`).float(row));
}
// The CIF writer emits six decimal places for tensor components.
function close(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 5.01e-7, `${value} != ${expected[i]} at ${i}`));
}
function ids(block, category) {
  const table = block.categories[category];
  return Array.from({ length: table.rowCount }, (_, i) => table.getField('id').int(i));
}
const structure = await structureFrom(cif);
const identity = await exported(structure);
assert.deepEqual(ids(identity, 'atom_site_anisotrop'), [2, 3], 'IDs count atoms without tensors too');
close(tensor(identity, 0), original);
assert.deepEqual(ids(await exported(structure, { doNotReindexAtomSiteId: true }), 'atom_site_anisotrop'), [13, 31]);
close(tensor(await exported(structure, { copyAllCategories: false }), 0), original);
const translation = Mat4.fromTranslation(Mat4(), Vec3.create(9, -8, 7));
close(tensor(await exported(Structure.transform(structure, translation)), 0), original);
const rotation = Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.create(0, 0, 1));
const generalRotation = Mat4.fromRotation(Mat4(), .37, Vec3.create(0, 0, 1));
// Independent scalar evaluation of a Z rotation, with nonzero off-diagonals.
close(tensor(await exported(Structure.transform(structure, generalRotation)), 0), [
  .10633369294723917, .1936663070527609, .3,
  -.026329709994111376, .007798083953171832, .03520212900748027,
]);
const turned = Structure.transform(structure, rotation);
const turnExport = await exported(turned);
close(tensor(turnExport, 0), rotated);
close(['x', 'y', 'z'].map(axis => turnExport.categories.atom_site.getField(`Cartn_${axis}`).float(1)), [0, 2, 0]);
const reopened = Structure.ofModel((await trajectoryFromMmCIF(turnExport).run()).representative);
close(tensor(await exported(reopened), 0), rotated);

const selected = Structure.create([structure.units[0].getChild(SortedArray.ofSortedArray([0, 2]))]);
const selectedExport = await exported(selected);
assert.deepEqual(ids(selectedExport, 'atom_site_anisotrop'), [2]);
close(tensor(selectedExport, 0), [.4, .5, .6, .04, .05, .06]);
const op = SymmetryOperator.create('rotated-copy', rotation, { assembly: { id: 'test', operId: 2, operList: ['2'] } });
const duplicate = Structure.create([structure.units[0], structure.units[0].applyOperator(1, op)]);
const duplicateExport = await exported(duplicate);
assert.deepEqual(ids(duplicateExport, 'atom_site_anisotrop'), [2, 3, 5, 6]);
close(tensor(duplicateExport, 2), rotated);
assert.equal(duplicateExport.categories.atom_site.getField('label_asym_id').str(4), 'A_2');
assert.equal(duplicateExport.categories.atom_site_anisotrop.getField('pdbx_label_asym_id').str(2), 'A_2');
// PDB ANISOU records use the same current-conformation export path.
const pdb = 'ATOM      1  CA  ALA A   1       2.000   0.000   0.000  1.00 10.00           C  \n'
  + 'ANISOU    1  CA  ALA A   1     1000   2000   3000    100    200    300       C  \nEND\n';
const parsedPdb = await parsePDB(pdb).run();
assert.equal(parsedPdb.isError, false);
const pdbStructure = Structure.ofModel((await trajectoryFromPDB(parsedPdb.result).run()).representative);
const pdbCopies = Structure.create([pdbStructure.units[0], pdbStructure.units[0].applyOperator(1, op)]);
const pdbExport = await exported(pdbCopies);
assert.deepEqual(ids(pdbExport, 'atom_site_anisotrop'), [1, 2]);
close(tensor(pdbExport, 1), rotated);
assert.equal(pdbExport.categories.atom_site_anisotrop.getField('pdbx_label_asym_id').str(1), 'A_2');

const errors = [0.001, 0.002, 0.003, 0.0001, 0.0002, 0.0003];
const withErrors = cif.replace('13 .1', `${components.map(c => `_atom_site_anisotrop.U_esd[${c}]`).join('\n')}\n13 .1`)
  .replace('13 .1 .2 .3 .01 .02 .03', `13 .1 .2 .3 .01 .02 .03 ${errors.join(' ')}`)
  .replace('31 .4 .5 .6 .04 .05 .06', '31 .4 .5 .6 .04 .05 .06 . . . . . .');
const uncertain = await structureFrom(withErrors);
close(tensor(await exported(uncertain), 0, 'U_esd'), errors);
close(tensor(await exported(Structure.transform(uncertain, translation)), 0, 'U_esd'), errors);
close(tensor(await exported(Structure.transform(uncertain, rotation)), 0, 'U_esd'), [.002, .001, .003, .0001, .0003, .0002]);
assert.throws(() => to_mmCIF('uncertain', Structure.transform(uncertain, generalRotation), false, { copyAllCategories: true }), /component covariance matrix/);
console.log('mmCIF anisotropic export: current transforms, subsets, duplicate operators, IDs, uncertainties and reopen passed');
