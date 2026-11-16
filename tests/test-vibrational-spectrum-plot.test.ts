import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { plotVibrationalSpectrum, VIBRATIONAL_PLOT_DEFAULTS, type VibrationalPlotKind, type VibrationalPlotOptions } from "../apps/desktop/src/lib/molecular-workbench/vibrational-spectrum-plot";
import type { VibrationalMode } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import { spectrumCsv, spectrumJson, broadenSpectrum } from "../apps/desktop/src/lib/molecular-workbench/vibrational-spectrum";

type Golden = { name: string; kind: VibrationalPlotKind; modes: VibrationalMode[]; options: VibrationalPlotOptions; rows: number[][] };
const golden: Golden[] = JSON.parse(readFileSync(new URL("./fixtures/quantum/vibrational-plot-golden.json", import.meta.url), "utf8"));
const file = (name: string) => readFileSync(new URL(`./fixtures/quantum/${name}`, import.meta.url), "utf8");
for (const reference of golden) test(`pinned C++ entire grid: ${reference.name}`, () => {
  const { wavenumbers, smoothed, raw } = plotVibrationalSpectrum(reference.modes, reference.kind, reference.options);
  expect(Array.from(wavenumbers)).toEqual(reference.rows.map(row => row[0]));
  for (const [column, actual] of [[1, smoothed], [2, raw]] as const) {
    // C++ float/libm versus JS exp: tolerate only final float rounding, not rescaling.
    const errors = Array.from(actual, (value, i) => Math.abs(value - reference.rows[i][column]) / Math.max(1, Math.abs(reference.rows[i][column])));
    expect(Math.max(...errors)).toBeLessThan(2e-6);
  }
});

test("actual fixture parser feeds the unchanged source values through plotting and export", () => {
  for (const [name, filename] of [['water', 'gaussian16-water-raman.fchk'], ['methane', 'orca-3.0.2-methane.hess']]) {
    const reference = golden.find(item => item.name === name)!;
    const science = parseScientificFile(filename, file(filename));
    const selected: VibrationalMode[] = science.modes.map(m => ({ index: m.index, frequencyCm1: m.frequencyCm1, ...(reference.kind === 'ir' ? {intensityKmMol:m.intensityKmMol} : {ramanActivityAngstrom4Amu:m.ramanActivityAngstrom4Amu}) }));
    expect(selected).toEqual(reference.modes);
    const provenance = { sourceName: filename, format: science.format, frame: null, frameCount: 1 };
    const before = [spectrumCsv(science.modes, provenance), spectrumJson(science.modes, provenance)];
    expect(Array.from(plotVibrationalSpectrum(science.modes, reference.kind, reference.options).smoothed)).toEqual(Array.from(plotVibrationalSpectrum(reference.modes, reference.kind, reference.options).smoothed));
    expect([spectrumCsv(science.modes, provenance), spectrumJson(science.modes, provenance)]).toEqual(before);
  }
});

test("default display retains direction, integer spacing, FWHM and unclamped relative transmission", () => {
  const modes = [{index:0,frequencyCm1:1000,intensityKmMol:300,ramanActivityAngstrom4Amu:50}];
  const ir = plotVibrationalSpectrum(modes, 'ir');
  expect([ir.axisStartCm1,ir.axisEndCm1,ir.wavenumbers.length,ir.wavenumbers[0],ir.wavenumbers.at(-1)]).toEqual([4000,400,3600,400,3999]);
  expect([ir.smoothed[600],ir.raw[600]]).toEqual([-140,-200]);
  const raman = plotVibrationalSpectrum(modes,'raman');
  expect([raman.wavenumbers.length,raman.wavenumbers[0],raman.wavenumbers.at(-1),raman.smoothed[1000]]).toEqual([4000,0,3999,50]);
  expect(raman.smoothed[985]).toBeCloseTo(25,5);
  expect(raman.smoothed[1015]).toBeCloseTo(25,5);
});

test("intentional before/after contract: peak height and inverse scale are not unit-area curves", () => {
  const old = broadenSpectrum([{frequencyCm1:1000,value:50}], 'gaussian',10,.96,955,965,3);
  expect(old.values[1]).toBeCloseTo(50*2*Math.sqrt(Math.LN2/Math.PI)/10,12);
  const modern = plotVibrationalSpectrum([{index:0,frequencyCm1:960,ramanActivityAngstrom4Amu:50}], 'raman', {...VIBRATIONAL_PLOT_DEFAULTS.raman,scale:.96,axisStartCm1:995,axisEndCm1:1006,fwhmCm1:10});
  expect(modern.smoothed[5]).toBe(50);
  expect(Array.from(modern.wavenumbers)).toContain(1000);
});

test("missing quantities and unsafe work are rejected before producing partial output", () => {
  expect(() => plotVibrationalSpectrum([{index:0,frequencyCm1:1000,transitionDipoleSquared:1}], 'ir')).toThrow();
  const modes = [{index:0,frequencyCm1:1000,intensityKmMol:0}];
  expect(plotVibrationalSpectrum(modes,'ir').smoothed.every(v=>v===100)).toBe(true);
  for (const change of [{scale:0},{fwhmCm1:0},{axisStartCm1:-1},{axisEndCm1:1e8},{scale:NaN}]) {
    expect(() => plotVibrationalSpectrum(modes,'ir',{...VIBRATIONAL_PLOT_DEFAULTS.ir,...change})).toThrow();
  }
  expect(() => plotVibrationalSpectrum(Array(10001).fill(modes[0]),'ir')).toThrow();
  expect(() => plotVibrationalSpectrum(Array(6000).fill(modes[0]),'ir')).toThrow();
});
