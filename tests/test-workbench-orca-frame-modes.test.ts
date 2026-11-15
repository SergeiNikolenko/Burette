import { expect, test } from "bun:test";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";

const geometry = (z: number) => `CARTESIAN COORDINATES (ANGSTROEM)\n---\nH 0 0 ${z}\n\n`;
const modes = (frequency: number, symmetry = "1-Au") => `VIBRATIONAL FREQUENCIES
---
Scaling factor for frequencies = 1.0
Point group: C2h
                           Irrep
0: ${frequency} cm**-1 ${symmetry}
NORMAL MODES
0
0 0.1
1 0.2
2 0.3
IR SPECTRUM
Mode freq (cm**-1) Int (km/mol) T**2 TX TY TZ
0: ${frequency} 2.5 0.1 (0 0 0)
`;

test("ORCA scan frequency blocks retain the geometry and symmetry of their own frame", () => {
  const doc = parseScientificFile("scan.out", geometry(0) + modes(123) + geometry(1) + modes(456, "2-Bg"));
  expect(doc.frames.map(frame => [frame.atoms[0].z, frame.modes?.[0].frequencyCm1, frame.modes?.[0].symmetry])).toEqual([
    [0, 123, "Au"], [1, 456, "Bg"],
  ]);
  expect(doc.frames[0].modes?.[0].displacements).toEqual([[0.1, 0.2, 0.3]]);
  expect(doc.frames[1].modes?.[0].intensityKmMol).toBe(2.5);
  expect(doc.modes).toBe(doc.frames[1].modes!);
});

test("a later geometry without frequencies never inherits modes from an earlier step", () => {
  const doc = parseScientificFile("scan.out", geometry(0) + modes(123) + geometry(1));
  expect(doc.frames[0].modes).toHaveLength(1);
  expect(doc.frames[1].modes).toBeUndefined();
  expect(doc.modes).toEqual([]);
});

test("ORCA preserves component indices on degenerate irreducible representations", () => {
  for (const irrep of ["E(0)", "E(1)", "T2g(2)", "A'", 'A"']) {
    expect(parseScientificFile("symmetry.out", geometry(0) + modes(123, `1-${irrep}`)).modes[0].symmetry).toBe(irrep);
  }
});

test("ORCA frame mode parsing rejects duplicate/out-of-range indices and empty coordinate blocks", () => {
  expect(() => parseScientificFile("bad.out", geometry(0) + modes(123).replace("NORMAL MODES", "0: 456 cm**-1\nNORMAL MODES"))).toThrow("Duplicate");
  expect(() => parseScientificFile("bad.out", geometry(0) + modes(123).replace("0: 123 cm", "3: 123 cm"))).toThrow("dimensions");
  expect(() => parseScientificFile("bad.out", "CARTESIAN COORDINATES (ANGSTROEM)\n---\n\n" + geometry(0) + modes(123))).toThrow("no atoms");
});

const raman = (frequency: number, activity: number, ratio: number) => `
RAMAN SPECTRUM
--------------
Mode freq (cm**-1) Activity Depolarization
----------------------------------------
0: ${frequency} ${activity} ${ratio}

THERMOCHEMISTRY
0: 999 999 999
`;

test("ORCA Raman activities and depolarization remain attached to their own geometry", () => {
  const doc = parseScientificFile("raman.out", geometry(0) + modes(123) + raman(123, 0.007371, 0.75)
    + geometry(1) + modes(456) + raman(456, 16.391442, 0.70725));
  expect(doc.frames.map(frame => {
    const mode = frame.modes![0];
    return [mode.frequencyCm1, mode.intensityKmMol, mode.ramanActivityAngstrom4Amu, mode.ramanDepolarizationRatio];
  })).toEqual([[123, 2.5, 0.007371, 0.75], [456, 2.5, 16.391442, 0.70725]]);
});

test("ORCA Raman tables preserve zero activity and reject mismatched or corrupt values", () => {
  const source = geometry(0) + modes(123);
  expect(parseScientificFile("zero.out", source + raman(123, 0, 0)).modes[0].ramanActivityAngstrom4Amu).toBe(0);
  for (const block of [raman(456, 1, 0.75), raman(123, -1, 0.75), raman(123, 1, 1.1),
    raman(123, 1, 0.75).replace("0: 123 1 0.75", "0: 123 1"),
    raman(123, 1, 0.75).replace("0: 123", "1: 123"),
    raman(123, 1, 0.75).replace("\n\nTHERMO", "\n0: 123 1 0.75\n\nTHERMO")]) {
    expect(() => parseScientificFile("bad.out", source + block)).toThrow("ORCA Raman");
  }
});

test("ORCA IR data cannot silently attach a mismatched, duplicate, or negative row", () => {
  const source = geometry(0) + modes(123);
  for (const bad of [
    source.replace("0: 123 2.5", "0: 456 2.5"),
    source.replace("0: 123 2.5", "1: 123 2.5"),
    source.replace("0: 123 2.5", "0: 123 -2.5"),
    source + "0: 123 2.5 0.1 (0 0 0)\n",
  ]) expect(() => parseScientificFile("bad.out", bad)).toThrow("ORCA IR");
});
