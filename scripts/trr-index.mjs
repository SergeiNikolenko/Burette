/** Index an already bounded browser TRR without decoding coordinate/vector arrays. */
export const BROWSER_TRR_LIMITS = Object.freeze({ bytes: 75 * 1024 * 1024, frames: 100_000, frameBytes: 64 * 1024 * 1024, decodedBytes: 128 * 1024 * 1024 });

export function indexTrrFrames(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.byteLength > BROWSER_TRR_LIMITS.bytes) throw new Error('Browser TRR exceeds the 75 MiB file limit.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = [];
  let offset = 0, atomCount;
  while (offset < bytes.length) {
    if (frames.length >= BROWSER_TRR_LIMITS.frames) throw new Error('Browser TRR exceeds the 100000-frame limit.');
    if (bytes.length - offset < 64 || view.getUint32(offset) !== 1993) throw new Error('Invalid or truncated browser TRR frame.');
    const versionLength = view.getUint32(offset + 8);
    const header = offset + 12 + Math.ceil(versionLength / 4) * 4;
    if (versionLength < 1 || versionLength > 1024 || header + 60 > bytes.length) throw new Error('Invalid browser TRR header.');
    const sizes = Array.from({ length: 10 }, (_, index) => view.getUint32(header + index * 4));
    const count = view.getUint32(header + 40);
    const precision = sizes[2] ? sizes[2] / 9 : sizes[7] / (count * 3);
    if (!count || count > 5_000_000 || [0, 1, 5, 6].some(index => sizes[index]) || ![4, 8].includes(precision)
      || sizes[7] !== count * 3 * precision || [2, 3, 4].some(index => sizes[index] !== 0 && sizes[index] !== 9 * precision)
      || [8, 9].some(index => sizes[index] !== 0 && sizes[index] !== count * 3 * precision)) throw new Error('Unsupported browser TRR blocks or atom count.');
    const end = header + 52 + 2 * precision + sizes.reduce((sum, size) => sum + size, 0);
    if (end > bytes.length || end - offset > BROWSER_TRR_LIMITS.frameBytes) throw new Error('Truncated or oversized browser TRR frame.');
    if (count * 3 * (4 + (sizes[8] ? 8 : 0) + (sizes[9] ? 8 : 0)) > BROWSER_TRR_LIMITS.decodedBytes) throw new Error('Browser TRR vectors exceed the decoded frame budget.');
    if (atomCount !== undefined && count !== atomCount) throw new Error('TRR atom count changes between frames.');
    atomCount = count;
    const timePs = precision === 8 ? view.getFloat64(header + 52) : view.getFloat32(header + 52);
    const lambda = precision === 8 ? view.getFloat64(header + 60) : view.getFloat32(header + 56);
    if (!Number.isFinite(timePs) || !Number.isFinite(lambda)) throw new Error('Non-finite browser TRR time or lambda.');
    frames.push({ offset, length: end - offset, timePs });
    offset = end;
  }
  return { atomCount, frames };
}
