/** Index already bounded browser XTC and DCD files without decoding coordinates.
 * Each frame becomes a byte range that the shared frame decoder reads alone: an
 * XTC frame is self-contained, a DCD frame is read behind the file's header. */
import { BROWSER_TRR_LIMITS } from './trr-index.mjs';

const LIMITS = BROWSER_TRR_LIMITS;
// One AKMA time unit in picoseconds (CHARMM), as MDAnalysis converts DCD time.
const AKMA_PS = 0.04888821;

function bounded(bytes, format) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.byteLength > LIMITS.bytes) throw new Error(`Browser ${format} exceeds the 75 MiB file limit.`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** GROMACS XTC (big-endian XDR): magic 1995, atoms, step, time, box, then the
 * coordinates, raw for at most nine atoms and compressed otherwise. */
export function indexXtcFrames(bytes) {
  const view = bounded(bytes, 'XTC');
  const frames = [];
  let offset = 0, atomCount;
  while (offset < bytes.length) {
    if (frames.length >= LIMITS.frames) throw new Error('Browser XTC exceeds the 100000-frame limit.');
    if (bytes.length - offset < 56 || view.getInt32(offset) !== 1995) throw new Error('Invalid or truncated browser XTC frame.');
    const count = view.getInt32(offset + 4);
    if (count < 1 || count > 5_000_000 || view.getInt32(offset + 52) !== count) throw new Error('Unsupported browser XTC atom count.');
    if (atomCount !== undefined && count !== atomCount) throw new Error('XTC atom count changes between frames.');
    atomCount = count;
    const timePs = view.getFloat32(offset + 12);
    if (!Number.isFinite(timePs)) throw new Error('Non-finite browser XTC time.');
    let end;
    if (count <= 9) end = offset + 56 + count * 12;
    else {
      if (bytes.length - offset < 92) throw new Error('Truncated browser XTC frame.');
      const length = view.getInt32(offset + 88);
      if (length < 0) throw new Error('Invalid browser XTC frame.');
      end = offset + 92 + Math.ceil(length / 4) * 4;
    }
    if (end > bytes.length || end - offset > LIMITS.frameBytes) throw new Error('Truncated or oversized browser XTC frame.');
    if (count * 12 > LIMITS.decodedBytes) throw new Error('Browser XTC positions exceed the decoded frame budget.');
    frames.push({ offset, length: end - offset, timePs });
    offset = end;
  }
  return { atomCount, frames };
}

/** Little-endian CHARMM/NAMD DCD with fixed-size frames: an optional unit cell
 * record, then X, Y and Z records. Fixed atoms and 4D coordinates are refused. */
export function indexDcdFrames(bytes) {
  const view = bounded(bytes, 'DCD');
  if (bytes.length < 92 || view.getUint32(0, true) !== 84 || view.getUint32(88, true) !== 84
    || String.fromCharCode(...bytes.subarray(4, 8)) !== 'CORD') throw new Error('Invalid browser DCD header.');
  const charmm = view.getUint32(84, true) !== 0;
  if (view.getUint32(40, true) !== 0) throw new Error('Browser DCD with fixed atoms is not supported.');
  if (charmm && view.getUint32(52, true) !== 0) throw new Error('Browser DCD with 4D coordinates is not supported.');
  const hasCell = charmm && view.getUint32(48, true) !== 0;
  let header = 92;
  const title = view.getUint32(header, true);
  if (title > 1 << 16 || header + title + 8 > bytes.length || view.getUint32(header + 4 + title, true) !== title) throw new Error('Invalid browser DCD title.');
  header += title + 8;
  if (header + 12 > bytes.length || view.getUint32(header, true) !== 4 || view.getUint32(header + 8, true) !== 4) throw new Error('Invalid browser DCD atom count.');
  const atomCount = view.getUint32(header + 4, true);
  header += 12;
  if (atomCount < 1 || atomCount > 5_000_000 || atomCount * 12 > LIMITS.decodedBytes) throw new Error('Unsupported browser DCD atom count.');
  const frameBytes = (hasCell ? 56 : 0) + 3 * (atomCount * 4 + 8);
  const frameCount = (bytes.length - header) / frameBytes;
  if (!Number.isInteger(frameCount) || frameCount < 1) throw new Error('Truncated browser DCD frames.');
  if (frameCount > LIMITS.frames) throw new Error('Browser DCD exceeds the 100000-frame limit.');
  // Frame i is written every `interval` steps of `step` AKMA; the first is at time 0.
  const interval = view.getUint32(16, true) || 1;
  const step = charmm ? view.getFloat32(44, true) : view.getFloat64(44, true);
  const timed = Number.isFinite(step) && step > 0;
  const frames = Array.from({ length: frameCount }, (_, index) => ({ offset: header + index * frameBytes, length: frameBytes,
    ...(timed ? { timePs: index * interval * step * AKMA_PS } : {}) }));
  return { atomCount, frames, header: bytes.subarray(0, header) };
}
