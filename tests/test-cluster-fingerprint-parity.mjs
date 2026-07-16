import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import initRDKitModule from "@rdkit/rdkit";

const fixture = JSON.parse(readFileSync(
  new URL("../schemas/compute/fixtures/rdkit-morgan-known-answer.v1.json", import.meta.url),
  "utf8",
));
const rdkit = await initRDKitModule();

assert.equal(fixture.schemaVersion, "burrete.rdkit-morgan-known-answer.v1");
assert.equal(rdkit.version(), fixture.rdkitVersion);
assert.deepEqual(fixture.settings, {
  radius: 2,
  bitCount: 2_048,
  useChirality: true,
  useFeatures: false,
});

for (const record of fixture.records) {
  const molecule = rdkit.get_mol(record.smiles);
  assert.ok(molecule, `RDKit must parse ${record.smiles}`);
  try {
    const fingerprint = molecule.get_morgan_fp_as_uint8array(JSON.stringify({
      radius: fixture.settings.radius,
      fplen: fixture.settings.bitCount,
      useChirality: fixture.settings.useChirality,
      useFeatures: fixture.settings.useFeatures,
    }));
    assert.equal(fingerprint.byteLength, 256);
    assert.equal(Buffer.from(fingerprint).toString("base64"), record.fingerprintBase64);
    assert.equal(createHash("sha256").update(fingerprint).digest("hex"), record.sha256);
    assert.equal(popcount(fingerprint), record.popcount);
  } finally {
    molecule.delete();
  }
}

console.log("cluster fingerprint parity tests passed");

function popcount(bytes) {
  let count = 0;
  for (const byte of bytes) {
    let value = byte;
    while (value) {
      value &= value - 1;
      count += 1;
    }
  }
  return count;
}
