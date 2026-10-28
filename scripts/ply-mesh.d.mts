type NumericArray = ArrayLike<number> & Iterable<number> & { slice(start: number, end: number): ArrayLike<number>; subarray?(start: number, end: number): ArrayLike<number> };
export class PlyMeshWriter {
  readonly vertexCount: number;
  readonly faceCount: number;
  checkCapacity(vertices: number, faces: number): void;
  append(mesh: { positions: NumericArray; normals: NumericArray; colors: NumericArray; indices: NumericArray }): void;
  toBlob(): Blob;
}
