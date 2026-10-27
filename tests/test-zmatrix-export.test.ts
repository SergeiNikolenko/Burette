import { describe, expect, test } from 'bun:test';
import { zmatrixDocumentFromAtoms } from '../scripts/zmatrix-export.mjs';
import { atomsFromZmatrixDocument, formatZmatrixDocument, parseZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { placeInReferenceFrame } from '../scripts/internal-coordinates.mjs';

const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, k) => v - b[k]));
const raw = [
  { element: 'C', position: [0, 0, 0] },
  { element: 'N', position: [1, 0, 0] },
  { element: 'O', position: [2, 0, 0] },
  { element: 'H', position: [1, 1, 0] },
  { element: 'F', position: [2, 1, 1] },
];
describe('automatic Z-matrix reference points', () => {
  test('linear-leading atom order round-trips without reflection and restores the original frame', () => {
    // Rotate the collinear leading triple away from every Cartesian axis.
    const atoms = raw.map(atom => ({ ...atom, position: atom.position.map((_, k) =>
      [5, -7, 11][k] + [[.36, -.8, .48], [.48, .6, .64], [-.8, 0, .6]][k].reduce((s, v, j) => s + v * atom.position[j], 0)) }));
    const document = zmatrixDocumentFromAtoms(atoms);
    expect(document.rows.filter(row => row.element === 'X')).toHaveLength(1);
    const rebuilt = atomsFromZmatrixDocument(parseZmatrixDocument(formatZmatrixDocument(document)));
    expect(rebuilt.map(atom => atom.element)).toEqual(atoms.map(atom => atom.element));
    for (let i = 0; i < atoms.length; i++) for (let j = 0; j < i; j++) {
      expect(distance(atoms[i].position, atoms[j].position)).toBeCloseTo(distance(rebuilt[i].position, rebuilt[j].position), 10);
    }
    const placed = placeInReferenceFrame(rebuilt, atoms);
    placed.forEach((atom, i) => expect(distance(atom.position, atoms[i].position)).toBeLessThan(1e-10));
    expect(zmatrixDocumentFromAtoms(atoms)).toEqual(document);
  });
  test('dummy does not collide with a later atom and ordinary molecules do not gain dummy points', () => {
    const atoms = [...raw, { element: 'He', position: [0, 1, 0] }];
    expect(atomsFromZmatrixDocument(zmatrixDocumentFromAtoms(atoms))).toHaveLength(atoms.length);
    for (const ordinary of [raw.slice(0, 1), raw.slice(0, 2), raw.slice(0, 3), [raw[0], raw[1], raw[3]]]) {
      expect(zmatrixDocumentFromAtoms(ordinary).rows.every(row => row.element !== 'X')).toBe(true);
    }
  });
  test('a translated geometry at the coordinate cube corner still exports', () => {
    const atoms = [[0, 0, 0], [-1, -1, -1], [-2, -2, -2], [-1, -2, -1], [-2, -3, -4]]
      .map((position, i) => ({ element: raw[i].element, position: position.map(v => v + 1e6) }));
    const document = zmatrixDocumentFromAtoms(atoms);
    expect(document.rows.filter(row => row.element === 'X')).toHaveLength(1);
    const placed = placeInReferenceFrame(atomsFromZmatrixDocument(document), atoms);
    placed.forEach((atom, i) => expect(distance(atom.position, atoms[i].position)).toBeLessThan(1e-8));
  });
  test('total row limit includes generated points; invalid Cartesian atoms fail before export', () => {
    const atLimit = Array.from({ length: 512 }, (_, i) => ({ element: 'C', position: [i, 0, 0] }));
    atLimit[511].position[1] = 1;
    expect(() => zmatrixDocumentFromAtoms(atLimit)).toThrow('512-row');
    expect(zmatrixDocumentFromAtoms(atLimit.slice(0, 511)).rows).toHaveLength(511);
    expect(() => zmatrixDocumentFromAtoms([{ element: 'X', position: [0, 0, 0] }])).toThrow();
    expect(() => zmatrixDocumentFromAtoms([raw[0], raw[0]])).toThrow();
  });
});
