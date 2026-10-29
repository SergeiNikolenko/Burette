import { expect, test } from "bun:test";
import { readCifCrystal } from "../apps/desktop/src/lib/molecular-workbench/cif-crystal";
test("a P1 operation accepted as numerical identity cannot create a second atom after floating-point application", async () => {
  const text = `data_precision
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
'x+0.000000000033333333333,y,z'
'x,y,z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C .2 .3 .4
`;
  try {
    const result = await readCifCrystal(text);
    console.log(JSON.stringify({ atomCount: result.atoms.length, sourceAtomIndices: result.sourceAtomIndices, x: result.atoms.map(a => a.x) }));
    expect(result.atoms.length).toBe(1);
  } catch (error) {
    if (error instanceof Error && /numerically ambiguous/u.test(error.message)) return;
    throw error;
  }
});
