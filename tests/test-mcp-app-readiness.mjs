import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runMcpAppOperation as run } from '../scripts/mcp-app-session.mjs';

test('empty/loading workspaces accept shell recovery but never molecular commands or stale control', async t => {
  const session = await run({ operation: 'open', file: new URL('../samples/mini.pdb', import.meta.url).pathname, workspace: true });
  const dir = join(tmpdir(), 'burette-mcp-app', session.sessionId);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const observe = () => run({ operation: 'observe', sessionId: session.sessionId });
  const act = action => run({ operation: 'act', sessionId: session.sessionId, action });
  assert.deepEqual((await observe()).lifecycle, { status: 'awaiting_mount', heartbeatAgeMs: null });
  await assert.rejects(act({ type: 'open_ketcher' }), /awaiting_mount/);
  for (const state of [{ ready: false, tabs: [], closedTabs: [{ id: 'closed' }] },
    { ready: false, tabs: [{ id: 'loading' }], activeDocument: { ready: false } }]) {
    await run({ operation: 'exchange', sessionId: session.sessionId, token: session.token, state });
    assert.equal((await observe()).lifecycle.status, state.tabs.length ? 'loading' : 'empty');
    for (const action of [{ type: 'open_ketcher' }, { type: 'set_display_mode', mode: 'fullscreen' },
      { type: 'activate_tab', tabId: state.tabs.length ? 'loading' : 'closed' }]) {
      assert.equal((await act(action)).status, 'queued');
    }
    await assert.rejects(act({ type: 'capture_scene' }), /not mounted and ready/);
  }
  const path = join(dir, 'observe.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...state, ready: true, activeDocument: { ready: true }, updatedAt: new Date(Date.now() - 16000).toISOString() }));
  const stale = await observe();
  assert.equal(stale.ready, false);
  assert.equal(stale.lifecycle.status, 'stale');
  await assert.rejects(act({ type: 'open_ketcher' }), /stale/);
  await assert.rejects(act({ type: 'capture_scene' }), /stale/);
});
