import type { ScientificDocument } from "../molecular-workbench/scientific-types";

export type ScalarSourceIdentity =
  | { kind: "atoms"; atomCount: number; geometrySha256: string; decodedSourceSha256: string }
  | { kind: "cube"; dimensions: number[]; matrix: number[]; geometrySha256: string; valuesSha256: string; decodedSourceSha256: string };

const hash = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
const textHash = (text: string) => hash(new TextEncoder().encode(text));

/** Binds source-order geometry at native Float32 precision and the decoded rendered source. */
export async function scalarSourceIdentity(science: ScientificDocument, sourceText: string, sourceKind: string): Promise<ScalarSourceIdentity> {
  if (sourceKind === "cube" || sourceKind === "cub") {
    const grid = science.grid;
    if (!grid) throw new Error("This source has no Cube grid.");
    const matrix = [...grid.axes[0], 0, ...grid.axes[1], 0, ...grid.axes[2], 0, ...grid.origin, 1];
    const values = new Uint8Array(grid.values.length * 4), view = new DataView(values.buffer);
    for (let index = 0; index < grid.values.length; index++) view.setFloat32(index * 4, grid.values[index]!, true);
    return { kind: "cube", dimensions: grid.dimensions, matrix, geometrySha256: await textHash(JSON.stringify([grid.dimensions, matrix])),
      valuesSha256: await hash(values), decodedSourceSha256: await textHash(sourceText) };
  }
  const atoms = science.atoms.map(atom => [atom.element.toUpperCase(), ...[atom.x, atom.y, atom.z].map(Math.fround)]);
  return { kind: "atoms", atomCount: atoms.length, geometrySha256: await textHash(JSON.stringify(atoms)),
    decodedSourceSha256: await textHash(sourceText) };
}
