import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { evaluateOrbital } from "../apps/desktop/src/lib/molecular-workbench/gaussian";
import type { Vec3 } from "../apps/desktop/src/lib/molecular-workbench/types";
import { readUnitCell } from "../apps/desktop/src/lib/molecular-workbench/crystal";
import { readCjsonGraph } from "../apps/desktop/src/lib/molecular-workbench/cjson-graph";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/cjson/${name}`, import.meta.url), "utf8");

test("an Avogadro CJSON's basis and orbitals reproduce the orbital cube Avogadro computed from them", () => {
  const document = parseScientificFile("formaldehyde.cjson", fixture("avogadro-formaldehyde-orbitals.cjson"));
  expect(document.basis?.map(shell => `${shell.kind}${shell.spherical ? "5" : ""}`).join(" ")).toBe("s s s p p d5 s s s p p d5 s s p s s p");
  expect(document.orbitals).toHaveLength(38);
  // Avogadro writes eV: the O 1s orbital at −521.115 eV is −19.1506 Eh.
  expect(document.orbitals[0].energyHartree).toBeCloseTo(-521.115181068 / 27.211386245988, 9);
  // 16 electrons fill the lowest eight orbitals when the file lists no occupations.
  expect(document.orbitals.map(orbital => orbital.occupancy).slice(0, 10)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 0, 0]);
  // Points of the LUMO cube in avogadrodata's formaldehyde.cjson (Å; bohr^-3/2), dropped from the fixture.
  const cube: [Vec3, number][] = [
    [[-0.4623992554, 0, 0.1856837485], 0.3365967869758606],
    [[-0.4623992554, 0, -0.1847434006], -0.3363324999809265],
    [[0.6442055071, 0, -0.1847434006], 0.30820995569229126],
    [[0.6442055071, -0.7431209526, -0.1847434006], 0.04939892515540123],
    [[0.6442055071, 0.7431209526, -0.1847434006], 0.04939892515540123],
  ];
  for (const [point, value] of cube) expect(evaluateOrbital(document, 8, point)).toBeCloseTo(value, 4);
});

test("Avogadro's vibrations keep their frequencies, intensities and atom displacements on the active coordinate set", () => {
  const text = fixture("avogadro-formaldehyde-raman.cjson"), source = JSON.parse(text);
  const document = parseScientificFile("raman.cjson", text);
  expect(document.frames).toHaveLength(21);
  expect(document.modes.map(mode => mode.frequencyCm1)).toEqual(source.vibrations.frequencies);
  const mode = document.modes[8];
  expect(mode).toMatchObject({ index: 8, intensityKmMol: source.vibrations.intensities[8], ramanActivityAngstrom4Amu: source.vibrations.ramanIntensities[8] });
  // Avogadro pads each eigenvector past 3N with zeros; only the four atoms' vectors remain.
  expect(mode.displacements).toEqual([0, 1, 2, 3].map(atom => source.vibrations.eigenVectors[8].slice(3 * atom, 3 * atom + 3)));
  expect(document.frames.every(frame => frame.modes === undefined)).toBe(true);
});

test("an unrestricted CJSON written by Avogadro keeps both spins and evaluates its alpha orbitals as PySCF does", () => {
  const text = fixture("avogadro-ch2-triplet-uhf.cjson"), { orbitals } = JSON.parse(text);
  const document = parseScientificFile("ch2.cjson", text);
  expect({
    spins: document.orbitals.map(orbital => orbital.spin).join(" "),
    energiesEv: document.orbitals.map(orbital => orbital.energyHartree * 27.211386245988),
    // The file carries multiplicity 1 and no occupations, so four electrons of each spin fill.
    occupancy: document.orbitals.map(orbital => orbital.occupancy),
  }).toEqual({
    spins: "alpha alpha alpha alpha alpha alpha alpha beta beta beta beta beta beta beta",
    energiesEv: [...orbitals.alphaEnergies, ...orbitals.betaEnergies].map((energy: number) => expect.closeTo(energy, 9)),
    occupancy: [1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
  });
  // PySCF's own UHF alpha orbitals 3 and 4 at these points (Å; bohr^-3/2), from avogadro-written/uhf.py.
  const points: Vec3[] = [[0.3, 0.2, 0.4], [0, 0.6, -0.2], [-0.25, -0.5, 0.3], [0.1, 0, -0.6]];
  const pyscf = { 3: [0.3007590986, -0.1182163009, 0.1543796572, -0.2165745381], 4: [0.2671138838, 0, -0.1480036665, 0.041703804] };
  for (const [orbital, values] of Object.entries(pyscf)) {
    points.forEach((point, n) => expect(evaluateOrbital(document, Number(orbital), point)).toBeCloseTo(values[n], 6));
  }
});

test("per-conformer vibrations written by Avogadro stay with the coordinate sets that carry them", () => {
  const text = fixture("avogadro-water-hessians.cjson"), { vibrations } = JSON.parse(text);
  const document = parseScientificFile("water.cjson", text);
  // Set 3 is active: its modes are the document's, set 0 keeps its own and sets 1 and 2 have none.
  expect({
    frames: document.frames.map(frame => frame.modes?.map(mode => [mode.frequencyCm1, mode.intensityKmMol]) ?? null),
    active: document.modes.map(mode => [mode.frequencyCm1, mode.intensityKmMol]),
  }).toEqual({
    frames: [vibrations.conformers["0"].frequencies.map((frequency: number, n: number) => [frequency, vibrations.conformers["0"].intensities[n]]), null, null, null],
    active: vibrations.frequencies.map((frequency: number, n: number) => [frequency, vibrations.intensities[n]]),
  });
  expect(vibrations.conformers["3"].frequencies).toEqual(vibrations.frequencies);
});

test("malformed CJSON science is refused with its reason", () => {
  const base = JSON.parse(fixture("avogadro-formaldehyde-raman.cjson"));
  const broken = (patch: (value: any) => void) => { const copy = structuredClone(base); patch(copy); return JSON.stringify(copy); };
  expect(() => parseScientificFile("x.cjson", broken(value => { value.vibrations.eigenVectors[0] = [1, 2, 3]; }))).toThrow("eigenvector does not match");
  expect(() => parseScientificFile("x.cjson", broken(value => { value.vibrations.intensities.pop(); }))).toThrow("IR intensities");
  const orbitals = JSON.parse(fixture("avogadro-formaldehyde-orbitals.cjson"));
  orbitals.basisSet.shellTypes[0] = 7;
  expect(() => parseScientificFile("x.cjson", JSON.stringify(orbitals))).toThrow("shell type 7");
});

test("a periodic CJSON opens as extended XYZ with its lattice, from cell parameters or cell vectors", () => {
  const rutile = parseScientificFile("rutile.cjson", fixture("avogadro-rutile.cjson"));
  expect(rutile.format).toBe("xyz");
  const cell = readUnitCell(rutile.frames[0].comment ?? "")!;
  expect(cell.map(vector => vector.map(value => Number(value.toFixed(6))))).toEqual([[2.95812, 0, 0], [0, 4.59373, 0], [0, 0, 4.59373]]);
  // Fractional (½, ½, ½) is the cell centre.
  expect(rutile.atoms[1]).toEqual({ element: "Ti", x: expect.closeTo(1.47906, 9), y: expect.closeTo(2.296865, 9), z: expect.closeTo(2.296865, 9) });
  const vectors = JSON.stringify({ chemicalJson: 1, unitCell: { cellVectors: [4, 0, 0, 1, 4, 0, 0, 0, 5] },
    atoms: { elements: { number: [18] }, coords: { "3dFractional": [0.5, 0.5, 0.5] } } });
  expect(parseScientificFile("argon.cjson", vectors).atoms).toEqual([{ element: "Ar", x: 2.5, y: 2, z: 2.5 }]);
  expect(() => readCjsonGraph("argon.cjson", vectors)).toThrow("cell-preserving");
});
