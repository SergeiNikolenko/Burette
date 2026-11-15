import { expect, test } from 'bun:test';
import { readUnitCell } from '../apps/desktop/src/lib/molecular-workbench/crystal';
import { readWorkbenchSource } from '../apps/desktop/src/lib/workbench/structure';
import type { ViewerDocument } from '../apps/desktop/src/types';
const xyz = (comment: string) => `1\n${comment}\nHe 0 0 0\n`;
test('cell metadata distinguishes no declaration from empty and invalid declarations', () => {
  expect(readUnitCell(xyz('isolated'))).toBeNull();
  expect(readUnitCell(xyz('Lattice="10 0 0 2 11 0 1 3 12"'))).toEqual([[10, 0, 0], [2, 11, 0], [1, 3, 12]]);
  for (const value of ['', '   ', '1 0 0 0 1 0 0 1']) expect(() => readUnitCell(xyz(`Lattice="${value}"`))).toThrow('nine numbers');
  for (const value of ['10 0 0 0 0 0 0 0 12', '10 0 0 0 NaN 0 0 0 12']) expect(() => readUnitCell(xyz(`Lattice="${value}"`))).toThrow();
});
test('ordinary source consumers still read atoms while malformed optional cell metadata stays unavailable', async () => {
  const document: ViewerDocument = { id: 'cell-review', path: '/he.xyz', title: 'he.xyz', extension: 'xyz', renderer: 'molstar', runtimePath: '', byteCount: 0 };
  for (const comment of ['isolated', 'Lattice=""', 'Lattice="10 0 0 0 0 0 0 0 12"']) {
    const source = await readWorkbenchSource(document, xyz(comment));
    expect({ atoms: source.atoms, cell: source.cell, graphText: source.graphText }).toEqual({ atoms: [{ element: 'He', x: 0, y: 0, z: 0 }], cell: null, graphText: xyz(comment) });
  }
});
