import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { workspaceContentHeight } from '../plugins/burette-agent/ui/native-workspace-sizing.mjs';

const source = await readFile(new URL('../plugins/burette-agent/ui/native-workspace-placement.mjs', import.meta.url), 'utf8');
function fixture(availableDisplayModes = ['inline', 'fullscreen']) {
  const nodes = [];
  const element = () => ({ children: [], attrs: {}, dataset: {}, style: { removeProperty(key) { delete this[key]; } }, appendChild(child) { this.children.push(child); }, setAttribute(key, value) { this.attrs[key] = value; } });
  const document = { querySelectorAll: () => [], createElement: () => { const node = element(); nodes.push(node); return node; }, documentElement: element(), head: element(), body: { ...element(), insertBefore() {} } };
  document.createElementNS = () => element();
  const events = new Map();
  const window = { innerWidth: 560, addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) };
  const sizes = [];
  const requests = [];
  const app = { getHostContext: () => ({ availableDisplayModes }), sendSizeChanged: async size => sizes.push(size), requestDisplayMode: async request => { requests.push(request); return request; } };
  const create = runInNewContext(source.replace(/^import .*\n/u, '').replace('export function', 'function') + '\ncreateWorkspacePlacement', { document, window, workspaceContentHeight });
  const status = {};
  return { placement: create(app, status), document, app, sizes, requests, status, events, window };
}

test('placement state moves the same workspace without inserting a second control', async () => {
  const { placement, document, sizes, requests } = fixture();
  assert.deepEqual(document.body.children, []);
  assert.deepEqual(structuredClone(placement.getSnapshot()), { mode: 'inline', target: 'fullscreen', disabled: false });
  await placement.set('fullscreen');
  assert.equal(placement.mode, 'fullscreen');
  placement.update({ displayMode: 'inline' });
  assert.equal(placement.getSnapshot().target, 'fullscreen');
  placement.update({ displayMode: 'fullscreen' });
  assert.equal(placement.getSnapshot().target, 'inline');
  await placement.set('inline');
  assert.deepEqual(structuredClone({ requests, sizes }), { requests: [{ mode: 'fullscreen' }, { mode: 'inline' }], sizes: [{ height: 480 }, { height: 480 }, { height: 480 }] });
});

test('hosts without a mode list can still grant placement requests', async () => {
  const { placement, requests } = fixture(null);
  assert.equal(placement.getSnapshot().disabled, false);
  await placement.set('fullscreen');
  assert.equal(placement.mode, 'fullscreen');
  assert.deepEqual(structuredClone(requests), [{ mode: 'fullscreen' }]);
});

test('returning after a structure loads preserves the original inline height', async () => {
  const { placement, document, sizes } = fixture();
  await placement.set('fullscreen');
  placement.observe({ activeSurface: { kind: 'ketcher' }, chemicalEditor: { structure: { atomCount: 500 } } });
  await placement.set('inline');
  assert.equal(document.body.style.height, '480px');
  assert.deepEqual(structuredClone(sizes), [{ height: 480 }, { height: 480 }]);
});

test('inline geometry follows width and host return without height feedback or remount', () => {
  const { placement, document, sizes, requests, events, window } = fixture();
  placement.update({ containerDimensions: { width: 420, height: 200 } });
  placement.update({ containerDimensions: { width: 420, height: 420 } });
  placement.update({ displayMode: 'fullscreen', containerDimensions: { width: 900 } });
  placement.update({ displayMode: 'inline', containerDimensions: { width: 420, height: 200 } });
  window.innerWidth = 360;
  events.get('resize')();
  assert.deepEqual(structuredClone(sizes), [{ height: 480 }, { height: 480 }]);
  assert.equal(document.body.style.height, '480px');
  assert.equal(document.documentElement.style.height, '480px');
  assert.deepEqual(requests, []);
  placement.dispose();
  assert.equal(events.size, 0);
});

test('wide chats retain full host width and do not jump when content finishes loading', async () => {
  const { placement, document, requests } = fixture();
  placement.update({ containerDimensions: { width: 1024, height: 200 } });
  assert.equal(document.body.style.width, undefined);
  assert.equal(document.body.style.height, '480px');
  placement.observe({ activeSurface: { kind: 'ketcher' }, chemicalEditor: { structure: { atomCount: 15 } } });
  assert.equal(document.body.style.height, '480px');
  assert.deepEqual(requests, []);
  await placement.set('fullscreen');
  assert.equal(document.body.style.width, undefined);
  assert.equal(document.body.style.height, undefined);
  assert.equal(document.body.style.margin, undefined);
});

test('incomplete host mode list still allows a request and rejection keeps the workspace', async () => {
  const { placement, app, status } = fixture(['inline']);
  assert.equal(placement.getSnapshot().disabled, false);
  placement.update({ availableDisplayModes: ['inline', 'fullscreen'] });
  app.requestDisplayMode = async () => { throw new Error('Host declined'); };
  await assert.rejects(placement.set('fullscreen'), /Host declined/);
  assert.equal(placement.mode, 'inline');
  assert.equal(placement.getSnapshot().disabled, false);
  assert.match(status.textContent, /Host declined/);
});

test('inline card retains its fixed budget without resize feedback', () => {
  const { placement, document, sizes, events, window } = fixture();
  for (const height of [520, 760, 280, 450]) {
    window.innerHeight = height;
    events.get('resize')();
    placement.update({ containerDimensions: { width: 560, height } });
    placement.observe({ activeSurface: { kind: 'ketcher' } });
    assert.equal(document.body.style.height, '480px');
    assert.equal(document.documentElement.style.height, '480px');
  }
  assert.deepEqual(structuredClone(sizes), [{ height: 480 }]);
});

test('repeated host resize or current-placement requests do not remount the app', async () => {
  const { placement, requests } = fixture();
  for (let index = 0; index < 10; index += 1) {
    placement.update({ displayMode: 'inline', containerDimensions: { width: 640 - index * 32 } });
    await placement.set('inline');
  }
  assert.deepEqual(requests, []);
});
