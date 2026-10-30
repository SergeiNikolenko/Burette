import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile, type VibrationalMode } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { broadenSpectrum, hessianJson, spectrumCsv, spectrumJson } from "../apps/desktop/src/lib/molecular-workbench/vibrational-spectrum";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/quantum/${name}`, import.meta.url), "utf8");
const methane = fixture("orca-3.0.2-methane.hess");
const water = fixture("gaussian16-water-raman.fchk");

// RFC 4180 fields: quoted cells may hold commas and doubled quotes.
function readCsv(text: string) {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const cells: string[] = [];
    let i = 0;
    while (i <= line.length) {
      if (line[i] === '"') {
        let value = "";
        for (i++; i < line.length; i++) {
          if (line[i] === '"' && line[i + 1] === '"') { value += '"'; i++; } else if (line[i] === '"') break; else value += line[i];
        }
        cells.push(value);
        i += 2;
      } else {
        const end = line.indexOf(",", i) < 0 ? line.length : line.indexOf(",", i);
        cells.push(line.slice(i, end));
        i = end + 1;
      }
    }
    rows.push(cells);
  }
  return rows;
}

test("a saved spectrum keeps every mode and quantity with its unit and source, missing values left empty", () => {
  const science = parseScientificFile("methane.hess", methane);
  const modes: VibrationalMode[] = [...science.modes, { index: 15, frequencyCm1: -12.5, symmetry: 'A"', intensityKmMol: 0 }];
  const provenance = { sourceName: "run, 1.hess\nignored", format: science.format, frame: 2, frameCount: 3 };
  const csv = spectrumCsv(modes, provenance);
  expect(csv.split("\n").slice(0, 3)).toEqual(["# source: run, 1.hess ignored", "# format: orca-hessian", "# geometry: frame 2 of 3"]);
  const [header, ...rows] = readCsv(csv);
  expect(header).toEqual(["mode", "frequency_cm-1", "symmetry", "ir_intensity_km/mol", "transition_dipole_squared_au", "raman_activity_A^4/amu",
    "raman_depolarization_plane", "raman_depolarization_unpolarized", "reduced_mass_amu", "force_constant_mdyn/A"]);
  expect(rows.length).toBe(16);
  const back = rows.map(([mode, frequency, symmetry, ir, t2, raman, plane, unpolarized, reduced, force]) => {
    const value = (cell: string) => (cell === "" ? undefined : Number(cell));
    return Object.fromEntries(Object.entries({ index: Number(mode), frequencyCm1: Number(frequency), symmetry: symmetry || undefined, intensityKmMol: value(ir),
      transitionDipoleSquared: value(t2), ramanActivityAngstrom4Amu: value(raman), ramanDepolarizationRatio: value(plane),
      ramanDepolarizationRatioUnpolarized: value(unpolarized), reducedMassAmu: value(reduced), forceConstantMdynAngstrom: value(force) }).filter(([, item]) => item !== undefined));
  });
  expect(back).toEqual(modes.map(({ displacements: _vectors, ...mode }) => mode));
  expect(rows[15]).toEqual(["15", "-12.5", 'A"', "0", "", "", "", "", "", ""]);

  const json = JSON.parse(spectrumJson(modes, provenance));
  expect(json.source).toEqual({ name: "run, 1.hess\nignored", format: "orca-hessian", frame: 2, frameCount: 3 });
  expect(json.units).toMatchObject({ frequencyCm1: "cm^-1 (negative: imaginary)", irIntensityKmMol: "km/mol", transitionDipoleSquaredAu: "atomic units", ramanActivityAngstrom4Amu: "angstrom^4/amu" });
  expect(json.modes[6]).toEqual({ mode: 6, frequencyCm1: 1292.217629, symmetry: null, irIntensityKmMol: null, transitionDipoleSquaredAu: 14.4422, ramanActivityAngstrom4Amu: 1.5128,
    ramanDepolarizationPlane: 0.75, ramanDepolarizationUnpolarized: null, reducedMassAmu: null, forceConstantMdynAngstrom: null });
  expect(json.modes.length).toBe(16);

  const gaussian = parseScientificFile("water.fchk", water);
  const saved = JSON.parse(hessianJson(gaussian.frames[0].hessian!, gaussian.atoms, { ...provenance, format: "fchk", frame: null, frameCount: 1 }));
  expect({ units: saved.units, dimension: saved.dimension, masses: saved.massesAmu, frame: saved.source.frame }).toEqual({ units: "hartree/bohr^2", dimension: 9, masses: [15.9949146, 1.00782504, 1.00782504], frame: null });
  expect(saved.matrix.flat()).toEqual(Array.from(gaussian.frames[0].hessian!.values));
  expect(saved.atoms[0]).toEqual({ element: "O", xAngstrom: gaussian.atoms[0].x, yAngstrom: gaussian.atoms[0].y, zAngstrom: gaussian.atoms[0].z });
});

test("broadened lines have unit area, the stated width and the scaled position", () => {
  const sticks = [{ frequencyCm1: 1000, value: 50 }];
  for (const shape of ["gaussian", "lorentzian"] as const) {
    // ±400 widths sampled every 0.1 cm⁻¹; the Lorentzian loses 2/(π·800) of its area to the tails.
    const { wavenumbers, values } = broadenSpectrum(sticks, shape, 10, 0.96, 960 - 2000, 960 + 2000, 2000);
    const step = wavenumbers[1] - wavenumbers[0];
    const area = values.reduce((sum, value) => sum + value * step, 0);
    expect(Math.abs(area / 50 - (shape === "gaussian" ? 1 : 1 - 2 / (Math.PI * 400)))).toBeLessThan(2e-3);
    const exact = broadenSpectrum(sticks, shape, 10, 0.96, 955, 965, 3).values;
    const peak = shape === "gaussian" ? 50 * 2 * Math.sqrt(Math.LN2 / Math.PI) / 10 : 50 * 2 / (Math.PI * 10);
    expect(exact[1]).toBeCloseTo(peak, 12);
    expect(exact[0]).toBeCloseTo(peak / 2, 12);
    expect(exact[2]).toBeCloseTo(peak / 2, 12);
  }
  const invalid: [number, number, number, number, number][] = [[0, 1, 0, 10, 10], [10, 0, 0, 10, 10], [10, 1, 10, 10, 10], [10, 1, 0, 10, 1], [10, 1, 0, 10, 2001]];
  for (const [width, scale, from, to, points] of invalid) expect(() => broadenSpectrum(sticks, "gaussian", width, scale, from, to, points)).toThrow();
});
