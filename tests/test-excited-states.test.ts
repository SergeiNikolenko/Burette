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

test("Gaussian TD-DFT states keep their symmetry, transition dipole and oscillator strength; EOM-CCSD keeps its final states", () => {
  const { spectrum } = absorption("fixtures/quantum/gaussian/cclib-dvb_td.out");
  // `Excited State   1:      Singlet-BU     5.3351 eV  232.39 nm  f=0.1707`; dipole row `1  0.1090 -1.1375 0.0000`.
  expect(spectrum.sourceRowIds).toEqual(["1 Singlet-BU", "2 Singlet-BU", "3 Singlet-AG", "4 Singlet-BU", "5 Singlet-AG"]);
  expect(spectrum.positions).toEqual([5.3351, 5.3746, 6.2152, 6.7732, 7.4124]);
  expect(spectrum.values).toEqual([0.1707, 0.6779, 0, 0.1793, 0]);
  expect(spectrum.auxiliary!.map((column) => column.values[0])).toEqual([0.109, -1.1375, 0]);
  // Divinylbenzene is achiral: its rotatory strengths are all zero, so there is no ECD spectrum.
  expect(read("fixtures/quantum/gaussian/cclib-dvb_td.out").frames[0].spectra!.spectra.map((item) => item.kind)).toEqual(["electronic"]);
  // The CIS guess states come first; the EOM-CCSD states printed last are the result.
  const eom = absorption("fixtures/quantum/gaussian/cclib-dvb_eomccsd.log").spectrum;
  expect([eom.positions.length, eom.positions[0], eom.sourceRowIds![0]]).toEqual([10, 3.0322, "1 Triplet-BU"]);
});

test("Gaussian velocity rotatory strengths become an ECD spectrum when any is nonzero", () => {
  const text = readFileSync(new URL("fixtures/quantum/gaussian/cclib-dvb_td.out", import.meta.url), "utf8");
  const chiral = text.replace(/(R\(velocity\)    E-M Angle\n {9}1 +-0\.0000 +0\.0000 +-0\.0000) +-0\.0000/u, "$1     12.3456");
  expect(chiral).not.toBe(text);
  const ecd = parseScientificFile("chiral.out", chiral).frames[0].spectra!.spectra.find((item) => item.kind === "ecd")!;
  expect(ecd).toMatchObject({ xUnit: "eV", valueUnit: "10**-40 erg-esu-cm/Gauss", positions: [5.3351, 5.3746, 6.2152, 6.7732, 7.4124] });
  // The other rows print `-0.0000`.
  expect(ecd.values.map((value) => value + 0)).toEqual([12.3456, 0, 0, 0, 0]);
});

test("NWChem TDDFT roots keep their symmetry, transition dipole and dipole oscillator strength", () => {
  const { document, spectrum } = absorption("fixtures/quantum/nwchem/cclib-dvb_td.out");
  // `Root   1 singlet bu   0.196071264 a.u.   5.3354 eV`, `Transition Moments X 0.13039 Y -1.10260 Z -0.00000`,
  // `Dipole Oscillator Strength 0.1611342389`.
  expect(spectrum.sourceRowIds).toEqual(["1 singlet bu", "2 singlet bu", "3 singlet ag", "4 singlet bu", "5 singlet ag"]);
  expect(spectrum.positions).toEqual([5.3354, 5.3716, 6.2147, 6.7704, 7.4074]);
  expect(spectrum.values.slice(0, 2)).toEqual([0.1611342389, 0.6826580671]);
  expect(spectrum.auxiliary!.map((column) => column.values[0])).toEqual([0.13039, -1.1026, -0]);
  expect(document.metadata?.keywords).toBe("B3LYP TDDFT");
});
