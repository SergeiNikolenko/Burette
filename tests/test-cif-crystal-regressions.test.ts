import { expect, test } from "bun:test";
import { readCifCrystal } from "../apps/desktop/src/lib/molecular-workbench/cif-crystal";
import { cartesianToFractional, buildSupercell } from "../apps/desktop/src/lib/molecular-workbench/crystal";
const cell = `_cell_length_a 3\n_cell_length_b 4\n_cell_length_c 5\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n`;
const sites = `loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nC1 C .2 .3 .4\n`;
const cif = (sym = "_space_group_IT_number 1\n", site = sites, lattice = cell) => `data_probe\n${lattice}${sym}${site}`;

test("sixfold oblique rotations follow an independent Cartesian rotation and row provenance", async () => {
  const lattice = cell.replace("length_a 3", "length_a 2").replace("length_b 4", "length_b 2").replace("angle_gamma 90", "angle_gamma 60");
  const result = await readCifCrystal(cif(`loop_\n_space_group_symop_operation_xyz\n'x,y,z'\n'x+y,-x,z'\n'y,-x-y,z'\n'-x,-y,z'\n'-x-y,x,z'\n'-y,x+y,z'\n`, sites, lattice));
  expect(result.sourceAtomIndices).toEqual([0, 0, 0, 0, 0, 0]);
  for (let k = 0; k < 6; k++) {
    const angle = -k * Math.PI / 3, x = .7 * Math.cos(angle) - .3 * Math.sqrt(3) * Math.sin(angle), y = .7 * Math.sin(angle) + .3 * Math.sqrt(3) * Math.cos(angle);
    // Undo integer lattice translations introduced when materializing into the cell.
    const observed = result.atoms[k], shiftB = (observed.y - y) / Math.sqrt(3), shiftA = (observed.x - x - shiftB) / 2;
    expect(shiftA).toBeCloseTo(Math.round(shiftA), 12); expect(shiftB).toBeCloseTo(Math.round(shiftB), 12); expect(observed.z).toBeCloseTo(2, 12);
  }
});

test("negative-origin fractional ranges preserve Cartesian rigid offsets and source indices", async () => {
  const result = await readCifCrystal(cif());
  const expanded = buildSupercell(result.atoms, result.cell, [[-.5, 1.5], [-1, 1], [0, 1]]);
  expect(expanded.sourceAtomIndices).toEqual([0, 0, 0, 0]);
  expect(expanded.cell.map((row, i) => row[i])).toEqual([6, 8, 5]);
  const coords = expanded.atoms.map(a => [a.x, a.y, a.z]);
  expect(coords).toEqual([[2.1, 1.2, 2], [2.1, 5.2, 2], [5.1, 1.2, 2], [5.1, 5.2, 2]].map(row => row.map(value => expect.closeTo(value, 12))));
});

test("mixed-case dotted atom fields inside one real tokenizer loop remain valid", async () => {
  const mixed = sites.replace("_atom_site_fract_x", "_ATOM_SITE.fract_x").replace("_atom_site_fract_y", "_atom_site.fract_y").replace("_atom_site_fract_z", "_atom_site.fract_z");
  const result = await readCifCrystal(cif(undefined, mixed));
  expect(result.atoms[0]).toEqual({ element: "C", x: expect.closeTo(.6, 12), y: expect.closeTo(1.2, 12), z: expect.closeTo(2, 12) });
});

test("conflicting dictionary aliases reject instead of selecting one cell", async () => {
  await expect(readCifCrystal(cif(undefined, sites, cell + "_cell.length_a 99\n"))).rejects.toThrow();
});

test("P1 name cannot accompany a nonidentity explicit symmetry table", async () => {
  await expect(readCifCrystal(cif("_space_group_name_H-M_alt 'P 1'\nloop_\n_space_group_symop_operation_xyz\n'x,y,z'\n'-x,-y,-z'\n"))).rejects.toThrow();
});

test("zero occupancy preserves the original input-row map for surviving charged type symbols", async () => {
  const atomSites = `loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\nFe2 Fe2+ ? ? ? 0\nFe3 Fe3+ .2 .3 .4 1\n`;
  const result = await readCifCrystal(cif(undefined, atomSites));
  expect(result.sourceAtomIndices).toEqual([1]); expect(result.atomLabels).toEqual(["Fe3"]);
  expect(result.atoms).toEqual([{ element: "Fe", x: expect.closeTo(.6, 12), y: expect.closeTo(1.2, 12), z: expect.closeTo(2, 12) }]);
});
