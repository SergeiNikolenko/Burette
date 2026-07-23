#!/usr/bin/env node
import assert from "node:assert/strict";

const { structureStoryFromViewerMessage } = await import("../apps/desktop/src/lib/structure-story.ts");

const story = structureStoryFromViewerMessage({
  documentId: " document-1 ",
  stepIndex: 1,
  stepCount: 8,
  fileName: " 02_oriented_plusY.pdb ",
  stage: " Orientation ",
  summary: " Largest shared Cα chain remains closely aligned. ",
  comparison: {
    rmsd: 0.004,
    chain: " A ",
    residueCount: 591,
  },
});

assert.deepEqual(story, {
  documentId: "document-1",
  stepIndex: 1,
  stepCount: 8,
  fileName: "02_oriented_plusY.pdb",
  stage: "Orientation",
  summary: "Largest shared Cα chain remains closely aligned.",
  comparison: {
    rmsd: 0.004,
    chain: "A",
    residueCount: 591,
  },
});

assert.equal(structureStoryFromViewerMessage({
  stepIndex: 0,
  stepCount: 1,
  fileName: "input.pdb",
  stage: "Starting complex",
  summary: "Reference state",
}), null);

assert.equal(structureStoryFromViewerMessage({
  documentId: "document-1",
  stepIndex: 8,
  stepCount: 8,
  fileName: "input.pdb",
  stage: "Starting complex",
  summary: "Reference state",
}), null);

const storyWithoutComparison = structureStoryFromViewerMessage({
  documentId: "document-1",
  stepIndex: 0,
  stepCount: 1,
  fileName: "input.pdb",
  stage: "Starting complex",
  summary: "x".repeat(10_000),
  comparison: { rmsd: -1, chain: "A", residueCount: 591 },
});

assert.equal(storyWithoutComparison?.summary.length, 8_000);
assert.equal(storyWithoutComparison?.comparison, null);

console.log("structure story tests passed");
