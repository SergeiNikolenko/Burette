import { expect, test } from "bun:test";
import { readCifCrystal } from "../apps/desktop/src/lib/molecular-workbench/cif-crystal";
import { buildSupercell, cartesianToFractional } from "../apps/desktop/src/lib/molecular-workbench/crystal";

const cell = `_cell_length_a 4.0(2)
_cell_length_b 5
_cell_length_c 6
_cell_angle_alpha 75
_cell_angle_beta 85
_cell_angle_gamma 60
`;
const sites = `loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
C1 C .1 .2 .3 1
O1 O 0 0 0 1
`;
const cif = (symmetry = "_space_group_IT_number 1\n", atomSites = sites) => `data_crystal\n${cell}${symmetry}${atomSites}`;

test("P1 CIF materializes oblique Cartesian coordinates then builds an explicit supercell", async () => {
  const crystal = await readCifCrystal(cif());
  expect(crystal.atoms.map(atom => atom.element)).toEqual(["C", "O"]);
  expect(crystal.atomLabels).toEqual(["C1", "O1"]);
  const atom = crystal.atoms[0];
  const fractional = cartesianToFractional([atom.x, atom.y, atom.z], crystal.cell);
  [0.1, 0.2, 0.3].forEach((value, index) => expect(fractional[index]).toBeCloseTo(value, 10));
  const expanded = buildSupercell(crystal.atoms, crystal.cell, [[0, 2], [0, 1], [0, 1]]);
  expect(expanded.atoms).toHaveLength(4);
  expect(expanded.atoms[1].x - expanded.atoms[0].x).toBeCloseTo(4);
});

test("P-1 inversion expands asymmetric sites and deduplicates a special position", async () => {
  const symmetry = `_space_group_IT_number 2
loop_
_space_group_symop_id
_space_group_symop_operation_xyz
1 'x,y,z'
2 '-x,-y,-z'
`;
  const result = await readCifCrystal(cif(symmetry));
  expect(result.atoms.map(atom => atom.element)).toEqual(["C", "C", "O"]);
  expect(result.sourceAtomIndices).toEqual([0, 0, 1]);
  const atom = result.atoms[1];
  cartesianToFractional([atom.x, atom.y, atom.z], result.cell).forEach((value, index) => expect(value).toBeCloseTo([.9, .8, .7][index], 10));
});

test("fractional translations and equivalent boundary sites produce stable unique identities", async () => {
  const translated = `loop_
_symmetry_equiv_pos_as_xyz
'x,y,z'
'x+1/2,y,z'
`;
  const result = await readCifCrystal(cif(translated, sites.replace("O1 O 0 0 0 1", "C2 C 1.1 .2 .3 1")));
  expect(result.atoms).toHaveLength(2);
  expect(result.sourceAtomIndices).toEqual([0, 0]);
  const translatedAtom = result.atoms[1];
  expect(cartesianToFractional([translatedAtom.x, translatedAtom.y, translatedAtom.z], result.cell)[0]).toBeCloseTo(.6);
});

test("CIF quoting, comments, case-insensitive tags and mmCIF aliases use the real tokenizer", async () => {
  const text = `data_cartesian
${cell.replaceAll("_cell_", "_CELL_")}
_space_group.name_H-M_alt 'P 1' # identity
loop_
_atom_site.label_atom_id
_atom_site.type_symbol
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
'Carbon one' C 1 2 3
`;
  const result = await readCifCrystal(text);
  expect(result.atomLabels).toEqual(["Carbon one"]);
  expect(result.atoms[0].x).toBeCloseTo(1);
  expect(result.atoms[0].y).toBeCloseTo(2);
  expect(result.atoms[0].z).toBeCloseTo(3);
});

test("disorder, partial occupancy, incomplete symmetry and ambiguous multi-block CIFs fail explicitly", async () => {
  await expect(readCifCrystal(cif("_space_group_IT_number 2\n"))).rejects.toThrow("explicit symmetry");
  await expect(readCifCrystal(cif("", sites))).rejects.toThrow("explicit symmetry");
  await expect(readCifCrystal(cif(undefined, sites.replace(".3 1", ".3 .5")))).rejects.toThrow("partially occupied");
  const incomplete = "loop_\n_space_group_symop_operation_xyz\n'x,y,z'\n'x+1/3,y,z'\n";
  await expect(readCifCrystal(cif(incomplete))).rejects.toThrow("incomplete");
  const invalid = "loop_\n_space_group_symop_operation_xyz\n'x,y,z'\n'2*x,y,z'\n";
  await expect(readCifCrystal(cif(invalid))).rejects.toThrow("volume");
  const mismatch = "loop_\n_space_group_symop_operation_xyz\n'x,y,z'\n'y,x,z'\n";
  await expect(readCifCrystal(cif(mismatch))).rejects.toThrow("metric");
  const multiple = cif() + cif().replace("data_crystal", "data_second");
  await expect(readCifCrystal(multiple)).rejects.toThrow("Choose one");
  expect((await readCifCrystal(multiple, { block: "second" })).atoms).toHaveLength(2);
  const disorder = sites.replace("_atom_site_occupancy", "_atom_site_disorder_group\n_atom_site_occupancy").replace("C1 C .1 .2 .3 1", "C1 C .1 .2 .3 1 1").replace("O1 O 0 0 0 1", "O1 O 0 0 0 . 1");
  await expect(readCifCrystal(cif(undefined, disorder))).rejects.toThrow("disordered");
});

// Independent simple oblique cell: a=(2,0,0), b=(1.5,3sqrt(3)/2,0), c=(0,0,4) Å.
test("cell axis convention and angstrom lengths match an independent oblique reference", async () => {
 const text = cif().replace("4.0(2)","2").replace("_cell_length_b 5","_cell_length_b 3").replace("_cell_length_c 6","_cell_length_c 4").replace("_cell_angle_alpha 75","_cell_angle_alpha 90").replace("_cell_angle_beta 85","_cell_angle_beta 90");
 const result = await readCifCrystal(text);
 const expected = [[2,0,0],[1.5,3*Math.sqrt(3)/2,0],[0,0,4]];
 result.cell.forEach((row,i)=>row.forEach((value,j)=>expect(value).toBeCloseTo(expected[i][j],12)));
 const carbon=result.atoms[0];
 expect([carbon.x,carbon.y,carbon.z]).toEqual([expect.closeTo(.5,12),expect.closeTo(.3*Math.sqrt(3),12),expect.closeTo(1.2,12)]);
 const expanded=buildSupercell(result.atoms,result.cell,[[-1,1],[0,1],[0,1]]);
 expect(expanded.sourceAtomIndices).toEqual([0,0,1,1]);
 expect(expanded.atoms.map(atom=>atom.x)).toEqual([expect.closeTo(.5,12),expect.closeTo(2.5,12),0,2]);
});

test("small inputs exercise symmetry count, coordinate and supercell admission bounds", async()=>{
 const crystal=await readCifCrystal(cif());
 await expect(readCifCrystal(cif("loop_\n_space_group_symop_operation_xyz\n"+"'x,y,z'\n".repeat(385)))).rejects.toThrow("symmetry operations exceed");
 await expect(readCifCrystal(cif(undefined,sites.replace(".1 .2 .3","1000001 .2 .3")))).rejects.toThrow("numeric values exceed");
 expect(()=>buildSupercell(crystal.atoms,crystal.cell,[[0,1001],[0,1],[0,1]])).toThrow("increasing bounds");
 expect(()=>buildSupercell(crystal.atoms,crystal.cell,[[0,2],[0,1],[0,1]],1)).toThrow("atom budget");
 expect(()=>buildSupercell(crystal.atoms,crystal.cell,[[0,1],[0,1],[0,1]],Infinity)).toThrow("atom limit");
});

test("equal admitted aliases agree without interpreting arbitrary separator substitutions", async()=>{
 const original=await readCifCrystal(cif());
 expect(await readCifCrystal(cif()+"_cell.length_a 4.0(2)\n")).toEqual(original);
 expect(await readCifCrystal(cif()+"_cell_length.a 99\n")).toEqual(original);
});
