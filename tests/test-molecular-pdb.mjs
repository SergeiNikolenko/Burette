import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerMolecularBackground } from '../plugins/burette-agent/mcp/registrations/molecular-background/register.mjs';
import { runMcpAppOperation } from '../scripts/mcp-app-session.mjs';

test('PDB admission deduplicates normalized IDs and publishes concurrent downloads safely', async t => {
  const cache = join(tmpdir(), 'burette-pdb-entries');
  const ids = [];
  async function unusedId() {
    let id;
    do { id = `9${randomUUID().slice(0, 3).toUpperCase()}`; }
    while (ids.includes(id) || await stat(join(cache, `${id}.pdb`)).then(() => true, () => false)
      || await stat(join(cache, `${id}.cif`)).then(() => true, () => false));
    ids.push(id);
    return id;
  }
  t.after(async () => { for (const id of ids) await rm(join(cache, `${id}.pdb`), { force: true }); });
  const original = new URL('../samples/mini.pdb', import.meta.url).pathname;
  const session = await runMcpAppOperation({ operation: 'open', file: original, workspace: true });
  t.after(() => rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true }));
  const tools = new Map();
  registerMolecularBackground({ registerTool(name, definition, handler) { tools.set(name, handler); } });
  const bytes = await readFile(original);
  const requested = [];
  // Control the network response while exercising the real cache writes,
  // atomic publication, session admission and duplicate-path handling.
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(String(url));
    return new Response(bytes, { status: 200 });
  });
  const add = tools.get('burette.add_molecular_files');
  const duplicateId = await unusedId();
  const duplicate = await add({ sessionId: session.sessionId, pdbIds: [duplicateId, duplicateId.toLowerCase(), ` ${duplicateId} `] });
  assert.notEqual(duplicate.isError, true, JSON.stringify(duplicate));
  assert.equal(duplicate.structuredContent.documents.length, 2);
  assert.deepEqual(requested, [`https://files.rcsb.org/download/${duplicateId}.pdb`]);

  const concurrentId = await unusedId();
  const concurrent = await Promise.all([1, 2].map(() => add({ sessionId: session.sessionId, pdbIds: [concurrentId] })));
  assert.ok(concurrent.every(response => response.isError !== true), JSON.stringify(concurrent));
  assert.deepEqual(concurrent.map(response => response.structuredContent.documents.length), [3, 3]);
  assert.equal(requested.filter(url => url.includes(concurrentId)).length, 2);
  assert.deepEqual(await readFile(join(cache, `${concurrentId}.pdb`)), bytes);
});
