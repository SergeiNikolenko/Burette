import assert from "node:assert/strict";

import {
  CONFORMER_EXTRACTOR_ABI_VERSION,
  CONFORMER_EXTRACTOR_RDKIT_RELEASE,
  conformerVariants,
  parseNativeConformerParameters,
} from "../apps/desktop/src/lib/conformer-extractor.ts";

assert.equal(CONFORMER_EXTRACTOR_ABI_VERSION, 1);
assert.equal(CONFORMER_EXTRACTOR_RDKIT_RELEASE, 20_250_304);
assert.deepEqual(conformerVariants, [
  "DG", "KDG", "ETDG", "ETDGv2", "ETKDG", "ETKDGv2", "ETKDGv3", "srETKDGv3",
]);

const encoded = minimalFixture();
const parsed = parseNativeConformerParameters(encoded, "ETKDGv3", encoded.byteLength);
assert.equal(parsed.variant, "ETKDGv3");
assert.deepEqual([...parsed.atomicNumbers], [6, 8]);
assert.deepEqual([...parsed.formalCharges], [0, -1]);
assert.deepEqual([...parsed.distanceAtomPairs], [0, 1]);
assert.deepEqual([...parsed.distanceBoundsSquared], [1, 2.25]);
assert.deepEqual([...parsed.distanceWeights], [1]);
assert.equal(parsed.atomicNumbers.buffer, encoded.buffer);
assert.equal(parsed.distanceBoundsSquared.buffer, encoded.buffer);

assert.throws(
  () => parseNativeConformerParameters(encoded, "DG", encoded.byteLength),
  /variant differs/u,
);
assert.throws(
  () => parseNativeConformerParameters(encoded, "ETKDGv3", encoded.byteLength - 1),
  /admitted byte envelope/u,
);

const badIndex = encoded.slice();
new DataView(badIndex.buffer).setUint32(72, 2, true);
assert.throws(
  () => parseNativeConformerParameters(badIndex, "ETKDGv3", badIndex.byteLength),
  /out-of-range atom index/u,
);

const nonFinite = encoded.slice();
new DataView(nonFinite.buffer).setFloat32(80, Number.NaN, true);
assert.throws(
  () => parseNativeConformerParameters(nonFinite, "ETKDGv3", nonFinite.byteLength),
  /non-finite/u,
);

const trailing = new Uint8Array(encoded.byteLength + 4);
trailing.set(encoded);
new DataView(trailing.buffer).setUint32(44, trailing.byteLength, true);
new DataView(trailing.buffer).setUint32(40, trailing.byteLength - 64, true);
assert.throws(
  () => parseNativeConformerParameters(trailing, "ETKDGv3", trailing.byteLength),
  /trailing or missing/u,
);

console.log("conformer extractor contract tests passed");

function minimalFixture() {
  const bytes = new Uint8Array(92);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x43, 0x45, 0x58]);
  view.setUint16(4, 1, true);
  view.setUint16(6, 64, true);
  view.setUint8(8, 6);
  view.setUint32(12, 2, true);
  view.setUint32(16, 1, true);
  view.setUint32(40, 28, true);
  view.setUint32(44, bytes.byteLength, true);
  view.setUint32(48, 20_250_304, true);
  view.setUint16(64, 6, true);
  view.setUint16(66, 8, true);
  view.setInt8(68, 0);
  view.setInt8(69, -1);
  view.setUint32(72, 0, true);
  view.setUint32(76, 1, true);
  view.setFloat32(80, 1, true);
  view.setFloat32(84, 2.25, true);
  view.setFloat32(88, 1, true);
  return bytes;
}
