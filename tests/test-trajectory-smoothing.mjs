import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../PreviewExtension/Web/trajectory-smoothing.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context);
const smooth = context.window.BuretteTrajectorySmoothing?.smooth;
const concatenateXtcSegments = context.window.BuretteTrajectorySmoothing?.concatenateXtcSegments;
const countXtcFrames = context.window.BuretteTrajectorySmoothing?.countXtcFrames;
assert.equal(typeof smooth, "function");
assert.equal(typeof concatenateXtcSegments, "function");
assert.equal(typeof countXtcFrames, "function");

function uncompressedXtcFrame({ atomCount = 2, step = 0, time = 0 } = {}) {
  const bytes = new Uint8Array(56 + atomCount * 12);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 1995);
  view.setInt32(4, atomCount);
  view.setInt32(8, step);
  view.setFloat32(12, time);
  view.setInt32(52, atomCount);
  return bytes;
}

const firstXtcSegment = Uint8Array.from([0, 1, 2]);
const secondXtcSegment = Uint8Array.from([3, 4]);
const combinedXtc = concatenateXtcSegments([firstXtcSegment, secondXtcSegment]);
assert.deepEqual(Array.from(combinedXtc), [0, 1, 2, 3, 4]);
assert.deepEqual(Array.from(firstXtcSegment), [0, 1, 2]);
assert.deepEqual(Array.from(secondXtcSegment), [3, 4]);
assert.throws(() => concatenateXtcSegments([]), /at least one XTC segment/);
assert.throws(() => concatenateXtcSegments([new Uint8Array(), secondXtcSegment]), /must not be empty/);

const oneFrameXtc = uncompressedXtcFrame();
const twoFrameXtc = concatenateXtcSegments([
  uncompressedXtcFrame({ step: 0, time: 0 }),
  uncompressedXtcFrame({ step: 1, time: 1 }),
]);
assert.equal(countXtcFrames(oneFrameXtc), 1);
assert.equal(countXtcFrames(twoFrameXtc), 2);
assert.throws(() => countXtcFrames(Uint8Array.from([0, 1, 2])), /valid XTC frame/);
const truncatedXtc = twoFrameXtc.subarray(0, twoFrameXtc.length - 1);
assert.throws(() => countXtcFrames(truncatedXtc), /truncated/);

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
