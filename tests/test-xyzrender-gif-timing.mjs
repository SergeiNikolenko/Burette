import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { retimeGif } from '../apps/desktop/src/lib/xyzrender-gif-timing.ts';
import { encodeAnimation, decodeAnimation } from '../apps/desktop/src/lib/xyzrender-animation.ts';
const { parseGIF, decompressFrames } = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('gifuct-js');
const frames = Array.from({ length: 12 }, (_, i) => new Uint8ClampedArray([i * 20, 0, 255, 255, 0, 0, 0, 0]));
const original = await encodeAnimation({ width: 2, height: 1, frames }, 0, 11, 10, () => {});
for (const fps of [1, 24, 30, 50]) {
  const output = retimeGif(original, fps);
  assert.ok(output);
  assert.deepEqual(decodeAnimation(output.buffer), decodeAnimation(original.buffer), 'all composited pixels and transparency stay unchanged');
  const decoded = decompressFrames(parseGIF(output.buffer), false);
  assert.equal(decoded.reduce((sum, frame) => sum + frame.delay, 0), Math.round(1200 / fps) * 10);
  assert.ok(decoded.every(frame => frame.delay >= 20));
  assert.equal(output.length, original.length, 'compressed images are retained');
}
for (const fps of [0, 60, 120, NaN]) assert.equal(retimeGif(original, fps), null);
for (let length = 0; length < original.length; length++) assert.equal(retimeGif(original.subarray(0, length), 24), null, 'truncated GIF rejected');
const huge = original.slice(); huge[6] = 255; huge[7] = 255; huge[8] = 255; huge[9] = 255;
assert.equal(retimeGif(huge, 24), null);
console.log('GIF retiming preserves pixels, transparency, duration and bounds');
