import { expect, test } from "bun:test";
import { readCifCrystal } from "../apps/desktop/src/lib/molecular-workbench/cif-crystal";
const cell = (length = 10, angle = 90) => `_cell_length_a ${length}\n_cell_length_b ${length}\n_cell_length_c ${length}\n_cell_angle_alpha ${angle}\n_cell_angle_beta ${angle}\n_cell_angle_gamma ${angle}\n`;
const sites = (rows = "C1 C .13 .27 .39") => `loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n${rows}\n`;
const cif = (lattice: string, symmetry: string, atoms = sites()) => `data_probe\n${lattice}${symmetry}${atoms}`;

test("a finite determinant-one metric-preserving closed table must still preserve lattice translations", async () => {
  const symmetry = `_space_group_IT_number 3\n_space_group_name_H-M_alt 'P 2'\nloop_\n_space_group_symop_operation_xyz\n'x,y,z'\n'3/5*x+4/5*y,4/5*x-3/5*y,-z'\n`;
  // This order-two rotation sends basis translation (1,0,0) to (.6,.8,0),
  // not to an integer lattice translation. Euclidean orthogonality is insufficient.
  await expect(readCifCrystal(cif(cell(), symmetry))).rejects.toThrow();
});

test("existing cell bound refuses 1e6 angstrom cells", async () => {
  await expect(readCifCrystal(cif(cell(1e6), "_space_group_IT_number 1\n"))).rejects.toThrow("Cell lengths");
});

test("admitted 1e5 angstrom acute cell must retain two same-element sites separated by .2925 angstrom", async () => {
  const one = .09999951, two = .10000049;
  // Distance from Gram tensor, independent of the implementation's Cartesian matrix.
  const distance = (two - one) * 1e5 * Math.sqrt(3 + 6 * Math.cos(10 * Math.PI / 180));
  expect(distance).toBeGreaterThan(.29); expect(distance).toBeLessThan(.30);
  const result = await readCifCrystal(cif(cell(1e5, 10), "_space_group_IT_number 1\n", sites(`C1 C ${one} ${one} ${one}\nC2 C ${two} ${two} ${two}`)));
  expect(result.sourceAtomIndices).toEqual([0, 1]);
});

test("near-integer faces retain distinct sites 0.01 angstrom apart in a large cell",async()=>{
 const result=await readCifCrystal(cif(cell(1e5),"_space_group_IT_number 1\n",sites("C1 C 0 0 0\nC2 C .99999995 0 0\nC3 C .00000005 0 0")));
 expect(result.sourceAtomIndices).toEqual([0,1,2]);
 expect(result.atoms[1].x).toBeCloseTo(99999.995,8);
 expect(result.atoms[2].x).toBeCloseTo(.005,10);
});
test("periodic adjacent buckets deduplicate translated sites without moving retained coordinates",async()=>{
 const result=await readCifCrystal(cif(cell(),"_space_group_IT_number 1\n",sites("C1 C .2 .3 .4\nC2 C 999999.2 -999999.7 .4")));
 expect(result.sourceAtomIndices).toEqual([0]);
 expect(result.atoms[0].x).toBeCloseTo(2,12);
});

test("a skew metric cannot merge distinct fractional sites merely because they are physically close",async()=>{
 const lattice=cell(1).replace("_cell_length_b 1","_cell_length_b 100000").replace("_cell_angle_gamma 90","_cell_angle_gamma .00001");
 const result=await readCifCrystal(cif(lattice,"_space_group_IT_number 1\n",sites("C1 C .2 .2 .2\nC2 C .3 .199999 .2")));
 expect(result.sourceAtomIndices).toEqual([0,1]);
 expect(Math.hypot(result.atoms[0].x-result.atoms[1].x,result.atoms[0].y-result.atoms[1].y,result.atoms[0].z-result.atoms[1].z)).toBeLessThan(1e-5);
});
