import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import { runReaderTask } from '../apps/desktop/src/lib/workbench/reader-task';
const lf = readFileSync(new URL('./fixtures/quantum/dispatcher/two-step-orca.out', import.meta.url), 'utf8');
const expected = parseScientificFile('scan.out', lf);
test('ORCA output IR, modes, frame energies and orbitals are identical for LF, CRLF and CR', () => {
  expect(expected.frames.map(frame => frame.energyHartree)).toEqual([-1.1, -1.2]);
  expect(expected.modes.map(mode => [mode.index, mode.frequencyCm1, mode.intensityKmMol])).toEqual([[0, 0, undefined], [1, -12.5, 3.2]]);
  expect(expected.modes[1].displacements).toEqual([[.1, 0, -.1], [-.1, 0, .1]]);
  expect(expected.orbitals.map(orbital => orbital.energyHartree)).toEqual([-.5, .2]);
  for (const ending of ['\n', '\r\n', '\r']) {
    const source = lf.replace(/\n/g, ending);
    expect(parseScientificFile('scan.out', source)).toEqual(expected);
    expect(() => parseScientificFile('bad.out', source.replace('1: -12.5 3.2', '1: -12.5 -3.2'))).toThrow('Negative ORCA IR strength');
  }
});
test('real reader worker parses BOM and CRLF while the uploaded file retains exact original bytes', async () => {
  const raw = '\ufeff' + lf.replace(/\n/g, '\r\n'), file = new File([raw], 'scan.out');
  const before = new Uint8Array(await file.arrayBuffer());
  const science = await runReaderTask({ action: 'parse', name: file.name, text: await file.text() });
  expect(science).toEqual(expected);
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(before);
  expect([...before.slice(0, 3)]).toEqual([239, 187, 191]);
});
