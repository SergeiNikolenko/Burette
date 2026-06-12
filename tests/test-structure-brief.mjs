#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const {
  documentKind,
  rendererLabel,
  structureBriefForDocument,
  usefulElements,
} = await import("../apps/desktop/src/lib/structure-brief.ts");
const {
  parseStructureComposition,
} = await import("../apps/desktop/src/lib/structure-composition.ts");

function document(extension, overrides = {}) {
  return {
    id: `doc-${extension}`,
    path: `/tmp/sample.${extension}`,
    title: `sample.${extension}`,
    extension,
    renderer: "molstar",
    runtimePath: "<html></html>",
    byteCount: 1024,
    ...overrides,
  };
}

function rowValue(rows, label) {
  const row = rows.find((candidate) => candidate.label === label);
  assert.ok(row, `Missing row: ${label}`);
  return row.value;
}

for (const extension of ["pdb", "pdbqt", "cif", "mmcif", "bcif", "gro", "mae", "maegz", "cms"]) {
  assert.equal(documentKind(document(extension)), "Macromolecule", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Components"), "Polymers, ligands, water, and ions when parsed", extension);
}

for (const extension of ["sdf", "mol", "mol2", "smiles", "smi"]) {
  assert.equal(documentKind(document(extension)), "Small molecule", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Molecule data"), "Atoms and bonds in source file", extension);
}

assert.equal(rowValue(usefulElements(document("sdf")), "Properties"), "SDF fields when present");
for (const extension of ["mol", "mol2", "smiles", "smi"]) {
  assert.equal(rowValue(usefulElements(document(extension)), "Properties"), "File metadata", extension);
}

for (const extension of ["csv", "tsv"]) {
  assert.equal(documentKind(document(extension)), "Molecule collection", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Table"), "Rows and columns available in grid", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Index"), "Managed by grid runtime", extension);
}

for (const extension of ["xyz", "extxyz", "dtr", "xtc", "trr"]) {
  assert.equal(documentKind(document(extension)), "Structure frames", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Frames"), "Preview runtime controlled", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Cell"), "Shown by renderer when present", extension);
}

for (const extension of ["cube", "cub"]) {
  assert.equal(documentKind(document(extension)), "Volume data", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Grid"), "Volumetric field", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Iso surface"), "Renderer controlled", extension);
}

const dockingDocument = document("sdf", {
  dockingRequest: {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/pose-a.sdf", "/tmp/pose-b.sdf"],
    activePose: 2,
  },
});
assert.equal(documentKind(dockingDocument), "Docking view");
assert.equal(rowValue(usefulElements(dockingDocument), "Receptor"), "receptor.pdb");
assert.equal(rowValue(usefulElements(dockingDocument), "Ligands"), "2");
assert.equal(rowValue(usefulElements(dockingDocument), "Active pose"), "3");
assert.ok(structureBriefForDocument(dockingDocument, "1 KB").notes.includes("Docking metadata is available from runtime config"));

const defaultDockingDocument = document("sdf", {
  dockingRequest: {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/pose-a.sdf"],
    activePose: null,
  },
});
assert.equal(rowValue(usefulElements(defaultDockingDocument), "Active pose"), "Default");

const mergedDocument = document("sdf", {
  mergedCollection: {
    sourcePaths: ["/tmp/a.sdf", "/tmp/b.sdf"],
    format: "sdf",
    suggestedFileName: "merged.sdf",
  },
});
assert.equal(documentKind(mergedDocument), "Merged collection");
assert.equal(rowValue(usefulElements(mergedDocument), "Sources"), "2");
assert.equal(rowValue(usefulElements(mergedDocument), "Suggested name"), "merged.sdf");
assert.ok(structureBriefForDocument(mergedDocument, "1 KB").notes.includes("Merged collection keeps source path references"));

const unknownDocument = document("dat", { renderer: "custom-renderer", virtual: true });
const unknownBrief = structureBriefForDocument(unknownDocument, "1 KB");
assert.equal(unknownBrief.kind, "Molecular file");
assert.equal(unknownBrief.renderer, "custom-renderer");
assert.deepEqual(unknownBrief.badges, ["Molecular file", "custom-renderer", "DAT", "Virtual"]);
assert.equal(rowValue(unknownBrief.overviewRows, "Source"), "Virtual document");
assert.ok(unknownBrief.notes.includes("This document is generated in the app"));

const fixturesRoot = join(process.cwd(), "tests/fixtures/BurettePreviewSamples");
const miniPdb = parseStructureComposition(await readFile(join(fixturesRoot, "mini.pdb"), "utf8"), "pdb");
assert.ok(miniPdb);
assert.equal(rowValue(miniPdb.rows, "Atoms"), "9");
assert.equal(rowValue(miniPdb.rows, "Residues"), "2");
assert.equal(rowValue(miniPdb.rows, "Chains"), "1");
assert.equal(rowValue(miniPdb.componentRows, "Polymers"), "1 chain / 2 residues / 9 atoms");
assert.equal(rowValue(miniPdb.componentRows, "Ligands"), "None detected");
assert.equal(rowValue(miniPdb.componentRows, "Water"), "None detected");
assert.equal(rowValue(miniPdb.polymerRows, "Chain A"), "2 protein / 2 residues / 9 atoms");
assert.equal(miniPdb.solventRows.length, 0);
assert.equal(miniPdb.componentRows.find((row) => row.label === "Polymers")?.action?.type, "select_residues");
assert.equal(miniPdb.componentRows.find((row) => row.label === "Polymers")?.action?.selector.kind, "polymer");
assert.equal(miniPdb.componentRows.find((row) => row.label === "Polymers")?.secondaryAction, undefined);
assert.equal(miniPdb.polymerRows.find((row) => row.label === "Chain A")?.action?.selector.auth_asym_id, "A");

const oneHtbPdb = parseStructureComposition(await readFile(join(fixturesRoot, "1HTB.pdb"), "utf8"), "pdb");
assert.ok(oneHtbPdb);
assert.match(rowValue(oneHtbPdb.rows, "Atoms"), /^\d/);
assert.notEqual(rowValue(oneHtbPdb.componentRows, "Polymers"), "None detected");
assert.ok(oneHtbPdb.polymerRows.length > 0, "1HTB should expose polymer chains");
assert.equal(oneHtbPdb.ligandRows.length, 4, "1HTB should expose individual ligand instances");
assert.equal(oneHtbPdb.componentRows.find((row) => row.label === "Ligands")?.action?.type, "select_residues");
assert.equal(oneHtbPdb.componentRows.find((row) => row.label === "Ligands")?.action?.selector.kind, "ligand");
assert.equal(oneHtbPdb.componentRows.find((row) => row.label === "Ligands")?.secondaryAction, undefined);
assert.equal(oneHtbPdb.ligandRows[0].action?.type, "focus_ligand");
assert.equal(oneHtbPdb.ligandRows[0].label, "NAD A 377");
assert.equal(oneHtbPdb.ligandRows[0].action?.selector.kind, "ligand");
assert.equal(oneHtbPdb.ligandRows[0].action?.selector.label_comp_id, "NAD");
assert.equal(oneHtbPdb.ligandRows[0].action?.selector.auth_asym_id, "A");
assert.equal(oneHtbPdb.ligandRows[0].action?.selector.auth_seq_id, 377);

const miniCif = parseStructureComposition(await readFile(join(fixturesRoot, "mini.cif"), "utf8"), "cif");
assert.ok(miniCif);
assert.equal(rowValue(miniCif.rows, "Atoms"), "4");
assert.equal(rowValue(miniCif.componentRows, "Polymers"), "1 chain / 1 residue / 4 atoms");

const miniGro = parseStructureComposition([
  "mini gro",
  "5",
  "    1ALA      N    1   0.000   0.000   0.000",
  "    1ALA     CA    2   0.100   0.000   0.000",
  "    2SOL     OW    3   0.200   0.000   0.000",
  "    2SOL    HW1    4   0.210   0.000   0.000",
  "    3NA      NA    5   0.300   0.000   0.000",
  "1.0 1.0 1.0",
].join("\n"), "gro");
assert.ok(miniGro);
assert.equal(rowValue(miniGro.rows, "Atoms"), "5");
assert.equal(rowValue(miniGro.componentRows, "Polymers"), "1 chain / 1 residue / 2 atoms");
assert.match(rowValue(miniGro.componentRows, "Ions"), /NA 1/);
assert.equal(miniGro.componentRows.find((row) => row.label === "Ions")?.action?.type, "select_residues");
assert.equal(miniGro.componentRows.find((row) => row.label === "Ions")?.action?.selector.kind, "ion");
assert.equal(rowValue(miniGro.solventRows, "Water"), "1 molecule / 2 atoms");
assert.equal(miniGro.solventRows.find((row) => row.label === "Water")?.action?.type, "hide_waters");
assert.equal(miniGro.solventRows.find((row) => row.label === "Water")?.secondaryAction?.type, "show_waters");
assert.equal(miniGro.solventRows.find((row) => row.label === "NA")?.action?.selector.kind, "ion");

const miniSdf = parseStructureComposition(await readFile(join(fixturesRoot, "mini.sdf"), "utf8"), "sdf");
assert.ok(miniSdf);
assert.equal(rowValue(miniSdf.rows, "Molecules"), "1");
assert.match(rowValue(miniSdf.rows, "Atoms"), /^\d+$/);

assert.equal(rendererLabel("molstar"), "Mol*");
assert.equal(rendererLabel("grid2d"), "Grid");
assert.equal(rendererLabel("xyzrender-external"), "xyzrender");
assert.equal(rendererLabel(""), "Preview");

console.log("structure brief tests passed");
