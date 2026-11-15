import { expect, test } from "bun:test";
import { readCifCrystal } from "../apps/desktop/src/lib/molecular-workbench/cif-crystal";
const source = (translation: string) => `data_probe
_cell_length_a 100000
_cell_length_b 100000
_cell_length_c 100000
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_IT_number 1
_space_group_name_H-M_alt 'P 1'
loop_
_space_group_symop_operation_xyz
'x,y,z'
'x+${translation},y,z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C .2 .3 .4
`;
for (const shift of ["0.0000001", "1/10000000"]) test(`P1 rejects physically nonidentity translation ${shift} before expansion`, async () => {
  const read = readCifCrystal(source(shift));
  void read.then(result => console.log(JSON.stringify({ shift, count: result.atoms.length, sourceAtomIndices: result.sourceAtomIndices, x: result.atoms.map(atom => atom.x) })), () => {});
  await expect(read).rejects.toThrow();
});

test("rational glide and arbitrary-origin twofold tables retain finite closure",async()=>{
 const base=source("1/2").replace("_space_group_IT_number 1\n_space_group_name_H-M_alt 'P 1'","_space_group_IT_number 7\n_space_group_name_H-M_alt 'P c'");
 const glide=base.replace("'x+1/2,y,z'","'x+1/2,-y,z'");
 const result=await readCifCrystal(glide);
 expect(result.sourceAtomIndices).toEqual([0,0]);
 expect(result.atoms.map(atom=>atom.x)).toEqual([expect.closeTo(20000,8),expect.closeTo(70000,8)]);
 const origin=base.replace("'x+1/2,y,z'","'-x+0.123456789123,-y+1/3,z'");
 const shifted=await readCifCrystal(origin);
 expect(shifted.sourceAtomIndices).toEqual([0,0]);
 expect(shifted.atoms[1].x).toBeCloseTo(92345.6789123,7);
});
test("third translations close across periodic bucket boundaries",async()=>{
 const text=source("1/3").replace("_space_group_IT_number 1\n_space_group_name_H-M_alt 'P 1'\n","").replace("'x+1/3,y,z'","'x+1/3,y,z'\n'x+2/3,y,z'");
 expect((await readCifCrystal(text)).sourceAtomIndices).toEqual([0,0,0]);
});
