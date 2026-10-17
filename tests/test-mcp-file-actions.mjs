import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mcpFileActionPath } from '../scripts/mcp-app-file-actions.mjs';

test('removed files retain named, format-correct snapshots for Open With', async t => {
  const root = await mkdtemp(join(tmpdir(), 'burette-file-actions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = { id: 'first', path: join(root, 'old-plugin.pdb'), label: 'example.pdb' };
  const second = { id: 'second', path: join(root, 'old-plugin.cif.gz'), label: 'example.cif.gz' };
  const session = { documents: [first, second] };
  await writeFile(first.path, 'original');
  assert.equal(await mcpFileActionPath(root, session, first), await realpath(first.path));
  await rm(first.path);
  await writeFile(join(root, 'source'), 'PDB snapshot');
  await writeFile(join(root, 'source-second'), 'CIF snapshot');
  const pdb = await mcpFileActionPath(root, session, first);
  const cif = await mcpFileActionPath(root, session, second);
  assert.ok(pdb.endsWith('/example.pdb'));
  assert.ok(cif.endsWith('/example.cif'));
  assert.equal(await readFile(pdb, 'utf8'), 'PDB snapshot');
  assert.equal(await readFile(cif, 'utf8'), 'CIF snapshot');
  await writeFile(pdb, 'external edits');
  assert.equal(await mcpFileActionPath(root, session, first), pdb);
  assert.equal(await readFile(pdb, 'utf8'), 'external edits');
});
