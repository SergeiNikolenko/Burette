#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const viewer = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
const start = viewer.indexOf("  function pdbAlphaCarbonResidues(data)");
const end = viewer.indexOf("  function structureSceneStoryStage", start);
assert.ok(start >= 0 && end > start, "alignment implementation block is available");

const alignment = Function(`
  const normalizeFormat = value => String(value || '').toLowerCase();
  ${viewer.slice(start, end)}
  return { alignStructureSceneEntries, restoreStructureSceneEntries };
`)();

function atomLine(serial, residue, chain, sequence, x, y, z) {
  return `ATOM  ${String(serial).padStart(5)}  CA  ${residue.padStart(3)} ${chain}${String(sequence).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00           C`;
}

function pdb(chain, offset) {
  return [
    atomLine(1, "ALA", chain, 1, offset + 0, 0, 0),
    atomLine(2, "GLY", chain, 2, offset + 2, 0, 0),
    atomLine(3, "SER", chain, 3, offset + 0, 3, 0),
    "END"
  ].join("\n");
}

function coordinates(data) {
  return data.split(/\r?\n/u)
    .filter(line => line.startsWith("ATOM  "))
    .map(line => [Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54))]);
}

const reference = pdb("A", 0);
const moving = pdb("B", 11);
const untouched = pdb("C", 27);
const prepared = {
  poses: [
    { format: "pdb", label: "reference.pdb", data: reference },
    { format: "pdb", label: "moving.pdb", data: moving },
    { format: "pdb", label: "untouched.pdb", data: untouched }
  ]
};

const one = alignment.alignStructureSceneEntries(prepared, "auto", {
  referencePoseIndex: 0,
  referenceChain: "A",
  movingPoseIndices: [1],
  movingChain: "B"
});
assert.equal(one.referencePoseIndex, 0);
assert.deepEqual(one.movingPoseIndices, [1]);
assert.equal(one.alignedCount, 1);
assert.deepEqual(coordinates(prepared.poses[1].data), coordinates(reference));
assert.equal(prepared.poses[2].data, untouched, "non-target structures stay untouched");

alignment.restoreStructureSceneEntries(prepared);
assert.equal(prepared.poses[1].data, moving);
assert.equal(prepared.structureAlignmentEnabled, false);

const all = alignment.alignStructureSceneEntries(prepared, "sequence", {
  referencePoseIndex: 1,
  referenceChain: "B"
});
assert.equal(all.referencePoseIndex, 1);
assert.deepEqual(all.movingPoseIndices, [0, 2]);
assert.deepEqual(coordinates(prepared.poses[0].data), coordinates(moving));
assert.deepEqual(coordinates(prepared.poses[2].data), coordinates(moving));
assert.equal(prepared.poses[1].data, moving, "the chosen reference never moves");

console.log("Selection-aware alignment behavior tests passed");
