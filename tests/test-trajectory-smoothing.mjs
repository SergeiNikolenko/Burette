import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../PreviewExtension/Web/trajectory-smoothing.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context);
const smooth = context.window.BuretteTrajectorySmoothing?.smooth;
assert.equal(typeof smooth, "function");

const xyz = [0, 1, 3, 1, 0].map((x, index) => `2\nframe ${index + 1}\nC ${x} 0 0\nO ${x + 1} 0 0`).join("\n");
const result = smooth({ data: xyz, format: "xyz", preset: "balanced", targetFrames: 3, referenceFrame: 1, align: false });
assert.equal(result.frameCount, 5);
assert.equal(result.rawSignal.length, 5);
assert.equal(result.filteredSignal.length, 5);
assert.equal(result.keyframes[0], 0);
assert.equal(result.keyframes.at(-1), 4);
assert.match(result.data, /Smoothed motion frame 5/);

assert.throws(
  () => smooth({ data: "", format: "xtc" }),
  /supports multi-model PDB and multi-frame XYZ/,
);

console.log("trajectory smoothing tests passed");
