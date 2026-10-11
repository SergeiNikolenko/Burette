import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const source = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
const fn = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const window = new Window();
const prepare = new Function('DOMParser', 'XMLSerializer', 'sanitizeSVG',
  ['stripSVGClipping', 'markSVGForFitting', 'prepareXyzrenderCardSVG'].map(fn).join('\n') + '\nreturn prepareXyzrenderCardSVG;')(
  window.DOMParser, window.XMLSerializer, value => value);
const result = prepare('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100%" height="100%" fill="#ffffff"/><circle r="5" fill="#ffffff"/><path d="M0 0L10 10" stroke="#ff0d0d"/><rect width="10" height="10" fill="#fff"/></svg>');
const svg = new window.DOMParser().parseFromString(result, 'image/svg+xml');
assert.equal(svg.querySelector('rect[width="100%"]'), null, 'card supplies the themed backdrop');
assert.equal(svg.querySelector('circle').getAttribute('fill'), '#ffffff', 'white atoms stay white');
assert.equal(svg.querySelector('path').getAttribute('stroke'), '#ff0d0d', 'element colours are not inverted');
assert.equal(svg.querySelector('rect').getAttribute('width'), '10', 'molecular geometry is retained');
assert.equal(svg.documentElement.getAttribute('data-buret-xyzrender-svg'), 'true');
window.happyDOM.abort();
console.log('Card theming removes only the canvas background and preserves molecular colours');
