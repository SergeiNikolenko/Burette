import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";

const read = (path: string) => parseScientificFile(path.split("/").pop()!, readFileSync(new URL(path, import.meta.url), "utf8"));
const absorption = (path: string) => {
  const document = read(path);
  const [spectrum] = document.frames.at(-1)!.spectra!.spectra;
  return { document, spectrum: spectrum as Extract<typeof spectrum, { kind: "electronic" }> };
};

// Every value is copied from the printed excited-state table.
test("Q-Chem TDDFT/TDA states become the absorption spectrum of their geometry, labelled with their multiplicity", () => {
  const { document, spectrum } = absorption("fixtures/quantum/qchem/cclib-dvb_td.out");
  expect(document.frames.at(-1)!.spectra!.source).toEqual({ name: "cclib-dvb_td.out", format: "program-output", scope: "frame", frameIndex: 0, frameCount: 1 });
  expect(spectrum).toMatchObject({ kind: "electronic", xUnit: "eV", valueUnit: null });
  expect(spectrum.positions).toHaveLength(10);
  expect(spectrum.positions.slice(0, 2)).toEqual([3.6052, 4.5675]);
  expect(spectrum.sourceRowIds!.slice(0, 2)).toEqual(["1 Triplet", "2 Triplet"]);
  expect(spectrum.auxiliary!.map((column) => column.name)).toEqual(["TX", "TY", "TZ"]);
});

test("the GAMESS TDDFT summary keeps each state's symmetry, transition dipole and oscillator strength", () => {
  const { spectrum } = absorption("fixtures/quantum/gamess/cclib-dvb_td.out");
  // `1 BU -384.4995231645 4.488 2.4722 0.0498 0.0000 0.6722`; the ground state row is not a transition.
  expect(spectrum.sourceRowIds).toEqual(["1 BU", "2 BU", "3 AG", "4 BU", "5 AG", "6 AG", "7 BU", "8 AG", "9 BU", "10 BU"]);
  expect(spectrum.positions.slice(0, 2)).toEqual([4.488, 4.701]);
  expect(spectrum.values.slice(0, 2)).toEqual([0.6722, 0.0358]);
  expect(spectrum.auxiliary!.map((column) => column.values[0])).toEqual([2.4722, 0.0498, 0]);
});
