type NumericArray = ArrayLike<number> & Iterable<number> & { slice(start: number, end: number): ArrayLike<number>; subarray?(start: number, end: number): ArrayLike<number> };
export type SceneMeshChunk = { readonly positions: Float32Array; readonly normals: Float32Array; readonly colors: Uint8Array; readonly indices: Uint32Array };
export const MESH_EXPORT_LIMIT: number;
export class PlyMeshWriter {
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly chunks: SceneMeshChunk[];
  checkCapacity(vertices: number, faces: number): void;
  append(mesh: { positions: NumericArray; normals: NumericArray; colors: NumericArray; indices: NumericArray }): void;
  toBlob(): Blob;
}
