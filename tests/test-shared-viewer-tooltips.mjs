import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { Window } from 'happy-dom';

test('changing a preset updates the shared hint without restoring a second native tooltip', async () => {
  const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function updateMolstarPresetControl(');
  const end = source.indexOf('  function setMolstarPresetMenuRovingItem(', start);
  const window = new Window();
  const { document } = window;
  document.body.innerHTML = '<div id="buret-toolbar"><button data-buret-molstar-preset-trigger title="Old"><span data-buret-molstar-preset-label></span></button></div>';
  window.__buretteMolstarControlTooltipsInstalled = true;
  const update = runInNewContext(source.slice(start, end) + '\nupdateMolstarPresetControl', {
    window, document, activeConfig: {}, molstarPresetOption: () => ({ value: 'spacefill', label: 'Spacefill by Element' }),
    populateMolstarPresetMenu() {}, updateMolstarAppearanceControl() {}, configuredMolstarAppearance() {},
  });
  update(document.getElementById('buret-toolbar'), 'spacefill');
  const button = document.querySelector('button');
  assert.equal(button.textContent, 'Style: Spacefill by Element');
  assert.equal(button.dataset.buretHint, 'Mol* preset: Spacefill by Element');
  assert.equal(button.hasAttribute('title'), false);
  await window.happyDOM.close();
});

test('shared toolbar and rail show explanatory hints on pointer and keyboard focus', async () => {
  const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
  const start = source.indexOf('  let molstarControlTooltip = null;');
  const end = source.indexOf('  function installDownloadExportBridge()', start);
  assert.ok(start >= 0 && end > start);
  const window = new Window();
  const { document } = window;
  document.body.innerHTML = '<div id="buret-toolbar"><button aria-label="Edit"><span class="buret-tooltip">Edit molecule in Ketcher</span></button></div><div class="buret-viewport-rail"><button aria-label="Save a screenshot"></button></div><button class="buret-corner-toggle" title="Scene tree (⌘T)"><span class="buret-tooltip">Scene tree (⌘T)</span></button>';
  runInNewContext(source.slice(start, end), { window, document });
  const [edit, camera] = document.querySelectorAll('button');
  edit.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
  const hint = document.querySelector('.buret-molstar-tooltip');
  assert.equal(hint.textContent, 'Edit molecule in Ketcher');
  assert.equal(hint.getAttribute('aria-hidden'), 'false');
  edit.dispatchEvent(new window.Event('pointerout', { bubbles: true }));
  assert.equal(hint.getAttribute('aria-hidden'), 'true');
  camera.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  assert.equal(hint.textContent, 'Save a screenshot');
  assert.ok(hint.classList.contains('visible'));
  camera.dispatchEvent(new window.Event('focusout', { bubbles: true }));
  assert.equal(hint.classList.contains('visible'), false);
  const tree = document.querySelector('.buret-corner-toggle');
  tree.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
  assert.equal(tree.hasAttribute('title'), false, 'native tooltip must not overlap the shared hint');
  assert.equal(hint.textContent, 'Scene tree (⌘T)');
  assert.equal(document.querySelectorAll('.buret-molstar-tooltip').length, 1);
  tree.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.equal(hint.classList.contains('visible'), false);
  const css = await readFile(new URL('../PreviewExtension/Web/viewer-runtime.css', import.meta.url), 'utf8');
  assert.match(css, /\.buret-control-tooltips :is\([^)]*\.buret-corner-toggle\) \.buret-tooltip \{ display: none; \}/);
  window.happyDOM.abort();
});
