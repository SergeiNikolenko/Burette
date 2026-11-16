import { expect, test } from 'bun:test';
import { editZmatrixRows } from '../scripts/zmatrix-rows.mjs';
import { atomsFromZmatrixDocument, formatZmatrixDocument, parseZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { placeInReferenceFrame } from '../scripts/internal-coordinates.mjs';

const source = 'O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\nR=.9572\nA=52.26\nU=1.5\n';
const before = () => parseZmatrixDocument(source);
const transformed = () => atomsFromZmatrixDocument(before()).map(atom => ({
  element: atom.element, position: [11 - atom.position[2], -7 + atom.position[0], 4 - atom.position[1]],
}));
function verify(result: ReturnType<typeof editZmatrixRows>) {
  const reopened = atomsFromZmatrixDocument(parseZmatrixDocument(formatZmatrixDocument(result.document)));
  const aligned = placeInReferenceFrame(reopened, result.atoms);
  aligned.forEach((atom, i) => atom.position.forEach((v, k) => expect(v).toBeCloseTo(result.atoms[i].position[k], 10)));
}

test('append a real atom or X in the original physical frame without moving survivors or aliasing inputs', () => {
  for (const element of ['F', 'X']) {
    const document = before(), reference = transformed();
    const result = editZmatrixRows(document, { type: 'append', row: { element, refs: [0, 1, 2], values: [1.4, 100, -75] } }, reference);
    expect(result.atomMap).toEqual(element === 'F' ? [0, 1, 2, null] : [0, 1, 2]);
    expect(result.atoms.slice(0, 3)).toEqual(reference);
    expect(result.document.rows.slice(0, 4)).toEqual(document.rows);
    expect(result.document.variables).toEqual(document.variables);
    expect(result.detachedBindings).toEqual([]);
    verify(result);
    result.atoms[0].position[0] = 999;
    result.document.rows[0].element = 'C';
    result.document.variables[0].value = 99;
    expect(document).toEqual(before());
    expect(reference).toEqual(transformed());
  }
});

test('remove reference point, remap identities and retain real atom coordinates exactly', () => {
  const result = editZmatrixRows(before(), { type: 'remove', index: 1 }, transformed());
  expect(result.atomMap).toEqual([0, 1, 2]);
  expect(result.atoms).toEqual(transformed());
  expect(result.document.rows.map(row => row.element)).toEqual(['O', 'H', 'H']);
  expect(result.document.rows[1].values).toEqual(['R']);
  expect(result.document.variables.map(variable => variable.name)).toEqual(['R', 'A', 'U']);
  expect(result.detachedBindings).toEqual([{ row: 1, slot: 1, binding: 'A' }, { row: 2, slot: 1, binding: 'A' }]);
  verify(result);
});

test('remove chemical atom and move reference/chemical rows with mapped source identities', () => {
  for (const action of [{ type: 'remove', index: 2 }, { type: 'move', index: 1, to: 3 }, { type: 'move', index: 3, to: 0 }] as const) {
    const document = before(), reference = transformed();
    const result = editZmatrixRows(document, action, reference);
    expect(result.atoms).toEqual(result.atomMap.map(index => reference[index!]));
    expect(document).toEqual(before());
    verify(result);
  }
});

test('preserve signed bindings when row references still mean the same geometry', () => {
  const document = parseZmatrixDocument('C\nH 1 R\nF 1 1.2 2 90\nCl 1 R 2 90 3 -D\nBr 1 R 2 90 3 +D\nR=1.4\nD=70\n');
  const result = editZmatrixRows(document, { type: 'move', index: 4, to: 3 });
  expect(result.document.rows.slice(3).map(row => row.values[2])).toEqual(['+D', '-D']);
  expect(result.detachedBindings).toEqual([]);
  expect(result.atomMap).toEqual([0, 1, 2, 4, 3]);
  verify(result);
});

test('reject invalid, essential-plane removal and stale current geometry atomically', () => {
  const document = before();
  const actions = [
    { type: 'remove', index: -1 }, { type: 'remove', index: 1.5 }, { type: 'move', index: 1, to: 4 },
    { type: 'append', row: { element: 'Q', refs: [0, 1, 2], values: [1, 90, 90] } },
    { type: 'append', row: { element: 'F', refs: [0, 1, 2], values: [1, 90, 181] } },
    { type: 'append', row: { element: 'F', refs: [0, 0, 2], values: [1, 90, 90] } },
    { type: 'append', row: { element: 'F', refs: [0, 1, 2], values: ['missing', 90, 90] } },
  ];
  for (const action of actions) {
    expect(() => editZmatrixRows(document, action as any)).toThrow();
    expect(document).toEqual(before());
  }
  expect(() => editZmatrixRows(parseZmatrixDocument('H\nX 1 1\n'), { type: 'remove', index: 0 })).toThrow('real atom');
  const essential = parseZmatrixDocument('C\nN 1 1.2\nX 1 1 2 90\nO 2 1.2 1 180 3 0\nF 1 1.4 2 90 3 90\n');
  expect(() => editZmatrixRows(essential, { type: 'remove', index: 2 })).toThrow();
  const stale = transformed(); stale[1].position[0] += .01;
  expect(() => editZmatrixRows(document, { type: 'remove', index: 1 }, stale)).toThrow('no longer matches');
  const wrong = transformed(); wrong[1].element = 'C';
  expect(() => editZmatrixRows(document, { type: 'remove', index: 1 }, wrong)).toThrow('identities');
  const coincident = transformed(); coincident[1].position = [...coincident[0].position];
  expect(() => editZmatrixRows(document, { type: 'remove', index: 1 }, coincident)).toThrow('no longer matches');
});

test('row edits of fully linear structures retain exact position and orientation', () => {
  const document = parseZmatrixDocument('C\nN 1 1.2\nO 2 1.2 1 180\n');
  const reference = [{ element: 'C', position: [5, 6, 7] }, { element: 'N', position: [5.72, 6.96, 7] }, { element: 'O', position: [6.44, 7.92, 7] }];
  for (const action of [{ type: 'remove', index: 0 }, { type: 'move', index: 2, to: 0 }] as const) {
    const result = editZmatrixRows(document, action, reference);
    expect(result.atoms).toEqual(result.atomMap.map(index => reference[index!]));
    verify(result);
  }
});

test('row and world-coordinate bounds also include newly added reference points', () => {
  const document = { variables: [], rows: Array.from({ length: 512 }, (_, i) => ({
    element: 'C', refs: [i - 1, i - 2, i - 3].slice(0, Math.min(i, 3)), values: [1, 180, 0].slice(0, Math.min(i, 3)),
  })) };
  expect(() => editZmatrixRows(document, { type: 'append', row: { element: 'X', refs: [511, 510, 509], values: [1, 180, 0] } })).toThrow('512');
  expect(() => editZmatrixRows(parseZmatrixDocument('He\n'), { type: 'append', row: { element: 'H', refs: [0], values: [1] } },
    [{ element: 'He', position: [0, 0, 1e6] }])).toThrow('outside coordinate bounds');
});
