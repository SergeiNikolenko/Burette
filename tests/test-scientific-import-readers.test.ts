import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { isScientificFile } from '../apps/desktop/src/lib/workbench/scientific-files';
import { openScientificFiles } from '../apps/desktop/src/lib/workbench/open';
import { scientificStateFor, releaseClosedImports } from '../apps/desktop/src/lib/workbench/scientific-source-state';
import { useMoleculeStore } from '../apps/desktop/src/stores/molecule-store';
const gaussian = readFileSync(new URL('./fixtures/quantum/gaussian-water-optimization.log', import.meta.url), 'utf8');
const gradient = readFileSync(new URL('./fixtures/quantum/qcschema-water-gradient.json', import.meta.url), 'utf8');
test('ordinary routing recognises scientific JSON and Gaussian logs while preserving unrelated JSON and logs', async () => {
  for (const [name, text, expected] of [['water.log', gaussian, true], ['water.json', gradient, true], ['water.qcschema', '', true],
    ['settings.json', '{"setting":1}', false], ['nested.json', '{"metadata":{"schema_name":"qcschema_molecule"}}', false], ['build.log', 'completed', false]] as const) {
    expect(await isScientificFile(new File([text], name))).toBe(expected);
  }
  expect(await isScientificFile(new File([gzipSync(gradient)], 'water.json.gz'))).toBe(true);
  expect(await isScientificFile(new File([gzipSync(gaussian)], 'water.log.gz'))).toBe(true);
});

test('ordinary open attaches each new format and retains exact original bytes including BOM and CRLF', async () => {
  const before = useMoleculeStore.getState().documents;
  const opened: Array<{ id: string; text: string }> = [];
  const actions = { openStructureRecords: async (records: Array<{ path: string; text: string }>) => records.map((r, i) => {
    const doc = { id: `reader-import-${opened.length}-${i}`, title: r.path, path: `/${r.path}`, runtimePath: `/${r.path}`, byteCount: new TextEncoder().encode(r.text).length, extension: 'xyz', renderer: 'molstar' as const };
    opened.push({ id: doc.id, text: r.text });
    useMoleculeStore.setState(s => ({ documents: [...s.documents, doc] }));
    return doc;
  }) };
  try {
    const files = [new File(['\ufeff' + gaussian.replaceAll('\n', '\r\n')], 'water.log'), new File(['\ufeff' + gradient], 'water.json')];
    await openScientificFiles(actions, files);
    expect(opened).toHaveLength(2);
    for (let i = 0; i < opened.length; i++) {
      const state = scientificStateFor(opened[i].id, opened[i].text);
      expect(state.revisions![0].document.format).toBe(i === 0 ? 'gaussian-log' : 'qcschema');
      expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(new Uint8Array(await files[i].arrayBuffer()));
    }
  } finally {
    useMoleculeStore.setState({ documents: before });
    releaseClosedImports(new Set(before.map(d => d.id)));
  }
});
