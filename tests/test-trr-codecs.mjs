import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeTrrFrame } from '../scripts/trr-frame.mjs';
import { indexTrrFrames, BROWSER_TRR_LIMITS } from '../scripts/trr-index.mjs';

function trrFrame(precision, box) {
  const version = new TextEncoder().encode('GMX_trn_file');
  const header = 12 + version.length, boxBytes = box ? precision * 9 : 0;
  const bytes = new Uint8Array(header + 52 + 2 * precision + boxBytes + 3 * precision);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1993); view.setUint32(4, 13); view.setUint32(8, version.length); bytes.set(version, 12);
  view.setUint32(header + 8, boxBytes); view.setUint32(header + 28, precision * 3); view.setUint32(header + 40, 1);
  const float = (offset, value) => precision === 8 ? view.setFloat64(offset, value) : view.setFloat32(offset, value);
  float(header + 52, 2.75);
  let offset = header + 52 + 2 * precision;
  if (box) { [1, 0, 0, 0, 2, 0, 0, 0, 3].forEach((value, i) => float(offset + i * precision, value)); offset += boxBytes; }
  [0.125, -0.25, 1.5].forEach((value, i) => float(offset + i * precision, value));
  return bytes;
}
for (const precision of [4, 8]) for (const box of [true, false]) {
  const frame = decodeTrrFrame(trrFrame(precision, box));
  assert.deepEqual([frame.x[0], frame.y[0], frame.z[0]], [1.25, -2.5, 15]);
  assert.equal(frame.timePs, 2.75);
  assert.deepEqual(frame.box, box ? [10, 0, 0, 0, 20, 0, 0, 0, 30] : undefined);
  assert.equal(frame.velocities, undefined); assert.equal(frame.forces, undefined);
}

// Independently written/read back by MDAnalysis libmdaxdr. TRR stores nm/ps
// velocities and kJ/mol/nm forces; absent blocks stay absent on a later frame.
const vectorBytes = new Uint8Array(readFileSync(new URL('./fixtures/trajectory/vectors.trr', import.meta.url)));
const forceBytes = new Uint8Array(readFileSync(new URL('./fixtures/trajectory/forces-only.trr', import.meta.url)));
const vectorFrame = decodeTrrFrame(vectorBytes);
const forceFrame = decodeTrrFrame(forceBytes);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const expectedV = [[.1, -.2, .3], [.4, 0, -.6], [-.7, .8, .9]];
const expectedF = [[1, -2, 3], [0, .5, -.5], [.1, .2, .3]];
for (let atom = 0; atom < 3; atom++) {
  ['vx', 'vy', 'vz'].forEach((axis, i) => near(vectorFrame.velocities[axis][atom], expectedV[atom][i]));
  ['fx', 'fy', 'fz'].forEach((axis, i) => {
    near(vectorFrame.forces[axis][atom], expectedF[atom][i]);
    near(forceFrame.forces[axis][atom], expectedF[atom][i] * 2);
  });
}
assert.equal(forceFrame.velocities, undefined);
assert.deepEqual([vectorFrame.step, forceFrame.step], [125, 175]);
assert.deepEqual([vectorFrame.timePs, forceFrame.timePs], [2.75, 4.25]);
const shifted = new Uint8Array(vectorBytes.length + 10);
shifted.set(vectorBytes, 7);
assert.deepEqual(decodeTrrFrame(shifted.subarray(7, 7 + vectorBytes.length)), decodeTrrFrame(vectorBytes));
// Double-precision vectors with no box exercise precision inference from coordinates.
const doubleCoords = trrFrame(8, false), doubleVectors = new Uint8Array(doubleCoords.length + 48);
doubleVectors.set(doubleCoords);
const doubleView = new DataView(doubleVectors.buffer), doubleHeader = 24;
doubleView.setUint32(doubleHeader + 32, 24); doubleView.setUint32(doubleHeader + 36, 24);
[.012345678901, -.02, .03, 41.84, -83.68, 125.52].forEach((value, i) => doubleView.setFloat64(doubleCoords.length + i * 8, value));
const doubleFrame = decodeTrrFrame(doubleVectors);
assert.equal(doubleFrame.velocities.vx[0], .012345678901 * 10);
near(doubleFrame.forces.fz[0], 3);
for (const corrupt of [
  bytes => bytes.subarray(0, bytes.length - 1),
  bytes => { new DataView(bytes.buffer).setUint32(24 + 32, 8); return bytes; },
  bytes => { new DataView(bytes.buffer).setUint32(24, 4); return bytes; },
  bytes => { new DataView(bytes.buffer).setFloat32(24 + 52, NaN); return bytes; },
  bytes => { new DataView(bytes.buffer).setFloat32(bytes.length - 4, Infinity); return bytes; },
  bytes => { new DataView(bytes.buffer).setUint32(24 + 40, 5_000_001); return bytes; },
]) assert.throws(() => decodeTrrFrame(corrupt(vectorBytes.slice())), /TRR/);


const first = vectorBytes, second = forceBytes;
const bytes = new Uint8Array(first.length + second.length); bytes.set(first); bytes.set(second, first.length);
assert.deepEqual(indexTrrFrames(bytes), { atomCount: 3, frames: [
  { offset: 0, length: 228, timePs: 2.75 }, { offset: 228, length: 192, timePs: 4.25 },
] });
const offsetBuffer = new Uint8Array(bytes.length + 7); offsetBuffer.set(bytes, 3);
assert.deepEqual(indexTrrFrames(offsetBuffer.subarray(3, 3 + bytes.length)), indexTrrFrames(bytes));
for (const data of [bytes.subarray(0, bytes.length - 1), new Uint8Array([...bytes, 0]), new Uint8Array(0), new Uint8Array(BROWSER_TRR_LIMITS.bytes + 1)]) {
  assert.throws(() => indexTrrFrames(data), /TRR/);
}
for (const mutate of [
  view => view.setUint32(first.length + 24 + 40, 4),
  view => view.setUint32(24 + 32, 8),
  view => view.setFloat32(first.length + 24 + 52, NaN),
  view => view.setUint32(first.length, 1),
]) { const bad = bytes.slice(); mutate(new DataView(bad.buffer)); assert.throws(() => indexTrrFrames(bad), /TRR/); }

console.log('TRR codecs: independent vectors, float32/64, units, bounded indexing and malformed data rejection passed');
