import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';

test('native preview preserves runtime configuration and safely defaults controls to collapsed', async () => {
  const window = new Window();
  const source = await readFile(new URL('../plugins/burette-agent/ui/native-workspace-preview.mjs', import.meta.url), 'utf8');
  const prepare = runInNewContext(source.replace(/^import .*\n/, '').replace('export function', 'function') + '\nprepareWorkspacePreview', {
    DOMParser: window.DOMParser, installWorkspaceTooltipLayout() {},
  });
  const config = { documentId: 'fixture', title: '</script><img src=x>', theme: 'dark' };
  const html = prepare(`<html><head><script type="application/json" id="burette-runtime-config">${JSON.stringify(config).replaceAll('<', '\\u003c')}</script><script src="viewer.js"></script></head><body></body></html>`);
  const doc = new window.DOMParser().parseFromString(html, 'text/html');
  assert.deepEqual(JSON.parse(doc.getElementById('burette-runtime-config').textContent), { ...config, defaultToolbarCollapsed: true, hostedMcpWidgetBootstrap: true });
  assert.equal(doc.querySelector('img'), null);
  assert.equal(doc.querySelector('[data-burette-script="viewer.js"]').type, 'application/burette-pending');
  await window.happyDOM.close();
});

test('native toolbar starts collapsed without changing ordinary preview defaults', async () => {
  const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function restoreToolbarCollapsed(');
  const end = source.indexOf('  function setToolbarCollapsed(', start);
  for (const native of [false, true]) {
    const calls = [];
    const restore = runInNewContext(source.slice(start, end) + '\nrestoreToolbarCollapsed', {
      window: { BuretteConfig: { defaultToolbarCollapsed: native } },
      TOOLBAR_COLLAPSED_VERSION: 'fixture',
      setToolbarCollapsed: (...args) => calls.push(args),
    });
    restore('toolbar', 'viewer');
    assert.deepEqual(calls, [['toolbar', native, 'viewer', false]]);
  }
});
