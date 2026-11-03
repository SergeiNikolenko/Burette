import { expect, test } from "bun:test";
import { readCrystalDocument, readCrystalView, writeCrystalCif, writeCrystalDocument, type CrystalFormat } from "../apps/desktop/src/lib/molecular-workbench/crystal-io";
import { isPoscarFileName, readPoscar, writePoscar } from "../apps/desktop/src/lib/molecular-workbench/poscar";
import { perceivePeriodicBonds, wholeMolecules } from "../apps/desktop/src/lib/molecular-workbench/periodic-bonds";
import { bondKey, fixtureText, fractional, matchSites, reference } from "./crystal-reference";

const formatOf = (name: string): CrystalFormat => name.endsWith(".cif") ? "cif" : name.endsWith(".xyz") ? "xyz" : "vasp";
const read = (name: string) => readCrystalDocument({ format: formatOf(name), text: fixtureText(name) });
const lengths = (cell: number[][]) => cell.map(vector => Math.hypot(...vector));

test.each(Object.keys(reference.fixtures))("%s reads as the full cell pymatgen reads", async (name) => {
  const expected = reference.fixtures[name];
  const document = await read(name);
  expect(document.atoms).toHaveLength(expected.atomCount);
  // CIF stores parameters only, so compare the metric; POSCAR and XYZ keep their vectors.
  lengths(document.cell).forEach((length, axis) => expect(length).toBeCloseTo(lengths(expected.cell)[axis], 8));
  if (!name.endsWith(".cif")) document.cell.flat().forEach((value, index) => expect(value).toBeCloseTo(expected.cell.flat()[index], 8));
  expect(Math.abs(fractional(document.cell[0], document.cell)[0])).toBeCloseTo(1, 12);
  // Every atom sits on a distinct reference site, element for element.
  expect(new Set(matchSites(document.atoms, document.cell, expected.sites).map(match => match.site)).size).toBe(expected.atomCount);
});

test("POSCAR: a negative scale is the cell volume, Cartesian positions follow it and selective dynamics survive a write", () => {
  const contcar = readPoscar(fixtureText("CONTCAR"));
  const expected = reference.fixtures.CONTCAR;
  expect(Math.abs(contcar.cell[0][0] * contcar.cell[1][1] * contcar.cell[2][2])).toBeCloseTo(expected.volume, 8);
  expect(contcar.selectiveDynamics).toEqual([[true, true, false], [false, false, false], [true, true, true], [true, false, true], [false, true, true], [true, true, true]]);
  matchSites(contcar.atoms, contcar.cell, expected.sites);
  const again = readPoscar(writePoscar(contcar));
  expect(again.selectiveDynamics).toEqual(contcar.selectiveDynamics);
  again.atoms.forEach((atom, index) => ["x", "y", "z"].forEach(axis => expect(atom[axis as "x"]).toBeCloseTo(contcar.atoms[index][axis as "x"], 10)));
  // Interleaved species stay in order as repeated blocks.
  const mixed = writePoscar({ title: "mixed", atoms: [{ element: "O", x: 0, y: 0, z: 0 }, { element: "H", x: 1, y: 0, z: 0 }, { element: "O", x: 0, y: 1, z: 0 }], cell: [[5, 0, 0], [0, 5, 0], [0, 0, 5]] });
  expect(mixed.split("\n").slice(5, 7)).toEqual(["O H O", "1 1 1"]);
  expect(readPoscar(mixed).atoms.map(atom => atom.element)).toEqual(["O", "H", "O"]);
});

test("POSCAR: VASP 4 species from the comment line, three scale factors and refusals", () => {
  const vasp4 = "Si\n1.0\n5.431 0 0\n0 5.431 0\n0 0 5.431\n2\nDirect\n0 0 0\n0.25 0.25 0.25\n";
  expect(readPoscar(vasp4).atoms.map(atom => atom.element)).toEqual(["Si", "Si"]);
  const scaled = readPoscar("cell\n2 1 0.5\n1 0 0\n0 1 0\n0 0 1\nC\n1\nCartesian\n1 1 1\n");
  expect(scaled.cell).toEqual([[2, 0, 0], [0, 1, 0], [0, 0, 0.5]]);
  expect([scaled.atoms[0].x, scaled.atoms[0].y, scaled.atoms[0].z]).toEqual([2, 1, 0.5]);
  expect(() => readPoscar("no names\n1\n1 0 0\n0 1 0\n0 0 1\n1\nDirect\n0 0 0\n")).toThrow("does not name its elements");
  expect(() => readPoscar("x\n1\n1 0 0\n2 0 0\n0 0 1\nC\n1\nDirect\n0 0 0\n")).toThrow("not independent");
  expect(() => readPoscar("x\n1\n1 0 0\n0 1 0\n0 0 1\nC\n2\nDirect\n0 0 0\n")).toThrow("position 2");
  expect(["POSCAR", "CONTCAR", "CONTCAR_relaxed", "Si.vasp", "a/b/POSCAR"].map(isPoscarFileName)).toEqual([true, true, true, true, true]);
  expect(["poscar.txt", "POSCARS", "notes"].map(isPoscarFileName)).toEqual([false, false, false]);
});

test("a CIF listing boundary copies of its sites reads as the eight atoms of rock salt", async () => {
  const document = await read("nacl-duplicates.cif");
  expect(document.atoms.map(atom => atom.element).sort()).toEqual(["Cl", "Cl", "Cl", "Cl", "Na", "Na", "Na", "Na"]);
});

test.each(["urea.cif", "rutile.cif", "quartz.cif", "triclinic-molecule.xyz"])("%s: periodic bonds match ASE's minimum-image neighbour list", async (name) => {
  const expected = reference.fixtures[name].periodicBonds!;
  const document = await read(name);
  const matches = matchSites(document.atoms, document.cell, reference.fixtures[name].sites);
  const ours = perceivePeriodicBonds(document.atoms, document.cell).map(bond => bondKey(matches[bond.a].site, matches[bond.b].site, bond.image.map((value, axis) => value + matches[bond.b].shift[axis] - matches[bond.a].shift[axis])));
  expect(new Set(ours).size).toBe(ours.length);
  expect([...ours].sort()).toEqual(expected.bonds.map(([a, b, image]) => bondKey(a, b, image)).sort());
});

test("whole molecules: urea and the wrapped methanol come back contiguous, quartz stays a network", async () => {
  for (const name of ["urea.cif", "triclinic-molecule.xyz"]) {
    const document = await read(name);
    const bonds = perceivePeriodicBonds(document.atoms, document.cell);
    expect(bonds.some(bond => bond.image.some(Boolean))).toBe(true);
    const whole = wholeMolecules(document.atoms, document.cell);
    const shape = (fragments: { atoms: number[]; periodic: boolean }[]) => fragments.map(fragment => `${fragment.atoms.length}:${fragment.periodic}`).sort();
    expect(shape(whole.fragments)).toEqual(shape(reference.fixtures[name].periodicBonds!.fragments));
    // After moving whole molecules, every bond joins atoms in the same image.
    expect(perceivePeriodicBonds(whole.atoms, document.cell).every(bond => bond.image.every(value => value === 0))).toBe(true);
    // Each molecule's centre lies in the cell, and every atom moved by whole cells only.
    whole.atoms.forEach((atom, index) => {
      const delta = fractional([atom.x - document.atoms[index].x, atom.y - document.atoms[index].y, atom.z - document.atoms[index].z], document.cell);
      delta.forEach(value => expect(Math.abs(value - Math.round(value))).toBeLessThan(1e-9));
    });
    for (const fragment of whole.fragments) {
      const centre = [0, 1, 2].map(axis => fragment.atoms.reduce((sum, atom) => sum + fractional([whole.atoms[atom].x, whole.atoms[atom].y, whole.atoms[atom].z], document.cell)[axis], 0) / fragment.atoms.length);
      // A molecule centred on a face may sit on either side of it.
      centre.forEach(value => { expect(value).toBeGreaterThan(-1e-9); expect(value).toBeLessThan(1 + 1e-9); });
    }
  }
  const quartz = await read("quartz.cif");
  const network = wholeMolecules(quartz.atoms, quartz.cell);
  expect(network.fragments).toEqual([{ atoms: quartz.atoms.map((_, index) => index), periodic: true }]);
  expect(network.atoms).toEqual(quartz.atoms);
});

test("the viewer's crystal view keeps atom order and only moves atoms by lattice vectors", async () => {
  const raw = await read("urea.cif"), view = await readCrystalView({ format: "cif", text: fixtureText("urea.cif") });
  expect(view.atoms.map(atom => atom.element)).toEqual(raw.atoms.map(atom => atom.element));
  expect(view.atoms).not.toEqual(raw.atoms);
});

test.each(["urea.cif", "si.poscar", "CONTCAR", "triclinic-molecule.xyz"])("%s survives a write in each format with exact fractional coordinates", async (name) => {
  const document = await read(name);
  for (const format of ["cif", "xyz", "vasp"] as const) {
    const text = writeCrystalDocument(format, document);
    const again = await readCrystalDocument({ format, text });
    expect(again.atoms.map(atom => atom.element)).toEqual(document.atoms.map(atom => atom.element));
    again.atoms.forEach((atom, index) => {
      const f = fractional([atom.x, atom.y, atom.z], again.cell), g = fractional([document.atoms[index].x, document.atoms[index].y, document.atoms[index].z], document.cell);
      f.forEach((value, axis) => { const d = value - g[axis]; expect(Math.abs(d - Math.round(d))).toBeLessThan(1e-9); });
    });
    if (format !== "cif") expect(again.cell).toEqual(document.cell);
  }
});

test("an extended XYZ write keeps the rest of the comment and replaces only the lattice", async () => {
  const document = await read("triclinic-molecule.xyz");
  const text = writeCrystalDocument("xyz", { ...document, title: 'Lattice="1 0 0 0 1 0 0 0 1" energy=-12.5 Properties=species:S:1:pos:R:3 pbc="T T T" note' });
  const comment = text.split("\n")[1];
  expect(comment.match(/Lattice=/gu)).toHaveLength(1);
  expect(comment).toContain("energy=-12.5");
  expect(comment).toContain("note");
  expect((await readCrystalDocument({ format: "xyz", text })).cell).toEqual(document.cell);
});

test("a CIF with operations lists only the given atoms and expands back", async () => {
  const cif = writeCrystalCif({
    atoms: [{ element: "Na", x: 0, y: 0, z: 0 }, { element: "Cl", x: 2.8201, y: 2.8201, z: 2.8201 }],
    cell: [[5.6402, 0, 0], [0, 5.6402, 0], [0, 0, 5.6402]], species: ["Na", "Cl"], labels: ["Na1", "Cl1"],
  }, "nacl", [
    { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] },
    { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0.5, 0.5] },
    { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0.5, 0, 0.5] },
    { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0.5, 0.5, 0] },
  ], null);
  expect(cif).toContain("'x,y+1/2,z+1/2'");
  expect((await readCrystalDocument({ format: "cif", text: cif })).atoms).toHaveLength(8);
});
