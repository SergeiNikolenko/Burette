import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { editStructureFragmentFile } from '../plugins/burette-agent/mcp/lib/structure-components.mjs';

test('same-title extract/remove/replace results are isolated, including concurrent calls', async () => {
  const file = fileURLToPath(new URL('../samples/structures/proteins/1htb.pdb', import.meta.url));
  const original = await readFile(file);
  const outputs = [];
  try {
    const request = { file, component: 'ligand', compId: 'PYZ', seq: 378, title: 'same-title' };
    const extract = await editStructureFragmentFile({ ...request, operation: 'extract', chain: 'A' });
    outputs.push(extract);
    const firstBytes = await readFile(extract.outputPath);
    const results = await Promise.allSettled(['extract', 'remove_to_new_file', 'replace_to_new_file'].flatMap(operation => ['A', 'B'].map(async chain => {
      const result = await editStructureFragmentFile({ ...request, operation, chain, replacementFile: extract.outputPath });
      outputs.push(result);
      return result;
    })));
    assert.ok(results.every(result => result.status === 'fulfilled'));
    assert.equal(new Set(outputs.map(result => result.outputPath)).size, 7);
    for (const result of outputs) {
      assert.equal(basename(result.outputPath), 'same-title.pdb');
      assert.equal((await stat(result.outputPath)).mode & 0o777, 0o600);
      assert.equal((await stat(dirname(result.outputPath))).mode & 0o777, 0o700);
    }
    assert.deepEqual(await readFile(extract.outputPath), firstBytes);
    const chainB = outputs.find(result => result.operation === 'extract' && result.component.includes('chain-B'));
    const atomLines = (await readFile(chainB.outputPath, 'utf8')).split('\n').filter(line => line.startsWith('HETATM'));
    assert.equal(atomLines.length, 6);
    assert.ok(atomLines.every(line => line.slice(21, 22) === 'B'));
    assert.deepEqual(await readFile(file), original);
  } finally {
    await Promise.all(outputs.map(result => rm(dirname(result.outputPath), { recursive: true, force: true })));
  }
});
