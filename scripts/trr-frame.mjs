/** One indexed GROMACS TRR frame. XDR scalars are big-endian; no source bytes are mutated. */
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const MAX_ATOMS = 5_000_000;

export function decodeTrrFrame(data) {
  if (!(data instanceof Uint8Array) || data.byteLength < 64 || data.byteLength > MAX_INPUT_BYTES) throw new Error('Invalid indexed TRR frame size.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const versionBytes = view.getUint32(8);
  const header = 12 + Math.ceil(versionBytes / 4) * 4;
  if (view.getUint32(0) !== 1993 || versionBytes < 1 || versionBytes > 1024 || header + 60 > data.byteLength) throw new Error('Invalid indexed TRR header.');
  const sizes = Array.from({ length: 10 }, (_, i) => view.getUint32(header + i * 4));
  const count = view.getUint32(header + 40);
  if (!count || count > MAX_ATOMS || [0, 1, 5, 6].some(i => sizes[i])) throw new Error('Unsupported indexed TRR topology or atom count.');
  const precision = sizes[2] ? sizes[2] / 9 : sizes[7] / (count * 3);
  const vectorBytes = count * 3 * precision;
  if (![4, 8].includes(precision) || sizes[7] !== vectorBytes
    || [2, 3, 4].some(i => sizes[i] !== 0 && sizes[i] !== 9 * precision)
    || [8, 9].some(i => sizes[i] !== 0 && sizes[i] !== vectorBytes)) throw new Error('Invalid indexed TRR block size or precision.');
  const start = header + 52 + 2 * precision;
  if (start + sizes.reduce((sum, size) => sum + size, 0) !== data.byteLength) throw new Error('Truncated or trailing indexed TRR frame data.');
  if (count * 3 * (4 + (sizes[8] ? 8 : 0) + (sizes[9] ? 8 : 0)) > MAX_DECODED_BYTES) throw new Error('Indexed TRR vectors exceed the decoded frame budget.');
  const float = offset => {
    const value = precision === 8 ? view.getFloat64(offset) : view.getFloat32(offset);
    if (!Number.isFinite(value)) throw new Error('Non-finite indexed TRR value.');
    return value;
  };
  const timePs = float(header + 52), lambda = float(header + 52 + precision);
  let offset = start;
  const box = sizes[2] ? Array.from({ length: 9 }, (_, i) => float(offset + i * precision) * 10) : undefined;
  if (box?.some(value => !Number.isFinite(value))) throw new Error('Indexed TRR box exceeds numeric range.');
  offset += sizes[2] + sizes[3] + sizes[4];
  const vectors = (scale, ArrayType) => {
    const axes = [new ArrayType(count), new ArrayType(count), new ArrayType(count)];
    for (let atom = 0; atom < count; atom++) for (let axis = 0; axis < 3; axis++) {
      axes[axis][atom] = float(offset) * scale;
      if (!Number.isFinite(axes[axis][atom])) throw new Error('Indexed TRR vector exceeds numeric range.');
      offset += precision;
    }
    return axes;
  };
  const [x, y, z] = vectors(10, Float32Array);
  // GROMACS base units: nm, ps, kJ/mol. Convert to the workbench's units.
  const velocity = sizes[8] ? vectors(10, Float64Array) : undefined;
  const force = sizes[9] ? vectors(1 / 41.84, Float64Array) : undefined;
  return {
    elementCount: count, x, y, z, box, timePs, step: view.getInt32(header + 44), lambda,
    ...(velocity ? { velocities: { vx: velocity[0], vy: velocity[1], vz: velocity[2] } } : {}),
    ...(force ? { forces: { fx: force[0], fy: force[1], fz: force[2] } } : {}),
  };
}
