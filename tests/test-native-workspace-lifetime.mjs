import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createViewerLifetime } from '../plugins/burette-agent/ui/local-viewer-lifetime.mjs';

const source = await readFile(new URL('../plugins/burette-agent/ui/native-workspace.mjs', import.meta.url), 'utf8');

for (const unmount of ['host-teardown', 'pagehide']) {
  test(`native workspace survives display changes and empty tabs; ${unmount} retains its session`, async () => {
    const disposed = [];
    const requests = [];
    const listeners = new Map();
    const storage = { 'workspace.mcp-fixture': 'retained state' };
    storage.removeItem = key => { delete storage[key]; };
    const status = { hidden: false };
    const previewWindow = {};
    const window = { Worker: class {}, addEventListener: (name, callback) => listeners.set(name, callback) };
    let transportOptions;
    const app = {
      getHostContext: () => ({ availableDisplayModes: ['inline', 'fullscreen'] }),
      getHostCapabilities: () => ({}),
      requestDisplayMode: async ({ mode }) => ({ mode }),
      sendSizeChanged: async () => {},
      updateModelContext: async () => {},
      requestTeardown: () => assert.fail('The workspace must not dismiss its host pane'),
      callServerTool: async request => {
        requests.push(request.arguments);
        return { _meta: { payload: request.arguments.asset ? { manifest: { styles: [], entry: 'app.js' } } : {} } };
      },
    };
    const start = runInNewContext(source.replace(/^import .+;$/gmu, '').replace('export async', 'async') + '\nstartNativeWorkspace', {
      createViewerLifetime, localStorage: storage, prepareWorkspacePreview() {},
      showWorkspaceOpening() {},
      showWorkspaceFailure(status, message) { status.hidden = false; status.textContent = message; },
      createWorkspaceCheckpoint: async () => ({ restored: false, storage: {}, update() {}, dispose() {}, async flush() {} }),
      createWorkspacePlacement: () => ({ set: async mode => ({ ok: true, mode }), update() {}, observe() {}, dispose() {}, mode: 'inline' }),
      document: {
        getElementById: () => status, querySelectorAll: () => [{ contentWindow: previewWindow }], documentElement: { dataset: {} },
        body: { replaceChildren: () => assert.fail('No terminal closed screen'), dataset: {} },
      },
      window, setTimeout, clearTimeout,
      createWorkspaceAssets: () => ({ importModule: async () => {}, dispose: () => disposed.push('assets') }),
      createWorkspaceAgent: () => ({ request() {}, decorate: state => state }),
      createWorkspaceTransport: options => {
        transportOptions = options;
        return { fetch() {}, dispose: () => disposed.push('transport') };
      },
    });
    await start(app, { _meta: { session: { sessionId: 'fixture' } }, structuredContent: { view: 'auto', documents: [{ path: '/fixture.pdb' }] } });
    assert.equal(status.hidden, false, 'importing the app must not expose its loading stages');
    transportOptions.observe({ ready: true, activeDocument: { id: 'active', ready: true, renderer: 'molstar' } });
    assert.equal(status.hidden, false, 'agent readiness is earlier than the final molecular frame');
    window.BuretteMcpWorkspace.firstFrame('background');
    assert.equal(status.hidden, false, 'a background scene must not uncover the loading foreground');
    window.BuretteMcpWorkspace.firstFrame('active');
    assert.equal(status.hidden, true, 'the completed frame reveals the app');
    assert.equal(status.inert, false);
    listeners.get('message')({ source: {}, data: { source: 'burette-viewer', body: { type: 'error', message: 'Untrusted' } } });
    assert.equal(status.hidden, true, 'only the owned preview can report a render failure');
    listeners.get('message')({ source: previewWindow, data: { source: 'burette-viewer', body: { type: 'error', message: 'Owned render failure' } } });
    assert.equal(status.hidden, false);
    assert.equal(status.inert, true);
    assert.equal(status.textContent, 'Owned render failure');
    transportOptions.observe({ ready: false, error: 'Fixture loading error' });
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, 'Fixture loading error');
    transportOptions.observe({ tabs: [{ kind: 'file' }] });
    transportOptions.observe({ tabs: [] });
    app.onhostcontextchanged({ displayMode: 'inline' });
    app.onhostcontextchanged({ displayMode: 'fullscreen' });
    assert.deepEqual(structuredClone(await transportOptions.setDisplayMode('inline')), { ok: true, mode: 'inline' });
    listeners.get('pagehide')({ persisted: true });
    assert.deepEqual(disposed, []);
    if (unmount === 'host-teardown') await app.onteardown();
    else {
      listeners.get('pagehide')({ persisted: false });
      await app.onteardown();
    }
    assert.deepEqual(disposed, ['transport', 'assets']);
    assert.equal(storage['workspace.mcp-fixture'], 'retained state');
    assert.equal(requests.some(request => request.close === true), false);
  });
}
