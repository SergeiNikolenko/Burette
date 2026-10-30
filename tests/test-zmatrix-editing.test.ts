import { describe, expect, test } from 'bun:test';
import { addZmatrixVariable, bindZmatrixCoordinate, removeZmatrixVariable, renameZmatrixVariable, setZmatrixReferences } from '../scripts/zmatrix-editing.mjs';
import { placeInReferenceFrame } from '../scripts/internal-coordinates.mjs';
import { atomsFromZmatrixDocument, parseZmatrixDocument, resolveZmatrixDocument } from '../scripts/zmatrix-document.mjs';

const source = 'C\nH 1 R\nF 1 1.2 2 90\nCl 1 R 2 90 3 -D\nBr 1 R 2 90 3 +D\nR=1.4\nD=70\n';
const base = () => parseZmatrixDocument(source);
const atoms = atomsFromZmatrixDocument;

describe('editable Z-matrix bindings', () => {
  test('equivalent reference planes preserve signed bindings at the torsion boundary', () => {
    const original = parseZmatrixDocument('C\nH 1 1\nF 1 1 2 90\nX 1 2 2 90 3 0\nCl 1 1.5 2 90 3 -D\nD=180\n');
    for (const refs of [[0, 1, 2], [0, 1, 3]]) {
      const changed = setZmatrixReferences(original, 4, refs);
      expect(changed.detachedSlots).toEqual([]);
      expect(changed.document.rows[4].values[2]).toBe('-D');
    }
  });
  test('changing references retains the transverse component of nearly linear geometry', () => {
    const original = parseZmatrixDocument('C\nH 1 1\nF 1 1 2 90\nCl 1 1.5 2 179.999999 3 75\n');
    const before = atoms(original);
    const changed = setZmatrixReferences(original, 3, [1, 0, 2]);
    expect(changed.document.rows[3].values[1]).toBeGreaterThan(0);
    const restored = placeInReferenceFrame(atoms(changed.document), before);
    restored.forEach((atom, i) => atom.position.forEach((v, k) => expect(v).toBeCloseTo(before[i].position[k], 13)));
    expect(Math.sign(restored[3].position[1])).toBe(Math.sign(before[3].position[1]));
  });
  test('a linear row away from the coordinate axes can change its torsion reference', () => {
    const original = parseZmatrixDocument('C\nH 1 1\nF 1 1 2 25\nX 1 1.1 2 90 3 90\nCl 3 0.7 2 0 1 75\n');
    const before = atoms(original);
    const changed = setZmatrixReferences(original, 4, [2, 1, 3]);
    placeInReferenceFrame(atoms(changed.document), before).forEach((atom, i) => atom.position.forEach((v, k) => expect(v).toBeCloseTo(before[i].position[k], 12)));
  });
  test('reference changes retain geometry and handedness, detaching only changed bindings', () => {
    const original = base();
    for (const refs of [[1, 0, 2], [2, 1, 0], [2, 0, 1]]) {
      const changed = setZmatrixReferences(original, 3, refs);
      expect(changed.detachedSlots).toContain(0);
      expect(typeof changed.document.rows[3].values[0]).toBe('number');
      const before = atoms(original);
      placeInReferenceFrame(atoms(changed.document), before).forEach((atom, i) => atom.position.forEach((v, k) => expect(v).toBeCloseTo(before[i].position[k], 9)));
    }
    const unchanged = setZmatrixReferences(original, 3, [0, 1, 2]);
    expect(unchanged.detachedSlots).toEqual([]);
    expect(unchanged.document.rows[3].values).toEqual(original.rows[3].values);
    expect(original).toEqual(base());
    for (const refs of [[0, 1, 3], [0, 0, 1], [-1, 0, 1], [0, 1]]) expect(() => setZmatrixReferences(original, 3, refs)).toThrow();
  });
  test('add, bind and detach coordinate; subsequent shared edits affect only bound uses', () => {
    const original = base();
    const added = addZmatrixVariable(original, 'Fbond', 1.3);
    expect(atoms(added)).toEqual(atoms(original));
    const bound = bindZmatrixCoordinate(added, 2, 0, 'Fbond');
    expect(resolveZmatrixDocument(bound)[2].values[0]).toBe(1.3);
    expect(atoms(bound)[2]).not.toEqual(atoms(original)[2]);
    const detached = bindZmatrixCoordinate(bound, 2, 0, null);
    expect(atoms(detached)).toEqual(atoms(bound));
    expect(detached.rows[2].values[0]).toBe(1.3);
    detached.variables.find(v => v.name === 'Fbond')!.value = 1.6;
    expect(resolveZmatrixDocument(detached)[2].values[0]).toBe(1.3);
    expect(original).toEqual(base());
  });
  test('rename and remove preserve signed torsions and every Cartesian coordinate', () => {
    const original = base();
    const renamed = renameZmatrixVariable(original, 'D', 'Torsion');
    expect(renamed.rows.slice(3).map(r => r.values[2])).toEqual(['-Torsion', '+Torsion']);
    expect(atoms(renamed)).toEqual(atoms(original));
    const removed = removeZmatrixVariable(renamed, 'Torsion');
    expect(removed.rows.slice(3).map(r => r.values[2])).toEqual([-70, 70]);
    expect(atoms(removed)).toEqual(atoms(original));
    expect(original).toEqual(base());
  });
  test('dummy coordinates can bind but remain absent from the real atom list', () => {
    const original = parseZmatrixDocument('O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\nR=.9572\nA=52.26\n');
    const bound = bindZmatrixCoordinate(addZmatrixVariable(original, 'Dummy', 1.8), 1, 0, 'Dummy');
    expect(atoms(bound).map(a => a.element)).toEqual(['O', 'H', 'H']);
    atoms(bound).forEach((atom, i) => atom.position.forEach((v, j) => expect(v).toBeCloseTo(atoms(original)[i].position[j], 12)));
  });
  test('invalid actions leave all input arrays and values unchanged', () => {
    const original = base();
    const actions = [
      () => addZmatrixVariable(original, 'R', 2),
      () => addZmatrixVariable(original, 'x'.repeat(65), 2),
      () => addZmatrixVariable(original, 'Q', Infinity),
      () => renameZmatrixVariable(original, 'R', 'D'),
      () => renameZmatrixVariable(original, 'missing', 'Q'),
      () => removeZmatrixVariable(original, 'missing'),
      () => bindZmatrixCoordinate(original, 1, 0, '-R'),
      () => bindZmatrixCoordinate(original, 2, 1, 181),
      () => bindZmatrixCoordinate(original, 3, 2, 'missing'),
      () => bindZmatrixCoordinate(original, 0, 0, 1),
      () => bindZmatrixCoordinate(original, 1.5, 0, 1),
      () => bindZmatrixCoordinate(original, 1, -1, 1),
    ];
    for (const action of actions) { expect(action).toThrow(); expect(original).toEqual(base()); }
  });
});

test('changing only a collinear torsion reference keeps an exact-linear row placeable',()=>{
 const document=parseZmatrixDocument('C\nH 1 1\nF 1 1 2 25\nX 3 1.4 2 0 1 0\nBr 3 2.1 2 0 1 0\nCl 3 0.7 2 0 4 75\n');
 const before=atomsFromZmatrixDocument(document);
 const changed=setZmatrixReferences(document,5,[2,1,4]);
 const after=placeInReferenceFrame(atomsFromZmatrixDocument(changed.document),before);
 after.forEach((atom,i)=>atom.position.forEach((value,k)=>expect(value).toBeCloseTo(before[i].position[k],12)));
});
