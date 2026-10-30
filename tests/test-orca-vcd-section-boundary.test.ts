import { expect, test } from "bun:test";
import { readOrcaVcdTables } from "../apps/desktop/src/lib/molecular-workbench/orca-circular-spectra";

test("a missing VCD header cannot relabel a later IR signal or borrow columns after another geometry", () => {
  for (const section of ["IR SPECTRUM", "CARTESIAN COORDINATES (ANGSTROEM)"]) {
    const source = `VCD SPECTRUM\n---\n\n${section}\nMode Freq Int\ncm**-1 (km/mol)\n---\n6: 1000 12.5\n`;
    expect(() => readOrcaVcdTables(source, [{ index: 6, frequencyCm1: 1000 }])).toThrow("section boundary");
  }
});
