#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mesoscaleZipEntries, validateGenericMesoscaleManifest, validateMesoscaleArchiveEntries } from "../apps/desktop/src/preview-mesoscale/mesoscale-package.ts";

const fixture = new Uint8Array(await readFile("tests/fixtures/mesoscale/basic.mesozip"));
const entries = mesoscaleZipEntries(fixture);
assert.deepEqual(entries.map((entry) => entry.name).sort(), ["manifest.json", "mini.pdb"]);
assert.equal(validateMesoscaleArchiveEntries(entries).expandedBytes, 1164);
const mismatchedLocalHeader = fixture.slice();
new DataView(mismatchedLocalHeader.buffer).setUint32(22, 0x7fffffff, true);
assert.throws(() => mesoscaleZipEntries(mismatchedLocalHeader), /local and central metadata disagree/);

const safe = [
  { name: "manifest.json", compressedBytes: 100, expandedBytes: 500 },
  { name: "model.pdb", compressedBytes: 100, expandedBytes: 500 },
];
assert.equal(validateMesoscaleArchiveEntries(safe).entries, 2);

for (const [label, unsafe, pattern] of [
  ["traversal", [{ name: "../model.pdb", compressedBytes: 1, expandedBytes: 1 }, safe[0]], /Unsafe/],
  ["absolute", [{ name: "/model.pdb", compressedBytes: 1, expandedBytes: 1 }, safe[0]], /Unsafe/],
  ["duplicate", [safe[0], safe[0]], /Duplicate/],
  ["nested archive", [safe[0], { name: "nested.zip", compressedBytes: 1, expandedBytes: 1 }], /Nested/],
  ["ratio", [safe[0], { name: "model.pdb", compressedBytes: 1, expandedBytes: 251 }], /ratio/],
]) {
  assert.throws(() => validateMesoscaleArchiveEntries(unsafe), pattern, label);
}

const validManifest = {
  roots: [{ id: "root", children: [] }],
  entities: [{ file: "model.pdb", groups: [{ root: "root", id: "group" }], instances: {
    positions: { data: [0, 0, 0] },
    rotations: { variant: "quaternion", data: [0, 0, 0, 1] },
  } }],
};
validateGenericMesoscaleManifest(validManifest, new Set(["manifest.json", "model.pdb"]));
assert.throws(() => validateGenericMesoscaleManifest({ ...validManifest, entities: [{ ...validManifest.entities[0], file: "missing.pdb" }] }, new Set(["manifest.json"])), /missing/);
assert.throws(() => validateGenericMesoscaleManifest({ ...validManifest, entities: [{ ...validManifest.entities[0], instances: { positions: { data: [0, Number.NaN, 0] }, rotations: { variant: "quaternion", data: [0, 0, 0, 1] } } }] }, new Set(["model.pdb"])), /positions/);
assert.throws(() => validateGenericMesoscaleManifest({ ...validManifest, entities: [{ ...validManifest.entities[0], instances: { positions: { data: [0, 0, 0, 1, 1, 1] }, rotations: { variant: "quaternion", data: [0, 0, 0, 1] } } }] }, new Set(["model.pdb"])), /rotations/);

console.log("mesoscale package safety passed");
