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

for (const extension of ["pdb", "pdbqt", "cif", "mmcif", "bcif", "gro"]) {
  assert.equal(documentKind(document(extension)), "Macromolecule", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Components"), "Polymers, ligands, water, and ions when parsed", extension);
}

for (const extension of ["mae", "maegz", "cms"]) {
  const brief = structureBriefForDocument(document(extension), "1 KB");
  assert.equal(documentKind(document(extension)), "Maestro structure", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Maestro source"), "CT blocks with atom-table coordinates", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "System parts"), "Solute, solvent, ions, and full-system CTs when present", extension);
  assert.ok(brief.notes.includes("Maestro CT sections are available from the source text"), extension);
}
assert.equal(rowValue(usefulElements(document("maegz")), "Text"), "Decompressed Maestro text opens in Text tab");

const maestroText = [
  "f_m_ct {",
  " s_m_title",
  " s_lp_Force_Field",
  " s_lp_Variant",
  " i_epik_Tot_Q",
  " :::",
  " Ligand A",
  " OPLS4",
  " Variant A",
  " 0",
  " m_atom[2] {",
  "  # First column is atom index #",
  "  i_m_residue_number",
  "  s_m_pdb_residue_name",
  "  s_m_pdb_atom_name",
  "  i_m_atomic_number",
  "  :::",
  '  1 1 "LIG " " C1 " 6',
  '  2 1 "LIG " " N1 " 7',
  "  :::",
  " }",
  " m_bond[1] {",
  "  i_m_from",
  "  i_m_to",
  "  i_m_order",
  "  :::",
  "  1 1 2 1",
  "  :::",
  " }",
  "}",
  "f_m_ct {",
  " s_m_title",
  " s_lp_Force_Field",
  " s_lp_Variant",
  " i_epik_Tot_Q",
  " :::",
  " Ligand B",
  " OPLS4",
  " Variant B",
  " 1",
  " m_atom[1] {",
  "  # First column is atom index #",
  "  i_m_residue_number",
  "  s_m_pdb_residue_name",
  "  s_m_pdb_atom_name",
  "  i_m_atomic_number",
  "  :::",
  '  1 1 "UNL " " O1 " 8',
  "  :::",
  " }",
  " m_bond[0] {",
  "  i_m_from",
  "  i_m_to",
  "  i_m_order",
  "  :::",
  "  :::",
  " }",
  "}",
].join("\n");
const maestroComposition = parseStructureComposition(maestroText, "maegz");
assert.ok(maestroComposition);
assert.equal(rowValue(maestroComposition.rows, "CT blocks"), "2");
assert.equal(rowValue(maestroComposition.rows, "Preview entries"), "2");
assert.equal(rowValue(maestroComposition.rows, "Preview atoms"), "3");
assert.equal(rowValue(maestroComposition.rows, "Source atoms"), "3");
assert.equal(rowValue(maestroComposition.rows, "Source bonds"), "1");
assert.equal(rowValue(maestroComposition.rows, "Elements"), "C 1, N 1, O 1");
assert.equal(rowValue(maestroComposition.componentRows, "Ligands"), "2 types / 2 instances / 3 atoms");
assert.equal(maestroComposition.componentRows.some((row) => row.label === "Energy"), false);
assert.equal(maestroComposition.componentRows.some((row) => row.label === "Maestro entries"), false);
assert.equal(rowValue(maestroComposition.maestroRows, "Ligand A"), "2 atoms / 1 bond / OPLS4 / Variant A");
assert.equal(rowValue(maestroComposition.maestroRows, "Ligand B"), "1 atom / 0 bonds / OPLS4 / Variant B");
assert.deepEqual(maestroComposition.maestroRows.find((row) => row.label === "Ligand A")?.action?.selector, { kind: "ligand", label_comp_id: "LIG" });
assert.deepEqual(maestroComposition.maestroRows.find((row) => row.label === "Ligand B")?.action?.selector, { kind: "ligand", label_comp_id: "UNL" });
assert.equal(maestroComposition.ligandRows.length, 2);
assert.ok(maestroComposition.notes.some((note) => note.includes("Maestro CT atom and bond tables")));
assert.ok(maestroComposition.notes.some((note) => note.includes("combined into one Mol* preview")));

function maestroCt(title, ctType, rows) {
  return [
    "f_m_ct {",
    " s_m_title",
    " s_ffio_ct_type",
    " :::",
    ` ${title}`,
    ` ${ctType}`,
    ` m_atom[${rows.length}] {`,
    "  # First column is atom index #",
    "  i_m_residue_number",
    "  s_m_pdb_residue_name",
    "  s_m_pdb_atom_name",
    "  i_m_atomic_number",
    "  :::",
    ...rows.map((row, index) => `  ${index + 1} ${row.seq} "${row.res} " "${row.atom} " ${row.atomicNumber}`),
    "  :::",
    " }",
    "}",
  ].join("\n");
}

const cmsText = [
  maestroCt("System", "full_system", [
    { seq: 1, res: "ALA", atom: "N", atomicNumber: 7 },
    { seq: 1, res: "ALA", atom: "CA", atomicNumber: 6 },
    { seq: 2, res: "SPC", atom: "OW", atomicNumber: 8 },
    { seq: 2, res: "SPC", atom: "HW1", atomicNumber: 1 },
    { seq: 2, res: "SPC", atom: "HW2", atomicNumber: 1 },
    { seq: 3, res: "CL", atom: "CL", atomicNumber: 17 },
  ]),
  maestroCt("Solute", "solute", [
    { seq: 1, res: "ALA", atom: "N", atomicNumber: 7 },
    { seq: 1, res: "ALA", atom: "CA", atomicNumber: 6 },
  ]),
  maestroCt("Chloride", "ion", [
    { seq: 3, res: "CL", atom: "CL", atomicNumber: 17 },
  ]),
  maestroCt("SPC water box", "solvent", [
    { seq: 2, res: "SPC", atom: "OW", atomicNumber: 8 },
    { seq: 2, res: "SPC", atom: "HW1", atomicNumber: 1 },
    { seq: 2, res: "SPC", atom: "HW2", atomicNumber: 1 },
  ]),
].join("\n");
const cmsComposition = parseStructureComposition(cmsText, "cms");
assert.ok(cmsComposition);
assert.equal(rowValue(cmsComposition.rows, "CT blocks"), "4");
assert.equal(rowValue(cmsComposition.rows, "Preview CT"), "System");
assert.equal(rowValue(cmsComposition.rows, "Preview atoms"), "6");
assert.equal(rowValue(cmsComposition.rows, "Source atoms"), "12");
assert.equal(rowValue(cmsComposition.componentRows, "Polymers"), "1 chain / 1 residue / 2 atoms");
assert.equal(rowValue(cmsComposition.componentRows, "Ligands"), "None detected");
assert.equal(rowValue(cmsComposition.componentRows, "Water"), "1 molecule / 3 atoms");
assert.equal(rowValue(cmsComposition.componentRows, "Ions"), "CL 1 / 1 atoms");
// Water and the Ions summary live only in componentRows now; solventRows carries
// just the individual ions behind that summary (no duplicate Water/Ions rows).
assert.equal(cmsComposition.solventRows.find((row) => row.label === "Water"), undefined);
assert.equal(cmsComposition.solventRows.find((row) => row.label === "Ions"), undefined);
assert.equal(rowValue(cmsComposition.solventRows, "CL"), "1 ion");
assert.deepEqual(cmsComposition.maestroRows.find((row) => row.label === "System")?.action?.selector, { kind: "all" });
assert.deepEqual(cmsComposition.maestroRows.find((row) => row.label === "Solute")?.action?.selector, { structure: "primary" });
assert.deepEqual(cmsComposition.maestroRows.find((row) => row.label === "Chloride")?.action?.selector, { kind: "ion" });
assert.deepEqual(cmsComposition.maestroRows.find((row) => row.label === "SPC water box")?.action?.selector, { kind: "water" });
assert.equal(cmsComposition.ligandRows.length, 0);
assert.ok(cmsComposition.notes.some((note) => note.includes("Component counts use the Mol* preview entries")));

for (const extension of ["sdf", "mol", "mol2", "smiles", "smi"]) {
  assert.equal(documentKind(document(extension)), "Small molecule", extension);
  assert.equal(rowValue(usefulElements(document(extension)), "Molecule data"), "Atoms and bonds in source file", extension);
}

assert.equal(rowValue(usefulElements(document("sdf")), "Properties"), "SDF fields when present");
for (const extension of ["mol", "mol2", "smiles", "smi"]) {
  assert.equal(rowValue(usefulElements(document(extension)), "Properties"), "File metadata", extension);
}

const sdfComposition = parseStructureComposition([
  "Molecule A",
  "  Burette",
  "",
  "  2  1  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0  0  0  0",
  "M  END",
  "$$$$",
  "Molecule B",
  "  Burette",
  "",
  "  3  2  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0",
  "    1.2000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    2.4000    0.0000    0.0000 F   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0  0  0  0",
  "  2  3  1  0  0  0  0",
  "M  END",
  "$$$$",
].join("\n"), "sdf");
assert.ok(sdfComposition);
assert.equal(rowValue(sdfComposition.rows, "Molecules"), "2");
assert.equal(rowValue(sdfComposition.rows, "Atoms"), "5");
assert.equal(rowValue(sdfComposition.componentRows, "Molecule A"), "2 atoms / 1 bond");
assert.equal(rowValue(sdfComposition.componentRows, "Molecule B"), "3 atoms / 2 bonds");
assert.deepEqual(sdfComposition.componentRows.find((row) => row.label === "Molecule A")?.action, {
  type: "set_sdf_molecule",
  label: "Show Molecule A",
  index: 0,
});
assert.deepEqual(sdfComposition.componentRows.find((row) => row.label === "Molecule B")?.action, {
  type: "set_sdf_molecule",
  label: "Show Molecule B",
  index: 1,
});
const duplicateTitleSdfComposition = parseStructureComposition([
  "RDKit 2D",
  "  Burette",
  "",
  "  1  0  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "M  END",
  "$$$$",
  "RDKit 2D",
  "  Burette",
  "",
  "  1  0  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "M  END",
  "$$$$",
].join("\n"), "sdf");
assert.ok(duplicateTitleSdfComposition);
assert.equal(rowValue(duplicateTitleSdfComposition.componentRows, "Molecule 1"), "1 atom / 0 bonds");
assert.equal(rowValue(duplicateTitleSdfComposition.componentRows, "Molecule 2"), "1 atom / 0 bonds");

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

const trajectoryDocument = document("docking", {
  dockingRequest: {
    receptorPath: "/tmp/topology.pdb",
    ligandPaths: ["/tmp/01_start.xtc", "/tmp/02_middle.xtc", "/tmp/03_final.xtc"],
  },
});
assert.equal(documentKind(trajectoryDocument), "Trajectory");
assert.equal(rowValue(usefulElements(trajectoryDocument), "Topology"), "topology.pdb");
assert.equal(rowValue(usefulElements(trajectoryDocument), "Segments"), "3");
assert.ok(structureBriefForDocument(trajectoryDocument, "10 MB").notes.includes("Trajectory segments share one topology"));
assert.ok(!structureBriefForDocument(trajectoryDocument, "10 MB").notes.some((note) => note.includes("Docking")));

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

const samplesRoot = join(process.cwd(), "samples");
const miniPdb = parseStructureComposition(await readFile(join(samplesRoot, "mini.pdb"), "utf8"), "pdb");
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

const ligandPdb = parseStructureComposition([
  "ATOM      1  N   GLY A   1      11.104  13.207   9.991  1.00 10.00           N",
  "ATOM      2  CA  GLY A   1      12.560  13.120   9.991  1.00 10.00           C",
  "ATOM      3  C   GLY A   1      13.022  11.720   9.991  1.00 10.00           C",
  "ATOM      4  O   GLY A   1      12.250  10.800   9.991  1.00 10.00           O",
  "HETATM    5  C1  NAD A 377      15.000  12.000   9.991  1.00 10.00           C",
  "HETATM    6  N1  NAD A 377      15.900  12.600   9.991  1.00 10.00           N",
  "HETATM    7  O   HOH A 501      18.000  12.000   9.991  1.00 10.00           O",
  "END",
].join("\n"), "pdb");
assert.ok(ligandPdb);
assert.match(rowValue(ligandPdb.rows, "Atoms"), /^\d/);
assert.notEqual(rowValue(ligandPdb.componentRows, "Polymers"), "None detected");
assert.ok(ligandPdb.polymerRows.length > 0, "inline ligand PDB should expose polymer chains");
assert.equal(ligandPdb.ligandRows.length, 1, "inline ligand PDB should expose individual ligand instances");
assert.equal(ligandPdb.componentRows.find((row) => row.label === "Ligands")?.action?.type, "select_residues");
assert.equal(ligandPdb.componentRows.find((row) => row.label === "Ligands")?.action?.selector.kind, "ligand");
assert.equal(ligandPdb.componentRows.find((row) => row.label === "Ligands")?.secondaryAction, undefined);
assert.equal(ligandPdb.ligandRows[0].action?.type, "focus_ligand");
assert.equal(ligandPdb.ligandRows[0].label, "NAD A 377");
assert.equal(ligandPdb.ligandRows[0].action?.selector.kind, "ligand");
assert.equal(ligandPdb.ligandRows[0].action?.selector.label_comp_id, "NAD");
assert.equal(ligandPdb.ligandRows[0].action?.selector.auth_asym_id, "A");
assert.equal(ligandPdb.ligandRows[0].action?.selector.auth_seq_id, 377);

const multiPosePdbqt = parseStructureComposition([
  "MODEL 1",
  "REMARK minimizedAffinity -8.0",
  "ROOT",
  "ATOM      1  C   UNL     1      56.893  -9.434  10.824  0.00  0.00    +0.000 C ",
  "ATOM      2  C   UNL     1      58.152  -9.602   9.952  0.00  0.00    +0.000 A ",
  "ENDROOT",
  "ENDMDL",
  "MODEL 2",
  "ROOT",
  "ATOM      1  C   UNL     1      57.893  -8.434  11.824  0.00  0.00    +0.000 C ",
  "ATOM      2  O   UNL     1      58.152  -8.602   8.952  0.00  0.00    +0.000 OA",
  "ENDROOT",
  "ENDMDL",
].join("\n"), "pdbqt");
assert.ok(multiPosePdbqt);
assert.equal(rowValue(multiPosePdbqt.rows, "Models"), "2");
assert.equal(rowValue(multiPosePdbqt.rows, "Elements"), "C 3, O 1");
assert.equal(rowValue(multiPosePdbqt.componentRows, "Polymers"), "None detected");
assert.equal(rowValue(multiPosePdbqt.componentRows, "Ligands"), "1 type / 2 instances / 4 atoms");
assert.equal(multiPosePdbqt.ligandRows.length, 2);

const miniCif = parseStructureComposition(await readFile(join(samplesRoot, "mini.cif"), "utf8"), "cif");
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
// Water and its hide/show actions live on the componentRows summary now;
// solventRows lists only the individual ions behind it.
assert.equal(rowValue(miniGro.componentRows, "Water"), "1 molecule / 2 atoms");
assert.equal(miniGro.componentRows.find((row) => row.label === "Water")?.action?.type, "hide_waters");
assert.equal(miniGro.componentRows.find((row) => row.label === "Water")?.secondaryAction?.type, "show_waters");
assert.equal(miniGro.solventRows.find((row) => row.label === "Water"), undefined);
assert.equal(miniGro.solventRows.find((row) => row.label === "NA")?.action?.selector.kind, "ion");

const histidineAliasGro = parseStructureComposition([
  "histidine alias gro",
  "1",
  "    1HIE    NE2    1   0.000   0.000   0.000",
  "1.0 1.0 1.0",
].join("\n"), "gro");
assert.ok(histidineAliasGro);
assert.equal(rowValue(histidineAliasGro.componentRows, "Polymers"), "1 chain / 1 residue / 1 atoms");
assert.equal(rowValue(histidineAliasGro.componentRows, "Ligands"), "None detected");

const miniSdf = parseStructureComposition(await readFile(join(samplesRoot, "mini.sdf"), "utf8"), "sdf");
assert.ok(miniSdf);
assert.equal(rowValue(miniSdf.rows, "Molecules"), "2");
assert.match(rowValue(miniSdf.rows, "Atoms"), /^\d+$/);

const shiftedCountsSdf = parseStructureComposition([
  "shifted counts",
  "  RDKit",
  "",
  "",
  "  2  1  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    1.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0",
  "M  END",
  "$$$$",
].join("\n"), "sdf");
assert.ok(shiftedCountsSdf);
assert.equal(rowValue(shiftedCountsSdf.rows, "Atoms"), "2");
assert.equal(rowValue(shiftedCountsSdf.rows, "Bonds"), "1");

assert.equal(rendererLabel("molstar"), "Mol*");
assert.equal(rendererLabel("grid2d"), "Grid");
assert.equal(rendererLabel("xyzrender-external"), "xyzrender");
assert.equal(rendererLabel(""), "Preview");

console.log("structure brief tests passed");
