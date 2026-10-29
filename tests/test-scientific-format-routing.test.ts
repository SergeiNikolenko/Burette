import { expect, test } from 'bun:test';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';

const atoms = [{ element: 'He', x: 0, y: 0, z: 0 }];
for (const comment of ['Gaussian 16: exported geometry', '[Molden Format] converted geometry', 'CARTESIAN COORDINATES (ANGSTROEM)']) {
  test(`independent: XYZ free comment retains source format and geometry: ${comment}`, () => {
    const doc = parseScientificFile('geometry.xyz', `1\n${comment}\nHe 0 0 0\n`);
    expect([doc.format, doc.atoms, doc.frames[0].comment]).toEqual(['xyz', atoms, comment]);
  });
}
test('independent: Cube free comment cannot become a Gaussian log', () => {
  const cube = 'Gaussian 16: generated density\nsecond comment\n1 0 0 0\n-1 1 0 0\n-1 0 1 0\n-1 0 0 1\n2 0 0 0 0\n0.5\n';
  const doc = parseScientificFile('density.cube', cube);
  expect([doc.format, doc.atoms, Array.from(doc.grid!.values)]).toEqual(['cube', atoms, [.5]]);
});
test('independent: UTF-8 intake accepts exact budget and rejects one additional byte', () => {
  const cap = 16 * 1024 * 1024;
  const prefix = '1\n', suffix = '\nHe 0 0 0\n';
  const commentBytes = cap - prefix.length - suffix.length;
  const comment = '漢'.repeat(Math.floor(commentBytes / 3)) + 'x'.repeat(commentBytes % 3);
  const text = prefix + comment + suffix;
  expect(new TextEncoder().encode(text).byteLength).toBe(cap);
  const doc = parseScientificFile('boundary.xyz', text);
  expect([doc.format, doc.atoms, doc.frames[0].comment === comment]).toEqual(['xyz', atoms, true]);
  expect(() => parseScientificFile('boundary.xyz', prefix + comment + 'x' + suffix)).toThrow('16 MiB');
});

const fixture = (name: string) => Bun.file(new URL(`./fixtures/quantum/${name}`, import.meta.url)).text();
test('content fallback still accepts scientific data under generic or unknown names', async () => {
  const cases = [
    ['result.out', await fixture('gaussian-water-optimization.log'), 'gaussian-log'],
    ['result.txt', await fixture('qcschema-water-gradient.json'), 'qcschema'],
    ['result.dat', await fixture('dispatcher/hydrogen.molden'), 'molden'],
    ['result.bin', await fixture('dispatcher/normal-modes.hess'), 'orca-hessian'],
    ['result.log', await fixture('dispatcher/two-step-orca.out'), 'orca'],
  ] as const;
  for (const [name, text, format] of cases) expect(parseScientificFile(name, text).format).toBe(format);
});
test('declared format aliases keep their parsers and malformed inputs do not fall back', async () => {
  const molden = await fixture('dispatcher/hydrogen.molden');
  for (const name of ['H.MOLF', 'water.molden.input']) expect(parseScientificFile(name, molden).format).toBe('molden');
  for (const name of ['geometry.xyz', 'density.cub', 'matrix.hess', 'water.fchk', 'result.qcschema']) {
    expect(() => { parseScientificFile(name, molden); }).toThrow();
  }
  expect(() => { parseScientificFile('unknown.dat', 'unrecognised scientific input'); }).toThrow('Supported scientific inputs');
});
