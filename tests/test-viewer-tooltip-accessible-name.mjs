import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';

const require = createRequire(import.meta.url);
const { IconButton } = require('molstar/lib/commonjs/mol-plugin-ui/controls/common.js');
const { HomeOutlinedSvg, SaveOutlinedSvg, AccountTreeOutlinedSvg } = require('molstar/lib/commonjs/mol-plugin-ui/controls/icons.js');
const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const start = source.indexOf('  let molstarControlTooltip = null;');
const end = source.indexOf('  function installDownloadExportBridge()', start);
assert.ok(start >= 0 && end > start);
const nativeButton = (title, svg = HomeOutlinedSvg) => renderToStaticMarkup(createElement(IconButton, { title, svg, transparent: true, onClick() {} }));
function fixture(markup) {
  const window = new Window();
  window.document.body.innerHTML = `<div class="msp-plugin">${markup}</div>`;
  runInNewContext(source.slice(start, end), { window, document: window.document, MutationObserver: window.MutationObserver });
  return window;
}
const fire = (window, button, event) => button.dispatchEvent(new window.Event(event, { bubbles: true }));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('real native Home, State Tree and Plugin State icon buttons keep their names after hover, click and keyboard focus', async () => {
  const window = fixture(nativeButton('Home') + nativeButton('State Tree', AccountTreeOutlinedSvg) + nativeButton('Plugin State', SaveOutlinedSvg));
  try {
    for (const button of window.document.querySelectorAll('button')) {
      const name = button.title;
      assert.equal(button.textContent.trim(), ''); assert.equal(button.getAttribute('aria-label'), null);
      fire(window, button, 'pointerover');
      assert.deepEqual([button.getAttribute('aria-label'), button.dataset.buretHint, button.hasAttribute('title')], [name, name, false]);
      fire(window, button, 'click');
      assert.equal(button.getAttribute('aria-label'), name);
      assert.equal(button.getAttribute('aria-describedby'), null, 'closing a hint must not remove the name');
      fire(window, button, 'focusin');
      assert.equal(window.document.querySelector('.buret-molstar-tooltip').textContent, name, 'the title-less button remains discoverable by the shared owner');
      fire(window, button, 'focusout'); assert.equal(button.getAttribute('aria-label'), name);
    }
  } finally { await window.happyDOM.close(); }
});

test('authored labels, labelledby references and visible button text are never replaced by tooltip descriptions', async () => {
  const window = fixture('<span id="external">External name</span>' +
    '<button title="Long explanation" aria-label="Authored name"><svg></svg></button>' +
    '<button title="Other explanation" aria-labelledby="external"><svg></svg></button>' +
    '<button title="Save a reusable state"><span>Save</span></button>' +
    '<div role="button" tabindex="0" title="Role action"><svg></svg></div>');
  try {
    const controls = [...window.document.querySelectorAll('button, [role="button"]')];
    for (const control of controls) fire(window, control, 'focusin');
    assert.deepEqual(controls.map(control => [control.getAttribute('aria-label'), control.getAttribute('aria-labelledby'), control.textContent]),
      [['Authored name', null, ''], [null, 'external', ''], [null, null, 'Save'], ['Role action', null, '']]);
    assert.ok(controls.every(control => !control.hasAttribute('title')));
  } finally { await window.happyDOM.close(); }
});

test('controller retitles update only helper-owned names and yield to a new authored name or text', async () => {
  const window = fixture(nativeButton('Show panel') + nativeButton('Open panel'));
  try {
    const [button, textButton] = window.document.querySelectorAll('button');
    fire(window, button, 'pointerover'); button.title = 'Hide panel'; await tick();
    assert.deepEqual([button.getAttribute('aria-label'), button.dataset.buretHint, button.hasAttribute('title')], ['Hide panel', 'Hide panel', false]);
    button.setAttribute('aria-label', 'Authored replacement'); button.title = 'Controller hint'; await tick();
    assert.equal(button.getAttribute('aria-label'), 'Authored replacement');
    fire(window, textButton, 'pointerover');
    assert.equal(textButton.getAttribute('aria-label'), 'Open panel');
    textButton.append('Visible action'); textButton.title = 'Detailed explanation'; await tick();
    assert.equal(textButton.getAttribute('aria-label'), null, 'a copied title must not override new button text');
    assert.equal(textButton.textContent, 'Visible action');
  } finally { await window.happyDOM.close(); }
});
