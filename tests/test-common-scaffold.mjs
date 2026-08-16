import assert from "node:assert/strict";
import OCL from "openchemlib";

import { foldCommonScaffold, scaffoldMoleculesFromRows } from "../apps/desktop/src/lib/common-scaffold.mjs";

// Aspirin, its methyl ester, and a chlorinated analogue: everything but the
// acetylsalicylic core differs, so the core is what a lasso over the three
// should report.
const aspirinFamily = [
  { smiles: "CC(=O)Oc1ccccc1C(=O)O" },
  { smiles: "CC(=O)Oc1ccccc1C(=O)OC" },
  { smiles: "CC(=O)Oc1ccc(Cl)cc1C(=O)O" },
];
const family = scaffoldMoleculesFromRows(OCL, aspirinFamily);
assert.equal(family.length, 3);
const core = foldCommonScaffold(OCL, family);
assert.ok(core, "the family shares a scaffold");
assert.equal(core.getAllAtoms(), 13);
// The defining property, checked directly rather than through an id code: an
// MCS result carries query flags a freshly parsed molecule does not, so the two
// encode differently even when they are the same fragment.
function isContainedIn(fragment, smiles) {
  const query = OCL.Molecule.fromIDCode(fragment.getIDCode());
  query.setFragment(true);
  const searcher = new OCL.SSSearcher();
  searcher.setFragment(query);
  searcher.setMolecule(OCL.Molecule.fromSmiles(smiles));
  return searcher.isFragmentInMolecule();
}
for (const row of aspirinFamily) {
  assert.ok(isContainedIn(core, row.smiles), `the core is inside ${row.smiles}`);
}
assert.ok(!isContainedIn(core, "CCCCCCCC"), "and is not inside an unrelated molecule");

// A single molecule has nothing to be common with.
assert.equal(foldCommonScaffold(OCL, family.slice(0, 1)), null);

// Molfiles are accepted as readily as SMILES, and a row carrying neither is
// skipped instead of failing the whole search.
const mixed = scaffoldMoleculesFromRows(OCL, [
  { molblock: OCL.Molecule.fromSmiles("c1ccccc1O").toMolfile() },
  { smiles: "c1ccccc1OC" },
  { smiles: "   " },
  { smiles: "not-a-smiles((" },
]);
assert.equal(mixed.length, 2, "blank and unparsable rows drop out");
const phenolCore = foldCommonScaffold(OCL, mixed);
assert.ok(phenolCore);
assert.equal(phenolCore.getAllAtoms(), 7);

// Molecules with nothing in common report nothing rather than a stray atom.
const unrelated = scaffoldMoleculesFromRows(OCL, [
  { smiles: "CCCCCCCC" },
  { smiles: "[Na+].[Cl-]" },
]);
assert.equal(foldCommonScaffold(OCL, unrelated), null);

console.log("common-scaffold tests passed");
