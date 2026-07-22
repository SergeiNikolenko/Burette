#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  collectionFamily,
  collectionExtension,
  isMoleculeCollectionPath,
  mergeCollectionSources,
  parseSdfCollectionRecords,
  splitSdfCollectionRecords,
} = await import("../apps/desktop/src/lib/collection-documents.ts");
const {
  openBrowserDevTextDocument,
  parseBrowserDevDelimitedGridRecords,
  appendToBrowserDevCollection,
  writeBrowserDevVirtualTextDocument,
  readBrowserDevVirtualTextDocument,
} = await import("../apps/desktop/src/lib/browser-dev-documents.ts");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store.ts");

assert.equal(collectionExtension("/tmp/a.MAE.GZ"), "gz");
assert.equal(isMoleculeCollectionPath("/tmp/a.sdf"), true);
assert.equal(isMoleculeCollectionPath("/tmp/a.SMI"), true);
assert.equal(isMoleculeCollectionPath("/tmp/a.pdb"), false);
assert.equal(collectionFamily("sd"), "sdf");
assert.equal(collectionFamily("SDF"), "sdf");
assert.equal(collectionFamily("smiles"), "smiles");
assert.equal(collectionFamily("tsv"), "tsv");
assert.equal(collectionFamily("pdb"), null);

const sdf = mergeCollectionSources([
  { path: "/tmp/a.sdf", extension: "sdf", text: "a\n  CDK\n$$$$\n" },
  { path: "/tmp/b.sd", extension: "sd", text: "b\n  CDK\n$$$$\n" },
]);
assert.equal(sdf.extension, "sdf");
assert.equal((sdf.text.match(/\$\$\$\$/g) ?? []).length, 2);

const sdfWithInlineDollars = "Named in title\n  CDK\n\nM  END\n> <Name>\nPreferred name\n\n> <NOTE>\nprice $$$$ marker\n\n$$$$\n";
assert.equal(splitSdfCollectionRecords(sdfWithInlineDollars).length, 1);
const parsedSdf = parseSdfCollectionRecords(sdfWithInlineDollars);
assert.equal(parsedSdf.length, 1);
assert.equal(parsedSdf[0].name, "Preferred name");
assert.equal(parsedSdf[0].molblock.endsWith("M  END"), true);
assert.equal(parsedSdf[0].molblock.includes("> <Name>"), false);
assert.equal(parsedSdf[0].props.NOTE, "price $$$$ marker");

const sampleMultiSdf = await readFile(new URL("../samples/collections/sdf/multi.sdf", import.meta.url), "utf8");
const browserGridDocument = await openBrowserDevTextDocument("multi.sdf", "sdf", sampleMultiSdf, defaultPreferences);
assert.equal(browserGridDocument.renderer, "grid2d");
const browserRecordsMatch = /window\.BurreteGridRecords = (\[[^;]+\]);<\/script>/u.exec(browserGridDocument.runtimePath);
assert.ok(browserRecordsMatch, "browser-dev grid should embed parsed records");
const browserRecords = JSON.parse(browserRecordsMatch[1]);
assert.equal(browserRecords.length, 2);
assert.equal(browserRecords[0].molblock.endsWith("M  END"), true);
assert.equal(browserRecords[0].molblock.includes("> <pIC50>"), false);
assert.equal(browserRecords[0].props.pIC50, "5.1");

const browserDelimitedRecords = parseBrowserDevDelimitedGridRecords(
  "SMILES,name,score\nCCO,ethanol,1.2\nO,water,2.3\n",
  "csv",
);
assert.equal(browserDelimitedRecords.length, 2);
assert.equal(browserDelimitedRecords[0].name, "ethanol");
assert.equal(browserDelimitedRecords[0].smiles, "CCO");
assert.equal(browserDelimitedRecords[0].props.score, "1.2");

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
    { path: "/tmp/a.csv", extension: "csv", text: "SMILES,name\nCCO,ethanol\n" },
    { path: "/tmp/b.csv", extension: "csv", text: "name,SMILES\nwater,O\n" },
  ]),
  /same columns in the same order/,
);

const tsv = mergeCollectionSources([
  { path: "/tmp/a.tsv", extension: "tsv", text: "SMILES\tname\nCCO\tethanol\n" },
  { path: "/tmp/b.tsv", extension: "tsv", text: "SMILES\tname\nO\twater\n" },
]);
assert.equal(tsv.extension, "tsv");
assert.equal(tsv.text.trim(), "SMILES\tname\nCCO\tethanol\nO\twater");

assert.throws(
  () => mergeCollectionSources([
    { path: "/tmp/a.sdf", extension: "sdf", text: "a\n$$$$\n" },
    { path: "/tmp/b.smi", extension: "smi", text: "CCO" },
  ]),
  /one format family/,
);

assert.throws(
  () => mergeCollectionSources([
    { path: "/tmp/a.sdf", extension: "sdf", text: "a\n$$$$\n" },
  ]),
  /Drop at least two/,
);

assert.throws(
  () => mergeCollectionSources([
    { path: "/tmp/a.sdf", extension: "sdf", text: "a\n$$$$\n" },
    { path: "/tmp/empty.sdf", extension: "sdf", text: " \n" },
  ]),
  /empty/,
);

assert.throws(
  () => mergeCollectionSources([
    { path: "/tmp/a.sdf", extension: "sdf", text: "a\n$$$$\n" },
    { path: "/tmp/b.sdf", extension: "sdf", text: "b\n$$$$\n" },
    { path: "/tmp/notes.txt", extension: "txt", text: "notes" },
  ]),
  /not a supported molecule collection/,
);

// Browser-dev "Add to collection" appends a sketch into a stable receiver that reuses
// its tab (same path) and accumulates records instead of spawning a fresh merged snapshot.
writeBrowserDevVirtualTextDocument("/tmp/append-target.sdf", "seed-mol\n  CDK\n$$$$\n");
const firstAppend = await appendToBrowserDevCollection(
  "/tmp/append-target.sdf",
  { extension: "sdf", text: "sketch-one\n  CDK\n$$$$\n" },
  defaultPreferences,
);
assert.equal(firstAppend.renderer, "grid2d");
assert.equal(firstAppend.title, "append-target.sdf");
assert.equal(firstAppend.mergedCollection, undefined, "append receiver is a plain collection, not a merged snapshot");
const secondAppend = await appendToBrowserDevCollection(
  "/tmp/append-target.sdf",
  { extension: "sdf", text: "sketch-two\n  CDK\n$$$$\n" },
  defaultPreferences,
);
assert.equal(secondAppend.path, firstAppend.path, "receiver path stays stable so the tab is reused");
const receiverText = readBrowserDevVirtualTextDocument(secondAppend.path);
assert.ok(receiverText, "receiver keeps its accumulated collection text");
assert.equal((receiverText.match(/\$\$\$\$/g) ?? []).length, 3, "records accumulate across appends");

console.log("collection document tests passed");
