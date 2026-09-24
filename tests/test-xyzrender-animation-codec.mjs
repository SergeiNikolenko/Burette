import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { parseGIF, decompressFrames } = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('gifuct-js');
import { decodeAnimation, encodeAnimation } from '../apps/desktop/src/lib/xyzrender-animation.ts';
const rgba = color => new Uint8ClampedArray(Array.from({length: 4}, () => color).flat());
const source = { width: 2, height: 2, frames: [rgba([255,0,0,255]), rgba([0,255,0,255]), rgba([0,0,255,255])] };
const bytes = await encodeAnimation(source, 1, 2, 20, () => {});
assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), 'GIF89a');
const result = decodeAnimation(bytes.buffer);
assert.equal(result.frames.length, 2);
assert.deepEqual([result.width, result.height], [2, 2]);
assert.deepEqual(Array.from(result.frames[0].slice(0, 4)), [0,255,0,255]);
assert.deepEqual(Array.from(result.frames[1].slice(0, 4)), [0,0,255,255]);
await assert.rejects(() => encodeAnimation(source, 2, 1, 10, () => {}), /Invalid export/);
const transparent = await encodeAnimation({width:2,height:2,frames:[rgba([0,0,0,0])]},0,0,10,()=>{});
assert.equal(decodeAnimation(transparent.buffer).frames[0][3], 0);
console.log('xyzrender GIF range, pixels and transparency round-trip passed');

for (const fps of [30, 60, 120]) {
  const highRate = { ...source, frames: Array.from({ length: 120 }, (_, i) => source.frames[i % 3]) };
  const encoded = await encodeAnimation(highRate, 0, 119, fps, () => {});
  const decoded = decompressFrames(parseGIF(encoded.buffer), false);
  assert.equal(decoded.length, Math.min(120, Math.round(120 / fps * 50)));
  assert.equal(decoded.reduce((total, frame) => total + frame.delay, 0), 120 / fps * 1000);
  assert.ok(decoded.every(frame => frame.delay >= 20));
}
console.log('30/60/120 fps export preserves duration with compatible GIF delays');
