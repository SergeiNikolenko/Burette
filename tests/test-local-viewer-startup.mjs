import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createViewerDocuments } from '../plugins/burette-agent/ui/local-viewer-documents.mjs';
import { workspaceLoadingStyle, workspaceLoadingMarkup } from '../plugins/burette-agent/ui/native-workspace-loading.mjs';

const source = await readFile(new URL('../plugins/burette-agent/ui/local-viewer.mjs', import.meta.url), 'utf8');
// Exercise the production download loop without starting WebGL or a host UI.
const exchange = source.slice(source.indexOf('async function exchange('), source.indexOf('async function loadScript('));

test('compact display changes return to chat without closing the session', async () => {
  const start = source.indexOf('onToggle: async () => {');
  const callback = source.slice(start + 'onToggle: '.length, source.indexOf('\n      },', start) + 8);
  for (const mode of ['inline', 'fullscreen']) {
    for (const rejected of [false, true]) {
      const requested = [];
      let closed = false;
      let resized = 0;
      const status = { classList: { remove() {} }, textContent: '' };
      const invoke = runInNewContext(`let displayMode = '${mode}', displayPending = false, revision = 0;
        const toggle = ${callback};
        async () => { await toggle(); return { displayMode, displayPending, revision }; }`, {
        status, updateHeader() {},
        lifetime: { close: async () => { closed = true; } },
        window: { BuretteHandleResize: () => resized++ },
        app: { requestDisplayMode: async ({ mode }) => {
          requested.push(mode);
          if (rejected) throw new Error('Host rejected placement');
          return { mode };
        } },
      });
      const target = mode === 'inline' ? 'fullscreen' : 'inline';
      assert.deepEqual(JSON.parse(JSON.stringify(await invoke())), {
        displayMode: rejected ? mode : target, displayPending: false, revision: rejected ? 0 : 1,
      });
      assert.deepEqual(requested, [target]);
      assert.equal(closed, false);
      assert.equal(resized, 1);
      assert.equal(status.textContent, rejected ? 'Host rejected placement' : '');
    }
  }
});

test('MCP entry connects once and ignores replayed opener results', async () => {
  const entry = await readFile(new URL('../plugins/burette-agent/ui/mcp-viewer-entry.mjs', import.meta.url), 'utf8');
  const initialized = [];
  let connections = 0;
  const result = { _meta: { session: { sessionId: 'fixture' } } };
  const connect = runInNewContext(entry.replace(/^import .+;$/gmu, '').replace('export async', 'async') + '\nconnectViewer', {
    App: class {
      async connect() {
        connections++;
        await this.ontoolresult({ content: [] });
        await this.ontoolresult(result);
        await this.ontoolresult(result);
      }
    },
  });
  await connect('fixture', async (_app, value) => initialized.push(value));
  assert.equal(connections, 1);
  assert.deepEqual(initialized, [result]);
});

for (const workspace of [true, false, undefined]) {
  test(`legacy UI resource starts only the requested renderer for workspace=${workspace}`, async () => {
    const entry = await readFile(new URL('../plugins/burette-agent/ui/local-viewer-entry.mjs', import.meta.url), 'utf8');
    const status = { textContent: '' };
    let compactStyleRemoved = false;
    const body = { dataset: { displayMode: 'inline' }, children: ['compact-payload', 'compact-shell'], replaceChildren(...children) { this.children = children; } };
    const starts = [];
    const app = {};
    const result = { structuredContent: { workspace } };
    await runInNewContext(`(async () => { ${entry.replace(/^import .+;$/gmu, '')} })()`, {
      workspaceLoadingStyle, workspaceLoadingMarkup,
      connectViewer: async (_name, initialize) => initialize(app, result),
      document: {
        body, head: { appendChild() {} }, createElement: () => ({}),
        getElementById: id => id === 'status' ? status : { remove() { compactStyleRemoved = true; } },
      },
      startNativeWorkspace: async (actualApp, actualResult) => {
        assert.equal(actualApp, app);
        assert.equal(actualResult, result);
        assert.equal(compactStyleRemoved, true);
        assert.equal(body.dataset.displayMode, undefined);
        assert.equal(status.innerHTML, workspaceLoadingMarkup);
        assert.deepEqual(body.children, [status, { id: 'root' }]);
        starts.push('workspace');
      },
      startLocalViewer: async () => {
        assert.equal(compactStyleRemoved, false);
        assert.deepEqual(body.children, ['compact-payload', 'compact-shell']);
        starts.push('compact');
      },
    });
    assert.deepEqual(starts, [workspace === true ? 'workspace' : 'compact']);
  });
}

for (const behavior of ['supported', 'unsupported', 'rejected']) {
  test(`native placement request is one-shot and reports ${behavior} host behavior`, async () => {
    const placement = source.slice(source.indexOf('async function requestInitialPlacement()'), source.indexOf("window.addEventListener('burette-selection-changed'"));
    const requests = [];
    const status = { textContent: '', classList: { remove() {} } };
    const run = runInNewContext(`let initialDisplayRequested = false; let displayMode = 'inline'; ${placement} async function place() { await requestInitialPlacement(); return displayMode; } place`, {
      requestedDisplayMode: 'fullscreen', status, updateHeader() {},
      app: {
        sendSizeChanged: async () => {},
        getHostContext: () => ({ availableDisplayModes: behavior === 'unsupported' ? ['inline'] : ['inline', 'fullscreen'] }),
        requestDisplayMode: async request => { requests.push(request.mode); if (behavior === 'rejected') throw new Error('Host rejected placement'); return { mode: request.mode }; },
      },
    });
    assert.equal(await run(), behavior === 'supported' ? 'fullscreen' : 'inline');
    await run();
    assert.deepEqual(requests, behavior === 'unsupported' ? [] : ['fullscreen']);
    if (behavior !== 'supported') assert.match(status.textContent, /side.pane/);
  });
}

for (const terminalCursor of [null, undefined]) {
  test(`inline source download finishes when the host returns ${terminalCursor} as its continuation`, async () => {
    const offsets = [];
    const config = { label: 'fixture.pdb', byteCount: 6 };
    const documents = createViewerDocuments({
      documents: [{ id: 'fixture' }], changed() {},
      exchange: async input => {
        assert.ok(Number.isInteger(input.offset), 'MCP proxy rejects undefined offsets');
        offsets.push(input.offset);
        if (input.offset === 0) return { config, dataBase64: Buffer.from('abc').toString('base64'), nextOffset: 3 };
        assert.equal(input.offset, 3);
        return {
          config,
          dataBase64: Buffer.from('def').toString('base64'),
          ...(terminalCursor === null ? { nextOffset: null } : {}),
        };
      },
    });
    const downloaded = await documents.source('fixture');
    assert.equal(Buffer.from(downloaded.bytes).toString(), 'abcdef');
    assert.deepEqual(offsets, [0, 3]);
    assert.deepEqual(downloaded.config, config);
  });
}

test('inline exchange sends JSON-safe viewer action results to the native proxy', async () => {
  const agent = await readFile(new URL('../PreviewExtension/Web/burette-agent.js', import.meta.url), 'utf8');
  const success = agent.slice(agent.indexOf('  function success('), agent.indexOf('  function failure('));
  const outcome = runInNewContext(`${success}\nsuccess('selectResidues', { selectionId: 'selection-1' }, 0)`, {
    state: { sceneVersion: 1 }, getMolstarVersion: () => 'fixture', durationSince: () => 1,
  });
  const completed = { actionId: 'action-1', result: outcome };
  const input = { state: { ready: true, camera: undefined, lastAction: completed }, completed };
  const payload = { actions: [] };
  const invoke = runInNewContext(`${exchange}\nexchange`, {
    session: { sessionId: 'session-1', token: 'fixture-token' },
    app: { callServerTool: async request => {
      const actual = structuredClone(request.arguments);
      assert.deepEqual(actual, JSON.parse(JSON.stringify(actual)), 'Native proxy requires JSON values, not undefined fields');
      assert.deepEqual(actual.completed.result, JSON.parse(JSON.stringify(outcome)));
      return { _meta: { payload } };
    } },
  });
  assert.equal(await invoke(input), payload);
});

test('idle heartbeats reuse composition, invalidate on structure replacement, and acknowledge without an extra delay', async () => {
  const polling = source.slice(source.indexOf('async function poll()'), source.indexOf('app.onhostcontextchanged'));
  const structures = [{ cell: { obj: { data: {} } } }];
  const delays = [];
  const sent = [];
  const published = [];
  const documents = { activeId: 'fixture', busy: false, tabs: [{ id: 'fixture' }], closed: [], handles: () => false };
  let activeSelection = null;
  let summaries = 0;
  let action;
  let disconnected = false;
  const poll = runInNewContext(`
    let summaryCache; let summaryStructures = []; let contextSignature = '';
    let revision = 0; let displayMode = 'fullscreen'; let completed = null; let lastAction = null; let viewerInitialized = false;
    const executed = new Map(); ${polling} poll`, {
    selection: null, session: { sessionId: 'fixture' }, TextEncoder,
    lifetime: { closed: false, schedule: (_callback, ms) => delays.push(ms) },
    documents,
    document: { hidden: false }, status: { dataset: {} }, updateHeader() {},
    setTimeout: (_callback, ms) => delays.push(ms),
    createLocalViewerContext: () => ({ content: [{ type: 'text', text: 'Molecular context' }], structuredContent: { burette: { activeSelection, scene: {} } }, presentation: { composerAttachmentLayout: 'card' } }),
    app: { getHostCapabilities: () => ({ updateModelContext: {} }), updateModelContext: async context => published.push(JSON.parse(JSON.stringify(context))) },
    exchange: async input => { if (disconnected) throw new Error('Disconnected'); sent.push(input); const actions = action ? [action] : []; action = null; return { actions }; },
    window: {
      BuretteViewer: { plugin: { managers: { structure: { hierarchy: { current: { structures } } } } } },
      BuretteAgent: { run: async () => { summaries += 1; return { ok: true, result: { counts: { atoms: 9 } } }; } },
      BuretteViewerActions: { run: async () => ({ ok: true, result: {} }) },
    },
  });
  await poll();
  await poll();
  assert.equal(summaries, 1, 'idle heartbeats must not walk atoms or append duplicate summaries to the command log');
  assert.deepEqual(published, [{ content: [] }], 'opening without a selection must not publish text, structure metadata or a composer card');
  activeSelection = { atoms: 44, label: 'NAD' };
  await poll();
  assert.deepEqual(published.at(-1).structuredContent.burette.activeSelection, activeSelection);
  assert.equal(published.at(-1).presentation.composerAttachmentLayout, 'card');
  activeSelection = null;
  await poll();
  await poll();
  assert.deepEqual(published.at(-1), { content: [] });
  assert.equal(published.length, 3, 'deselection clears once, not on every heartbeat');
  activeSelection = { atoms: 0 };
  await poll();
  assert.equal(published.length, 3, 'empty selection objects must not create cards');
  activeSelection = { atoms: 9 };
  await poll();
  documents.busy = true;
  await poll();
  assert.deepEqual(published.at(-1), { content: [] }, 'switching documents clears the old card even before a selection event arrives');
  activeSelection = null;
  documents.busy = false;
  await poll();
  structures[0].cell.obj.data = {};
  await poll();
  assert.equal(summaries, 3, 'replacing the underlying structure must invalidate composition');
  action = { actionId: 'fixture-action', action: { type: 'reset_camera' } };
  await poll();
  assert.equal(delays.at(-1), 0);
  await poll();
  assert.equal(sent.at(-1).completed.actionId, 'fixture-action');
  assert.equal(delays.at(-1), 1000);
  action = { actionId: 'stale-document', documentId: 'other-document', action: { type: 'reset_camera' } };
  await poll();
  await poll();
  assert.match(sent.at(-1).completed.error, /active document changed/u);
  action = { actionId: 'unacknowledged', action: { type: 'reset_camera' } };
  await poll();
  disconnected = true;
  await poll();
  assert.equal(delays.at(-1), 1000, 'transport failure must not create a zero-delay retry loop');
});
