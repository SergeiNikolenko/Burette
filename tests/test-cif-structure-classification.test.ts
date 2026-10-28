import { expect, test } from "bun:test";
import { classifyCifStructure } from "../apps/desktop/src/lib/cif-structure-classification";

// Minimized AlSb/COD 9008832: original lattice and asymmetric sites, no inferred elements.
const cell = `_cell_length_a 6.1347
_cell_length_b 6.1347
_cell_length_c 6.1347
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
`;
const sites = `loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Al 0.00000 0.00000 0.00000
Sb 0.25000 0.25000 0.25000
`;
const crystal = `data_9008832
${cell}_space_group_IT_number 216
${sites}`;
const entities = `loop_
_entity.id
_entity.type
1 polymer
2 non-polymer
loop_
_entity_poly.entity_id
_entity_poly.type
1 'polypeptide(L)'
`;
const cartesian = `loop_
_atom_site.label_atom_id
_atom_site.label_entity_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
'atom one' 1 1 2 3
'atom two' 1 4 5 6
`;
const protein = `data_protein
${cell}${entities}${cartesian}`;
const neutral = { kind: null };

test("label-only AlSb keeps two source sites; symmetry, occupancy and arbitrary aliases do not invent atoms or chemistry", async () => {
  expect(await classifyCifStructure(crystal)).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
  const inversion = crystal.replace("_space_group_IT_number 216", "_space_group_IT_number 2\nloop_\n_space_group_symop_operation_xyz\n'x,y,z'\n'-x,-y,-z'");
  expect(await classifyCifStructure(inversion)).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
  expect(await classifyCifStructure(crystal.replace("Al 0.00000", "'unknown alias' 0.00000").replace("Sb 0.25000", "'C=O' 0.25000"))).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
  const occupied = crystal.replace("_atom_site_fract_z\n", "_atom_site_fract_z\n_atom_site_occupancy\n").replace("Al 0.00000 0.00000 0.00000", "Al 0 0 0 0").replace("Sb 0.25000 0.25000 0.25000", "Sb .25 .25 .25 .5");
  expect(await classifyCifStructure(occupied)).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
});

test("linked polymer evidence wins over a lattice; Cartesian proteins also need no lattice", async () => {
  expect(await classifyCifStructure(protein)).toEqual({ kind: "Macromolecule" });
  expect(await classifyCifStructure(protein.replace(cell, ""))).toEqual({ kind: "Macromolecule" });
  const indirect = protein.replace("_atom_site.label_entity_id", "_atom_site.label_asym_id").replaceAll("' 1 ", "' A ");
  expect(await classifyCifStructure(indirect + "loop_\n_struct_asym.id\n_struct_asym.entity_id\nA 1\n")).toEqual({ kind: "Macromolecule" });
  expect(await classifyCifStructure(protein.replace("1 polymer", "1 non-polymer"))).toEqual(neutral);
  expect(await classifyCifStructure(protein.replace("_entity.id\n_entity.type\n1 polymer\n2 non-polymer\nloop_\n", ""))).toEqual({ kind: "Macromolecule" });
});

test("explicit nonpolymer mmCIF is a crystal only with a valid lattice; orphan polymer metadata proves nothing", async () => {
  const nonpolymer = protein.replace(entities, "_entity.id 1\n_entity.type non-polymer\n");
  expect(await classifyCifStructure(nonpolymer)).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
  expect(await classifyCifStructure(nonpolymer.replace(cell, ""))).toEqual(neutral);
  expect(await classifyCifStructure(protein.replaceAll("' 1 ", "' 7 "))).toEqual(neutral);
  expect(await classifyCifStructure(protein.replaceAll("' 1 ", "' 2 "))).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
  expect(await classifyCifStructure(`data_unknown\n${cell}${cartesian.replace("label_entity_id", "group_PDB").replaceAll("' 1 ", "' ATOM ")}`)).toEqual(neutral);
});

test("real CIF quoting, multiline text, comments, case and dictionary aliases do not become metadata", async () => {
  const preamble = `_publ_section_title\n;\n_entity.id 1\n_entity.type polymer\n_atom_site.Cartn_x 7\n;\n# _entity_poly.entity_id 1\n`;
  const aliased = crystal.replace("data_9008832\n", `data_9008832\n${preamble}`).replaceAll("_cell_", "_CELL.").replaceAll("_atom_site_", "_ATOM_SITE.").replace("6.1347\n", "'6.1347(2)' # uncertainty\n").replace("Al 0.00000", "'Al label' 0.00000");
  expect(await classifyCifStructure(aliased)).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
});

test("case-insensitive tags may share a category even when the parser stores separate case variants", async () => {
  const mixedCell = cell.replaceAll("_cell_", "_cell.").replace("_cell.length_b", "_CELL.length_b");
  const mixedSites = sites.replaceAll("_atom_site_", "_atom_site.").replace("_atom_site.fract_y", "_ATOM_SITE.fract_y");
  expect(await classifyCifStructure(`data_mixed\n${mixedCell}${mixedSites}`)).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
  const mixedProtein = protein.replace("_entity.type", "_ENTITY.type").replace("_atom_site.Cartn_y", "_ATOM_SITE.Cartn_y");
  expect(await classifyCifStructure(mixedProtein)).toEqual({ kind: "Macromolecule" });
  expect(await classifyCifStructure(crystal.replace("_atom_site_fract_y", "_atom_site.fract_y"))).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
  expect(await classifyCifStructure(crystal.replace("_cell_length_a", "_cell_length.a"))).toEqual(neutral);
  expect(await classifyCifStructure(crystal.replace("_atom_site_fract_x", "_atom.site_fract_x"))).toEqual(neutral);
});

test("conflicting coordinate, cell and entity aliases cannot hide behind the first matching field", async () => {
  expect(await classifyCifStructure(crystal + "_atom_site.fract_x 0\n_atom_site.fract_y 0\n_atom_site.fract_z 0\n")).toEqual(neutral);
  expect(await classifyCifStructure(crystal.replace("_cell_length_a 6.1347", "_cell_length_a -1") + "_cell.length_a 6.1347\n")).toEqual(neutral);
  expect(await classifyCifStructure(crystal.replaceAll("_cell_", "_cell.") + "_CELL.length_a -1\n")).toEqual(neutral);
  expect(await classifyCifStructure(crystal + "loop_\n_atom_site.fract_x\n_atom_site.fract_y\n_atom_site.fract_z\n0 0 0\n.5 .25 .25\n")).toEqual(neutral);
  expect(await classifyCifStructure(protein + "_ENTITY.id 1\n_ENTITY.type non-polymer\n")).toEqual(neutral);
  const duplicateInLoop = crystal.replace("_atom_site_fract_z\n", "_atom_site_fract_z\n_atom_site.fract_x\n").replace("Al 0.00000 0.00000 0.00000", "Al 0 0 0 0").replace("Sb 0.25000 0.25000 0.25000", "Sb .25 .25 .25 .5");
  expect(await classifyCifStructure(duplicateInLoop)).toEqual(neutral);
  expect(await classifyCifStructure(crystal + "_cell.length_a 6.1347\n_CELL.length_a 6.1347\n")).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
});

test("incomplete, nonfinite or invalid coordinates never publish a partial classification", async () => {
  for (const value of ["?", ".", "NaN", "Infinity", "1e999", "1broken"]) {
    expect(await classifyCifStructure(crystal.replace("Sb 0.25000", `Sb ${value}`))).toEqual(neutral);
  }
  expect(await classifyCifStructure(crystal.replace("_atom_site_fract_z\n", ""))).toEqual(neutral);
  expect(await classifyCifStructure(crystal + "_atom_site.Cartn_x 1\n")).toEqual(neutral);
  expect(await classifyCifStructure(protein.replace("'atom two' 1 4 5 6", "'atom two' 1 4 5"))).toEqual(neutral);
  expect(await classifyCifStructure(crystal.replace("0.25000 0.25000 0.25000", "2.5e-1(2) +.25 .25"))).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
});

test("fractional sites require a complete physical cell; degenerate metrics and cell-only sources remain neutral", async () => {
  for (const source of [crystal.replace(cell, ""), crystal.replace("_cell_angle_gamma 90\n", ""), crystal.replace("_cell_length_a 6.1347", "_cell_length_a -1"), crystal.replace("_cell_angle_gamma 90", "_cell_angle_gamma 180"), crystal.replace("_cell_angle_alpha 90", "_cell_angle_alpha 170").replace("_cell_angle_beta 90", "_cell_angle_beta 10"), `data_cell\n${cell}`]) {
    expect(await classifyCifStructure(source)).toEqual(neutral);
  }
});

test("multiple coordinate blocks stay neutral, unrelated metadata blocks do not, and model rows are not one asymmetric unit", async () => {
  expect(await classifyCifStructure(crystal + protein)).toEqual(neutral);
  expect(await classifyCifStructure(crystal + "data_broken\n_atom_site.Cartn_x 1\n")).toEqual(neutral);
  expect(await classifyCifStructure(crystal + "data_reference\n_publ_section_title 'metadata only'\n")).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
  const models = crystal.replace("_atom_site_fract_z\n", "_atom_site_fract_z\n_atom_site_pdbx_PDB_model_num\n").replace("Al 0.00000 0.00000 0.00000", "Al 0 0 0 1").replace("Sb 0.25000 0.25000 0.25000", "Sb .25 .25 .25 2");
  expect(await classifyCifStructure(models)).toEqual({ kind: "Crystal structure" });
  for (const id of ["nonsense", "?", ".", "0", "-1", "1.5", "1e2", "9007199254740993"]) {
    const invalid = models.replace("Al 0 0 0 1", `Al 0 0 0 ${id}`).replace("Sb .25 .25 .25 2", `Sb .25 .25 .25 ${id}`);
    expect(await classifyCifStructure(invalid)).toEqual({ kind: "Crystal structure" });
    expect(await classifyCifStructure(invalid.replace("_atom_site_pdbx_PDB_model_num", "_atom_site.pdbx_PDB_model_num"))).toEqual({ kind: "Crystal structure" });
  }
  expect(await classifyCifStructure(models.replace("Sb .25 .25 .25 2", "Sb .25 .25 .25 1"))).toEqual({ kind: "Crystal structure", asymmetricSiteCount: 2 });
});

test("malformed and excessive input returns no partial result", async () => {
  expect(await classifyCifStructure("data_bad\nloop_\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n1 2 3\n")).toEqual(neutral);
  expect(await classifyCifStructure("data_bad\n_publ_section_title\n;unterminated\n")).toEqual(neutral);
  expect(await classifyCifStructure(`data_large\n#${"x".repeat(20_000_000)}\n${sites}`)).toEqual(neutral);
});
