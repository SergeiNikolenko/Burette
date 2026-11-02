import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BOHR_TO_ANGSTROM, COORDINATE_PRESETS, coordinateSpecError, MAX_COORDINATE_BLOCK_BYTES, detectCoordinateSpec, generateCoordinateBlock, parseCoordinateBlock,
  type CoordinateBlockFormat,
} from "../apps/desktop/src/lib/molecular-workbench/coordinate-block";
import type { MolecularAtom, UnitCell } from "../apps/desktop/src/lib/molecular-workbench/types";

// Oracles: tests/support/regenerate-coordinate-block-oracles.py (Open Babel 3.2.1 writers/readers, gemmi 0.7.5).
const FIXTURES = new URL("./fixtures/coordinate-block/", import.meta.url);
const CASES = ["bromochlorofluoromethane", "l-alanine", "s-1-phenylethanol", "water-dimer"];
const read = (name: string) => readFileSync(new URL(name, FIXTURES), "utf8");
const xyzAtoms = (text: string): MolecularAtom[] => text.trim().split("\n").slice(2).map(line => {
  const [element, x, y, z] = line.trim().split(/\s+/u);
  return { element, x: Number(x), y: Number(y), z: Number(z) };
});
const source = (name: string) => xyzAtoms(readFileSync(new URL(`./fixtures/zmatrix-reference/${name}.xyz`, import.meta.url), "utf8"));
const format = (id: string): CoordinateBlockFormat => {
  const preset = COORDINATE_PRESETS.find(item => item.id === id)!;
  return { spec: preset.spec, mode: preset.mode, unit: preset.unit ?? "angstrom" };
};
const between = (text: string, start: (line: string) => boolean, end: (line: string) => boolean) => {
  const lines = text.split("\n"), from = lines.findIndex(start) + 1;
  return lines.slice(from, from + lines.slice(from).findIndex(end)).join("\n");
};
// The coordinate block inside each Open Babel output and the Burette preset that reads it.
const WRITERS: Record<string, { preset: string; block: (text: string) => string; precision: number }> = {
  gamin: { preset: "gamess-symbols", block: text => between(text, line => line === "C1", line => line.trim() === "$END"), precision: 1e-10 },
  // Open Babel converts with the CODATA 2002 radius 0.5291772108 Å: 2.6e-10 relative to CODATA 2022.
  tmol: { preset: "turbomole", block: text => between(text, line => line === "$coord", line => line === "$end"), precision: 3e-9 },
  mopcrt: { preset: "mopac-cartesian", block: text => text.split("\n").slice(3).join("\n"), precision: 1e-5 },
  com: { preset: "gaussian-cartesian", block: text => between(text, line => line === "0  1", line => !line.trim()), precision: 1e-5 },
  orcainp: { preset: "orca-cartesian", block: text => between(text, line => line.startsWith("* xyz"), line => line === "*"), precision: 1e-5 },
  nw: { preset: "xyz-symbols", block: text => between(text, line => line.startsWith("geometry "), line => line === "end"), precision: 1e-5 },
  mp: { preset: "xyz-symbols", block: text => between(text, line => line === "Geometry specification:", line => line === "}"), precision: 1e-5 },
  gukin: { preset: "gamess-uk", block: text => between(text, line => line === "geometry angstrom", line => line === "end"), precision: 1e-8 },
};
const worst = (a: MolecularAtom[], b: MolecularAtom[]) => {
  expect(a.map(atom => atom.element)).toEqual(b.map(atom => atom.element));
  return Math.max(...a.flatMap((atom, i) => [atom.x - b[i].x, atom.y - b[i].y, atom.z - b[i].z].map(Math.abs)));
};
const distance = (a: MolecularAtom, b: MolecularAtom) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// Pairwise distances fix the shape up to reflection; signed volumes fix the handedness.
const shapeError = (a: MolecularAtom[], b: MolecularAtom[]) => {
  expect(a.map(atom => atom.element)).toEqual(b.map(atom => atom.element));
  const volume = (atoms: MolecularAtom[], i: number, j: number, k: number, l: number) => {
    const [u, v, w] = [j, k, l].map(n => [atoms[n].x - atoms[i].x, atoms[n].y - atoms[i].y, atoms[n].z - atoms[i].z]);
    return u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]);
  };
  let error = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) error = Math.max(error, Math.abs(distance(a[i], a[j]) - distance(b[i], b[j])));
  for (let i = 3; i < a.length; i++) {
    const [p, q] = [volume(a, 0, 1, 2, i), volume(b, 0, 1, 2, i)];
    if (Math.abs(q) > 1e-3) expect(Math.sign(p)).toBe(Math.sign(q));
    error = Math.max(error, Math.abs(p - q));
  }
  return error;
};
const results: Record<string, number> = {};
const record = (key: string, value: number) => { results[key] = Math.max(results[key] ?? 0, value); return value; };

test("independent: Burette reads every Open Babel coordinate writer back to the source atoms", () => {
  for (const name of CASES) {
    const atoms = source(name);
    for (const [writer, { preset, block, precision }] of Object.entries(WRITERS)) {
      const parsed = parseCoordinateBlock(block(read(`${name}.openbabel.${writer}`)), format(preset));
      expect(parsed.errors).toEqual([]);
      expect(record(`openbabel ${writer} -> ${preset}`, worst(parsed.atoms, atoms))).toBeLessThan(precision);
    }
    // MOPAC internal coordinates in Open Babel's own references, 0–360° dihedrals and
    // standard orientation: rebuilt by the existing Z-matrix code.
    const mopin = parseCoordinateBlock(read(`${name}.openbabel.mopin`).split("\n").slice(3).join("\n"), format("mopac-zmatrix"));
    expect(mopin.errors).toEqual([]);
    expect(record("openbabel mopin -> mopac-zmatrix (shape)", shapeError(mopin.atoms, atoms))).toBeLessThan(5e-5);
  }
  console.log(JSON.stringify({ readerMaxDeviationAngstrom: results }));
});

test("independent: Open Babel reads Burette's generated blocks back to the source atoms", () => {
  const readback: Record<string, number> = {};
  for (const name of CASES) {
    const atoms = source(name);
    for (const [preset, reader, zmatrix] of [["gamess-symbols", "gamin"], ["turbomole", "tmol"], ["mopac-cartesian", "mopcrt"], ["gamess-uk", "gukin"],
      ["xyz-symbols", "xyz"], ["mopac-zmatrix", "mopin", true], ["gaussian-zmatrix", "gzmat", true]] as const) {
      // The committed Open Babel input is exactly what the current generator writes.
      expect(read(`${name}.burette.${preset}.${reader}`)).toContain(generateCoordinateBlock(atoms, format(preset)));
      const back = xyzAtoms(read(`${name}.burette.${preset}.openbabel.xyz`));
      // Six written decimals, read back through Open Babel's five-decimal XYZ.
      const error = zmatrix ? shapeError(back, atoms) : worst(back, atoms);
      readback[`${preset} -> openbabel ${reader}`] = Math.max(readback[`${preset} -> openbabel ${reader}`] ?? 0, error);
      expect(error).toBeLessThan(zmatrix ? 3e-5 : 1.2e-5);
    }
  }
  console.log(JSON.stringify({ readbackMaxDeviationAngstrom: readback }));
});

test("independent: lattice coordinates match gemmi's fractionalization of a triclinic cell", () => {
  const oracle = JSON.parse(read("l-alanine.gemmi-fractional.json")) as { vectors: UnitCell; fractional: number[][] };
  const atoms = source("l-alanine");
  const lattice = { ...format("lattice-symbols"), cell: oracle.vectors };
  const block = generateCoordinateBlock(atoms, lattice);
  const fields = block.trim().split("\n").map(line => line.trim().split(/\s+/u).slice(1).map(Number));
  const fractionalError = Math.max(...fields.flatMap((row, i) => row.map((value, axis) => Math.abs(value - oracle.fractional[i][axis]))));
  expect(fractionalError).toBeLessThan(5.000001e-7);
  // Six fractional decimals in cells of up to 11.7 Å.
  const parsed = parseCoordinateBlock(block, lattice);
  expect(parsed.errors).toEqual([]);
  const cartesianError = worst(parsed.atoms, atoms);
  expect(cartesianError).toBeLessThan(1.5e-5);
  // Fractional fields never take the distance unit.
  expect(generateCoordinateBlock(atoms, { ...lattice, unit: "bohr" })).toBe(block);
  console.log(JSON.stringify({ gemmiFractionalMaxDeviation: fractionalError, latticeCartesianMaxDeviationAngstrom: cartesianError }));
});

test("Bohr fields use the CODATA 2022 Bohr radius 0.529177210544 Å", () => {
  const bohr = { spec: "Sxyz", mode: "cartesian", unit: "bohr" } as const;
  const atoms = [{ element: "H", x: 0.529177210544, y: -2 * 0.529177210544, z: 0 }];
  expect(generateCoordinateBlock(atoms, bohr)).toBe("H      1.000000   -2.000000    0.000000\n");
  expect(parseCoordinateBlock("H 1 -2.5 1e2", bohr).atoms).toEqual([{ element: "H", x: 0.529177210544, y: -2.5 * 0.529177210544, z: 100 * 0.529177210544 }]);
  expect(BOHR_TO_ANGSTROM).toBe(0.529177210544);
});

test("Avogadro field layout: labels, names, indices, GAMESS numbers, flags and separators", () => {
  const atoms = [{ element: "C", x: 1, y: -0, z: 2.5 }, { element: "H", x: 0, y: 0, z: 1 }, { element: "C", x: -12345.6789, y: 0, z: 0 }];
  expect(generateCoordinateBlock(atoms, { spec: "#_L_N_G_Z_x10", mode: "cartesian", unit: "angstrom" })).toBe([
    "1  C1   Carbon           6.0  6       1.000000 1 0",
    "2  H1   Hydrogen         1.0  1       0.000000 1 0",
    "3  C2   Carbon           6.0  6    -12345.678900 1 0", ""].join("\n"));
  expect(generateCoordinateBlock(atoms.slice(0, 1), { spec: "S,x,y,z_", mode: "cartesian", unit: "angstrom" })).toBe("C  ,   1.000000,  -0.000000,   2.500000  \n");
  expect(generateCoordinateBlock(atoms, { spec: "", mode: "cartesian", unit: "angstrom" })).toBe("");
  expect(generateCoordinateBlock(atoms, { spec: "Sabc", mode: "cartesian", unit: "angstrom" }).split("\n")[0]).toBe("C           N/A         N/A         N/A");
  expect(() => generateCoordinateBlock(atoms, { spec: "SxyzR", mode: "cartesian", unit: "angstrom" })).toThrow("Z-matrix format");
  // Any spec can be written; reading back needs an element and a complete position.
  expect(coordinateSpecError("xyz", "cartesian")).toBe("The format needs an element: S, N, L, Z or G.");
  expect(coordinateSpecError("Sxyb", "cartesian")).toBe("The format needs x, y and z, or a, b and c.");
  // Ten atoms widen the index column.
  const ten = Array.from({ length: 10 }, (_, i) => ({ element: "He", x: 3 * i, y: 0, z: 0 }));
  expect(generateCoordinateBlock(ten, { spec: "#S", mode: "cartesian", unit: "angstrom" }).split("\n")[0]).toBe("1  He ");
});

test("empty formats are detected from the first line as Avogadro does", () => {
  expect(detectCoordinateSpec("C 0.0 1 2")).toBe("Sxyz");
  expect(detectCoordinateSpec("6 0 0 0")).toBe("Zxyz");
  expect(detectCoordinateSpec("1 C 0.0 0.0 0.0")).toBe("Z?xyz");
  expect(detectCoordinateSpec("Carbon 1.0 2.0 3.0 extra")).toBe("Nxyz");
  expect(detectCoordinateSpec("1.0 2.0 3.0")).toBeNull();
  expect(detectCoordinateSpec("C 1.0 2.0")).toBeNull();
  const detected = parseCoordinateBlock("\n  o 0 0 0\nH 0.96 0 0\n\n", { spec: "", mode: "cartesian", unit: "angstrom" });
  expect(detected).toEqual({ atoms: [{ element: "O", x: 0, y: 0, z: 0 }, { element: "H", x: 0.96, y: 0, z: 0 }], errors: [] });
});

test("invalid lines are reported with their line numbers and nothing is parsed", () => {
  const xyz = format("xyz-symbols");
  expect(parseCoordinateBlock("C 0 0 0\n\nQ 1 0 0\nH 1 2\nH 1 2 x\nXx 0 0 0", xyz).errors).toEqual([
    { line: 3, message: "Invalid element symbol." }, { line: 4, message: "Too few entries on line." },
    { line: 5, message: "Invalid coordinate." }, { line: 6, message: "Dummy atoms are not supported here." },
  ]);
  expect(parseCoordinateBlock("C 6.0 0 0 0\nC 7.0 0 0 1", format("gamess-symbols")).errors).toEqual([{ line: 2, message: "The element fields on this line disagree." }]);
  expect(parseCoordinateBlock("C1 0 0 0\nH 0 0 1", { spec: "Lxyz", mode: "cartesian", unit: "angstrom" }).errors).toEqual([{ line: 2, message: "Invalid atom label." }]);
  expect(parseCoordinateBlock("C 1000001 0 0", xyz).errors).toEqual([{ line: 1, message: "Coordinates must be within ±1,000,000 Å." }]);
  expect(parseCoordinateBlock("C 0 0 0", format("lattice-symbols")).errors).toEqual([{ line: null, message: "Fractional coordinates need a unit cell." }]);
  expect(parseCoordinateBlock("C 0 0 0\n".repeat(513), xyz).errors).toEqual([{ line: null, message: "The coordinate editor supports up to 512 atoms." }]);
  expect(parseCoordinateBlock(" ".repeat(MAX_COORDINATE_BLOCK_BYTES) + "C 0 0 0", xyz).errors).toEqual([{ line: null, message: "The coordinates exceed 1 MiB." }]);
  // Extra trailing fields (the default custom format's "#N" comment) are ignored.
  expect(parseCoordinateBlock("C 6 1 2 3 1 Carbon trailing", { spec: "SZxyz#N", mode: "cartesian", unit: "angstrom" }).atoms).toEqual([{ element: "C", x: 1, y: 2, z: 3 }]);
});

test("unchanged fields keep the exact source coordinates; edited fields take the typed value", () => {
  const atoms = source("l-alanine");
  for (const preset of ["xyz-symbols", "turbomole", "gamess-names"]) {
    const block = generateCoordinateBlock(atoms, format(preset));
    expect(parseCoordinateBlock(block, { ...format(preset), reference: atoms }).atoms).toEqual(atoms);
  }
  const lines = generateCoordinateBlock(atoms, format("xyz-symbols")).split("\n");
  lines[4] = lines[4].replace(/^(\S+\s+)\S+/u, "$11.25");
  const edited = parseCoordinateBlock(lines.join("\n"), { ...format("xyz-symbols"), reference: atoms }).atoms;
  expect(edited).toEqual(atoms.map((atom, i) => i === 4 ? { ...atom, x: 1.25 } : atom));
  // A different atom count is read without the reference.
  expect(parseCoordinateBlock(lines.slice(0, 3).join("\n"), { ...format("xyz-symbols"), reference: atoms }).atoms[0].x).toBe(Number(atoms[0].x.toFixed(6)));
});

test("Z-matrix blocks reuse the existing rows: reference orientation, dummy rows and invalid references", () => {
  const atoms = source("s-1-phenylethanol");
  for (const preset of ["gaussian-zmatrix", "mopac-zmatrix", "orca-internal", "psi4-zmatrix", "molpro-zmatrix"]) {
    const block = generateCoordinateBlock(atoms, format(preset));
    // The untouched block is the reference itself; an edited one is rebuilt in its orientation.
    expect(parseCoordinateBlock(block, { ...format(preset), reference: atoms }).atoms).toEqual(atoms);
    const rebuilt = parseCoordinateBlock(block.replace(/\n/u, "\n\n"), { ...format(preset), reference: atoms });
    expect(record(`${preset} edited rebuild`, worst(rebuilt.atoms, atoms))).toBeLessThan(2e-5);
  }
  const gaussian = format("gaussian-zmatrix");
  // Linear N≡C–C needs a reference point; X rows place atoms and never become atoms.
  const linear = parseCoordinateBlock("N\nC 1 1.157\nX 2 1.0 1 90.0\nC 2 1.458 3 90.0 1 180.0\nH 4 1.09 2 110.0 3 0.0", gaussian);
  expect(linear.errors).toEqual([]);
  expect(linear.atoms.map(atom => atom.element)).toEqual(["N", "C", "C", "H"]);
  expect(distance(linear.atoms[0], linear.atoms[1])).toBeCloseTo(1.157, 12);
  expect(distance(linear.atoms[0], linear.atoms[2])).toBeCloseTo(1.157 + 1.458, 12);
  expect(parseCoordinateBlock("O\nH 1 0.96\nH 2 0.96 2 104.5", gaussian).errors).toEqual([{ line: 3, message: "References must be distinct earlier rows." }]);
  expect(parseCoordinateBlock("O\nH 1 0.96\nH 1 0.96 2 190", gaussian).errors).toEqual([{ line: 3, message: "Require positive distance, angle in [0,180], and dihedral in [-180,180]." }]);
  expect(parseCoordinateBlock("O\nH 1 0.96\nH 1 0.96 2 104.5", { ...gaussian, spec: "SIRJA" }).errors[0].message).toBe("A Z-matrix format needs I, J, K, R, A and T.");
});
