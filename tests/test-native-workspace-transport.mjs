import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const code = (await readFile(new URL('../plugins/burette-agent/ui/native-workspace-transport.mjs', import.meta.url), 'utf8')).replace('export function', 'function');
function transport(options) {
  const context = vm.createContext({ window: { fetch }, location: { origin: 'https://fixture.invalid' }, crypto, URL, Response, Request, Uint8Array, TextDecoder, TextEncoder, atob, setTimeout });
  vm.runInContext(code, context);
  return context.createWorkspaceTransport({ assets: {}, isClosed: () => false, observe() {}, ...options });
}
const path = '/authorized/molecule.smi';
const bytes = new TextEncoder().encode('CCO');
const document = { id: 'document-1', path, format: 'smi', byteCount: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const descriptor = { view: 'auto', documents: [document] };

test('heartbeat publishes asynchronously restored readiness to both the loading cover and host', async () => {
  let restored = false;
  const observed = [], published = [];
  const bridge = transport({ descriptor,
    decorateState: state => ({ ...state, ready: state.ready && restored }),
    observe: state => observed.push(state),
    exchange: async request => { published.push(request.state); return {}; },
  });
  await bridge.fetch('/__burette/agent-session/observe.json', { method: 'PUT', body: JSON.stringify({ activeDocument: { path, ready: true } }) });
  assert.equal(observed.at(-1).ready, false);
  restored = true;
  await bridge.fetch('/__burette/agent-session/actions.json');
  assert.equal(observed.at(-1).ready, true);
  assert.equal(observed.at(-1), published.at(-1));
});

test('native file icons and XYZRender cross only the private authorized exchange', async () => {
  const requests = [];
  const bridge = transport({ descriptor, exchange: async input => { requests.push(JSON.parse(JSON.stringify(input))); return { svg: '<svg/>', iconUrl: 'data:image/png;base64,fixture' }; } });
  const post = (url, body) => bridge.fetch(url, { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await post('/__burette/file-action', { type: 'app_icon', path, targetId: 'finder' })).status, 200);
  assert.equal((await post('/__burette/xyzrender', { path, preset: 'flat' })).status, 200);
  assert.deepEqual(requests, [
    { fileAction: { type: 'app_icon', documentId: document.id, targetId: 'finder' } },
    { xyzrender: { documentId: document.id, preset: 'flat' } },
  ]);
  assert.equal((await post('/__burette/xyzrender', { path: '/etc/passwd' })).status, 400);
  assert.equal(requests.length, 2);
});

test('native transport reads only snapshotted files and verifies bytes', async () => {
  const requests = [];
  const bridge = transport({ descriptor, exchange: async request => { requests.push(request); return { dataBase64: Buffer.from(bytes).toString('base64'), nextOffset: null }; } });
  assert.equal(await (await bridge.fetch(`/__burette/read-file?path=${encodeURIComponent(path)}`)).text(), 'CCO');
  assert.equal(requests[0].documentId, document.id);
  assert.equal((await bridge.fetch('/__burette/read-file?path=/etc/passwd')).status, 400);
  assert.equal((await bridge.fetch('https://external.invalid/data')).status, 400);
  assert.equal(requests.length, 1);
  const corrupt = transport({ descriptor, exchange: async () => ({ dataBase64: Buffer.from('CCC').toString('base64'), nextOffset: null }) });
  assert.match(await (await corrupt.fetch(`/__burette/read-file?path=${encodeURIComponent(path)}`)).text(), /integrity/u);
});

test('concurrent reads and tab revisits reuse verified snapshots; failures are retryable', async () => {
  let calls = 0, corrupt = true;
  const bridge = transport({ descriptor, exchange: async () => {
    calls += 1;
    return { dataBase64: Buffer.from(corrupt ? 'CCC' : 'CCO').toString('base64'), nextOffset: null };
  } });
  const url = `/__burette/read-file?path=${encodeURIComponent(path)}`;
  assert.equal((await bridge.fetch(url)).status, 400);
  corrupt = false;
  const responses = await Promise.all([bridge.fetch(url), bridge.fetch(url)]);
  assert.deepEqual(await Promise.all(responses.map(response => response.text())), ['CCO', 'CCO']);
  assert.equal(calls, 2, 'one failed transfer plus one shared successful transfer');
  assert.equal(await (await bridge.fetch(url)).text(), 'CCO');
  assert.equal(calls, 2);
  bridge.dispose();
  await bridge.fetch(url);
  assert.equal(calls, 3, 'disposing releases the source cache');
});

test('native commands reject stale documents and preserve tab IDs', async () => {
  const acknowledgements = [];
  let action = { actionId: 'stale', documentId: 'old', action: { type: 'reset_camera' } };
  const bridge = transport({ descriptor, exchange: async request => {
    if (request.completed) acknowledgements.push(request.completed);
    return { actions: [action] };
  } });
  await bridge.fetch('/__burette/agent-session/observe.json', { method: 'PUT', body: JSON.stringify({ activeDocument: { path, ready: true }, viewerAgent: { documentId: 'new' }, activeTabId: 'tab-9' }) });
  assert.deepEqual(await (await bridge.fetch('/__burette/agent-session/actions.json')).json(), { actions: [] });
  assert.equal(acknowledgements[0].result.error.code, 'STALE_TARGET');
  action = { actionId: 'close', action: { type: 'close_tab' } };
  assert.deepEqual(await (await bridge.fetch('/__burette/agent-session/actions.json')).json(), { actions: [{ id: 'close', status: 'queued', action: { type: 'manage_tabs', operation: 'close', tabId: 'tab-9' } }] });
});

test('Ketcher becomes ready only after its seeded structure is acknowledged', async () => {
  const bridge = transport({ descriptor: { ...descriptor, view: 'ketcher' }, exchange: async () => ({ dataBase64: Buffer.from(bytes).toString('base64'), nextOffset: null }) });
  const actionUrl = '/__burette/agent-session/actions.json';
  const first = (await (await bridge.fetch(actionUrl)).json()).actions[0];
  assert.equal(first.action.type, 'open_ketcher');
  await bridge.fetch(actionUrl, { method: 'PUT', body: JSON.stringify({ actions: [{ ...first, status: 'completed', result: { ok: true } }] }) });
  await bridge.fetch('/__burette/agent-session/observe.json', { method: 'PUT', body: JSON.stringify({ activeSurface: { ready: true }, chemicalEditor: { phase: 'ready', surfaceId: 'editor-1', structureRevision: 0 } }) });
  assert.equal(bridge.state().ready, false);
  const seed = (await (await bridge.fetch(actionUrl)).json()).actions[0];
  assert.equal(seed.action.format, 'smiles');
  assert.equal(seed.action.content, 'CCO');
  await bridge.fetch(actionUrl, { method: 'PUT', body: JSON.stringify({ actions: [{ ...seed, status: 'completed', result: { ok: true } }] }) });
  assert.equal(bridge.state().ready, true);
});

test('showing an already open file focuses its tab without reloading its renderer', async () => {
  let requested = [path];
  const bridge = transport({ descriptor: { ...descriptor, documents: [...descriptor.documents] }, exchange: async () => ({ actions: [{ actionId: 'show', action: { type: 'open_files', paths: requested } }] }) });
  await bridge.fetch('/__burette/agent-session/observe.json', { method: 'PUT', body: JSON.stringify({ tabs: [{ id: 'tab-existing', path }], activeTabId: 'another-tab' }) });
  assert.deepEqual((await (await bridge.fetch('/__burette/agent-session/actions.json')).json()).actions, [{ id: 'show', status: 'queued', action: { type: 'manage_tabs', operation: 'focus', tabId: 'tab-existing' } }]);
  requested = [path, '/authorized/new.pdb'];
  assert.deepEqual((await (await bridge.fetch('/__burette/agent-session/actions.json')).json()).actions, [{ id: 'show', status: 'queued', action: { type: 'open_files', paths: ['/authorized/new.pdb'] } }]);
});

const actionsUrl = '/__burette/agent-session/actions.json';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(condition) {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) await pause(20);
  assert.ok(condition());
}

test('tab actions are acknowledged with the settled observation, never re-run meanwhile', async () => {
  const exchanges = [];
  const second = '/authorized/second.pdb';
  const tabs = [{ id: 'tab-a', path }, { id: 'tab-b', path: second }];
  const listed = [{ actionId: 'focus', documentId: 'doc-a', action: { type: 'activate_tab', tabId: 'tab-b' } }];
  const bridge = transport({ descriptor, exchange: async request => { exchanges.push(request); return request.completed ? {} : { actions: listed }; } });
  const put = state => bridge.fetch('/__burette/agent-session/observe.json', { method: 'PUT', body: JSON.stringify(state) });
  await put({ activeDocument: { path, ready: true }, viewerAgent: { documentId: 'doc-a' }, activeTabId: 'tab-a', tabs });
  const [handed] = (await (await bridge.fetch(actionsUrl)).json()).actions;
  assert.deepEqual(handed.action, { type: 'manage_tabs', operation: 'focus', tabId: 'tab-b' });
  await bridge.fetch(actionsUrl, { method: 'PUT', body: JSON.stringify({ actions: [{ ...handed, status: 'completed', result: { ok: true } }] }) });
  assert.deepEqual((await (await bridge.fetch(actionsUrl)).json()).actions, [], 'a listed but unacknowledged action is not handed out twice');
  await pause(120);
  assert.equal(exchanges.some(request => request.completed), false, 'the previous tab is still observed');
  await put({ activeDocument: { path: second, ready: true }, viewerAgent: { documentId: 'doc-b' }, activeTabId: 'tab-b', tabs });
  await eventually(() => exchanges.some(request => request.completed));
  const acknowledgement = exchanges.find(request => request.completed);
  assert.deepEqual([acknowledgement.completed.actionId, acknowledgement.state.activeTabId, acknowledgement.state.activeDocument.id], ['focus', 'tab-b', 'doc-b']);
});

test('agent-owned actions run once locally and carry the view choice for added files', async () => {
  const exchanges = [], executions = [], opened = [];
  const listed = [
    { actionId: 'view', documentId: 'doc-a', action: { type: 'set_xyzrender_view', preset: 'tube' } },
    { actionId: 'add', action: { type: 'open_files', paths: ['/authorized/new.xyz'], view: 'xyzrender' } },
  ];
  const agent = { intercept: action => action.type === 'set_xyzrender_view' ? async () => { executions.push(action); await pause(30); return { status: 'completed', result: { ok: true, command: action.type } }; } : null };
  const bridge = transport({ descriptor, agent, prepareOpen: (paths, view) => opened.push([paths, view]),
    exchange: async request => { exchanges.push(request); return request.completed ? {} : { actions: listed }; } });
  await bridge.fetch('/__burette/agent-session/observe.json', { method: 'PUT', body: JSON.stringify({ activeDocument: { path, ready: true }, viewerAgent: { documentId: 'doc-a' }, tabs: [] }) });
  const first = (await (await bridge.fetch(actionsUrl)).json()).actions;
  const again = (await (await bridge.fetch(actionsUrl)).json()).actions;
  assert.deepEqual([first.map(item => item.id), again.map(item => item.id)], [['add'], ['add']]);
  await eventually(() => exchanges.some(request => request.completed?.actionId === 'view'));
  assert.equal(executions.length, 1);
  assert.deepEqual(opened[0], [['/authorized/new.xyz'], 'xyzrender']);
});
