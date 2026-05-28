#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  collectionExtension,
  isMoleculeCollectionPath,
  mergeCollectionSources,
} = await import("../apps/desktop/src/lib/collection-documents.ts");

assert.equal(collectionExtension("/tmp/a.MAE.GZ"), "gz");
assert.equal(isMoleculeCollectionPath("/tmp/a.sdf"), true);
assert.equal(isMoleculeCollectionPath("/tmp/a.pdb"), false);

const sdf = mergeCollectionSources([
  { path: "/tmp/a.sdf", extension: "sdf", text: "a\n  CDK\n$$$$\n" },
  { path: "/tmp/b.sd", extension: "sd", text: "b\n  CDK\n$$$$\n" },
]);
assert.equal(sdf.extension, "sdf");
assert.equal((sdf.text.match(/\$\$\$\$/g) ?? []).length, 2);

const smiles = mergeCollectionSources([
  { path: "/tmp/a.smi", extension: "smi", text: "CCO ethanol\n\n" },
  { path: "/tmp/b.smiles", extension: "smiles", text: "# comment\nO water\n" },
]);
assert.equal(smiles.extension, "smi");
assert.match(smiles.text, /CCO ethanol/);
assert.match(smiles.text, /O water/);

const csv = mergeCollectionSources([
  { path: "/tmp/a.csv", extension: "csv", text: "SMILES,name\nCCO,ethanol\n" },
  { path: "/tmp/b.csv", extension: "csv", text: "SMILES,name\nO,water\n" },
]);
assert.equal(csv.text.trim(), "SMILES,name\nCCO,ethanol\nO,water");

assert.throws(
  () => mergeCollectionSources([
    { path: "/tmp/a.sdf", extension: "sdf", text: "a\n$$$$\n" },
    { path: "/tmp/b.smi", extension: "smi", text: "CCO" },
  ]),
  /one format family/,
);

console.log("collection document tests passed");
