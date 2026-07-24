#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  textStructureSelectionFromRange,
  textStructureSelectionFromSelectedText,
} from "../apps/desktop/src/lib/text-structure-selection.ts";

function documentFor(extension, content) {
  return {
    id: `text:${extension}`,
    path: `/tmp/sample.${extension}`,
    title: `sample.${extension}`,
    extension,
    language: extension,
    byteCount: content.length,
    content,
    truncated: false,
    modifiedAt: null,
  };
}

function rangeForLines(text, startLine, endLine) {
  const lines = text.split("\n");
  let from = 0;
  for (let index = 0; index < startLine; index += 1) from += lines[index].length + 1;
  let to = from;
  for (let index = startLine; index <= endLine; index += 1) to += lines[index].length + 1;
  return { from, to };
}

const pdb = [
  "ATOM    348  CB  CYS A  46      -1.776  10.979 -23.364  1.00 20.83           C",
  "ATOM    349  SG  CYS A  46      -1.577  10.465 -25.103  1.00 16.51           S",
  "ATOM    350  N   ARG A  47      -4.864  10.382 -24.362  1.00 16.51           N",
  "ATOM    351  CA  ARG A  47      -5.872   9.361 -24.648  1.00 13.48           C",
].join("\n");
const pdbRange = rangeForLines(pdb, 1, 3);
assert.deepEqual(
  textStructureSelectionFromRange(documentFor("pdb", pdb), pdbRange.from, pdbRange.to),
  {
    label: "Chain A residues 46-47",
    selector: { auth_asym_id: "A", beg_auth_seq_id: 46, end_auth_seq_id: 47 },
    granularity: "residue",
    lineCount: 3,
  },
);
const pdbHoverRange = rangeForLines(pdb, 1, 1);
assert.deepEqual(
  textStructureSelectionFromRange(documentFor("pdb", pdb), pdbHoverRange.from, pdbHoverRange.to),
  {
    label: "Chain A residue 46",
    selector: { auth_asym_id: "A", auth_seq_id: 46 },
    granularity: "residue",
    lineCount: 1,
  },
);
assert.deepEqual(
  textStructureSelectionFromRange(documentFor("pdb", pdb), pdbHoverRange.from, pdbHoverRange.to, { preferAtom: true }),
  {
    label: "Atom 349",
    selector: { atom_id: 349 },
    granularity: "atom",
    lineCount: 1,
  },
);

const selectedPdbText = [
  "ATOM     10  O   THR A   2      15.794   8.073  -0.579  1.00 32.95           O",
  "ATOM     11  CB  THR A   2      13.966  10.539  -0.265  1.00 30.38           C",
  "ATOM     12  OG1 THR A   2      14.234  11.714  -1.037  1.00 31.87           O",
  "ATOM     13  CG2 THR A   2      12.824  10.816   0.688  1.00 28.80           C",
  "ATOM     14  N   ALA A   3      17.214   9.789  -0.868  1.00 29.89           N",
  "ATOM     15  CA  ALA A   3      18.100   9.012  -1.724  1.00 29.15           C",
  "ATOM     16  C   ALA A   3      18.488   7.713  -1.049  1.00 30.96           C",
  "ATOM     17  O   ALA A   3      18.734   7.685   0.157  1.00 36.26           O",
  "ATOM     18  CB  ALA A   3      19.344   9.802  -2.069  1.00 29.10           C",
  "ATOM     19  N   GLY A   4      18.498   6.639  -1.830  1.00 28.57           N",
  "ATOM     20  CA  GLY A   4      18.865   5.329  -1.333  1.00 26.44           C",
  "ATOM     21  C   GLY A   4      17.781   4.656  -0.528  1.00 24.94           C",
  "ATOM     22  O   GLY A   4      17.856   3.456  -0.261  1.00 26.24           O",
].join("\n");
assert.deepEqual(
  textStructureSelectionFromSelectedText(documentFor("pdb", pdb), selectedPdbText),
  {
    label: "Chain A residues 2-4",
    selector: { auth_asym_id: "A", beg_auth_seq_id: 2, end_auth_seq_id: 4 },
    granularity: "residue",
    lineCount: 13,
  },
);

const xyz = [
  "4",
  "benzene fragment",
  "C 0 0 0",
  "C 1 0 0",
  "H 0 1 0",
  "H 1 1 0",
].join("\n");
const xyzRange = rangeForLines(xyz, 3, 4);
assert.deepEqual(
  textStructureSelectionFromRange(documentFor("xyz", xyz), xyzRange.from, xyzRange.to),
  {
    label: "2 atoms",
    selector: { atom_index: [1, 2] },
    granularity: "atom",
    lineCount: 2,
  },
);

const mol = [
  "sample",
  "  Burette",
  "",
  "  3  2  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    1.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "    0.0000    1.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0  0  0  0",
  "  1  3  1  0  0  0  0",
  "M  END",
].join("\n");
const molRange = rangeForLines(mol, 4, 5);
assert.deepEqual(
  textStructureSelectionFromRange(documentFor("mol", mol), molRange.from, molRange.to),
  {
    label: "2 atoms",
    selector: { atom_index: [0, 1] },
    granularity: "atom",
    lineCount: 2,
  },
);

const mol2 = [
  "@<TRIPOS>MOLECULE",
  "sample",
  "3 2 0 0 0",
  "SMALL",
  "USER_CHARGES",
  "@<TRIPOS>ATOM",
  "1 C1 0.0000 0.0000 0.0000 C.ar 1 BEN 0.0000",
  "2 C2 1.0000 0.0000 0.0000 C.ar 1 BEN 0.0000",
  "3 H1 0.0000 1.0000 0.0000 H 1 BEN 0.0000",
  "@<TRIPOS>BOND",
  "1 1 2 ar",
].join("\n");
const mol2Range = rangeForLines(mol2, 6, 7);
assert.deepEqual(
  textStructureSelectionFromRange(documentFor("mol2", mol2), mol2Range.from, mol2Range.to),
  {
    label: "2 atoms",
    selector: { atom_index: [0, 1] },
    granularity: "atom",
    lineCount: 2,
  },
);

const cube = [
  "sample cube",
  "generated",
  " 3 0.0 0.0 0.0",
  " 2 1.0 0.0 0.0",
  " 2 0.0 1.0 0.0",
  " 2 0.0 0.0 1.0",
  " 6 0.0 0.0000 0.0000 0.0000",
  " 8 0.0 1.0000 0.0000 0.0000",
  " 1 0.0 0.0000 1.0000 0.0000",
  " 0.1 0.2",
].join("\n");
const cubeRange = rangeForLines(cube, 7, 8);
assert.deepEqual(
  textStructureSelectionFromRange(documentFor("cube", cube), cubeRange.from, cubeRange.to),
  {
    label: "2 atoms",
    selector: { atom_index: [1, 2] },
    granularity: "atom",
    lineCount: 2,
  },
);

const cif = [
  "data_sample",
  "loop_",
  "_atom_site.group_PDB",
  "_atom_site.id",
  "_atom_site.type_symbol",
  "_atom_site.Cartn_x",
  "_atom_site.Cartn_y",
  "_atom_site.Cartn_z",
  "ATOM 1 C 0.0 0.0 0.0",
  "ATOM 2 O 1.0 0.0 0.0",
  "ATOM 3 N 0.0 1.0 0.0",
  "#",
].join("\n");
const cifRange = rangeForLines(cif, 9, 10);
assert.deepEqual(
  textStructureSelectionFromRange(documentFor("cif", cif), cifRange.from, cifRange.to),
  {
    label: "2 atoms",
    selector: { atom_index: [1, 2] },
    granularity: "atom",
    lineCount: 2,
  },
);

console.log("text structure selection tests passed");
