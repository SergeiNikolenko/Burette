import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { serializeXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { zmatrixDocumentFromAtoms } from "../scripts/zmatrix-export.mjs";
import { editZmatrixRows } from "../scripts/zmatrix-rows.mjs";
import { zmatrixRowsRevision } from "../apps/desktop/src/lib/workbench/zmatrix-draft";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
const sourceFrames = (data: ScientificDocument) => readXyzFrames(serializeXyz(data.atoms, "pose validation"));
function pose(data: ScientificDocument, transform: (x: number, y: number, z: number) => number[]): ScientificDocument {
  const atoms = data.atoms.map(atom => { const [x, y, z] = transform(atom.x, atom.y, atom.z); return { ...atom, x, y, z }; });
  return { ...data, atoms, frames: [{ atoms }], modes: [], orbitals: [] };
}
const chiral = () => parseScientificFile("chiral.zmat", "C\nX 1 2\nH 1 R 2 A\nF 1 R 2 A 3 120\nCl 1 R 2 A 3 -120\nR=1.1\nA=109.5\n");

test("real FCHK converted to internal coordinates and Add X validates without changing its absolute source pose", () => {
  const data = parseScientificFile("gaussian16-water-raman.fchk", readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url), "utf8"));
  const atoms = data.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
  const definition = zmatrixDocumentFromAtoms(atoms), science = { ...data, internalCoordinates: definition };
  const text = serializeXyz(data.atoms, "actual FCHK"), origin = { text, document: science };
  const next = zmatrixRowsRevision(science, editZmatrixRows(definition,
    { type: "append", row: { element: "X", refs: [0, 1, 2], values: [2, 90, 90] } }, atoms), text, [origin]);
  expect(next.document.atoms).toBe(data.atoms);
  expect(validateScientificDocument(next.document, readXyzFrames(next.text))).toBe(next.document);
});

test("proper rotations and translations preserve a definition with dummy references and signed torsions", () => {
  const original = chiral();
  for (const transform of [(x: number, y: number, z: number) => [-y + 5, x - 3, z + 2],
    (x: number, y: number, z: number) => [z + 9, x - 7, y + 4]]) {
    const transformed = pose(original, transform);
    expect(validateScientificDocument(transformed, sourceFrames(transformed))).toBe(transformed);
    expect(transformed.internalCoordinates).toBe(original.internalCoordinates);
  }
});

test("reflections preserve distances but must not preserve a chiral internal-coordinate definition", () => {
  const original = chiral(), reflected = pose(original, (x, y, z) => [-x + 5, y - 3, z + 2]);
  expect(() => validateScientificDocument(reflected, sourceFrames(reflected))).toThrow("Z-matrix definition does not match");
});

test("changed bonds, angles and dummy-referenced torsions fail the same geometry check", () => {
  const original = chiral();
  for (const [name, value] of [["R", 1.3], ["A", 95]] as const) {
    const changed = { ...original, internalCoordinates: { ...original.internalCoordinates!, variables: original.internalCoordinates!.variables.map(variable => variable.name === name ? { name, value } : variable) } };
    expect(() => validateScientificDocument(changed, sourceFrames(original))).toThrow("Z-matrix definition does not match");
  }
  const changed = structuredClone(original); changed.internalCoordinates!.rows[4].values[2] = -90;
  expect(() => validateScientificDocument(changed, sourceFrames(original))).toThrow("Z-matrix definition does not match");
});

test("pose-invariant definition checking does not relax exact scientific-to-source pose correspondence", () => {
  const original = chiral(), transformed = pose(original, (x, y, z) => [x + 2, y, z]);
  expect(() => validateScientificDocument(original, sourceFrames(transformed))).toThrow("Scientific atoms do not match");
});


test("one atom, diatomics and nearly collinear dummy-referenced definitions retain a rigidly moved pose", () => {
  const inputs = ["He\n", "C\nN 1 1.2\n", ...["179.999", "179.999999", "0.000001"].map(angle =>
    `C\nN 1 1.2\nX 2 1.0 1 90\nO 2 1.3 1 ${angle} 3 20\nF 4 1.4 2 179.99999 3 30\nH 1 1.1 2 ${angle} 3 -70\n`)];
  for (const input of inputs) {
    const original = parseScientificFile("near-axis.zmat", input);
    const moved = pose(original, (x, y, z) => [z + 600, x - 900, y + 350]);
    expect(validateScientificDocument(moved, sourceFrames(moved))).toBe(moved);
  }
});
