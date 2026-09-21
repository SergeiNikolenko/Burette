import assert from "node:assert/strict";

import { detectKetcherImportFormat, normalizeKetcherSmilesImport } from "../apps/desktop/src/lib/ketcher-import-format.ts";

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

console.log("Ketcher import format tests passed");
