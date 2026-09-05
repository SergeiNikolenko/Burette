import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runMcpAppOperation as run } from '../scripts/mcp-app-session.mjs';

test('local MCP App snapshots source, gates readiness, authenticates exchange, and preserves action results', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'burette-mcp-app-test-'));
  let session;
  try {
    const file = join(temporary, 'structure.pdb');
    const source = await readFile(new URL('../samples/structures/proteins/1htb.pdb', import.meta.url));
    await writeFile(file, source);
    session = await run({ operation: 'open', file });
    assert.equal(session.ready, false);
    const locator = { sessionId: session.sessionId };
    await assert.rejects(run({ operation: 'act', ...locator, action: { type: 'reset_camera' } }), /not mounted/u);
    await assert.rejects(run({ operation: 'exchange', ...locator, token: 'wrong', source: true }), /capability/u);
    await writeFile(file, 'changed');
    const chunks = [];
    let offset = 0;
    do {
      const chunk = await run({ operation: 'exchange', ...locator, token: session.token, source: true, offset });
      chunks.push(Buffer.from(chunk.dataBase64, 'base64'));
      offset = chunk.nextOffset;
    } while (offset !== null);
    assert.deepEqual(Buffer.concat(chunks), source);
    await run({ operation: 'exchange', ...locator, token: session.token, state: { ready: true, revision: 1, displayMode: 'inline' } });
    const queued = await Promise.all([1, 2].map(() => run({ operation: 'act', ...locator, action: { type: 'reset_camera' } })));
    for (const item of queued) await run({ operation: 'exchange', ...locator, token: session.token, completed: { actionId: item.actionId, result: { ok: true } } });
    assert.deepEqual(await run({ operation: 'exchange', ...locator, token: session.token }), { actions: [] });
    const first = await run({ operation: 'act', ...locator, action: { type: 'select_residues', selector: { chain: 'A', auth_seq_id: 377 } } });
    const second = await run({ operation: 'act', ...locator, action: { type: 'clear_selection' } });
    assert.equal((await run({ operation: 'exchange', ...locator, token: session.token })).actions[0].actionId, first.actionId);
    await run({ operation: 'exchange', ...locator, token: session.token, completed: { actionId: first.actionId, error: 'SELECTION_EMPTY' } });
    assert.equal((await run({ operation: 'exchange', ...locator, token: session.token })).actions[0].actionId, second.actionId);
    const observed = await run({ operation: 'observe', ...locator });
    assert.equal(observed.ready, true);
    assert.equal(observed.token, undefined);
    assert.equal(observed.sha256, session.sha256);
    await assert.rejects(run({ operation: 'act', ...locator, action: { type: 'load_structure', url: 'https://example.com' } }), /Unsupported/u);
    await assert.rejects(run({ operation: 'exchange', ...locator, token: session.token, state: { data: 'a'.repeat(65536) } }), /64 KiB/u);
    await assert.rejects(run({ operation: 'observe', sessionId: '../escape' }), /Invalid/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (session) await rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true });
  }
});
