// Binary PLY 1.0: https://paulbourke.net/dataformats/ply/
// Scene-space coordinates remain in angstrom, without recentering or scaling.
// This serializer owns no renderer state; the caller supplies tessellated meshes.
export const MESH_EXPORT_LIMIT = 64 * 1024 * 1024;
const VERTEX_BYTES = 28; // xyz, normal (float32), RGBA (uint8)
const FACE_BYTES = 13; // count (uint8), three vertex indices (int32)
const HEADER_RESERVE = 1024;

function sizeCheck(vertices, faces) {
  if (!Number.isSafeInteger(vertices) || !Number.isSafeInteger(faces) || vertices < 0 || faces < 0
      || vertices * VERTEX_BYTES + faces * FACE_BYTES + HEADER_RESERVE > MESH_EXPORT_LIMIT) {
    throw new Error('The 3D model exceeds the 64 MiB export limit.');
  }
}

/**
 * Incremental, bounded triangle-mesh writer. Each append is atomic and copies
 * its input, so later renderer mutations cannot alter accepted output chunks.
 * Indices are local to a chunk; the writer adjusts them across scene objects.
 * The accepted chunks (float32 positions, unit float32 normals, RGBA bytes and
 * scene-wide uint32 triangle indices) are what every scene export format reads.
 */
export class PlyMeshWriter {
  #vertexCount = 0;
  #faceCount = 0;
  #chunks = [];

  get vertexCount() { return this.#vertexCount; }
  get faceCount() { return this.#faceCount; }
  get chunks() { return this.#chunks.slice(); }

  /** Check before a caller allocates expanded instance/tessellation arrays. */
  checkCapacity(vertices, faces) {
    sizeCheck(vertices, faces);
    sizeCheck(this.#vertexCount + vertices, this.#faceCount + faces);
  }

  append({ positions, normals, colors, indices }) {
    const vertices = positions.length / 3, faces = indices.length / 3;
    this.checkCapacity(vertices, faces);
    if (normals.length !== positions.length || colors.length !== vertices * 4) {
      throw new Error('PLY requires one normal and RGBA color per vertex.');
    }
    if (!vertices || !faces) throw new Error('PLY mesh chunks must contain vertices and triangles.');
    // Validate before allocating or changing accumulated output. Chunks reach millions of
    // triangles and run on the viewer's main thread: no allocation per element.
    for (let i = 0; i < positions.length; i++) {
      const value = positions[i];
      if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error('PLY coordinates must be finite and within ±1,000,000 Å.');
    }
    for (let i = 0; i < normals.length; i += 3) {
      const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      if (!Number.isFinite(length) || length < 1e-20) throw new Error('PLY normals must be finite and nonzero.');
    }
    for (let i = 0; i < colors.length; i++) {
      const value = colors[i];
      if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('PLY color channels must be integers from 0 to 255.');
    }
    const inRange = value => Number.isInteger(value) && value >= 0 && value < vertices;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      if (!inRange(a) || !inRange(b) || !inRange(c) || a === b || b === c || a === c) {
        throw new Error('PLY triangles require three distinct in-range vertex indices.');
      }
    }
    const chunkPositions = Float32Array.from(positions), chunkNormals = new Float32Array(positions.length);
    for (let i = 0; i < normals.length; i += 3) {
      const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      for (let axis = 0; axis < 3; axis++) chunkNormals[i + axis] = normals[i + axis] / length;
    }
    const chunkIndices = new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i++) chunkIndices[i] = this.#vertexCount + indices[i];
    this.#chunks.push({ positions: chunkPositions, normals: chunkNormals, colors: Uint8Array.from(colors), indices: chunkIndices });
    this.#vertexCount += vertices;
    this.#faceCount += faces;
  }

  toBlob() {
    if (!this.#faceCount) throw new Error('The scene contains no exportable triangles.');
    const header = [
      'ply', 'format binary_little_endian 1.0',
      'comment Burette scene mesh; coordinates in angstrom',
      `element vertex ${this.#vertexCount}`,
      ...['x', 'y', 'z', 'nx', 'ny', 'nz'].map(name => `property float ${name}`),
      ...['red', 'green', 'blue', 'alpha'].map(name => `property uchar ${name}`),
      `element face ${this.#faceCount}`, 'property list uchar int vertex_indices', 'end_header', '',
    ].join('\n');
    const vertexParts = this.#chunks.map(({ positions, normals, colors }) => {
      const bytes = new Uint8Array(positions.length / 3 * VERTEX_BYTES), view = new DataView(bytes.buffer);
      for (let i = 0; i < positions.length / 3; i++) {
        const offset = i * VERTEX_BYTES;
        for (let axis = 0; axis < 3; axis++) {
          view.setFloat32(offset + axis * 4, positions[i * 3 + axis], true);
          view.setFloat32(offset + 12 + axis * 4, normals[i * 3 + axis], true);
        }
        bytes.set(colors.subarray(i * 4, i * 4 + 4), offset + 24);
      }
      return bytes;
    });
    const faceParts = this.#chunks.map(({ indices }) => {
      const bytes = new Uint8Array(indices.length / 3 * FACE_BYTES), view = new DataView(bytes.buffer);
      for (let i = 0; i < indices.length / 3; i++) {
        view.setUint8(i * FACE_BYTES, 3);
        for (let corner = 0; corner < 3; corner++) view.setInt32(i * FACE_BYTES + 1 + corner * 4, indices[i * 3 + corner], true);
      }
      return bytes;
    });
    return new Blob([header, ...vertexParts, ...faceParts], { type: 'application/octet-stream' });
  }
}
