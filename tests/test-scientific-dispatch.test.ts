import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BOHR_ANGSTROM, displaceNormalMode, gridToCube, parseScientificFile, scientificFrameToXyz, type ScalarGrid } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { evaluateOrbitalGrid } from "../apps/desktop/src/lib/molecular-workbench/gaussian";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/quantum/dispatcher/${name}`, import.meta.url), "utf8");
const hydrogenMolden = fixture("hydrogen.molden"), hessian = fixture("normal-modes.hess");

test("Gaussian grid -> cube round trip retains values, origin and coordinates", () => {
  const document = parseScientificFile("h.molden", hydrogenMolden);
  const grid = evaluateOrbitalGrid(document, 0, { spacingAngstrom: 0.5, paddingAngstrom: 1 });
  expect(grid.dimensions).toEqual([5, 5, 5]);
  const restored = parseScientificFile("h.cube", gridToCube(grid, document.atoms));
  expect(restored.grid!.origin[0]).toBeCloseTo(-1, 8);
  expect(restored.atoms).toEqual(document.atoms);
  for (let i = 0; i < grid.values.length; i++) expect(restored.grid!.values[i]).toBeCloseTo(grid.values[i], 6);
});

test("Cube supports nonorthogonal axes and explicit angstrom grid counts", () => {
  const result = parseScientificFile("field.cub", "comment\ncomment\n1 1 2 3\n-2 1 0 0\n-1 0.5 1 0\n-1 0 0.5 1\n8 0 1 2 3\n0.1 -0.2\n");
  expect(result.atoms).toEqual([{ element: "O", x: 1, y: 2, z: 3 }]);
  expect(result.grid!.axes).toEqual([[1, 0, 0], [0.5, 1, 0], [0, 0.5, 1]]);
  expect(result.grid!.dimensions).toEqual([2, 1, 1]);
  expect(Array.from(result.grid!.values)).toEqual([Math.fround(0.1), Math.fround(-0.2)]);
});

test("Cube rejects overflowing vectors and every out-of-range corner before rendering/export", () => {
  const cube = "comment\ncomment\n1 0 0 0\n-2 1 0 0\n-2 0.5 1 0\n-1 0 0 1\n1 0 0 0 0\n0 0 0 0\n";
  expect(() => parseScientificFile("axis.cube", cube.replace("-2 1 0 0", "-2 1e308 0 0"))).toThrow("coordinates exceed");
  expect(() => parseScientificFile("origin.cube", cube.replace("1 0 0 0\n-2", "1 1e308 0 0\n-2"))).toThrow("coordinates exceed");
  expect(() => parseScientificFile("corners.cube", cube.replace("-2 1 0 0", "-2 600000 0 0").replace("-2 0.5 1 0", "-2 600000 1 0"))).toThrow("grid corners");
  const valid = parseScientificFile("valid.cube", cube);
  const malformed: ScalarGrid = { ...valid.grid!, axes: [[1e308, 0, 0], [0, 1, 0], [0, 0, 1]] };
  expect(() => gridToCube(malformed, valid.atoms)).toThrow("coordinates exceed");
  const cancelling: ScalarGrid = { ...valid.grid!, dimensions: [3, 3, 1], axes: [[600000, 0, 0], [-600000, 1, 0], [0, 0, 1]], values: new Float32Array(9) };
  expect(() => gridToCube(cancelling, valid.atoms)).toThrow("grid corners");
});

test("XYZ frames preserve identity and label energies only with explicit Hartree units", () => {
  const document = parseScientificFile("steps.xyz", "1\nenergy=-0.5 Hartree\nH 0 0 0\n1\n-0.4\nH 0 0 1\n");
  expect(document.frames.map(frame => frame.energyHartree)).toEqual([-0.5, undefined]);
  expect(scientificFrameToXyz(document.frames[0])).toContain("Energy=-0.5 Hartree");
  expect(() => parseScientificFile("bad.xyz", "1\n\nH 0 0 0\n1\n\nHe 0 0 0\n")).toThrow("identity");
});

test("ORCA geometry steps retain their energies and frequency indices", () => {
  const document = parseScientificFile("calc.out", fixture("two-step-orca.out"));
  expect(document.frames.map(frame => frame.energyHartree)).toEqual([-1.1, -1.2]);
  expect(document.converged).toBe(true);
  expect(document.atoms[1].z).toBe(0.7);
  expect(document.orbitals.map(o => [o.energyHartree, o.occupancy, o.coefficients])).toEqual([[-0.5, 2, []], [0.2, 0, []]]);
  expect(document.modes[1]).toEqual({ index: 1, frequencyCm1: -12.5, intensityKmMol: 3.2, displacements: [[0.1, 0, -0.1], [-0.1, 0, 0.1]] });
  const displaced = displaceNormalMode(document.atoms, document.modes[1], 0.5, Math.PI / 2);
  expect(Math.hypot(displaced[0].x, displaced[0].z)).toBeCloseTo(0.5, 12);
  expect(displaceNormalMode(document.atoms, document.modes[1], 0.5, 0)).toEqual(document.atoms);
});

test("ORCA older T**2 spectrum is not incorrectly labelled km/mol", () => {
  const document = parseScientificFile("old.out", `CARTESIAN COORDINATES (ANGSTROEM)\n---\nH 0 0 0\n\nVIBRATIONAL FREQUENCIES\n0: 123 cm**-1\nIR SPECTRUM\nMode freq (cm**-1) T**2 TX TY TZ\n0: 123 2.0 (0 0 0)\n`);
  expect(document.modes).toEqual([{ index: 0, frequencyCm1: 123, transitionDipoleSquared: 2 }]);
});

test("ORCA Hessian maps bohr atom positions and mode matrix columns", () => {
  const document = parseScientificFile("calc.hess", hessian);
  expect(document.atoms).toEqual([{ element: "H", x: 0, y: 0, z: BOHR_ANGSTROM }]);
  expect(document.modes[2]).toEqual({ index: 2, frequencyCm1: 100, displacements: [[0, 0, 1]] });
  expect(() => parseScientificFile("truncated.hess", hessian.replace("2 0.0 0.0 1.0", ""))).toThrow("Truncated");
});

test("Malformed and unsupported scientific files fail without guessed fields", () => {
  expect(() => parseScientificFile("bad.molden", hydrogenMolden.replace("s 1 1.00", "h 1 1.00"))).toThrow("not supported");
  expect(() => parseScientificFile("bad.molden", hydrogenMolden.replace("1 1.0\nSym", "2 1.0\nSym"))).toThrow("coefficient");
  expect(() => parseScientificFile("bad.molden", hydrogenMolden.replace("1.0D+00", "-1.0"))).toThrow("exponent");
  expect(() => parseScientificFile("binary.gbw", "\0")).toThrow("binary");
  expect(() => parseScientificFile("bad.cube", "a\nb\n-1 0 0 0\n")).toThrow("Multi-orbital");
  expect(() => evaluateOrbitalGrid(parseScientificFile("h.molden", hydrogenMolden), 0, { spacingAngstrom: 0.1, paddingAngstrom: 10 })).toThrow("limit");
});

test("the dispatcher retains Gaussian, QCSchema, FCHK and editable Z-matrix formats", () => {
  for (const [name, text, format] of [
    ["water.log", fixture("../gaussian-water-optimization.log"), "gaussian-log"],
    ["water.qcschema", fixture("../qcschema-water-gradient.json"), "qcschema"],
    ["water.fch", fixture("../gaussian16-water-raman.fchk"), "fchk"],
  ] as const) {
    const doc = parseScientificFile(name, text);
    expect([doc.format, doc.atoms.length]).toEqual([format, 3]);
  }
  const zmat = parseScientificFile("carbon-dioxide.zmat", "C\nX 1 1\nO 1 R 2 90\nR=1.2\n");
  expect([zmat.format, zmat.atoms.map(atom => atom.element), zmat.internalCoordinates?.rows[1].element]).toEqual(["zmat", ["C", "O"], "X"]);
  expect(zmat.internalCoordinates?.variables).toEqual([{ name: "R", value: 1.2 }]);
});

test("dispatcher intake rejects binary and oversized UTF-8 before parsing", () => {
  expect(() => parseScientificFile("binary.xyz", "\0")).toThrow("binary");
  expect(() => parseScientificFile("large.xyz", "x".repeat(16 * 1024 * 1024 + 1))).toThrow("16 MiB");
  const multibyte = "1\n" + "漢".repeat(Math.ceil(16 * 1024 * 1024 / 3)) + "\nH 0 0 0\n";
  expect(multibyte.length).toBeLessThan(16 * 1024 * 1024);
  expect(() => { parseScientificFile("multibyte.xyz", multibyte); }).toThrow("16 MiB");
});
