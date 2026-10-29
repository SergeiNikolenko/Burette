import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseFchk } from "../apps/desktop/src/lib/molecular-workbench/fchk";
import { MAX_HESSIAN_DIMENSION, packedTriangleLength } from "../apps/desktop/src/lib/molecular-workbench/hessian";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
const water = readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url), "utf8");
const field = (key: string, value: number | number[]) => `${key.padEnd(40)}   ${/electrons|atoms|numbers|types|per shell|atom map|basis functions/u.test(key) ? "I" : "R"}   ${Array.isArray(value) ? `N= ${value.length}\n ${value.join(" ")}` : value}`;
const hydrogen = (beta = false) => "Analytic hydrogen\nSP UHF STO-1G\n" + Object.entries({
  "Number of atoms": 1, "Number of alpha electrons": 1, "Number of beta electrons": 0,
  "Atomic numbers": [1], "Current cartesian coordinates": [0, 0, 0], "Number of basis functions": 1,
  "Shell types": [0], "Number of primitives per shell": [1], "Shell to atom map": [1], "Primitive exponents": [1],
  "Contraction coefficients": [1], "Alpha Orbital Energies": [-0.5], "Alpha MO coefficients": [1],
  ...(beta ? { "Beta Orbital Energies": [0.2], "Beta MO coefficients": [1] } : {}),
}).map(([key, value]) => field(key, value)).join("\n");

test("real Gaussian FCHK retains source geometry, packed Hessian, masses and energy in declared units", () => {
  const result = parseFchk(water), hessian = result.frames[0].hessian!;
  expect(result.format).toBe("fchk"); expect(result.atoms.map(atom => atom.element)).toEqual(["O", "H", "H"]);
  expect(result.frames).toHaveLength(1); expect(result.frames[0].atoms).toBe(result.atoms);
  // Independent coordinates printed in angstroms by the same Gaussian run.
  const printed = [[-0.025297, 0, -0.019587], [0.013297, 0, 0.968957], [0.941422, 0, -0.229734]];
  result.atoms.forEach((atom, index) => [atom.x, atom.y, atom.z].forEach((value, axis) => expect(Math.abs(value - printed[index][axis])).toBeLessThan(5.1e-7)));
  expect(result.frames[0].energyHartree).toBe(-74.96590118929858);
  expect({ units: hessian.units, dimension: hessian.dimension, source: hessian.source, masses: hessian.massesAmu })
    .toEqual({ units: "hartree/bohr^2", dimension: 9, source: "gaussian-fchk", masses: [15.9949146, 1.00782504, 1.00782504] });
  expect(hessian.values).toBeInstanceOf(Float64Array);
  expect([hessian.values[0], hessian.values[9], hessian.values[1], hessian.values[10], hessian.values[18], hessian.values[2], hessian.values[20], hessian.values[80]])
    .toEqual([0.698573806, -6.64719584e-16, -6.64719584e-16, -1.35231273e-4, -0.0819412042, -0.0819412042, 0.740956701, 0.118957335]);
  expect(validateScientificDocument(result, [{ elements: result.atoms.map(atom => atom.element), positions: Float64Array.from(result.atoms.flatMap(atom => [atom.x, atom.y, atom.z])) }])).toBe(result);
});

test("FCHK mode quantities match the independently printed Gaussian table and share their source frame", () => {
  const result = parseFchk(water);
  expect(result.frames[0].modes).toBe(result.modes);
  const printed = [[2169.8754, 1.0785, 2.9918, 7.245, 9.2638, 0.7246, 0.8403], [4141.2918, 1.0491, 10.6007, 44.2824, 47.7964, 0.1791, 0.3038], [4392.3985, 1.0774, 12.2466, 29.9557, 21.5447, 0.75, 0.8571]];
  expect(result.modes.map(mode => mode.index)).toEqual([1, 2, 3]);
  result.modes.forEach((mode, index) => {
    const values = [mode.frequencyCm1, mode.reducedMassAmu, mode.forceConstantMdynAngstrom, mode.intensityKmMol, mode.ramanActivityAngstrom4Amu, mode.ramanDepolarizationRatio, mode.ramanDepolarizationRatioUnpolarized];
    values.forEach((value, column) => expect(Math.abs(value! - printed[index][column])).toBeLessThan(5.1e-5));
  });
  expect(result.modes[0].displacements).toHaveLength(3);
  expect(result.modes[0].displacements![0]).toEqual([-5.42956578e-2, -2.68605018e-34, -4.20401897e-2]);
  expect(result.modes[0].displacements![2]).toEqual([1.56575641e-1, -1.09774337e-32, 6.87841819e-1]);
  expect(parseFchk(water.replace("2.16987538E+03", "-2.16987538E+03")).modes.map(mode => mode.frequencyCm1)).toEqual([-2169.87538, 4141.29177, 4392.3985]);
});

test("zero intensities stay known only when source derivatives establish that they were computed", () => {
  const zeroIr = water.replace("7.24502214E+00", "0.00000000E+00").replace("4.42823895E+01  2.99556673E+01", "0.00000000E+00  0.00000000E+00");
  expect(parseFchk(zeroIr).modes.map(mode => mode.intensityKmMol)).toEqual([0, 0, 0]);
  const absent = zeroIr.replace(/^Dipole Derivatives[^\n]*\n(?:[ \t][^\n]*\n)*/mu, "");
  expect(absent).not.toContain("Dipole Derivatives");
  expect(parseFchk(absent).modes.map(mode => mode.intensityKmMol)).toEqual([undefined, undefined, undefined]);
  const noRaman = water.replace("9.26382035E+00  4.77963791E+01  2.15446685E+01", "0.00000000E+00  0.00000000E+00  0.00000000E+00")
    .replace(/^Polarizability Derivatives[^\n]*\n(?:[ \t][^\n]*\n)*/mu, "");
  expect(noRaman).not.toContain("Polarizability Derivatives");
  expect(parseFchk(noRaman).modes.map(mode => [mode.ramanActivityAngstrom4Amu, mode.ramanDepolarizationRatio, mode.ramanDepolarizationRatioUnpolarized])).toEqual(Array.from({ length: 3 }, () => [undefined, undefined, undefined]));
});

test("restricted open-shell and unrestricted orbital records preserve occupations, coefficients and shell ownership", () => {
  for (const beta of [true, false]) {
    const result = parseFchk(hydrogen(beta));
    expect(result.atoms).toEqual([{ element: "H", x: 0, y: 0, z: 0 }]);
    expect(result.basis).toEqual([{ atomIndex: 0, exponents: [1], coefficients: [1], spherical: false, cartesianOrder: "gaussian", kind: "s" }]);
    expect(result.orbitals).toEqual([{ index: 0, spin: "alpha", occupancy: 1, energyHartree: -0.5, coefficients: [1] }, { index: 1, spin: "beta", occupancy: 0, energyHartree: beta ? 0.2 : -0.5, coefficients: [1] }]);
  }
});

test("FCHK refuses malformed Hessian, frequency, source and orbital records without partial data", () => {
  const mutations = [
    water.replace("Cartesian Force Constants                  R   N=          45", `Cartesian Force Constants                  R   N= ${packedTriangleLength(MAX_HESSIAN_DIMENSION + 3)}`),
    water.replace("Cartesian Force Constants                  R   N=          45", "Cartesian Force Constants                  R   N=          44"),
    water.replace(" 4.53781830E-16 -1.65989594E-02 -1.36593063E-01  7.41483178E-17  1.18957335E-01\n", ""),
    water.replace("1.18957335E-01", "1.18957335E+999"),
    water + "Cartesian Force Constants                  R   N=           6\n 1 2 3 4 5 6\n",
    water.replace("Vib-LE2Fix                                 I               14", "Vib-LE2Fix                                 I               13"),
    water.replace("Number of Normal Modes                     I                3", "Number of Normal Modes                     I               10"),
    water.replace("Vib-NDim                                   I                3", "Vib-NDim                                   I                2"),
    water.replace("7.24502214E+00", "-7.24502214E+00"),
    water.replace("7.24569765E-01", "1.72456977E+00"),
    water.replace("Vib-AtMass                                 R   N=           3\n  1.59949146E+01", "Vib-AtMass                                 R   N=           3\n -1.59949146E+01"),
    water.replace(/Number of Normal Modes {2,}I +3\n/u, ""),
  ];
  for (const invalid of mutations) { expect(invalid).not.toBe(water); expect(() => parseFchk(invalid)).toThrow(); }
  const minimal = hydrogen();
  for (const invalid of [minimal.replace(/(Shell types[^\n]*\n) 0/u, "$1 7"), minimal.replace(field("Alpha MO coefficients", [1]), field("Alpha MO coefficients", [1, 1])), minimal + "\n" + field("Number of atoms", 1), minimal.replace(/(Primitive exponents[^\n]*\n) 1/u, "$1 1E999"), minimal + "\0", "x".repeat(16 * 1024 * 1024 + 1)]) expect(() => parseFchk(invalid)).toThrow();
});

test("FCHK browser dependency closure excludes the absent quantum dispatcher and field evaluators", async () => {
  const loaded: string[] = [], result = await Bun.build({ entrypoints: [new URL("../apps/desktop/src/lib/molecular-workbench/fchk.ts", import.meta.url).pathname], target: "browser",
    plugins: [{ name: "fchk-closure", setup(build) { build.onLoad({ filter: /\.[cm]?[jt]sx?$/u }, ({ path }) => { loaded.push(path); }); } }] });
  expect(result.success).toBe(true);
  expect(loaded.some(path => path.endsWith("/hessian.ts"))).toBe(true);
  expect(loaded.filter(path => /\/(?:quantum|gaussian|quantum-client|science-worker|science-task)\.[cm]?[jt]s$/u.test(path))).toEqual([]);
});


test("Fortran D exponents and CRLF preserve the same parsed scientific values", () => {
  expect(parseFchk(water.replace(/E([+-]\d+)/gu, "D$1").replaceAll("\n", "\r\n"))).toEqual(parseFchk(water));
});

test("FCHK refuses missing frequencies and incompatible Cartesian normal-mode vectors", () => {
  const withoutFrequency = water.replace(/^Vib-E2[^\n]*\n(?:[ \t][^\n]*\n)*/mu, "");
  expect(withoutFrequency).not.toContain("Vib-E2 "); expect(() => parseFchk(withoutFrequency)).toThrow("no frequencies");
  const withoutVectors = water.replace(/^Vib-Modes[^\n]*\n(?:[ \t][^\n]*\n)*/mu, "");
  expect(withoutVectors).not.toContain("Vib-Modes ");
  expect(() => parseFchk(withoutVectors + "\n" + field("Vib-Modes", Array(26).fill(0)))).toThrow("Vib-Modes length");
});


const header = (key: string, tail: string) => `${key.padEnd(40)}   ${tail}`;

test("independent: malformed derivative records cannot certify a computed all-zero spectrum", () => {
  const zero = water.replace("7.24502214E+00", "0.00000000E+00").replace("4.42823895E+01  2.99556673E+01", "0.00000000E+00  0.00000000E+00");
  expect(parseFchk(zero).modes.map(mode => mode.intensityKmMol)).toEqual([0, 0, 0]);
  for (const replacement of [header("Dipole Derivatives", "R   N= 27") + "\n", header("Dipole Derivatives", "R   N= 0") + "\n", header("Dipole Derivatives", "C   N= 1") + "\nuncomputed\n"]) {
    const bad = zero.replace(/^Dipole Derivatives[^\n]*\n(?:[ \t][^\n]*\n)*/mu, replacement);
    expect(bad).not.toBe(zero);
    expect(() => parseFchk(bad)).toThrow();
  }
});

test("independent: scalar normal-mode metadata cannot silently consume a multi-value array", () => {
  for (const [key, first] of [["Number of Normal Modes", 3], ["Vib-NDim", 3], ["Vib-LE2Fix", 14]] as const) {
    const bad = water.replace(new RegExp(`^${key}[^\\n]*$`, "mu"), header(key, `I   N= 2\n ${first} 999999`));
    expect(bad).not.toBe(water);
    expect(() => parseFchk(bad)).toThrow();
  }
});

test("derivative provenance requires complete finite real arrays of the tensor's atom dimensions", () => {
  for (const [key, count] of [["Dipole Derivatives", 27], ["Polarizability Derivatives", 54]] as const) {
    const record = new RegExp(`^${key}[^\\n]*\\n(?:[ \\t][^\\n]*\\n)*`, "mu"), zeros = Array(count).fill(0).join(" ");
    for (const replacement of [header(key, `R   N= ${count - 1}\n ${Array(count - 1).fill(0).join(" ")}\n`), header(key, `R   N= ${count}\n ${zeros.replace(/^0/u, "1E999")}\n`), header(key, `I   N= ${count}\n ${zeros}\n`), header(key, "R   0\n")]) {
      const bad = water.replace(record, replacement);
      expect(bad).not.toBe(water); expect(() => parseFchk(bad)).toThrow();
    }
  }
});
