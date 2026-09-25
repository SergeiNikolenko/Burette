import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { detectKetcherImportFormat, normalizeKetcherSmilesImport } from "../apps/desktop/src/lib/ketcher-import-format.ts";
import { deserializeKetcherMolfile, normalizeKetcherMolfileNames } from "../apps/desktop/src/lib/ketcher-workflow.ts";

const molV2000 = [
  "example",
  "  Burette",
  "",
  "  1  0  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "M  END",
].join("\n");

assert.equal(detectKetcherImportFormat("CC=O"), "smiles");
assert.equal(detectKetcherImportFormat("[#6]-[!#1]"), "smarts");
assert.equal(detectKetcherImportFormat("CC |$;;_R1$|"), "extended-smiles");
assert.equal(detectKetcherImportFormat(molV2000), "molfile-v2000");
assert.equal(detectKetcherImportFormat(molV2000.replace("V2000", "V3000")), "molfile-v3000");
assert.equal(detectKetcherImportFormat(`${molV2000}\n$$$$`), "sdf-v2000");
assert.equal(detectKetcherImportFormat("$RXN V3000\n\n\n\nM  V30 COUNTS 1 1"), "rxn-v3000");
assert.equal(detectKetcherImportFormat("InChI=1S/CH4/h1H4"), "inchi");
assert.equal(detectKetcherImportFormat("InChI=1S/CH4/h1H4\nAuxInfo=1/0/N:1/rA:1C/rB:/rC:;"), "inchi-aux");
assert.equal(detectKetcherImportFormat('{"root":{"nodes":[]}}'), "ket");
assert.equal(detectKetcherImportFormat("<cml><molecule /></cml>"), "cml");
assert.equal(normalizeKetcherSmilesImport("CCO ethanol\nCC propane"), "CCO.CC");
assert.equal(normalizeKetcherSmilesImport("CCO CC"), "CCO.CC");
assert.equal(normalizeKetcherSmilesImport("CCO ethanol"), "CCO ethanol");

// ketcher-core writes `'' + struct.name`, so SMILES-built structures export a "null" name line.
const ketcherMolBody = "  Ketcher 09252612002D\n\n  1  0  0  0  0  0            999 V2000\nM  END";
assert.equal(normalizeKetcherMolfileNames(`null\n${ketcherMolBody}`), `\n${ketcherMolBody}`);
assert.equal(normalizeKetcherMolfileNames(`NAD\n${ketcherMolBody}`), `NAD\n${ketcherMolBody}`);
assert.equal(
  normalizeKetcherMolfileNames(`null\n${ketcherMolBody}\n$$$$\nnull\n${ketcherMolBody}\n$$$$\n`),
  `\n${ketcherMolBody}\n$$$$\n\n${ketcherMolBody}\n$$$$\n`,
);
assert.equal(normalizeKetcherMolfileNames("$RXN\nnull\n\n\n  1  1\n$MOL\nnull\n"), "$RXN\n\n\n\n  1  1\n$MOL\n\n");
assert.equal(normalizeKetcherMolfileNames("nullable\n"), "nullable\n");

// Molfiles loaded directly into the editor get Ketcher's implicit hydrogens (OH/NH2 labels).
const requireFromDesktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { MolSerializer } = await import(requireFromDesktop.resolve("ketcher-core"));
const aminoethanol = deserializeKetcherMolfile(MolSerializer, [
  "",
  "  Burette",
  "",
  "  4  3  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0",
  "    1.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    2.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    3.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0",
  "  2  3  1  0",
  "  3  4  1  0",
  "M  END",
].join("\n"));
assert.deepEqual([...aminoethanol.atoms.values()].map((atom) => `${atom.label}${atom.implicitH}`), ["N2", "C2", "C2", "O1"]);

console.log("Ketcher import format tests passed");
