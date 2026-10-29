import {expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {parseScientificFile} from "../apps/desktop/src/lib/molecular-workbench/quantum";
const source=readFileSync(new URL("./fixtures/quantum/dispatcher/ordered-spectra.hess",import.meta.url),"utf8");

test("Hessian spectra bind by mode index, preserve T² units and share their geometry", () => {
  const result = parseScientificFile("modes.hess", source);
  expect([...result.modes].sort((a, b) => a.index - b.index)).toEqual([
    { index: 0, frequencyCm1: 0, transitionDipoleSquared: 0, ramanActivityAngstrom4Amu: 0, ramanDepolarizationRatio: 0, displacements: [[1, 0, 0]] },
    { index: 1, frequencyCm1: 123.456, transitionDipoleSquared: 0.2, ramanActivityAngstrom4Amu: 16.3, ramanDepolarizationRatio: 0.75, displacements: [[0, 1, 0]] },
    { index: 2, frequencyCm1: 123.456, transitionDipoleSquared: 0.4, ramanActivityAngstrom4Amu: 21.1, ramanDepolarizationRatio: 0.25, displacements: [[0, 0, 1]] },
  ]);
  expect(result.frames[0].modes).toBe(result.modes);
});

test("Hessian refuses mismatched, truncated, non-finite and unsupported spectral data", () => {
  const mutations = [
    source.replace("$ir_spectrum\n3", "$ir_spectrum\n2"),
    source.replace("123.46 0.4 0.0 -0.2 0.3\n", ""),
    source.replace("123.46 0.2", "456.78 0.2"),
    source.replace("123.46 0.2", "123.46 -0.2"),
    source.replace("123.46 0.2 -0.1", "123.46 0.2 NaN"),
    source.replace("123.46 0.2 -0.1", "123.46 0.2 1e999"),
    source.replace("123.46 0.2 -0.1", "123.46 1.0 0.2 -0.1"),
    source.replace("$raman_spectrum\n3", "$raman_spectrum\n2"),
    source.replace("123.46 16.3", "456.78 16.3"),
    source.replace("123.46 16.3", "123.46 -16.3"),
    source.replace("16.3 0.75", "16.3 -0.1"),
    source.replace("16.3 0.75", "16.3 1.1"),
    source.replace("16.3 0.75", "16.3"),
    source.replace("$end", "$ir_spectrum\n3\n$end"),
  ];
  for (const invalid of mutations) expect(() => parseScientificFile("bad.hess", invalid)).toThrow();
});

test("Hessian allows absent spectra without inventing zero intensities", () => {
  const result = parseScientificFile("modes.hess", source.slice(0, source.indexOf("$ir_spectrum")));
  expect(result.modes.every(mode => mode.transitionDipoleSquared === undefined && mode.intensityKmMol === undefined
    && mode.ramanActivityAngstrom4Amu === undefined)).toBe(true);
});
