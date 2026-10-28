import { describe, expect, test } from 'bun:test';
import { parseXyz, serializeXyz } from '../apps/desktop/src/lib/molecular-workbench/xyz';

describe('browser workbench XYZ boundary', () => {
  test('supercells can exceed the 512-atom interactive geometry limit', () => {
    const atoms = Array.from({ length: 513 }, (_, x) => ({ element: 'C', x, y: 0, z: 0 }));
    expect(parseXyz(serializeXyz(atoms, 'supercell')).atoms).toEqual(atoms);
  });
  test('Fortran notation and CRLF preserve geometry and title', () => {
    expect(parseXyz('1\r\nTitle\r\nHe 1D-2 -.5 +1.25\r\n')).toEqual({ title: 'Title', atoms: [{element:'He',x:.01,y:-.5,z:1.25}] });
  });
  test('rejects extra frames, unknown elements, nonnumeric fields and invalid bounds', () => {
    for (const text of ['1\nt\nH 0 0 0\n1\nt\nH 0 0 0', '1\nt\nXx 0 0 0', '1\nt\nC 0 0 0x20', '1\nt\nC 0 0 1e7', '100001\nt']) expect(() => parseXyz(text)).toThrow();
  });
  test('serialization cannot inject an XYZ frame through the title', () => {
    const text = serializeXyz([{element:'H',x:0,y:0,z:0}], 'a\n1\rC');
    expect(parseXyz(text).title).toBe('a 1 C');
  });
});
