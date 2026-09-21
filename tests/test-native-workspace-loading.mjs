import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { workspaceLoadingStyle, workspaceLoadingMarkup } from '../plugins/burette-agent/ui/native-workspace-loading.mjs';

const source = await readFile(new URL('../plugins/burette-agent/ui/native-workspace-loading.mjs', import.meta.url), 'utf8');
test('opening uses one accessible spinner and its stable familiar label without duplication', () => {
  const createElement = tag => ({ tag, attributes: {}, children: [], setAttribute(key, value) { this.attributes[key] = value; }, append(...nodes) { this.children.push(...nodes); } });
  const opening = runInNewContext(source.replaceAll('export ', '') + '\nshowWorkspaceOpening', {
    document: { createElement, createTextNode: text => text },
  });
  const status = { children: ['reading card'], querySelector() { return null; }, replaceChildren(...nodes) { this.children = nodes; } };
  opening(status);
  opening(status);
  assert.equal(status.children.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(status.children[0])), {
    tag: 'div', attributes: { role: 'status' }, className: 'workspace-loading workspace-loading-opening', children: [
      { tag: 'span', attributes: { 'aria-hidden': 'true' }, children: [], className: 'workspace-loading-spinner' },
      { tag: 'span', attributes: {}, children: [], textContent: 'Opening molecular structure...' },
    ],
  });
});

test('built native bootstrap includes the shared initial loading surface', async () => {
  const { workspaceLoadingStyle, workspaceLoadingMarkup } = await import('../plugins/burette-agent/ui/native-workspace-loading.mjs');
  const html = await readFile(new URL('../plugins/burette-agent/assets/native-workspace.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`<style>${workspaceLoadingStyle}</style>`));
  assert.ok(html.includes(`<div id="status" role="status">${workspaceLoadingMarkup}</div>`));
});

test('ready hides the loading overlay and errors remain visible without the spinner', () => {
  const window = new Window();
  try {
    const { document } = window;
    document.head.innerHTML = `<style>${workspaceLoadingStyle}</style>`;
    document.body.innerHTML = `<div id="status" role="status">${workspaceLoadingMarkup}</div>`;
    const status = document.getElementById('status');
    assert.equal(window.getComputedStyle(status).display, 'grid');
    status.hidden = true;
    assert.equal(window.getComputedStyle(status).display, 'none');
    status.hidden = false;
    status.textContent = 'Burette could not load: fixture error';
    assert.equal(window.getComputedStyle(status).display, 'block');
    assert.equal(status.querySelector('.workspace-loading'), null);
  } finally { window.close(); }
});

test('spinner is retained across loading stages and failure offers an accessible retry', () => {
  const dom = new Window();
  try {
    const { document } = dom;
    document.head.innerHTML = `<style>${workspaceLoadingStyle}</style>`;
    document.body.innerHTML = `<div id="status">${workspaceLoadingMarkup}</div><div id="root">Intermediate scene</div>`;
    let retries = 0;
    const { opening, fail } = runInNewContext(source.replaceAll('export ', '') + '\n({ opening: showWorkspaceOpening, fail: showWorkspaceFailure })', {
      document, window: { location: { reload() { retries++; } } },
    });
    const status = document.getElementById('status');
    const spinner = status.querySelector('.workspace-loading-spinner');
    opening(status);
    opening(status);
    assert.equal(status.querySelector('.workspace-loading-spinner'), spinner);
    assert.equal(status.textContent, 'Opening molecular structure...');
    document.documentElement.dataset.theme = 'dark';
    assert.equal(dom.getComputedStyle(document.body).backgroundColor, '#000');
    assert.equal(dom.getComputedStyle(document.getElementById('root')).opacity, '0');
    fail(status, 'Fixture render failure');
    assert.equal(status.querySelector('[role="alert"]').textContent, 'Fixture render failureRetry');
    assert.equal(status.querySelector('.workspace-loading-spinner'), null);
    assert.equal(dom.getComputedStyle(status).display, 'grid');
    status.querySelector('button').click();
    assert.equal(retries, 1);
  } finally { dom.close(); }
});
