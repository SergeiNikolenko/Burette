import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runMcpAppOperation as run } from '../scripts/mcp-app-session.mjs';
import { createViewerDocuments } from '../plugins/burette-agent/ui/local-viewer-documents.mjs';
import { registerLocalViewer } from '../plugins/burette-agent/mcp/registrations/local-viewer/register.mjs';
import { pendingMcpActions } from '../scripts/mcp-app-action-log.mjs';

test('layer MCP schema and native queue preserve the bounded revisioned patch', async t => {
  let schema;
  await registerLocalViewer({ registerResource() {}, registerTool(name, metadata) { if (name === 'burette.control_inline_viewer') schema = metadata.inputSchema.action; } });
  const session = await run({ operation: 'open', file: new URL('../samples/mini.pdb', import.meta.url).pathname, workspace: true });
  const dir = join(tmpdir(), 'burette-mcp-app', session.sessionId);
  t.after(() => rm(dir, { recursive: true, force: true }));
  await run({ operation: 'exchange', sessionId: session.sessionId, token: session.token, state: { ready: true } });
  const action = { type: 'patch_scene_layers', selectionVersion: 1, sceneId: crypto.randomUUID(), expectedRevision: 1,
    operations: [{ type: 'create', layerId: 'ligand', structureId: 'object', expression: { kind: 'ligand' },
      appearance: { type: 'ball-and-stick', color: { name: 'uniform', value: '#ff8800' } } }] };
  assert.deepEqual(schema.parse(action), action);
  assert.equal(schema.safeParse({ ...action, operations: Array(9).fill(action.operations[0]) }).success, false);
  assert.equal(schema.safeParse({ ...action, operations: [{ ...action.operations[0], execute: 'arbitrary' }] }).success, false);
  for (const item of [action, { type: 'list_scene_layers', selectionVersion: 1 }]) {
    assert.equal((await run({ operation: 'act', sessionId: session.sessionId, action: item })).status, 'queued');
  }
  assert.deepEqual((await pendingMcpActions(dir)).map(item => item.action), [action, { type: 'list_scene_layers', selectionVersion: 1 }]);
});

test('close-first rejects file admission; enqueue-first preserves the queued record', async t => {
  const file = new URL('../samples/mini.pdb', import.meta.url).pathname;
  const added = new URL('../samples/mini.sdf', import.meta.url).pathname;
  for (const closeFirst of [true, false]) {
    const session = await run({ operation: 'open', file, workspace: true });
    const dir = join(tmpdir(), 'burette-mcp-app', session.sessionId);
    t.after(() => rm(dir, { recursive: true, force: true }));
    const exchange = input => run({ operation: 'exchange', sessionId: session.sessionId, token: session.token, ...input });
    await exchange({ state: { ready: true, tabs: [], capabilities: { addFiles: true } } });
    const act = () => run({ operation: 'act', sessionId: session.sessionId, action: { type: 'open_files', paths: [added] } });
    if (closeFirst) {
      await exchange({ close: true });
      await assert.rejects(act(), /Viewer is closed/);
      assert.equal(JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')).documents.length, 1);
      assert.deepEqual(await pendingMcpActions(dir), []);
    } else {
      const action = await act();
      await exchange({ close: true });
      assert.equal((await pendingMcpActions(dir))[0].actionId, action.actionId);
      assert.equal(JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')).documents.length, 2);
    }
    assert.equal((await run({ operation: 'observe', sessionId: session.sessionId })).closed, true);
  }
});

test('Ketcher accepts actual molecular content without a project and defaults inline', async t => {
  const handlers = new Map();
  await registerLocalViewer({ registerResource() {}, registerTool(name, metadata, handler) { handlers.set(name, handler); } });
  const open = handlers.get('burette.open_viewer');
  const structure = { format: 'smi', content: 'CC(=O)Oc1ccccc1C(=O)O' };
  const openRequestId = crypto.randomUUID();
  const result = await open({ view: 'ketcher', structure, openRequestId });
  assert.equal(result.isError, undefined);
  const session = result.structuredContent;
  const dir = join(tmpdir(), 'burette-mcp-app', session.sessionId);
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual({ mode: session.requestedDisplayMode, view: session.view, ready: session.ready },
    { mode: 'inline', view: 'ketcher', ready: false });
  assert.equal(await readFile(join(dir, 'source'), 'utf8'), structure.content);
  assert.equal((await open({ view: 'ketcher', structure, openRequestId })).structuredContent.sessionId, session.sessionId);
  assert.equal((await open({ view: 'ketcher', structure: { ...structure, content: 'O' }, openRequestId })).isError, true);
  for (const args of [
    {}, { file: '/missing', structure, view: 'ketcher' },
    { structure, view: 'auto' }, { structure: { format: '../bad', content: 'O' }, view: 'ketcher' },
    { structure: { format: 'smi', content: 'O'.repeat(65537) }, view: 'ketcher' },
    { structure: { format: 'smi', content: ' ' }, view: 'ketcher' },
  ]) assert.equal((await open(args)).isError, true);
  const expanded = (await open({ view: 'ketcher', structure, displayMode: 'fullscreen' })).structuredContent;
  t.after(() => rm(join(tmpdir(), 'burette-mcp-app', expanded.sessionId), { recursive: true, force: true }));
  assert.equal(expanded.requestedDisplayMode, 'fullscreen');
});

test('bundled molecular examples resolve without a caller project path', async t => {
  const handlers = new Map();
  await registerLocalViewer({ registerResource() {}, registerTool(name, metadata, handler) { handlers.set(name, handler); } });
  for (const [example, format] of [['1htb', 'pdb'], ['caffeine', 'xyz']]) {
    const result = await handlers.get('burette.open_viewer')({ example });
    assert.equal(result.isError, undefined);
    const session = result.structuredContent;
    t.after(() => rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true }));
    assert.equal(session.format, format);
    assert.equal(session.view, example === 'caffeine' ? 'xyzrender' : 'auto');
    assert.ok(session.byteCount > 100);
    assert.match(session.documents[0].path, /assets\/examples\//);
  }
});

test('registered workspace opener requests side-pane placement by default', async () => {
  const handlers = new Map();
  await registerLocalViewer({ registerResource() {}, registerTool(name, metadata, handler) { handlers.set(name, handler); } });
  const result = await handlers.get('burette.open_viewer')({ file: new URL('../samples/mini.pdb', import.meta.url).pathname });
  const session = result.structuredContent;
  try {
    assert.equal(result.isError, undefined);
    assert.equal(session.requestedDisplayMode, 'fullscreen');
    assert.equal(session.workspace, true);
  } finally {
    if (session?.sessionId) await rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true });
  }
});

test('MCP sources preserve MVSX archive bytes and mark only the archive as binary', async () => {
  const file = new URL('../samples/mvs/docking_story.mvsx', import.meta.url).pathname;
  const pdb = new URL('../samples/mini.pdb', import.meta.url).pathname;
  const session = await run({ operation: 'open', file, additionalFiles: [pdb], workspace: true });
  const documents = createViewerDocuments({ documents: session.documents, changed() {},
    exchange: input => run({ operation: 'exchange', sessionId: session.sessionId, token: session.token, ...input }),
  });
  try {
    for (const item of session.documents) {
      const loaded = await documents.source(item.id);
      assert.deepEqual({ format: loaded.config.format, binary: loaded.config.binary, bytes: Buffer.from(loaded.bytes) }, {
        format: item.format, binary: item.format === 'mvsx', bytes: await readFile(item.path),
      });
    }
  } finally {
    documents.dispose();
    await rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true });
  }
});

test('replayed cards whose temporary sessions expired return only terminal state', async () => {
  const session = await run({ operation: 'open', file: new URL('../samples/mini.pdb', import.meta.url).pathname });
  await rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true });
  assert.deepEqual(await run({ operation: 'exchange', sessionId: session.sessionId, token: session.token, source: true }), { closed: true, expired: true, actions: [] });
  assert.deepEqual(await run({ operation: 'observe', sessionId: session.sessionId }), {
    apiVersion: 'burette-mcp-app/v1', sessionId: session.sessionId, ready: false, closed: true, expired: true, tabs: [], activeDocument: null, selection: null,
  });
  await assert.rejects(run({ operation: 'act', sessionId: session.sessionId, action: { type: 'reset_camera' } }), /session has expired/u);
  await assert.rejects(run({ operation: 'exchange', sessionId: '../outside', token: session.token }), /Invalid/u);
});

test('local MCP App snapshots source, gates readiness, authenticates exchange, and preserves action results', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'burette-mcp-app-test-'));
  let session;
  try {
    const file = join(temporary, 'structure.pdb');
    const source = await readFile(new URL('../samples/structures/proteins/1htb.pdb', import.meta.url));
    await writeFile(file, source);
    session = await run({ operation: 'open', file, displayMode: 'fullscreen' });
    assert.equal(session.ready, false);
    assert.equal(session.requestedDisplayMode, 'fullscreen');
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
    for (const action of [
      { type: 'set_molstar_style', style: 'cartoon' }, { type: 'color_by_chain', color: 'chain-id' },
      { type: 'set_scene_motion', mode: 'spin' }, { type: 'set_scene_wiggle', mode: 'even' },
      { type: 'rotate_camera', axis: [0, 1, 0], angleDegrees: 30 }, { type: 'observe_scene' },
    ]) assert.equal((await run({ operation: 'act', ...locator, action })).status, 'queued');
    const waited = run({ operation: 'act', ...locator, action: { type: 'reset_camera' }, waitMs: 1000 });
    // A mounted UI acknowledges the specific queued action, including failure.
    let waitedId;
    for (let attempt = 0; attempt < 50 && !waitedId; attempt += 1) {
      const actionDir = join(tmpdir(), 'burette-mcp-app', session.sessionId, 'actions');
      for (const name of await readdir(actionDir)) {
        if (!/^[0-9a-f-]{36}\.json$/u.test(name)) continue;
        const record = JSON.parse(await readFile(join(actionDir, name), 'utf8'));
        if (record.action.type === 'reset_camera' && record.status === 'queued') waitedId = record.actionId;
      }
      if (!waitedId) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waitedId);
    await run({ operation: 'exchange', ...locator, token: session.token, completed: { actionId: waitedId, error: 'Renderer failed', result: { ok: false } } });
    const acknowledged = await waited;
    assert.equal(acknowledged.status, 'failed');
    assert.equal(acknowledged.error, 'Renderer failed');
    await assert.rejects(run({ operation: 'act', ...locator, action: { type: 'load_structure', url: 'https://example.com' } }), /Unsupported/u);
    await assert.rejects(run({ operation: 'exchange', ...locator, token: session.token, state: { data: 'a'.repeat(65536) } }), /64 KiB/u);
    await assert.rejects(run({ operation: 'observe', sessionId: '../escape' }), /Invalid/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (session) await rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true });
  }
});

test('native workspace authorizes each source and binds queued actions to the observed document', async () => {
  let session;
  try {
    const file = new URL('../samples/structures/proteins/1htb.pdb', import.meta.url).pathname;
    const secondFile = new URL('../samples/mini.pdb', import.meta.url).pathname;
    await assert.rejects(run({ operation: 'open', file, additionalFiles: Array(8).fill(file) }), /at most 8/u);
    session = await run({ operation: 'open', file, additionalFiles: [file, secondFile] });
    assert.equal(session.documents.length, 2);
    const [first, second] = session.documents;
    const locator = { sessionId: session.sessionId };
    const exchange = input => run({ operation: 'exchange', ...locator, token: session.token, ...input });
    await assert.rejects(exchange({ source: true, documentId: '../escape' }), /not authorized/u);
    await assert.rejects(exchange({ fileAction: { type: 'list_apps', documentId: 'unknown' } }), /not authorized/u);
    const fileApps = await exchange({ fileAction: { type: 'list_apps', documentId: second.id, path: '/outside-the-workspace' } });
    assert.ok(Array.isArray(fileApps.targets), 'The private App uses only the authorized document path, not a supplied override');
    const source = await exchange({ source: true, documentId: second.id });
    assert.deepEqual(Buffer.from(source.dataBase64, 'base64'), await readFile(secondFile));
    assert.equal(source.config.documentId, second.id);
    await exchange({ state: { ready: true, activeDocument: first, tabs: session.documents } });
    const queued = await run({ operation: 'act', ...locator, action: { type: 'reset_camera' } });
    assert.equal((await exchange({})).actions[0].documentId, first.id);
    await exchange({ completed: { actionId: queued.actionId, result: { ok: true } } });
    await assert.rejects(run({ operation: 'act', ...locator, action: { type: 'move_tab', tabId: first.id, toIndex: 3 } }), /Invalid tab move/u);
    await assert.rejects(run({ operation: 'act', ...locator, action: { type: 'activate_tab', tabId: 'unknown' } }), /Unknown document/u);
    await exchange({ state: { ready: false, activeDocument: null, tabs: [], closedTabs: session.documents } });
    await assert.rejects(run({ operation: 'act', ...locator, action: { type: 'reset_camera' } }), /not mounted/u);
    assert.equal((await run({ operation: 'act', ...locator, action: { type: 'activate_tab', tabId: second.id } })).status, 'queued');
    await assert.rejects(run({ operation: 'exchange', ...locator, token: 'wrong', close: true }), /capability/u);
    assert.deepEqual(await exchange({ close: true }), { closed: true, actions: [] });
    // A stale heartbeat or replayed tool result cannot resurrect a closed App.
    assert.deepEqual(await exchange({ state: { ready: true, tabs: session.documents } }), { closed: true, actions: [] });
    assert.deepEqual(await exchange({ source: true }), { closed: true, actions: [] });
    const closed = await run({ operation: 'observe', ...locator });
    assert.equal(closed.closed, true);
    assert.equal(closed.ready, false);
    assert.deepEqual(closed.tabs, []);
    assert.equal(closed.selection, null);
    await assert.rejects(run({ operation: 'act', ...locator, action: { type: 'activate_tab', tabId: second.id } }), /Viewer is closed/u);
  } finally {
    if (session) await rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true });
  }
});

test('shared native workspace supports explicit chemistry views and rejects unauthorized app access', async () => {
  let session;
  try {
    const file = new URL('../samples/mini.sdf', import.meta.url).pathname;
    const pdb = new URL('../samples/mini.pdb', import.meta.url).pathname;
    await assert.rejects(run({ operation: 'open', file: pdb, workspace: true, view: 'ketcher' }), /Ketcher requires/u);
    session = await run({ operation: 'open', file, workspace: true, view: 'ketcher' });
    assert.equal(session.view, 'ketcher');
    const locator = { sessionId: session.sessionId };
    const exchange = input => run({ operation: 'exchange', ...locator, token: session.token, ...input });
    await exchange({ state: { ready: true, activeDocument: null, tabs: [{ id: 'tab-editor', kind: 'ketcher' }] } });
    await assert.rejects(run({ operation: 'act', ...locator, action: { type: 'open_docking_view', receptorPath: pdb, ligandPaths: [file] } }), /not authorized/u);
    const queued = await run({ operation: 'act', ...locator, action: { type: 'control_ketcher', input: { content: 'a'.repeat(9000) } } });
    await exchange({ completed: { actionId: queued.actionId, result: { ok: true } } });
    const closing = run({ operation: 'act', ...locator, action: { type: 'close_all_tabs' }, waitMs: 1000 });
    await new Promise(resolve => setTimeout(resolve, 25));
    await exchange({ close: true });
    assert.deepEqual((await closing).result, { closed: true });
  } finally {
    if (session) await rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true });
  }
});
