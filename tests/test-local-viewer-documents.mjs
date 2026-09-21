import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createViewerDocuments } from '../plugins/burette-agent/ui/local-viewer-documents.mjs';

test('native tabs lazily read sources, preserve scenes and release closed documents', async () => {
  const reads = [];
  const renders = [];
  const catalog = ['a', 'b', 'c'].map(id => ({ id, label: `${id}.pdb` }));
  let scene = { camera: 1, selection: 'a', layers: ['cartoon'] };
  let disposals = 0;
  const originalWindow = globalThis.window;
  globalThis.window = {
    BuretteConfig: { label: 'a.pdb' },
    BuretteViewer: { plugin: {
      state: { getSnapshot: () => structuredClone(scene) },
    } },
    BuretteViewerActions: { run: async action => {
      if (action.type === 'dispose_viewer') { disposals++; return { ok: true }; }
      renders.push(action);
      scene = action.snapshot || { camera: 0, selection: null, layers: ['default'] };
      globalThis.window.BuretteConfig = action.config;
      return { ok: true };
    } },
  };
  try {
    const docs = createViewerDocuments({ documents: catalog, changed() {}, exchange: async ({ documentId }) => {
      reads.push(documentId);
      return { config: { label: `${documentId}.pdb`, byteCount: 1 }, dataBase64: btoa(documentId), nextOffset: null };
    } });
    assert.deepEqual(reads, []);
    await docs.source('a');
    await docs.activate('b');
    assert.deepEqual(reads, ['a', 'b']);
    await docs.activate('a');
    assert.deepEqual(scene, { camera: 1, selection: 'a', layers: ['cartoon'] });
    assert.deepEqual(reads, ['a', 'b']);
    await docs.act({ type: 'move_tab', tabId: 'c', toIndex: 0 });
    assert.deepEqual(docs.tabs.map(tab => tab.id), ['c', 'a', 'b']);
    await docs.act({ type: 'close_tab', tabId: 'a' });
    assert.equal(docs.activeId, 'c');
    await docs.act({ type: 'close_other_tabs', tabId: 'b' });
    assert.deepEqual(docs.tabs.map(tab => tab.id), ['b']);
    await docs.act({ type: 'close_all_tabs' });
    assert.equal(docs.activeId, null);
    assert.equal(disposals, 1);
    assert.deepEqual(docs.closed, catalog);
    docs.dispose();
    await assert.rejects(docs.activate('a'), /closed/u);
    await assert.rejects(docs.source('a'), /closed/u);
  } finally { globalThis.window = originalWindow; }
});

test('close during a source read cannot retain or render the arriving document', async () => {
  let finish;
  const docs = createViewerDocuments({ documents: [{ id: 'a' }, { id: 'b' }], changed() {},
    exchange: () => new Promise(resolve => { finish = resolve; }) });
  const switching = docs.activate('b');
  docs.dispose();
  finish({ config: { byteCount: 1 }, dataBase64: 'YQ==', nextOffset: null });
  await assert.rejects(switching, /closed/u);
  assert.equal(docs.activeId, null);
  assert.deepEqual(docs.tabs, []);
});

test('failed replacement rolls back, concurrent actions are rejected and failed rollback clears readiness', async () => {
  const originalWindow = globalThis.window;
  let finish;
  let failRollback = false;
  globalThis.window = { BuretteConfig: {}, BuretteViewer: { plugin: { state: { getSnapshot: () => ({ camera: 'saved' }) } } },
    BuretteViewerActions: { run: async action => action.snapshot ? { ok: !failRollback } : { ok: false, error: { message: 'Bad structure' } } } };
  try {
    const docs = createViewerDocuments({ documents: [{ id: 'a' }, { id: 'b' }], changed() {}, exchange: async ({ documentId }) => {
      if (documentId === 'b') await new Promise(resolve => { finish = resolve; });
      return { config: { byteCount: 1 }, dataBase64: 'YQ==', nextOffset: null };
    } });
    await docs.source('a');
    const switchPromise = docs.activate('b');
    await assert.rejects(docs.act({ type: 'close_all_tabs' }), /in progress/u);
    finish();
    await assert.rejects(switchPromise, /Bad structure/u);
    assert.equal(docs.activeId, 'a');
    assert.equal(docs.busy, false);
    failRollback = true;
    await assert.rejects(docs.activate('b'), /could not be restored/u);
    assert.equal(docs.activeId, null);
  } finally { globalThis.window = originalWindow; }
});
