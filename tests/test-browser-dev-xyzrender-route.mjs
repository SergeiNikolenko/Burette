#!/usr/bin/env node
import assert from "node:assert/strict";

const { selectedXyzFrameInputData } = await import("../apps/desktop/vite/browser-dev/xyzrender.ts");

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const multiFrameXyz = encoder.encode(
  "2\nfirst frame\nH 0 0 0\nO 0 0 1\n2\nsecond frame\nH 1 0 0\nO 1 0 1\n",
);

const secondFrame = selectedXyzFrameInputData(multiFrameXyz, "xyz", 1);
assert.equal(
  decoder.decode(secondFrame),
  "2\nsecond frame\nH 1 0 0\nO 1 0 1\n",
);

const clampedFrame = selectedXyzFrameInputData(multiFrameXyz, "xyz", 99);
assert.equal(
  decoder.decode(clampedFrame),
  "2\nsecond frame\nH 1 0 0\nO 1 0 1\n",
);

assert.equal(selectedXyzFrameInputData(multiFrameXyz, "pdb", 1), null);
assert.equal(selectedXyzFrameInputData(multiFrameXyz, "xyz", null), null);
assert.equal(selectedXyzFrameInputData(encoder.encode("1\nsingle\nH 0 0 0\n"), "xyz", 0), null);

console.log("browser-dev xyzrender route tests passed");
