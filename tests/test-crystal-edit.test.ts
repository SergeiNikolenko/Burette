import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runCrystalEdit, type CrystalEdit } from "../apps/desktop/src/lib/molecular-workbench/crystal-edit";
import { readCrystalDocument, readCrystalView, writeCrystalDocument, type CrystalFormat } from "../apps/desktop/src/lib/molecular-workbench/crystal-io";
import { analyzeCrystalSymmetry, type MoyoAnalyzer } from "../apps/desktop/src/lib/molecular-workbench/crystal-symmetry";
import { perceivePeriodicBonds } from "../apps/desktop/src/lib/molecular-workbench/periodic-bonds";
import { instantiateStandaloneWasm } from "../apps/desktop/src/lib/molecular-workbench/symmetry/wasm-module";
import { runCrystalTask } from "../apps/desktop/src/lib/workbench/crystal-task";
import { fixtureText, fractional, matchSites, reference } from "./crystal-reference";

// The real engines the crystal worker loads: moyo 0.21.0 and spglib's Niggli reduction.
const MOYO = new URL("../apps/desktop/node_modules/@spglib/moyo-wasm/", import.meta.url);
const moyoModule = await import(new URL("moyo_wasm.js", MOYO).href);
moyoModule.initSync({ module: readFileSync(new URL("moyo_wasm_bg.wasm", MOYO)) });
const moyo: MoyoAnalyzer = { analyze_cell: moyoModule.analyze_cell, operations_from_number: moyoModule.operations_from_number, hall_symbol_entry: moyoModule.hall_symbol_entry };
const niggli = await instantiateStandaloneWasm(new URL("../apps/desktop/src/lib/molecular-workbench/symmetry/burette-niggli.wasm", import.meta.url));
const engines = { moyo: async () => moyo, niggli: async () => niggli };

const formatOf = (name: string): CrystalFormat => name.endsWith(".cif") ? "cif" : name.endsWith(".xyz") ? "xyz" : "vasp";
const source = (name: string) => ({ format: formatOf(name), text: fixtureText(name) });
const edit = (name: string, change: CrystalEdit) => runCrystalEdit(engines, source(name), change);
const reread = async (result: { format: CrystalFormat; text: string }) => readCrystalDocument(result);
const SPACE_GROUP_FIXTURES = ["urea.cif", "rutile.cif", "quartz.cif", "si.poscar", "CONTCAR", "nacl-duplicates.cif"];

test("editing a cell keeps fractional or Cartesian coordinates exactly as pymatgen does", async () => {
  for (const name of ["urea.cif", "triclinic-molecule.xyz", "CONTCAR"]) {
    const expected = reference.fixtures[name];
    const original = await readCrystalDocument(source(name));
    const matches = matchSites(original.atoms, original.cell, expected.sites);
    const cell = expected.editedCell.cell;
    // pymatgen moves the reference site; our atom may sit `shift` whole cells away from it.
    const keepFractional = await reread(await edit(name, { kind: "set-cell", cell, policy: "fractional" }));
    keepFractional.atoms.forEach((atom, index) => {
      const ours = fractional([atom.x, atom.y, atom.z], keepFractional.cell);
      const theirs = fractional(expected.editedCell.fractionalPolicy[matches[index].site], cell).map((value, axis) => value + matches[index].shift[axis]);
      ours.forEach((value, axis) => expect(value).toBeCloseTo(theirs[axis], 8));
    });
    // A CIF stores parameters, not orientation, so Cartesian positions are only defined for POSCAR and XYZ.
    if (name.endsWith(".cif")) continue;
    // Cartesian keeps the shown positions, where every molecule is whole across the old faces.
    const shown = await readCrystalView(source(name)), shownMatches = matchSites(shown.atoms, shown.cell, expected.sites);
    const keepCartesian = await reread(await edit(name, { kind: "set-cell", cell, policy: "cartesian" }));
    keepCartesian.atoms.forEach((atom, index) => {
      const shift = shownMatches[index].shift, old = original.cell;
      const offset = fractional([0, 1, 2].map((axis) => shift[0] * old[0][axis] + shift[1] * old[1][axis] + shift[2] * old[2][axis]) as [number, number, number], cell);
      const ours = fractional([atom.x, atom.y, atom.z], cell);
      const theirs = expected.editedCell.cartesianPolicyFractional[shownMatches[index].site].map((value, axis) => value + offset[axis]);
      ours.forEach((value, axis) => expect(value).toBeCloseTo(theirs[axis], 8));
      // POSCAR stores Direct coordinates, so Cartesian positions return to rounding.
      (["x", "y", "z"] as const).forEach((axis) => expect(atom[axis]).toBeCloseTo(shown.atoms[index][axis], 10));
    });
  }
});

test("POSCAR edits that keep the atoms keep selective dynamics; edits that change them drop it", async () => {
  const flags = (await readCrystalDocument(source("CONTCAR"))).selectiveDynamics;
  for (const change of [{ kind: "wrap" }, { kind: "standard-orientation" }, { kind: "scale-volume", volume: 70 }, { kind: "niggli" }] as CrystalEdit[]) {
    expect((await reread(await edit("CONTCAR", change))).selectiveDynamics).toEqual(flags);
  }
  expect((await reread(await edit("CONTCAR", { kind: "supercell", repeats: [1, 1, 2] }))).selectiveDynamics).toBeNull();
});

test.each(Object.keys(reference.fixtures))("%s: standard orientation, volume scaling, supercell and Niggli match pymatgen and spglib", async (name) => {
  const expected = reference.fixtures[name];
  const oriented = await reread(await edit(name, { kind: "standard-orientation" }));
  oriented.cell.flat().forEach((value, index) => expect(value).toBeCloseTo(expected.standardOrientation.flat()[index], 8));
  const scaled = await edit(name, { kind: "scale-volume", volume: expected.scaledVolume.volume });
  expect(scaled.volume).toBeCloseTo(expected.scaledVolume.volume, 8);
  expect(scaled.parameters.alpha).toBeCloseTo(expected.parameters.alpha, 8);
  const supercell = await edit(name, { kind: "supercell", repeats: [2, 2, 1] });
  expect([supercell.atomCount, supercell.volume]).toEqual([expected.supercell_2x2x1.atomCount, expect.closeTo(expected.supercell_2x2x1.volume, 6)] as never);
  const reduced = await edit(name, { kind: "niggli" });
  for (const key of ["a", "b", "c", "alpha", "beta", "gamma"] as const) expect(reduced.parameters[key]).toBeCloseTo(expected.niggli.parameters[key], 6);
  expect(reduced.volume).toBeCloseTo(expected.niggli.volume, 6);
  // Niggli changes the basis, never the structure.
  expect(reduced.atomCount).toBe(expected.atomCount);
});

test("wrapping puts every atom in [0, 1) and moves it by whole cells only", async () => {
  const original = await readCrystalDocument(source("triclinic-molecule.xyz"));
  const shifted = { ...original, atoms: original.atoms.map((atom, index) => ({ ...atom, x: atom.x + (index % 3 - 1) * original.cell[0][0] * 2, y: atom.y + (index % 2) * original.cell[1][1] })) };
  const text = writeCrystalDocument("xyz", shifted);
  const wrapped = await readCrystalDocument(await runCrystalEdit(engines, { format: "xyz", text }, { kind: "wrap" }));
  wrapped.atoms.forEach((atom, index) => {
    const f = fractional([atom.x, atom.y, atom.z], wrapped.cell), g = fractional([shifted.atoms[index].x, shifted.atoms[index].y, shifted.atoms[index].z], wrapped.cell);
    f.forEach((value, axis) => { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1); expect(Math.abs(value - g[axis] - Math.round(value - g[axis]))).toBeLessThan(1e-9); });
  });
});

test.each(SPACE_GROUP_FIXTURES)("%s: primitive, conventional and symmetrized cells match spglib's standardize_cell", async (name) => {
  const expected = reference.fixtures[name].spglib["0.01"];
  const primitive = await edit(name, { kind: "primitive", tolerance: 0.01 });
  expect(primitive.spaceGroup!.number).toBe(expected.number);
  expect([primitive.atomCount, primitive.volume]).toEqual([expected.primitiveRaw.atomCount, expect.closeTo(expected.primitiveRaw.volume, 6)] as never);
  const conventional = await edit(name, { kind: "conventional", tolerance: 0.01 });
  expect([conventional.atomCount, conventional.volume]).toEqual([expected.conventionalIdealized.atomCount, expect.closeTo(expected.conventionalIdealized.volume, 2)] as never);
  for (const key of ["a", "b", "c", "alpha", "beta", "gamma"] as const) expect(conventional.parameters[key]).toBeCloseTo(expected.conventionalIdealized.parameters[key], 2);
  const symmetrized = await edit(name, { kind: "symmetrize", tolerance: 0.01 });
  expect([symmetrized.atomCount, symmetrized.volume]).toEqual([expected.primitiveIdealized.atomCount, expect.closeTo(expected.primitiveIdealized.volume, 2)] as never);
  // Every output is itself in the same space group.
  for (const result of [primitive, conventional, symmetrized]) {
    expect(analyzeCrystalSymmetry(moyo, await readCrystalDocument(result), 0.01).number).toBe(expected.number);
  }
});

test.each(SPACE_GROUP_FIXTURES)("%s: the asymmetric unit has spglib's orbit count and expands back to the full cell", async (name) => {
  const expected = reference.fixtures[name];
  const orbits = new Set(expected.spglib["0.01"].equivalentAtoms).size;
  const result = await edit(name, { kind: "asymmetric-unit", tolerance: 0.01 });
  expect([result.format, result.newDocument]).toEqual(["cif", !name.endsWith(".cif")]);
  expect(result.atomCount).toBe(orbits);
  const expanded = await readCrystalDocument(result);
  expect(expanded.atoms).toHaveLength(expected.atomCount);
  matchSites(expanded.atoms, expanded.cell, expected.sites, 2e-3);
});

test("filling the urea asymmetric unit with its Hall setting rebuilds the published cell", async () => {
  const expected = reference.fixtures["urea.cif"];
  // The five asymmetric-unit rows of the CIF, read without their symmetry operations.
  const rows = fixtureText("urea.cif").replace(/^\s+[2-8]\s+'[^']*'\n/gmu, "").replace(/^_symmetry_Int_Tables_number.*\n/mu, "");
  const representatives = await readCrystalDocument({ format: "cif", text: rows });
  expect(representatives.atoms).toHaveLength(5);
  const p1 = { format: "xyz" as const, text: writeCrystalDocument("xyz", { ...representatives, title: "urea" }) };
  const filled = await runCrystalEdit(engines, p1, { kind: "fill", hallNumber: expected.spglib["0.01"].hallNumber });
  expect([filled.atomCount, filled.addedAtoms, filled.spaceGroup?.number]).toEqual([16, 11, 113]);
  const document = await readCrystalDocument(filled);
  matchSites(document.atoms, document.cell, expected.sites, 2e-3);
  // Filled molecules are whole: every bond joins atoms of one image.
  expect(perceivePeriodicBonds(document.atoms, document.cell).every((bond) => bond.image.every((value) => value === 0))).toBe(true);
  // Filling a full cell with its own group adds nothing; a wrong group lands atoms on other elements.
  expect((await edit("urea.cif", { kind: "fill", hallNumber: expected.spglib["0.01"].hallNumber })).addedAtoms).toBe(0);
  await expect(runCrystalEdit(engines, p1, { kind: "fill", hallNumber: 0 })).rejects.toThrow("Hall number");
});

test("edits that move atoms between cells keep molecules whole", async () => {
  for (const change of [{ kind: "supercell", repeats: [2, 1, 2] }, { kind: "niggli" }, { kind: "conventional", tolerance: 0.01 }, { kind: "primitive", tolerance: 0.01 }] as CrystalEdit[]) {
    // A CIF reader wraps every site; the view the viewer shows makes molecules whole again.
    const document = await readCrystalView(await edit("urea.cif", change));
    const bonds = perceivePeriodicBonds(document.atoms, document.cell);
    expect(bonds.length).toBeGreaterThan(0);
    expect(bonds.every((bond) => bond.image.every((value) => value === 0))).toBe(true);
  }
});

// The reported bug: changing the cell lost the bonds that cross a face and duplicated others.
test("changing the cell keeps every periodic bond exactly once, in both coordinate policies", async () => {
  const pairs = (atoms: { x: number; y: number; z: number; element: string }[], cell: number[][]) =>
    perceivePeriodicBonds(atoms, cell as never).map((bond) => [Math.min(bond.a, bond.b), Math.max(bond.a, bond.b)].join("-")).sort();
  for (const name of ["urea.cif", "quartz.cif", "triclinic-molecule.xyz"]) {
    const before = await readCrystalView(source(name));
    const expected = pairs(before.atoms, before.cell);
    expect(expected.length).toBe(reference.fixtures[name].periodicBonds!.bonds.length);
    // Fractional: 2% larger along each axis, so no bond length crosses the perception cutoff.
    // Cartesian: the same lattice in a sheared basis (b + a), so every bond now crosses another face.
    const cells = {
      fractional: before.cell.map((vector) => vector.map((value) => value * 1.02)),
      cartesian: [before.cell[0], before.cell[1].map((value, axis) => value + before.cell[0][axis]), before.cell[2]],
    };
    for (const policy of ["fractional", "cartesian"] as const) {
      const result = await edit(name, { kind: "set-cell", cell: cells[policy] as never, policy });
      const after = await readCrystalView(result);
      expect(pairs(after.atoms, after.cell)).toEqual(expected);
      expect(new Set(pairs(after.atoms, after.cell)).size).toBe(new Set(expected).size);
      expect(after.atoms).toHaveLength(before.atoms.length);
    }
  }
});

test("a Cartesian cell change keeps the shown whole molecules in place and re-analyses the cell", async () => {
  // The browser acceptance step: urea 2 × 2 × 1, then c lengthened by 0.5 Å along z.
  const supercell = await edit("urea.cif", { kind: "supercell", repeats: [2, 2, 1] });
  const before = await readCrystalView(supercell);
  const cell = before.cell.map((vector, axis) => axis === 2 ? [vector[0], vector[1], vector[2] + 0.5] : vector);
  const after = await readCrystalView(await runCrystalEdit(engines, supercell, { kind: "set-cell", cell: cell as never, policy: "cartesian" }));
  expect(after.atoms).toHaveLength(64);
  after.atoms.forEach((atom, index) => (["x", "y", "z"] as const).forEach((axis) => expect(atom[axis]).toBeCloseTo(before.atoms[index][axis], 6)));
  const bonds = (view: typeof before) => perceivePeriodicBonds(view.atoms, view.cell).map((bond) => `${bond.a}-${bond.b}-${bond.image}`).sort();
  expect(bonds(after)).toEqual(bonds(before));
  // A longer c keeps every operation of P-42_1m on these positions; the analysis says so, not a cached header.
  expect(analyzeCrystalSymmetry(moyo, after, 0.01).number).toBe(113);
});

test("the crystal worker runs edits and lists the 530 space-group settings", async () => {
  const settings = await runCrystalTask({ action: "space-groups" });
  expect(settings).toHaveLength(530);
  expect(settings.find((setting) => setting.hallNumber === reference.fixtures["rutile.cif"].spglib["0.01"].hallNumber)!.number).toBe(136);
  const result = await runCrystalTask({ action: "edit", source: source("si.poscar"), edit: { kind: "primitive", tolerance: 0.01 } });
  expect([result.format, result.atomCount]).toEqual(["vasp", 2]);
  const controller = new AbortController(), pending = runCrystalTask({ action: "edit", source: source("urea.cif"), edit: { kind: "supercell", repeats: [8, 8, 8] } }, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(runCrystalTask({ action: "edit", source: source("urea.cif"), edit: { kind: "scale-volume", volume: 0 } })).rejects.toThrow("between 0.1 and 10");
});
