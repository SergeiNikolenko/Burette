import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { mcpAppCheckpoint } from '../scripts/mcp-app-checkpoint.mjs';
import { createWorkspaceCheckpoint } from '../plugins/burette-agent/ui/native-workspace-checkpoint.mjs';
import { runMcpAppOperation } from '../scripts/mcp-app-session.mjs';

test('checkpoint transport rejects traversal, code-bearing snapshots, oversized data and wrong capability', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'burette-checkpoint-test-'));
  const key = 'a'.repeat(64);
  const scene = data => gzipSync(JSON.stringify(data)).toString('base64');
  try {
    assert.deepEqual(await mcpAppCheckpoint(directory, { key: 'workspace' }), { value: null });
    for (const input of [{ key: '../x' }, { key: '/tmp/x' }, { key, value: 'not base64' }, { key, value: scene({ data: {}, behaviour: {} }) }, { key, value: scene({ data: {}, onLoadMarkdownCommands: {} }) }, { key, value: scene({ data: 'a'.repeat(16 * 1024 * 1024) }) }, { key: 'workspace', value: JSON.stringify({ token: 'x' }) }]) {
      await assert.rejects(mcpAppCheckpoint(directory, input));
    }
    const value = scene({ data: { tree: [] }, camera: { current: { position: [1, 2, 3] } } });
    await mcpAppCheckpoint(directory, { key, value });
    assert.deepEqual(await mcpAppCheckpoint(directory, { key }), { value });
  } finally { await rm(directory, { recursive: true, force: true }); }
  const session = await runMcpAppOperation({ operation: 'open', workspace: true, file: new URL('../samples/mini.pdb', import.meta.url).pathname });
  try {
    await assert.rejects(runMcpAppOperation({ operation: 'exchange', sessionId: session.sessionId, token: 'wrong', checkpoint: { key: 'workspace' } }), /capability/);
    assert.deepEqual(await runMcpAppOperation({ operation: 'exchange', sessionId: session.sessionId, token: session.token, checkpoint: { key: 'workspace' } }), { value: null });
  } finally { await rm(join(tmpdir(), 'burette-mcp-app', session.sessionId), { recursive: true, force: true }); }
});

test('native remount restores actual Mol* snapshot and isolated tabs, not an empty startup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'burette-checkpoint-test-'));
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const key = `burette.molecule.session.mcp-${sessionId}`;
  const exchange = ({ checkpoint }) => mcpAppCheckpoint(directory, checkpoint);
  const previousDocument = globalThis.document;
  let current = { data: { tree: [{ representation: 'cartoon', palette: ['#34c759', '#af52de'] }] }, camera: { current: { position: [10, 20, 30] } }, structureSelection: { entries: ['ligand:A:377'] } };
  const restored = [];
  const plugin = () => ({ canvas3d: {}, managers: { structure: { hierarchy: { current: { structures: [{}] } } } }, behaviors: { state: { isBusy: { value: false } } }, state: {
    getSnapshot: () => structuredClone(current), setSnapshot: async snapshot => { restored.push(snapshot); current = snapshot; },
  } });
  const frame = { isConnected: true, dataset: { documentId: 'file-1' }, contentWindow: { BuretteViewer: { plugin: plugin() } } };
  globalThis.document = { querySelectorAll: () => [frame] };
  const state = { ready: true, activeDocument: { id: 'file-1', path: '/authorized/protein.pdb', renderer: 'molstar', ready: true } };
  let first, second;
  try {
    first = await createWorkspaceCheckpoint({ exchange, sessionId });
    first.storage.setItem(key, JSON.stringify({ state: { tabs: [{ id: 'tab-protein', location: { kind: 'file', path: '/authorized/protein.pdb' } }], activeTabId: 'tab-protein' } }));
    await first.flush();
    assert.equal((await mcpAppCheckpoint(directory, { key: 'workspace' })).value, null, 'startup before readiness cannot clobber a session');
    assert.equal(first.update(state).ready, false);
    await first.flush();
    assert.equal(first.update(state).ready, true);
    const before = structuredClone(current);
    await first.flush(); first.dispose();
    current = { data: { tree: [] }, camera: { current: { position: [0, 0, 0] } } };
    frame.contentWindow.BuretteViewer.plugin = plugin();
    second = await createWorkspaceCheckpoint({ exchange, sessionId });
    assert.equal(second.restored, true);
    assert.equal(JSON.parse(second.storage.getItem(key)).state.activeTabId, 'tab-protein');
    assert.equal(second.update(state).ready, false);
    await second.flush();
    assert.equal(second.update(state).ready, true);
    assert.deepEqual(current, { ...before, id: 'burette-resume' });
    assert.equal(restored.length, 1);
    const third = await createWorkspaceCheckpoint({ exchange: async () => ({ actions: [] }), sessionId }).then(() => null, error => error);
    assert.match(third.message, /Unexpected workspace restoration response/);
  } finally { first?.dispose(); second?.dispose(); globalThis.document = previousDocument; await rm(directory, { recursive: true, force: true }); }
});

test('a native host omitting null metadata still opens and persists a fresh workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'burette-checkpoint-test-'));
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const key = `burette.molecule.session.mcp-${sessionId}`;
  const exchange = async ({ checkpoint }) => Object.fromEntries(Object.entries(await mcpAppCheckpoint(directory, checkpoint)).filter(([, value]) => value !== null));
  let first, restored;
  try {
    first = await createWorkspaceCheckpoint({ exchange, sessionId });
    assert.equal(first.restored, false);
    first.storage.setItem(key, JSON.stringify({ state: { tabs: [], activeTabId: null } }));
    await first.flush();
    assert.deepEqual(await exchange({ checkpoint: { key: 'workspace' } }), {});
    assert.equal(first.update({ ready: true }).ready, true);
    await first.flush();
    restored = await createWorkspaceCheckpoint({ exchange, sessionId });
    assert.equal(restored.restored, true);
    assert.equal(restored.storage.getItem(key), first.storage.getItem(key));
    for (const response of [null, [], { value: 123 }, { actions: [] }]) {
      await assert.rejects(createWorkspaceCheckpoint({ exchange: async () => response, sessionId }), /Unexpected workspace restoration response/);
    }
  } finally { first?.dispose(); restored?.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('heartbeats do not repeatedly serialize scenes and teardown saves the latest camera', async () => {
  const previousDocument = globalThis.document;
  const saved = new Map();
  let captures = 0;
  let position = [1, 2, 3];
  const plugin = { canvas3d: { camera: { transition: { inTransition: false } } },
    managers: { structure: { hierarchy: { current: { structures: [{}] } } } },
    behaviors: { state: { isBusy: { value: false } } },
    state: { getSnapshot() { captures++; return { data: {}, camera: { current: { position } } }; } },
  };
  const frame = { isConnected: true, dataset: { documentId: 'protein' }, contentWindow: { BuretteViewer: { plugin } } };
  globalThis.document = { querySelectorAll: () => [frame] };
  const checkpoint = await createWorkspaceCheckpoint({ sessionId: 'test', exchange: async ({ checkpoint: item }) => {
    if (item.value !== undefined) saved.set(item.key, item.value);
    return { value: saved.get(item.key) ?? null };
  } });
  try {
    const state = { ready: true, activeDocument: { id: 'protein', path: '/protein.pdb', renderer: 'molstar', ready: true } };
    checkpoint.update(state);
    await checkpoint.flush();
    const before = captures;
    for (let i = 0; i < 100; i++) checkpoint.update(state);
    assert.equal(captures, before, 'poll bursts must not capture scenes');
    position = [4, 5, 6];
    await checkpoint.flush();
    assert.equal(captures, before + 1, 'teardown bypasses the interval');
    const value = [...saved.entries()].find(([key]) => key !== 'workspace')[1];
    const { gunzipSync } = await import('node:zlib');
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(value, 'base64'))).camera.current.position, position);
  } finally { checkpoint.dispose(); globalThis.document = previousDocument; }
});
