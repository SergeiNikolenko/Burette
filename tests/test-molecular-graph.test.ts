import { expect, test } from "bun:test";
import { Molecule } from "openchemlib";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";

const v3 = ["Mapped graph", "Burette", "", "  0  0  0     0  0            999 V3000",
  "M  V30 BEGIN CTAB", "M  V30 COUNTS 6 4 0 0 1", "M  V30 BEGIN ATOM",
  "M  V30 20 H 0 0 1 0", "M  V30 7 C 0 0 0 0 MASS=13 CFG=1", "M  V30 90 F 1 0 -1 0",
  "M  V30 4 Cl -1 1 -1 0", "M  V30 81 Br -1 -1 -1 0", "M  V30 55 N 4 2 3 0 CHG=1",
  "M  V30 END ATOM", "M  V30 BEGIN BOND", "M  V30 3 1 7 20", "M  V30 9 1 7 90",
  "M  V30 1 1 7 4", "M  V30 6 1 7 81", "M  V30 END BOND", "M  V30 END CTAB", "M  END", ""].join("\n");

// Inspect serialized physical coordinates independently, without reparsing them through the production helper.
function serializedAtoms(text: string) {
  const lines = text.split(/\r?\n/), start = lines.indexOf("M  V30 BEGIN ATOM"), end = lines.indexOf("M  V30 END ATOM");
  return lines.slice(start + 1, end).map(line => {
    const [, , id, element, x, y, z, , ...attributes] = line.split(/\s+/);
    return { id: Number(id), element, x: Number(x), y: Number(y), z: Number(z), attributes };
  });
}
function verifyPhysicalRows(graph: ReturnType<typeof parseMolecule>) {
  const rows = serializedAtoms(graph.molfile);
  expect(graph.atomMap!.map(index => {
    const { element, x, y, z } = rows[index]; return { element, x, y, z };
  })).toEqual(graph.atoms);
}

test("H-first V3000 gapped IDs retain source order, charges, isotope, stereo and serialized physical frame", () => {
  const graph = parseMolecule(v3, "mol");
  expect({ source: graph.graphSource, complete: graph.graphComplete, title: graph.title }).toEqual({ source: "explicit", complete: true, title: "Mapped graph" });
  expect(graph.atoms).toEqual([
    { element: "H", x: 0, y: 0, z: 1 }, { element: "C", x: 0, y: 0, z: 0 },
    { element: "F", x: 1, y: 0, z: -1 }, { element: "Cl", x: -1, y: 1, z: -1 },
    { element: "Br", x: -1, y: -1, z: -1 }, { element: "N", x: 4, y: 2, z: 3 },
  ]);
  expect(graph.bonds.map(bond => [Math.min(bond.a, bond.b), Math.max(bond.a, bond.b), bond.order]).sort()).toEqual([[0, 1, 1], [1, 2, 1], [1, 3, 1], [1, 4, 1]]);
  expect(graph.atomMap).not.toEqual([0, 1, 2, 3, 4, 5]); verifyPhysicalRows(graph);
  const rows = serializedAtoms(graph.molfile);
  expect(rows[graph.atomMap![1]].attributes).toContain("MASS=13");
  expect(rows[graph.atomMap![5]].attributes).toContain("CHG=1");
  const source = Molecule.fromMolfile(v3), result = Molecule.fromMolfile(graph.molfile);
  source.ensureHelperArrays(Molecule.cHelperParities); result.ensureHelperArrays(Molecule.cHelperParities);
  const center = Array.from({ length: source.getAllAtoms() }, (_, index) => index).find(index => source.getAtomMass(index) === 13)!;
  expect(source.getAtomParity(center)).not.toBe(0);
  expect(result.getIDCode()).toBe(source.getIDCode());
  expect(parseMolecule(v3 + "$$$$\n", "sdf").atoms).toEqual(graph.atoms);
});

function v2(z: number) {
  const row = (x: number, y: number, z: number, symbol: string) => `${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}${z.toFixed(4).padStart(10)} ${symbol.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`;
  return ["Physical V2", "Burette", "", "  2  1  0  0  0  0            999 V2000", row(1.25, -2.5, z, "C"), row(4.45, 1.75, -z, "O"), "  1  2  1  0  0  0  0", "M  END", ""].join("\n");
}
test("planar and nonplanar V2000 coordinates remain physical angstroms instead of diagram bond lengths", () => {
  for (const z of [0, 2.375]) {
    const graph = parseMolecule(v2(z), "mol");
    expect(graph.atoms).toEqual([{ element: "C", x: 1.25, y: -2.5, z }, { element: "O", x: 4.45, y: 1.75, z: -z || 0 }]);
    verifyPhysicalRows(graph);
    const [a, b] = serializedAtoms(graph.molfile);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(Math.hypot(3.2, 4.25, 2 * z), 10);
  }
});

test("XYZ perception preserves source-order H and separates complete neutral valence from uncertain connectivity", () => {
  const water = parseMolecule("3\nwater\nH .96 0 0\nO 0 0 0\nH -.24 .93 0\n", "xyz");
  expect({ source: water.graphSource, complete: water.graphComplete, elements: water.atoms.map(a => a.element), bonds: water.bonds.map(b => [Math.min(b.a, b.b), Math.max(b.a, b.b), b.order]).sort() })
    .toEqual({ source: "perceived", complete: true, elements: ["H", "O", "H"], bonds: [[0, 1, 1], [1, 2, 1]] });
  verifyPhysicalRows(water);
  for (const text of ["1\ncarbon\nC 0 0 0\n", "2\nunknown order\nC 0 0 0\nO 1.2 0 0\n", "1\nmetal\nFe 0 0 0\n"]) {
    const graph = parseMolecule(text, "xyz"); expect([graph.graphSource, graph.graphComplete]).toEqual(["perceived", false]);
  }
});

test("multiple records, invalid atom counts and oversized input are refused before graph publication", () => {
  expect(() => parseMolecule(v3 + "$$$$\n" + v3 + "$$$$\n", "sdf")).toThrow("one SDF record");
  for (const source of ["", "0\nempty\n", "257\nlarge\n" + "C 0 0 0\n".repeat(257), "1\nbad\nC NaN 0 0\n"]) expect(() => parseMolecule(source, "xyz")).toThrow();
  expect(() => parseMolecule(" ".repeat(2_000_001), "mol")).toThrow("2 MB");
});
