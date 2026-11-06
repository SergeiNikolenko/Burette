import { expect, test } from "bun:test";
import { readCjsonCrystal, readCjsonGraph, writeCjson } from "../apps/desktop/src/lib/molecular-workbench/cjson-graph";
import { periodicCrystalFormat, readCrystalDocument, readCrystalView, writeCrystalCif } from "../apps/desktop/src/lib/molecular-workbench/crystal-io";
import { parseXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { structureExportText } from "../apps/desktop/src/lib/workbench/structure-export";
import { readMolecularStructure, readWorkbenchSource } from "../apps/desktop/src/lib/workbench/structure";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { fixtureText } from "./crystal-reference";

// Export → Structure writes the document's own source; each result is read back by the
// reader that opens it and must carry the same atoms (and bonds and cell where the format has them).
const record = (title: string, x: number) => [title, "  Burette          3D", "", "  4  3  0  0  0  0            999 V2000",
  `${x.toFixed(4).padStart(10)}    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0`,
  `${(x + 1.2).toFixed(4).padStart(10)}    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0`,
  `${(x - 0.55).toFixed(4).padStart(10)}    0.9400    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0`,
  `${(x - 0.55).toFixed(4).padStart(10)}   -0.9400    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0`,
  "  1  2  2  0", "  1  3  1  0", "  1  4  1  0", "M  END", "> <origin>", "test", "", "$$$$"].join("\n");
const sdf = `${record("Formaldehyde", 0)}\n`, collection = `${sdf}${record("Shifted", 5)}\n`;
const doc = (title: string, extension: string, text: string): ViewerDocument =>
  ({ id: crypto.randomUUID(), title, path: `/${title}`, extension, renderer: "molstar", runtimePath: "/viewer", byteCount: text.length });
// Writers print to 1e-12, so compare at 1e-9.
const near = (value: number) => Math.round(value * 1e9) / 1e9 || 0;
const atoms = (list: { element: string; x: number; y: number; z: number }[]) => list.map(({ element, x, y, z }) => [element, ...[x, y, z].map(near)].join(" "));
const lattice = (cell: number[][]) => cell.flat().map(near);

test("an SDF exports as MOL, XYZ and CJSON that read back with the same atoms and bonds", async () => {
  const source = doc("formaldehyde.sdf", "sdf", sdf);
  const original = await readMolecularStructure(await readWorkbenchSource(source, sdf));
  // MOL is the first record as written, without its data items, for a collection too.
  const pair = doc("pair.sdf", "sdf", collection);
  expect(await structureExportText(pair, collection, "mol")).toBe(`${sdf.slice(0, sdf.indexOf("M  END"))}M  END\n`);
  await expect(structureExportText(pair, collection, "xyz")).rejects.toThrow("Open one SDF record at a time.");
  const xyz = parseXyz(await structureExportText(source, sdf, "xyz"));
  expect(atoms(xyz.atoms)).toEqual(atoms(original.atoms));
  const cjson = readCjsonGraph("formaldehyde.cjson", await structureExportText(source, sdf, "cjson"));
  expect([cjson.structure.title, atoms(cjson.structure.atoms), cjson.structure.bonds]).toEqual(["formaldehyde", atoms(original.atoms), original.bonds]);
});

test("a crystal keeps its cell in XYZ and CJSON, and its CIF fractions are rounded", async () => {
  const text = fixtureText("rutile.cif"), source = doc("rutile.cif", "cif", text);
  const cell = await readCrystalView({ format: "cif", text });
  const xyz = await structureExportText(source, text, "xyz");
  expect(periodicCrystalFormat("xyz", xyz)).toBe("xyz");
  const reread = await readCrystalDocument({ format: "xyz", text: xyz });
  expect([lattice(reread.cell), atoms(reread.atoms)]).toEqual([lattice(cell.cell), atoms(cell.atoms)]);
  const periodic = readCjsonCrystal(JSON.stringify(writeCjson({ atoms: cell.atoms, cell: cell.cell })))!;
  expect([lattice(periodic.cell), atoms(periodic.atoms)]).toEqual([lattice(cell.cell), atoms(cell.atoms)]);
  const cif = writeCrystalCif(cell, "rutile");
  expect(cif.split("_atom_site_occupancy")[1]).not.toMatch(/\d\.\d*(?:9{6}|0{6})\d|e-\d/u);
  expect((await readCrystalDocument({ format: "cif", text: cif })).atoms).toHaveLength(cell.atoms.length);
});
