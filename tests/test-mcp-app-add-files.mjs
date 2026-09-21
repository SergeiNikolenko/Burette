import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runMcpAppOperation as run } from '../scripts/mcp-app-session.mjs';
import { createWorkspaceTransport } from '../plugins/burette-agent/ui/native-workspace-transport.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'burette-add-files-test-')));
  let session;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (session) await rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true });
  });
  const content = await readFile(new URL('../samples/mini.pdb', import.meta.url));
  const paths = await Promise.all(Array.from({ length: 9 }, async (_, i) => {
    const path = join(root, `${i}.pdb`);
    await writeFile(path, content);
    return path;
  }));
  session = await run({ operation: 'open', file: paths[0], workspace: true });
  const locator = { sessionId: session.sessionId };
  const exchange = input => run({ operation: 'exchange', ...locator, token: session.token, ...input });
  const act = paths => run({ operation: 'act', ...locator, action: { type: 'open_files', paths } });
  const catalog = async () => (await exchange({})).documents;
  await exchange({ state: { ready: true, capabilities: { addFiles: true }, tabs: [{ id: 'tab-1', kind: 'file' }], activeDocument: { ...session.documents[0], ready: true } } });
  return { root, session, locator, paths, exchange, act, catalog, content };
}

test('new files use the same native transport and session, with existing snapshots intact', async t => {
  const f = await fixture(t);
  const oldWindow = globalThis.window;
  const oldLocation = globalThis.location;
  globalThis.window = { fetch };
  globalThis.location = { origin: 'https://fixture.invalid' };
  t.after(() => { globalThis.window = oldWindow; globalThis.location = oldLocation; });
  const descriptor = { ...f.session, documents: [...f.session.documents] };
  const bridge = createWorkspaceTransport({ descriptor, assets: {}, exchange: f.exchange, isClosed: () => false, observe() {} });
  await bridge.fetch('/__burette/agent-session/observe.json', { method: 'PUT', body: JSON.stringify({ tabs: [{ id: 'tab-1', kind: 'file' }], activeDocument: { path: f.paths[0], ready: true }, viewerAgent: { documentId: f.session.documents[0].id } }) });
  const second = await f.act([f.paths[1]]);
  assert.equal(second.sessionId, f.session.sessionId);
  const reply = await (await bridge.fetch('/__burette/agent-session/actions.json')).json();
  assert.deepEqual(reply.actions.map(item => item.action), [{ type: 'open_files', paths: [f.paths[1]] }]);
  assert.equal(descriptor.documents.length, 2);
  const file = await bridge.fetch(`/__burette/read-file?path=${encodeURIComponent(f.paths[1])}`);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), f.content);
  assert.equal((await bridge.fetch('/__burette/read-file?path=/etc/passwd')).status, 400);
  await bridge.fetch('/__burette/agent-session/actions.json', { method: 'PUT', body: JSON.stringify({ actions: reply.actions.map(item => ({ ...item, status: 'completed', result: { ok: true } })) }) });
  await writeFile(f.paths[0], 'changed after authorization');
  await f.act([f.paths[0], f.paths[1]]);
  assert.equal((await f.catalog()).length, 2);
  assert.equal((await f.catalog())[0].id, f.session.documents[0].id);
  assert.deepEqual(Buffer.from((await f.exchange({ source: true, documentId: f.session.documents[0].id })).dataBase64, 'base64'), f.content);
  assert.deepEqual((await f.exchange({})).documents, descriptor.documents, 'Remount receives the extended catalog');
});

test('concurrent additions deduplicate real paths and preserve both updates', async t => {
  const f = await fixture(t);
  const alias = join(f.root, 'alias.pdb');
  await symlink(f.paths[1], alias);
  await Promise.all([f.act([f.paths[1]]), f.act([f.paths[2]]), f.act([alias])]);
  assert.deepEqual((await f.catalog()).map(item => item.path).sort(), f.paths.slice(0, 3).sort());
});

test('invalid batches and over-limit additions do not change the session catalog', async t => {
  const f = await fixture(t);
  const before = await f.catalog();
  await assert.rejects(f.act([f.paths[1], join(f.root, 'missing.pdb')]), /ENOENT/u);
  assert.deepEqual(await f.catalog(), before);
  await assert.rejects(f.act([]), /between 1 and 8/u);
  await f.act(f.paths.slice(1, 8));
  const full = await f.catalog();
  await assert.rejects(f.act([f.paths[8]]), /at most 8/u);
  assert.deepEqual(await f.catalog(), full);
  const names = await readdir(join(tmpdir(), 'burette-mcp-app', f.session.sessionId));
  assert.equal(names.includes('documents.lock'), false);
});

test('empty mounted workspaces accept another file; unmounted and closed ones do not', async t => {
  const f = await fixture(t);
  await f.exchange({ state: { ready: false, capabilities: { addFiles: true }, tabs: [], activeDocument: null } });
  assert.equal((await f.act([f.paths[1]])).status, 'queued');
  await f.exchange({ state: { ready: false } });
  await assert.rejects(f.act([f.paths[2]]), /not mounted/u);
  assert.equal((await f.catalog()).length, 2);
  await f.exchange({ close: true });
  await assert.rejects(f.act([f.paths[2]]), /Viewer is closed/u);
});

test('an older mounted pane must be reloaded before changing its catalog', async t => {
  const f = await fixture(t);
  await f.exchange({ state: { ready: true, tabs: [] } });
  await assert.rejects(f.act([f.paths[1]]), /Reload the existing Burette pane/u);
  assert.equal((await f.catalog()).length, 1);
});
