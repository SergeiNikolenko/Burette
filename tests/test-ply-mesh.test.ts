import { expect, test } from 'bun:test';
import { PlyMeshWriter } from '../scripts/ply-mesh.mjs';

const triangle = () => ({
  positions: new Float64Array([5, -7, 11, 6.125, -7, 11, 5, -6, 11]),
  normals: new Float32Array([0, 0, 2, 0, 0, 2, 0, 0, 2]),
  colors: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0]),
  indices: new Uint32Array([0, 1, 2]),
});

// Read fields from the PLY header rather than duplicating the writer's layout.
async function readPly(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = new TextDecoder().decode(bytes.subarray(0, 1024)).split('end_header\n')[0] + 'end_header\n';
  let offset = new TextEncoder().encode(header).length;
  const view = new DataView(bytes.buffer);
  const sections = header.split('\n').filter(line => line.startsWith('element ') || line.startsWith('property '));
  const output: Record<string, Record<string, number | number[]>[]> = {};
  for (let line = 0; line < sections.length;) {
    const [, name, count] = sections[line++].split(' ');
    const fields: string[][] = [];
    while (sections[line]?.startsWith('property ')) fields.push(sections[line++].split(' ').slice(1));
    const read = (type: string) => {
      if (type === 'uchar') return view.getUint8(offset++);
      const result = type === 'float' ? view.getFloat32(offset, true) : view.getInt32(offset, true);
      offset += 4;
      return result;
    };
    output[name] = Array.from({ length: Number(count) }, () => Object.fromEntries(fields.map(field =>
      field[0] === 'list' ? [field[3], Array.from({ length: read(field[1]) }, () => read(field[2]))] : [field[1], read(field[0])])));
  }
  expect(offset).toBe(bytes.length);
  return { header, ...output };
}

test('PLY retains world positions, normalized normals, colors, opacity and object index offsets', async () => {
  const writer = new PlyMeshWriter(), first = triangle();
  writer.append(first);
  first.positions.fill(0);
  first.colors.fill(0);
  const second = triangle();
  second.positions = second.positions.map((value, index) => index % 3 === 2 ? value + 2 : value);
  second.indices = new Uint32Array([2, 1, 0]);
  writer.append(second);
  const result = await readPly(writer.toBlob());
  expect(result.header).toContain('coordinates in angstrom');
  expect(result.vertex).toEqual([
    { x: 5, y: -7, z: 11, nx: 0, ny: 0, nz: 1, red: 255, green: 0, blue: 0, alpha: 255 },
    { x: 6.125, y: -7, z: 11, nx: 0, ny: 0, nz: 1, red: 0, green: 255, blue: 0, alpha: 128 },
    { x: 5, y: -6, z: 11, nx: 0, ny: 0, nz: 1, red: 0, green: 0, blue: 255, alpha: 0 },
    { x: 5, y: -7, z: 13, nx: 0, ny: 0, nz: 1, red: 255, green: 0, blue: 0, alpha: 255 },
    { x: 6.125, y: -7, z: 13, nx: 0, ny: 0, nz: 1, red: 0, green: 255, blue: 0, alpha: 128 },
    { x: 5, y: -6, z: 13, nx: 0, ny: 0, nz: 1, red: 0, green: 0, blue: 255, alpha: 0 },
  ]);
  expect(result.face).toEqual([{ vertex_indices: [0, 1, 2] }, { vertex_indices: [5, 4, 3] }]);
});

test('invalid mesh chunks and bounds fail atomically before output allocation', async () => {
  const writer = new PlyMeshWriter();
  expect(() => writer.toBlob()).toThrow('no exportable triangles');
  writer.append(triangle());
  const before = new Uint8Array(await writer.toBlob().arrayBuffer());
  for (const invalid of [
    { ...triangle(), positions: new Float32Array([NaN, 0, 0, 0, 0, 0, 0, 0, 0]) },
    { ...triangle(), positions: new Float64Array([1e7, 0, 0, 0, 0, 0, 0, 0, 0]) },
    { ...triangle(), normals: new Float32Array(9) },
    { ...triangle(), normals: new Float32Array(6) },
    { ...triangle(), colors: [256, ...new Array(11).fill(0)] },
    { ...triangle(), indices: [-1, 1, 2] },
    { ...triangle(), indices: [0, 0, 2] },
    { ...triangle(), indices: [0, 1, 3] },
    { ...triangle(), indices: [0, 1] },
    { ...triangle(), indices: [0, 1, 1.5] },
  ]) expect(() => writer.append(invalid)).toThrow();
  expect(() => writer.checkCapacity(3e6, 0)).toThrow('64 MiB');
  expect(() => writer.checkCapacity(-1, 0)).toThrow();
  expect(() => writer.checkCapacity(0, Infinity)).toThrow();
  expect([writer.vertexCount, writer.faceCount]).toEqual([3, 1]);
  expect(new Uint8Array(await writer.toBlob().arrayBuffer())).toEqual(before);
});
