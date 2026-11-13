import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";

const read = (path: string) => parseScientificFile(path.split("/").pop()!, readFileSync(new URL(path, import.meta.url), "utf8"));

// Every value is copied from the output's banner, input echo, SCF setup and closing lines.
test("an ORCA output describes its program, keywords, basis, charge, multiplicity, termination and run time", () => {
  expect(read("fixtures/quantum/orca-log/cclib-orca6-dvb_ir.out").metadata).toEqual({ program: "ORCA 6.0.1", keywords: "b3lyp sto-3g usesym freq",
    basis: "STO-3G", charge: 0, multiplicity: 1, termination: "normal", runSeconds: 50.462 });
  expect(read("fixtures/quantum/orca-log/cclib-orca5-dvb_ir.out").metadata).toMatchObject({ program: "ORCA 5.0.1", keywords: "rks b3lyp sto-3g usesym freq", runSeconds: 138.241 });
});

test("a session document keeps a calculation description and refuses a malformed one", () => {
  const document = read("fixtures/quantum/orca-log/cclib-orca6-dvb_ir.out");
  const scene = readXyzFrames(`${document.atoms.length}\n\n${document.atoms.map((atom) => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join("\n")}\n`);
  expect(validateScientificDocument(document, scene).metadata).toEqual(document.metadata);
  for (const metadata of [{ termination: "crashed" }, { charge: 0.5 }, { multiplicity: 0 }, { program: "" }, { solvent: "water" }]) {
    expect(() => validateScientificDocument({ ...document, metadata }, scene)).toThrow("calculation description");
  }
});
