import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';

test('native preview preserves runtime configuration and safely defaults controls to collapsed', async () => {
  const window = new Window();
  const source = await readFile(new URL('../plugins/burette-agent/ui/native-workspace-preview.mjs', import.meta.url), 'utf8');
  const prepare = runInNewContext(source.replace(/^import .*\n/gm, '').replace('export function', 'function') + '\nprepareWorkspacePreview', {
    DOMParser: window.DOMParser, installWorkspaceTooltipLayout() {},
  });
  const config = { documentId: 'fixture', title: '</script><img src=x>', theme: 'dark' };
  const html = prepare(`<html><head><script type="application/json" id="burette-runtime-config">${JSON.stringify(config).replaceAll('<', '\\u003c')}</script><script src="viewer.js"></script></head><body></body></html>`);
  const doc = new window.DOMParser().parseFromString(html, 'text/html');
  assert.deepEqual(JSON.parse(doc.getElementById('burette-runtime-config').textContent), { ...config, autoFocusStructure: true, defaultToolbarCollapsed: true, hostedMcpWidgetBootstrap: true });
  assert.equal(doc.querySelector('img'), null);
  assert.equal(doc.querySelector('[data-burette-script="viewer.js"]').type, 'application/burette-pending');
  assert.ok(!html.includes('color-scheme:normal'), 'dark preview boot must never force light normal color-scheme');
  assert.ok(html.includes('color-scheme:dark'), 'dark preview boot must preserve dark color-scheme');
  await window.happyDOM.close();
});

test('native frame loader omits base element and propagates dark host theme', async () => {
  const window = new Window();
  window.document.documentElement.dataset.theme = 'dark';
  const source = await readFile(new URL('../plugins/burette-agent/ui/native-workspace-frame.mjs', import.meta.url), 'utf8');
  const prepareFrame = runInNewContext(source.replace(/^import .*\n/gm, '').replace('export async function', 'async function') + '\nprepareWorkspaceFrame', {
    DOMParser: window.DOMParser, document: window.document, window,
  });
  const assets = {
    response: async () => ({ text: async () => '<html lang="en"><head><script type="module" src="./assets/index.js"></script></head><body></body></html>' }),
    moduleBase: (path) => `https://burette.invalid/${path}`,
    resolve: (href) => href.replace(/^\.\//, 'shell/molecular-frame/'),
    asset: async (p) => `blob:${p}`,
  };
  const html = await prepareFrame('shell/molecular-frame/index.html', assets, 'https://sandbox.example');
  assert.ok(!/<base\b/i.test(html), 'CSP base-uri self forbids <base> elements in child frames');
  assert.ok(html.includes('class="dark"'), 'dark host theme must mark child root dark before first paint');
  assert.ok(html.includes('color-scheme:dark'), 'dark host theme must set dark color-scheme on child frame');
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
