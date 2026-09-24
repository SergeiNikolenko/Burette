import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const boundsCode = source.slice(source.indexOf('  function toolbarViewportBounds()'), source.indexOf('  function applyDefaultToolbarPosition('));
const positionCode = source.slice(source.indexOf('  function applyDefaultToolbarPosition('), source.indexOf('  function isToolbarCorner('));
const fitCode = source.slice(source.indexOf('  function fitToolbarToViewport('), source.indexOf('  function defaultToolbarTop('));
for (const width of [120, 320, 640, 1280]) {
  for (const rect of [null, { left: 0, top: 0, right: 1800, bottom: 900, width: 1800, height: 900 },
    { left: 1400, top: 0, right: 1800, bottom: 900, width: 400, height: 900 }]) {
    const { bounds, position } = runInNewContext(`${boundsCode}${fitCode}${positionCode}\n({bounds:toolbarViewportBounds, position:applyDefaultToolbarPosition})`, {
      window: { innerWidth: width, innerHeight: 700 },
      document: { querySelector: () => rect ? { getBoundingClientRect: () => rect } : null },
      TOOLBAR_MARGIN: 12, dockToolbar() {}, defaultToolbarTop: () => 12, updateFloatingLayoutOffsets() {},
    });
    const content = { style: {} };
    const toolbar = { style: {}, dataset: {}, querySelector: () => content,
      get offsetWidth() { return Math.min(420, parseFloat(this.style.maxWidth)); } };
    position(toolbar);
    assert.equal(bounds().right, width, 'A stale molecular viewport cannot move controls outside the actual frame');
    assert.ok(parseFloat(toolbar.style.left) + toolbar.offsetWidth <= width);
    assert.ok(parseFloat(toolbar.style.left) >= 0);
    assert.ok(parseFloat(content.style.maxWidth) >= 0);
  }
}
console.log('Toolbar bounds: stale oversized/offscreen viewports and 120-1280px windows passed');
